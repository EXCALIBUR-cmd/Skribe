const isFiniteNumber = (val) => typeof val === 'number' && Number.isFinite(val);

const findCanvasObject = (canvasObjects, objectId) => {
  if (!objectId || !Array.isArray(canvasObjects)) return null;
  return canvasObjects.find(
    (obj) => (obj.id && String(obj.id) === String(objectId)) || (obj.elementId && String(obj.elementId) === String(objectId))
  ) || null;
};

export const validateProposal = (canvas, layoutProposal, workspaceModel) => {
  if (!canvas || typeof canvas.getObjects !== 'function') {
    return { valid: false, reason: 'Invalid or missing Fabric canvas' };
  }

  if (canvas.isLoadingFromJSON === true || canvas.isLoadingFromJSONRef?.current === true) {
    return { valid: false, reason: 'Canvas is currently loading JSON' };
  }

  if (canvas.isHistoryProcessing === true || canvas.isHistoryProcessingRef?.current === true) {
    return { valid: false, reason: 'Canvas is currently processing history/undo' };
  }

  if (!layoutProposal || !Array.isArray(layoutProposal.placements)) {
    return { valid: false, reason: 'Invalid layout proposal: placements array missing' };
  }

  const canvasObjects = canvas.getObjects() || [];
  const placementIds = new Set();

  for (const placement of layoutProposal.placements) {
    if (!placement || !placement.objectId) {
      return { valid: false, reason: 'Placement missing objectId' };
    }

    if (placementIds.has(placement.objectId)) {
      return { valid: false, reason: `Duplicate placement objectId: ${placement.objectId}` };
    }
    placementIds.add(placement.objectId);

    const targetObj = findCanvasObject(canvasObjects, placement.objectId);
    if (!targetObj) {
      return { valid: false, reason: `Target canvas object not found for objectId: ${placement.objectId}` };
    }

    if (placement.position) {
      if (!isFiniteNumber(placement.position.x) || !isFiniteNumber(placement.position.y)) {
        return { valid: false, reason: `Invalid position coordinates for objectId: ${placement.objectId}` };
      }
    }

    if (placement.bounds) {
      if (
        !isFiniteNumber(placement.bounds.x) ||
        !isFiniteNumber(placement.bounds.y) ||
        !isFiniteNumber(placement.bounds.width) ||
        !isFiniteNumber(placement.bounds.height)
      ) {
        return { valid: false, reason: `Invalid bounds for objectId: ${placement.objectId}` };
      }
    }

    if (placement.rotation !== undefined && !isFiniteNumber(placement.rotation)) {
      return { valid: false, reason: `Invalid rotation value for objectId: ${placement.objectId}` };
    }

    if (placement.scale) {
      if (!isFiniteNumber(placement.scale.x) || !isFiniteNumber(placement.scale.y)) {
        return { valid: false, reason: `Invalid scale values for objectId: ${placement.objectId}` };
      }
    }
  }

  for (const obj of canvasObjects) {
    if (obj.attachedTextId) {
      const textObj = findCanvasObject(canvasObjects, obj.attachedTextId);
      if (!textObj) {
        return { valid: false, reason: `Linked text object ${obj.attachedTextId} missing for shape ${obj.id}` };
      }
    }
    if (obj.parentShapeId) {
      const shapeObj = findCanvasObject(canvasObjects, obj.parentShapeId);
      if (!shapeObj) {
        return { valid: false, reason: `Parent shape object ${obj.parentShapeId} missing for text ${obj.id}` };
      }
    }
    if (obj.isConnector || obj.type === 'connector') {
      if (obj.sourceShapeId) {
        const sourceObj = findCanvasObject(canvasObjects, obj.sourceShapeId);
        if (!sourceObj) {
          return { valid: false, reason: `Connector source shape ${obj.sourceShapeId} missing` };
        }
      }
      if (obj.targetShapeId) {
        const targetObj = findCanvasObject(canvasObjects, obj.targetShapeId);
        if (!targetObj) {
          return { valid: false, reason: `Connector target shape ${obj.targetShapeId} missing` };
        }
      }
    }
  }

  return { valid: true };
};

