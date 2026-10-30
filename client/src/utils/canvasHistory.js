import { SKRIBE_SERIALIZABLE_PROPERTIES, hydrateCanvasObjects } from './fabricHydration.js';

export const captureCanvasHistory = (canvas) => JSON.stringify(canvas.toObject([...SKRIBE_SERIALIZABLE_PROPERTIES]));

export const restoreCanvasHistory = async (canvas, snapshot) => {
  const parsed = JSON.parse(snapshot);
  await canvas.loadFromJSON(parsed);
  return hydrateCanvasObjects(canvas, parsed);
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
