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

const keysFor = (ids) => {
  const seen = new Map();
  return ids.map((id) => {
    const count = seen.get(id) || 0;
    seen.set(id, count + 1);
    return `${id}#${count}`;
  });
};

const indexState = ({ keys, strings }) => new Map(keys.map((key, index) => [key, strings[index]]));

export const captureHistoryState = (canvas, memo = null) => {
  const properties = [...SKRIBE_SERIALIZABLE_PROPERTIES];
  if (!canCaptureParts(canvas, memo)) {
    const { objects = [], ...rest } = canvas.toObject(properties);
    return { head: JSON.stringify(rest).slice(1, -1), keys: keysFor(objects.map((object) => object.id)), strings: objects.map((object) => JSON.stringify(object)) };
  }
  const { head, exported, strings } = captureParts(canvas, memo, properties);
  return { head, keys: keysFor(exported.map((object) => object.id)), strings };
};

export const conflictHistoryState = (undoObjects, mergedObjects, current) => {
  const merged = new Set(mergedObjects);
  const known = indexState(current);
  const keyed = keysFor(undoObjects.map((object) => object.id)).map((key, index) => ({ key, object: undoObjects[index] }));
  const kept = keyed.filter(({ key, object }) => !merged.has(object) || known.has(key));
  return {
    head: current.head,
    keys: kept.map(({ key }) => key),
    strings: kept.map(({ key, object }) => (merged.has(object) ? known.get(key) : JSON.stringify(object)))
  };
};

export const serializeHistoryState = ({ head, strings }) => `{${head ? `${head},` : ''}"objects":[${strings.join(',')}]}`;

export const createHistoryEntry = (before, after) => {
  const beforeIndex = indexState(before);
  const afterIndex = indexState(after);
  const changes = [...new Set([...before.keys, ...after.keys])]
    .filter((key) => beforeIndex.get(key) !== afterIndex.get(key))
    .map((key) => ({ key, before: beforeIndex.get(key) ?? null, after: afterIndex.get(key) ?? null }));
  const orderChanged = before.keys.length !== after.keys.length || before.keys.some((key, index) => key !== after.keys[index]);
  const headChanged = before.head !== after.head;
  if (changes.length === 0 && !orderChanged && !headChanged) return null;
  return {
    changes,
    order: orderChanged ? { before: before.keys, after: after.keys } : null,
    head: headChanged ? { before: before.head, after: after.head } : null
  };
};

export const rebaseHistoryState = (base, before, after, previewKeys = []) => {
  const was = indexState(before);
  const now = indexState(after);
  const next = indexState(base);
  [...new Set([...before.keys, ...after.keys])].forEach((key) => {
    if (was.get(key) === now.get(key)) return;
    if (now.has(key)) next.set(key, now.get(key));
    else next.delete(key);
  });
  previewKeys.forEach((key) => {
    if (now.has(key) && next.has(key)) next.set(key, now.get(key));
  });
  const placed = new Set(after.keys);
  const remoteOrderChanged = before.keys.length !== after.keys.length || before.keys.some((key, index) => key !== after.keys[index]);
  const keys = remoteOrderChanged
    ? [...after.keys.filter((key) => next.has(key)), ...base.keys.filter((key) => next.has(key) && !placed.has(key))]
    : base.keys.filter((key) => next.has(key));
  return { head: before.head !== after.head ? after.head : base.head, keys, strings: keys.map((key) => next.get(key)) };
};

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const planChange = (live, from, to) => {
  if (live === from) return { next: to, conflict: false };
  if (live === to) return { next: live, conflict: false };
  if (live === null || from === null || to === null) return { next: live, conflict: true };
  const liveObject = JSON.parse(live);
  const fromObject = JSON.parse(from);
  const toObject = JSON.parse(to);
  const merged = { ...liveObject };
  const fields = new Set([...Object.keys(fromObject), ...Object.keys(toObject)]);
  for (const field of fields) {
    if (sameValue(fromObject[field], toObject[field]) || sameValue(liveObject[field], toObject[field])) continue;
    if (!sameValue(liveObject[field], fromObject[field])) return { next: live, conflict: true };
    if (field in toObject) merged[field] = toObject[field];
    else delete merged[field];
  }
  return { next: JSON.stringify(merged), conflict: false };
};

const LINK_FIELDS = ['elementId', 'parentShapeId', 'attachedTextId', 'sourceShapeId', 'targetShapeId'];
const REQUIRED_LINKS = ['parentShapeId', 'sourceShapeId', 'targetShapeId'];

const linkedSets = (plans) => {
  const parent = plans.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    return root;
  };
  const owner = new Map();
  plans.forEach((plan, index) => {
    [plan.from, plan.to, plan.live].filter(Boolean).forEach((text) => {
      const object = JSON.parse(text);
      [object.id, ...LINK_FIELDS.map((field) => object[field])].filter(Boolean).forEach((token) => {
        if (owner.has(token)) parent[find(index)] = find(owner.get(token));
        else owner.set(token, index);
      });
    });
  });
  return plans.map((_, index) => find(index));
};

const mergeOrder = (liveKeys, order, undoing, present) => {
  const from = order ? (undoing ? order.after : order.before) : null;
  const to = order ? (undoing ? order.before : order.after) : null;
  let base = liveKeys;
  if (order) {
    const liveSet = new Set(liveKeys);
    const fromSet = new Set(from);
    if (sameValue(liveKeys.filter((key) => fromSet.has(key)), from.filter((key) => liveSet.has(key)))) base = to;
  }
  const result = base.filter((key) => present.has(key));
  const placed = new Set(result);
  const place = (key, reference) => {
    const position = reference.indexOf(key);
    let anchor = -1;
    for (let index = position - 1; index >= 0 && anchor === -1; index -= 1) anchor = result.indexOf(reference[index]);
    result.splice(anchor + 1, 0, key);
    placed.add(key);
  };
  liveKeys.filter((key) => present.has(key) && !placed.has(key)).forEach((key) => place(key, liveKeys));
  if (to) to.filter((key) => present.has(key) && !placed.has(key)).forEach((key) => place(key, to));
  return result;
};

