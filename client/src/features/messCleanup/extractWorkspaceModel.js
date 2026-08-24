import { isTemporaryObject } from './cleanupTypes.js';
import { detectRelationships } from './detectRelationships.js';
import { normalizeObject } from './normalizeObjects.js';

export const extractWorkspaceModel = (canvas) => {
  const fabricObjects = canvas && typeof canvas.getObjects === 'function' ? canvas.getObjects() : [];
  const normalizedObjects = fabricObjects
    .filter((object) => !isTemporaryObject(object))
    .map((object, index) => normalizeObject(object, index));

  return {
    version: 1,
    board: {
      objects: detectRelationships(normalizedObjects)
    }
  };
};

export default extractWorkspaceModel;