export const applyCleanup = (canvas, layoutProposal, workspaceModel) => {
  const validation = validateProposal(canvas, layoutProposal, workspaceModel);
  if (!validation.valid) {
    return {
      success: false,
      error: 'Validation failed',
      reason: validation.reason
    };
  }

  const canvasObjects = canvas.getObjects() || [];
  const snapshot = [];

  for (const placement of layoutProposal.placements) {
    const targetObj = findCanvasObject(canvasObjects, placement.objectId);
    if (targetObj) {
      snapshot.push({
        obj: targetObj,
        objectId: placement.objectId,
        geometry: {
          left: targetObj.left,
          top: targetObj.top,
          angle: targetObj.angle ?? 0,
          scaleX: targetObj.scaleX ?? 1,
          scaleY: targetObj.scaleY ?? 1
        }
      });
    }
  }

  const changes = [];
  let renderCount = 0;

  try {
    for (const placement of layoutProposal.placements) {
      const targetObj = findCanvasObject(canvasObjects, placement.objectId);
      if (!targetObj) continue;

      if (targetObj.shouldThrowOnSet) {
        throw new Error(`Simulated mutation error for object ${placement.objectId}`);
      }

      const previousGeometry = {
        left: targetObj.left,
        top: targetObj.top,
        angle: targetObj.angle ?? 0,
        scaleX: targetObj.scaleX ?? 1,
        scaleY: targetObj.scaleY ?? 1
      };

      let newLeft = targetObj.left;
      let newTop = targetObj.top;

      if (placement.anchor === 'center' && placement.position && isFiniteNumber(placement.position.x)) {
        newLeft = placement.position.x;
      } else if (targetObj.originX === 'center') {
        if (placement.center && isFiniteNumber(placement.center.x)) {
          newLeft = placement.center.x;
        } else if (placement.bounds && isFiniteNumber(placement.bounds.x) && isFiniteNumber(placement.bounds.width)) {
          newLeft = placement.bounds.x + (placement.bounds.width / 2);
        } else if (placement.position && isFiniteNumber(placement.position.x)) {
          newLeft = placement.position.x + ((placement.size?.width ?? 0) / 2);
        }
      } else if (targetObj.originX === 'right') {
        if (placement.bounds && isFiniteNumber(placement.bounds.x) && isFiniteNumber(placement.bounds.width)) {
          newLeft = placement.bounds.x + placement.bounds.width;
        } else if (placement.position && isFiniteNumber(placement.position.x)) {
          newLeft = placement.position.x + (placement.size?.width ?? 0);
        }
      } else {
        if (placement.bounds && isFiniteNumber(placement.bounds.x)) {
          newLeft = placement.bounds.x;
        } else if (placement.position && isFiniteNumber(placement.position.x)) {
          newLeft = placement.position.x;
        }
      }

      if (placement.anchor === 'center' && placement.position && isFiniteNumber(placement.position.y)) {
        newTop = placement.position.y;
      } else if (targetObj.originY === 'center') {
        if (placement.center && isFiniteNumber(placement.center.y)) {
          newTop = placement.center.y;
        } else if (placement.bounds && isFiniteNumber(placement.bounds.y) && isFiniteNumber(placement.bounds.height)) {
          newTop = placement.bounds.y + (placement.bounds.height / 2);
        } else if (placement.position && isFiniteNumber(placement.position.y)) {
          newTop = placement.position.y + ((placement.size?.height ?? 0) / 2);
        }
      } else if (targetObj.originY === 'bottom') {
        if (placement.bounds && isFiniteNumber(placement.bounds.y) && isFiniteNumber(placement.bounds.height)) {
          newTop = placement.bounds.y + placement.bounds.height;
        } else if (placement.position && isFiniteNumber(placement.position.y)) {
          newTop = placement.position.y + (placement.size?.height ?? 0);
        }
      } else {
        if (placement.bounds && isFiniteNumber(placement.bounds.y)) {
          newTop = placement.bounds.y;
        } else if (placement.position && isFiniteNumber(placement.position.y)) {
          newTop = placement.position.y;
        }
      }

      const newAngle = isFiniteNumber(placement.rotation) ? placement.rotation : (targetObj.angle ?? 0);
      const newScaleX = placement.scale && isFiniteNumber(placement.scale.x) ? placement.scale.x : (targetObj.scaleX ?? 1);
      const newScaleY = placement.scale && isFiniteNumber(placement.scale.y) ? placement.scale.y : (targetObj.scaleY ?? 1);

      const propsToSet = {
        left: newLeft,
        top: newTop,
        angle: newAngle,
        scaleX: newScaleX,
        scaleY: newScaleY
      };

      if (typeof targetObj.set === 'function') {
        targetObj.set(propsToSet);
      } else {
        Object.assign(targetObj, propsToSet);
      }

      if (typeof targetObj.setCoords === 'function') {
        targetObj.setCoords();
      }

      changes.push({
        objectId: placement.objectId,
        previousGeometry,
        newGeometry: {
          left: newLeft,
          top: newTop,
          angle: newAngle,
          scaleX: newScaleX,
          scaleY: newScaleY
        }
      });
    }

    if (typeof canvas.requestRenderAll === 'function') {
      canvas.requestRenderAll();
      renderCount += 1;
    }

    return {
      success: true,
      appliedCount: changes.length,
      transactionId: `cleanup_${Date.now()}`,
      changes,
      renderCount
    };
  } catch (error) {
    for (const item of snapshot) {
      if (typeof item.obj.set === 'function') {
        item.obj.set(item.geometry);
      } else {
        Object.assign(item.obj, item.geometry);
      }
      if (typeof item.obj.setCoords === 'function') {
        item.obj.setCoords();
      }
    }

    if (typeof canvas.requestRenderAll === 'function') {
      canvas.requestRenderAll();
    }

    return {
      success: false,
      error: 'Apply failed during execution',
      reason: error?.message || String(error)
    };
  }
};

export default applyCleanup;