export const applyHistoryEntry = (live, entry, kind) => {
  const undoing = kind === 'undo';
  const liveIndex = indexState(live);
  const plans = entry.changes.map(({ key, before, after }) => {
    const from = undoing ? after : before;
    const to = undoing ? before : after;
    const current = liveIndex.get(key) ?? null;
    return { key, from, to, live: current, ...planChange(current, from, to) };
  });
  const present = new Set(live.keys);
  plans.forEach((plan) => {
    if (plan.next === null) present.delete(plan.key);
    else present.add(plan.key);
  });
  const restored = plans.filter((plan) => !plan.conflict && plan.live === null && plan.next !== null);
  if (restored.length > 0) {
    const presentIds = new Set([...present].map((key) => key.slice(0, key.lastIndexOf('#'))));
    restored.forEach((plan) => {
      const object = JSON.parse(plan.next);
      if (REQUIRED_LINKS.some((field) => object[field] && !presentIds.has(object[field]))) plan.conflict = true;
    });
  }
  if (plans.some((plan) => plan.conflict)) {
    const sets = linkedSets(plans);
    const blocked = new Set(sets.filter((_, index) => plans[index].conflict));
    plans.forEach((plan, index) => {
      if (!blocked.has(sets[index])) return;
      plan.next = plan.live;
      plan.conflict = true;
    });
  }
  const nextIndex = new Map(liveIndex);
  plans.forEach((plan) => {
    if (plan.next === null) nextIndex.delete(plan.key);
    else nextIndex.set(plan.key, plan.next);
  });
  const keys = mergeOrder(live.keys, entry.order, undoing, new Set(nextIndex.keys()));
  const headFrom = entry.head ? (undoing ? entry.head.after : entry.head.before) : null;
  const head = entry.head && live.head === headFrom ? (undoing ? entry.head.before : entry.head.after) : live.head;
  const effective = head !== live.head
    || keys.length !== live.keys.length
    || keys.some((key, index) => key !== live.keys[index])
    || plans.some((plan) => plan.next !== plan.live);
  return effective ? { head, keys, strings: keys.map((key) => nextIndex.get(key)) } : null;
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

const hasUniqueKeys = (keys) => keys.every((key) => key.endsWith('#0') && key !== '#0' && key !== 'undefined#0' && key !== 'null#0');

const parseHistoryState = (snapshot) => {
  const { objects, ...rest } = JSON.parse(snapshot);
  if (!Array.isArray(objects)) return null;
  return { head: JSON.stringify(rest).slice(1, -1), keys: keysFor(objects.map((object) => object?.id)), strings: objects.map((object) => JSON.stringify(object)) };
};

const planHistoryRestore = (canvas, target, memo, current) => {
  if (!canCaptureParts(canvas, memo) || !target) return null;
  const live = current || captureHistoryState(canvas, memo);
  if (target.head !== live.head) return null;
  const exported = canvas._objects.filter((object) => !object.excludeFromExport);
  if (exported.length !== canvas._objects.length || !hasUniqueKeys(live.keys) || !hasUniqueKeys(target.keys)) return null;
  const liveIndex = new Map(live.keys.map((key, index) => [key, index]));
  const freshIndices = [];
  target.keys.forEach((key, index) => {
    const at = liveIndex.get(key);
    if (at === undefined || live.strings[at] !== target.strings[index]) freshIndices.push(index);
  });
  if (freshIndices.length > target.keys.length / 2) return null;
  const fresh = freshIndices.map((index) => JSON.parse(target.strings[index]));
  const wantedKeys = new Set(target.keys);
  return {
    target,
    fresh,
    freshKeys: freshIndices.map((index) => target.keys[index]),
    live: exported,
    liveKeys: live.keys,
    diff: {
      added: fresh.filter((_, index) => !liveIndex.has(target.keys[freshIndices[index]])).map((raw) => raw.id),
      modified: fresh.filter((_, index) => liveIndex.has(target.keys[freshIndices[index]])).map((raw) => raw.id),
      removed: exported.filter((_, index) => !wantedKeys.has(live.keys[index])).map((object) => object.id)
    }
  };
};

export const restoreHistoryIncrementally = async (canvas, snapshot, memo, current = null) => {
  const text = () => (typeof snapshot === 'string' ? snapshot : serializeHistoryState(snapshot));
  const full = async () => ({ objects: await restoreCanvasHistory(canvas, text()), fresh: null, diff: null });
  if (typeof canvas.discardActiveObject === 'function') canvas.discardActiveObject();
  const plan = planHistoryRestore(canvas, typeof snapshot === 'string' ? parseHistoryState(snapshot) : snapshot, memo, current);
  if (!plan) return full();
  let enlivened;
  try {
    enlivened = await fabric.util.enlivenObjects(plan.fresh);
  } catch {
    return full();
  }
  const unchangedMeanwhile = canvas._objects.length === plan.live.length && canvas._objects.every((object, index) => object === plan.live[index]);
  if (enlivened.length !== plan.fresh.length || !unchangedMeanwhile) return full();
  const replacements = new Map(plan.freshKeys.map((key, index) => [key, enlivened[index]]));
  const liveByKey = new Map(plan.liveKeys.map((key, index) => [key, plan.live[index]]));
  const next = plan.target.keys.map((key) => replacements.get(key) || liveByKey.get(key));
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
