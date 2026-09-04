import { isTemporaryObject } from './cleanupTypes.js';
import { detectRelationships } from './detectRelationships.js';
import { normalizeObject } from './normalizeObjects.js';
import { hydrateSkribeFabricObject } from '../../utils/fabricHydration.js';
import { logObjectDiagnostic, logMessCleanupInventory } from './messCleanupDiagnostic.js';

export const extractWorkspaceModel = (canvas) => {
  const fabricObjects = canvas && typeof canvas.getObjects === 'function' ? canvas.getObjects() : [];
  const validObjects = fabricObjects.filter((object) => !isTemporaryObject(object));
  const totalCount = validObjects.length;

  const normalizedObjects = validObjects.map((object, index) => {
    hydrateSkribeFabricObject(object, object);
    const normalized = normalizeObject(object, index);
    logObjectDiagnostic(object, index, totalCount, normalized);
    return normalized;
  });

  const resolvedObjects = detectRelationships(normalizedObjects);
  logMessCleanupInventory(resolvedObjects);

  return {
    version: 1,
    board: {
      objects: resolvedObjects
    }
  };
};

export default extractWorkspaceModel;
