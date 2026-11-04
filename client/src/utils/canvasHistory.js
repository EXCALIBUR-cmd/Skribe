import * as fabric from 'fabric';
import { SKRIBE_SERIALIZABLE_PROPERTIES, hydrateCanvasObjects, hydrateRestoredObject } from './fabricHydration.js';

const captureParts = (canvas, memo, properties) => {
  const live = canvas._objects;
  let shell;
  canvas._objects = [];
  try {
    shell = canvas.toObject(properties);
  } finally {
    canvas._objects = live;
  }
  const { objects: emptied, ...rest } = shell;
  const exported = live.filter((object) => !object.excludeFromExport);
  return {
    head: JSON.stringify(rest).slice(1, -1),
    exported,
    strings: exported.map((object) => memo.read(object, () => canvas._toObject(object, 'toObject', properties), JSON.stringify))
  };
};

const canCaptureParts = (canvas, memo) => Boolean(memo) && Array.isArray(canvas._objects) && typeof canvas._toObject === 'function';

export const captureCanvasHistory = (canvas, memo = null) => {
  const properties = [...SKRIBE_SERIALIZABLE_PROPERTIES];
  if (!canCaptureParts(canvas, memo)) return JSON.stringify(canvas.toObject(properties));
  const { head, strings } = captureParts(canvas, memo, properties);
  return `{${head ? `${head},` : ''}"objects":[${strings.join(',')}]}`;
};

export const loadCanvasTolerant = async (canvas, payload) => {
  const objects = Array.isArray(payload?.objects) ? payload.objects : [];
  try {
    await canvas.loadFromJSON(payload);
    return { payload, unrestorable: [] };
  } catch (loadError) {
    const outcomes = await Promise.all(objects.map((object) => (
      fabric.util.enlivenObjects([JSON.parse(JSON.stringify(object))]).then(() => true, () => false)
    )));
    if (outcomes.every(Boolean)) throw loadError;
    const restorable = { ...payload, objects: objects.filter((_, index) => outcomes[index]) };
    const unrestorable = objects.flatMap((data, index) => (outcomes[index] ? [] : [{ index, data }]));
    await canvas.loadFromJSON(restorable);
    return { payload: restorable, unrestorable };
  }
};

export const mergeRetainedObjects = (objects, retained) => {
  if (!Array.isArray(retained) || retained.length === 0) return objects;
  const merged = [...objects];
  [...retained].sort((a, b) => a.index - b.index).forEach(({ index, data }) => {
    merged.splice(Math.min(index, merged.length), 0, data);
  });
  return merged;
};

export const retainUnrestorable = (canvas, unrestorable) => {
  const known = canvas.skribeRetainedObjects || [];
  const ids = new Set(known.map((entry) => entry.data?.id));
  canvas.skribeRetainedObjects = [...known, ...unrestorable.filter((entry) => !ids.has(entry.data?.id))];
};

export const restoreCanvasHistory = async (canvas, snapshot) => {
  const { payload, unrestorable } = await loadCanvasTolerant(canvas, JSON.parse(snapshot));
  retainUnrestorable(canvas, unrestorable);
  return hydrateCanvasObjects(canvas, payload);
};

const hasUniqueIds = (objects) => {
  const ids = new Set();
  return objects.every((object) => {
    if (typeof object?.id !== 'string' || !object.id || ids.has(object.id)) return false;
    ids.add(object.id);
    return true;
  });
};

const planHistoryRestore = (canvas, target, memo) => {
  if (!canCaptureParts(canvas, memo) || !Array.isArray(target?.objects)) return null;
  const { head, exported, strings } = captureParts(canvas, memo, [...SKRIBE_SERIALIZABLE_PROPERTIES]);
  const { objects: wanted, ...rest } = target;
  if (JSON.stringify(rest).slice(1, -1) !== head) return null;
  if (exported.length !== canvas._objects.length || !hasUniqueIds(exported) || !hasUniqueIds(wanted)) return null;
  const liveIndex = new Map(exported.map((object, index) => [object.id, index]));
  const fresh = wanted.filter((raw) => !liveIndex.has(raw.id) || strings[liveIndex.get(raw.id)] !== JSON.stringify(raw));
  if (fresh.length > wanted.length / 2) return null;
  const wantedIds = new Set(wanted.map((raw) => raw.id));
  return {
    wanted,
    fresh,
    live: exported,
    diff: {
      added: fresh.filter((raw) => !liveIndex.has(raw.id)).map((raw) => raw.id),
      modified: fresh.filter((raw) => liveIndex.has(raw.id)).map((raw) => raw.id),
      removed: exported.filter((object) => !wantedIds.has(object.id)).map((object) => object.id)
    }
  };
};

export const restoreHistoryIncrementally = async (canvas, snapshot, memo) => {
  const full = async () => ({ objects: await restoreCanvasHistory(canvas, snapshot), fresh: null, diff: null });
  if (typeof canvas.discardActiveObject === 'function') canvas.discardActiveObject();
  const plan = planHistoryRestore(canvas, JSON.parse(snapshot), memo);
  if (!plan) return full();
  let enlivened;
  try {
    enlivened = await fabric.util.enlivenObjects(plan.fresh);
  } catch {
    return full();
  }
  const unchangedMeanwhile = canvas._objects.length === plan.live.length && canvas._objects.every((object, index) => object === plan.live[index]);
  if (enlivened.length !== plan.fresh.length || !unchangedMeanwhile) return full();
  const replacements = new Map(plan.fresh.map((raw, index) => [raw.id, enlivened[index]]));
  const liveById = new Map(plan.live.map((object) => [object.id, object]));
  const next = plan.wanted.map((raw) => replacements.get(raw.id) || liveById.get(raw.id));
  const kept = new Set(next);
  plan.live.filter((object) => !kept.has(object)).forEach((object) => object._set('canvas', undefined));
  if (canvas._hoveredTarget && !kept.has(canvas._hoveredTarget)) canvas._hoveredTarget = undefined;
  plan.fresh.forEach((raw, index) => {
    const object = enlivened[index];
    object._set('canvas', canvas);
    object.setCoords();
    hydrateRestoredObject(object, raw);
  });
  canvas._objects = next;
  return { objects: next, fresh: enlivened, diff: plan.diff };
};

const indexSnapshot = (snapshot) => new Map(
  (JSON.parse(snapshot).objects || [])
    .filter((object) => object && object.id)
    .map((object) => [object.id, JSON.stringify(object)])
);

export const diffCanvasHistory = (beforeSnapshot, afterSnapshot) => {
  const before = indexSnapshot(beforeSnapshot);
  const after = indexSnapshot(afterSnapshot);
  return {
    added: [...after.keys()].filter((id) => !before.has(id)),
    modified: [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id)),
    removed: [...before.keys()].filter((id) => !after.has(id))
  };
};
