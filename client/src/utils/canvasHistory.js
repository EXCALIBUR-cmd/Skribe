import * as fabric from 'fabric';
import { SKRIBE_SERIALIZABLE_PROPERTIES, hydrateCanvasObjects } from './fabricHydration.js';

export const captureCanvasHistory = (canvas, memo = null) => {
  const properties = [...SKRIBE_SERIALIZABLE_PROPERTIES];
  if (!memo || !Array.isArray(canvas._objects) || typeof canvas._toObject !== 'function') return JSON.stringify(canvas.toObject(properties));
  const live = canvas._objects;
  let shell;
  canvas._objects = [];
  try {
    shell = canvas.toObject(properties);
  } finally {
    canvas._objects = live;
  }
  const { objects: emptied, ...rest } = shell;
  const objects = live
    .filter((object) => !object.excludeFromExport)
    .map((object) => memo.read(object, () => canvas._toObject(object, 'toObject', properties), JSON.stringify));
  const head = JSON.stringify(rest).slice(1, -1);
  return `{${head ? `${head},` : ''}"objects":[${objects.join(',')}]}`;
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
