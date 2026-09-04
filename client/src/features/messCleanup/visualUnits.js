

import { getSemanticType, getShapeType } from './cleanupTypes.js';
import { getObjectDimensions, getPlacementBounds, unionBounds } from './layoutStrategies.js';

export const inspectWorkspaceVisualUnits = (workspaceModel) => {
  const objects = workspaceModel?.board?.objects || workspaceModel?.objects || [];

  return objects.map((obj, index) => ({
    index,
    objectId: obj.id,
    type: obj.type,
    semanticType: getSemanticType(obj),
    shapeType: getShapeType(obj),
    position: obj.position ? { x: Math.round(obj.position.x), y: Math.round(obj.position.y) } : null,
    size: obj.size ? { width: Math.round(obj.size.width), height: Math.round(obj.size.height) } : null,
    scale: obj.scale || { x: 1, y: 1 },
    rotation: obj.rotation || 0,
    parentShapeId: obj.relationshipMetadata?.parentShapeId || null,
    attachedTextId: obj.relationshipMetadata?.attachedTextId || null,
    sourceShapeId: obj.relationshipMetadata?.sourceShapeId || null,
    targetShapeId: obj.relationshipMetadata?.targetShapeId || null,
    isStickyNote: obj.metadata?.isStickyNote === true,
    isVectorStroke: obj.metadata?.isVectorStroke === true,
    textLength: typeof obj.text === 'string' ? obj.text.length : 0
  }));
};

export const normalizeAngle = (angle = 0) => {
  const a = angle % 360;
  return a < 0 ? a + 360 : a;
};

export const buildVisualObjectModel = (workspaceModel) => {
  const rawObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const visualObjects = [];

  rawObjects.forEach((obj, index) => {
    if (!obj || !obj.id) return;

    const semanticType = getSemanticType(obj);
    const size = getObjectDimensions(obj);
    const pos = obj.position || { x: 0, y: 0 };
    const rawRotation = typeof obj.rotation === 'number' ? obj.rotation : 0;
    const isSticky = obj.metadata?.isStickyNote === true || obj.isStickyNote === true || obj.type === 'note' || semanticType === 'note';

    let kind = 'shape';
    if (semanticType === 'text') kind = 'text';
    else if (isSticky) kind = 'sticky-note';
    else if (semanticType === 'connector') kind = 'connector';
    else if (semanticType === 'stroke' || obj.metadata?.isVectorStroke) kind = 'freehand';
    else if (semanticType === 'line') kind = 'line';
    else if (semanticType === 'image') kind = 'image';

    const anchor = 'top-left';
    const bounds = getPlacementBounds(pos, size, anchor, rawRotation);
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    };

    
    let rotation = rawRotation;
    if (kind === 'text') {
      const parentId = obj.relationshipMetadata?.parentShapeId;
      let isAttachedToRealContainer = false;
      if (parentId) {
        const parentObj = rawObjects.find((o) => o.id === parentId);
        if (parentObj) {
          const parentSemantic = getSemanticType(parentObj);
          isAttachedToRealContainer = parentSemantic === 'shape' || parentSemantic === 'note';
        }
      }
      if (!isAttachedToRealContainer) {
        rotation = 0;
      }
    }

    visualObjects.push({
      objectId: obj.id,
      kind,
      semanticType,
      shapeType: getShapeType(obj),
      bounds,
      center,
      size,
      scale: { x: obj.scale?.x || 1, y: obj.scale?.y || 1 },
      rotation,
      originalRotation: rawRotation,
      parentObjectId: obj.relationshipMetadata?.parentShapeId || null,
      attachedTextIds: obj.relationshipMetadata?.attachedTextId ? [obj.relationshipMetadata.attachedTextId] : [],
      connectorMetadata: kind === 'connector' ? {
        sourceObjectId: obj.relationshipMetadata?.sourceShapeId || obj.connector?.sourceShapeId || obj.sourceShapeId || null,
        targetObjectId: obj.relationshipMetadata?.targetShapeId || obj.connector?.targetShapeId || obj.targetShapeId || null,
        connectorType: obj.connector?.connectorType || obj.metadata?.connectorType || obj.connectorType || 'straight'
      } : null,
      text: obj.text || null,
      metadata: obj.metadata || {},
      originalIndex: index,
      originalObject: obj
    });
  });

  return visualObjects;
};

const isPointInside = (point, box, tolerance = 10) => (
  point.x >= box.x - tolerance &&
  point.x <= box.x + box.width + tolerance &&
  point.y >= box.y - tolerance &&
  point.y <= box.y + box.height + tolerance
);

export const resolveContainerOwnership = (visualObjects, objectMap) => {
  const isContainer = (vo) => !!vo && (vo.kind === 'shape' || vo.kind === 'sticky-note');
  const isText = (vo) => !!vo && vo.kind === 'text';
  const isStroke = (vo) => !!vo && (vo.kind === 'freehand' || vo.semanticType === 'stroke');
  const areaOf = (vo) => Math.max(1, vo.bounds.width) * Math.max(1, vo.bounds.height);

  const claims = new Map(); 
  const claim = (childId, ownerId, tier, area) => {
    if (!childId || !ownerId || childId === ownerId) return;
    const prev = claims.get(childId);
    if (!prev || tier < prev.tier || (tier === prev.tier && area < prev.area)) {
      claims.set(childId, { ownerId, tier, area });
    }
  };

  const containers = visualObjects.filter(isContainer);

  containers.forEach((c) => {
    const attached = c.attachedTextIds?.[0] || c.originalObject?.relationshipMetadata?.attachedTextId || null;
    if (attached && isText(objectMap.get(attached))) claim(attached, c.objectId, 0, areaOf(c));
  });
  visualObjects.forEach((vo) => {
    if (!isText(vo) || !vo.parentObjectId) return;
    const parent = objectMap.get(vo.parentObjectId);
    if (isContainer(parent)) claim(vo.objectId, parent.objectId, 0, areaOf(parent));
  });

  const byElement = new Map();
  visualObjects.forEach((vo) => {
    const eid = vo.originalObject?.elementId;
    if (!eid) return;
    if (!byElement.has(eid)) byElement.set(eid, []);
    byElement.get(eid).push(vo);
  });
  byElement.forEach((group) => {
    const container = group.find(isContainer);
    if (!container) return;
    group.forEach((vo) => {
      if (isText(vo) || isStroke(vo)) claim(vo.objectId, container.objectId, 1, areaOf(container));
    });
  });

  visualObjects.forEach((vo) => {
    if ((!isText(vo) && !isStroke(vo)) || claims.has(vo.objectId)) return;
    let best = null;
    let bestArea = Infinity;
    containers.forEach((c) => {
      if (c.objectId === vo.objectId) return;
      if (isText(vo) && isPointInside(vo.center, c.bounds) && areaOf(c) < bestArea) {
        best = c;
        bestArea = areaOf(c);
      } else if (isStroke(vo) && isPointInside(vo.center, c.bounds) && areaOf(c) < bestArea) {
        if (vo.bounds.width <= c.bounds.width * 1.1 && vo.bounds.height <= c.bounds.height * 1.1) {
          best = c;
          bestArea = areaOf(c);
        }
      }
    });
    if (best) claim(vo.objectId, best.objectId, 2, bestArea);
  });

  const ownerByText = new Map();
  const ownedByOwner = new Map();
  const ownerTierByText = new Map();
  claims.forEach((info, childId) => {
    ownerByText.set(childId, info.ownerId);
    ownerTierByText.set(childId, info.tier);
    if (!ownedByOwner.has(info.ownerId)) ownedByOwner.set(info.ownerId, []);
    ownedByOwner.get(info.ownerId).push(childId);
  });
  ownedByOwner.forEach((ids) => ids.sort((a, b) => String(a).localeCompare(String(b))));

  return { ownedByOwner, ownerByText, ownerTierByText };
};

export const assertShapeGeometryIntegrity = (unit) => {
  if (!unit) throw new Error('Atomic unit is null or undefined');
  if (!unit.unitId) throw new Error('Atomic unit is missing unitId');
  if (!Array.isArray(unit.objectIds) || unit.objectIds.length === 0) {
    throw new Error(`Atomic unit ${unit.unitId} has no objectIds`);
  }
  if (!unit.localBounds || unit.localBounds.width <= 0 || unit.localBounds.height <= 0) {
    throw new Error(`Atomic unit ${unit.unitId} has invalid bounds: ${JSON.stringify(unit.localBounds)}`);
  }
  if (!Number.isFinite(unit.localBounds.x) || !Number.isFinite(unit.localBounds.y)) {
    throw new Error(`Atomic unit ${unit.unitId} has non-finite coordinates`);
  }
  return true;
};

export const assertPlacementsWithinCanvas = (proposal) => {
  if (!proposal || !proposal.canvasBounds) {
    throw new Error('LayoutProposal has no canvasBounds');
  }
  const canvas = proposal.canvasBounds;
  const canvasMaxX = canvas.x + canvas.width;
  const canvasMaxY = canvas.y + canvas.height;

  const outside = [];
  (proposal.placements || []).forEach((p) => {
    const pBounds = p.bounds || { x: p.position.x, y: p.position.y, width: p.size.width, height: p.size.height };
    const pMaxX = pBounds.x + pBounds.width;
    const pMaxY = pBounds.y + pBounds.height;

    const tolerance = 2; 
    if (
      pBounds.x < canvas.x - tolerance ||
      pBounds.y < canvas.y - tolerance ||
      pMaxX > canvasMaxX + tolerance ||
      pMaxY > canvasMaxY + tolerance
    ) {
      outside.push({
        objectId: p.objectId,
        placementBounds: pBounds,
        canvasBounds: canvas
      });
    }
  });

  if (outside.length > 0) {
    throw new Error(`Placements outside canvas bounds: ${JSON.stringify(outside)}`);
  }
  return true;
};

export const reconstructVisualUnits = (visualObjects, semanticScene = null, options = {}) => {
  const objectMap = new Map(visualObjects.map((vo) => [vo.objectId, vo]));
  const assignedIds = new Set();
  const atomicUnits = [];

  const invalidGeometryIds = [];
  const detachedTextIds = [];
  const orphanConnectorIds = [];
  const rotationNormalizedTextIds = [];

  const createPlacement = (vo, localPos, unitId, anchor = 'center') => {
    const size = vo.size;
    const rotation = vo.rotation;
    const origObj = vo.originalObject || {};
    return {
      objectId: vo.objectId,
      sourceObjectId: vo.sourceObjectId || origObj.sourceObjectId || vo.objectId,
      elementId: origObj.elementId || vo.elementId || null,
      unitId,
      type: vo.semanticType || 'shape',
      semanticType: vo.semanticType || 'shape',
      relationshipMetadata: origObj.relationshipMetadata || {},
      position: { x: localPos.x, y: localPos.y },
      rotation,
      scale: { x: 1, y: 1 }, 
      anchor,
      size,
      bounds: getPlacementBounds(localPos, size, anchor, rotation),
      path: origObj.path || null,
      pathData: origObj.pathData || vo.pathData || null,
      pathCommands: origObj.pathCommands || vo.pathCommands || null,
      stroke: origObj.stroke || origObj.visual?.stroke || null,
      strokeWidth: origObj.strokeWidth || origObj.visual?.strokeWidth || null,
      strokeDashArray: origObj.strokeDashArray || null
    };
  };

  const { ownedByOwner, ownerByText } = resolveContainerOwnership(visualObjects, objectMap);

  const flowchartGroups = (semanticScene?.groups || []).filter((g) => g.type === 'flowchart');
  flowchartGroups.forEach((g) => {
    const rawIds = (g.objectIds || []).filter((id) => objectMap.has(id) && !assignedIds.has(id));
    if (rawIds.length === 0) return;

    const unitId = `unit_graph_${g.id}`;
    const localPlacements = [];
    const unitObjIds = [];

    const nodes = rawIds.filter((id) => objectMap.get(id)?.kind !== 'connector');
    if (nodes.length === 0) return;

    let curX = 0;
    nodes.forEach((id) => {
      if (assignedIds.has(id)) return;
      const vo = objectMap.get(id);
      if (!vo) return;

      const pPos = { x: curX + vo.size.width / 2, y: vo.size.height / 2 };
      localPlacements.push(createPlacement(vo, pPos, unitId, 'center'));
      unitObjIds.push(id);
      assignedIds.add(id);

      const ownedTextIds = (ownedByOwner.get(id) || []).filter((tId) => objectMap.has(tId) && !assignedIds.has(tId));
      ownedTextIds.forEach((tId) => {
        const textVo = objectMap.get(tId);
        localPlacements.push(createPlacement(textVo, pPos, unitId, 'center'));
        unitObjIds.push(tId);
        assignedIds.add(tId);
      });

      curX += vo.size.width + 80;
    });

    if (unitObjIds.length > 0) {
      const localBounds = unionBounds(localPlacements.map((p) => p.bounds));
      const origBounds = unionBounds(unitObjIds.map((id) => objectMap.get(id).bounds));

      const unit = {
        unitId,
        type: 'graph-unit',
        role: 'flowchart',
        objectIds: unitObjIds,
        localPlacements,
        localBounds,
        originalBounds: origBounds,
        centerX: origBounds.x + origBounds.width / 2,
        centerY: origBounds.y + origBounds.height / 2,
        width: localBounds.width,
        height: localBounds.height
      };

      assertShapeGeometryIntegrity(unit);
      atomicUnits.push(unit);
    }
  });

  const freeformGroups = (semanticScene?.groups || []).filter((g) => g.type === 'freeform');
  freeformGroups.forEach((g) => {
    const gObjIds = (g.objectIds || []).filter((id) => objectMap.has(id) && !assignedIds.has(id));
    if (gObjIds.length === 0) return;

    if (gObjIds.every((id) => objectMap.get(id)?.kind === 'text')) return;

    const unitId = `unit_freeform_${g.id}`;
    const vos = gObjIds.map((id) => objectMap.get(id));
    const origBounds = unionBounds(vos.map((v) => v.bounds));

    const localPlacements = vos.map((vo) => {
      const localPos = {
        x: vo.bounds.x - origBounds.x + vo.size.width / 2,
        y: vo.bounds.y - origBounds.y + vo.size.height / 2
      };
      return createPlacement(vo, localPos, unitId, 'center');
    });

    const localBounds = unionBounds(localPlacements.map((p) => p.bounds));

    const unit = {
      unitId,
      type: 'freeform-unit',
      role: 'freeform',
      objectIds: gObjIds,
      localPlacements,
      localBounds,
      originalBounds: origBounds,
      centerX: origBounds.x + origBounds.width / 2,
      centerY: origBounds.y + origBounds.height / 2,
      width: localBounds.width,
      height: localBounds.height
    };

    assertShapeGeometryIntegrity(unit);
    atomicUnits.push(unit);
    gObjIds.forEach((id) => assignedIds.add(id));
  });

  const conceptGroups = (semanticScene?.groups || []).filter((g) => g.type === 'concept');
  conceptGroups.forEach((g) => {
    const shapeIds = (g.objectIds || []).filter((id) => objectMap.get(id)?.kind === 'shape' && !assignedIds.has(id));
    shapeIds.forEach((shapeId) => {
      const shapeVo = objectMap.get(shapeId);
      const unitId = `unit_concept_${g.id}_${shapeId}`;
      const shapeSize = shapeVo.size;
      const centerPos = { x: shapeSize.width / 2, y: shapeSize.height / 2 };

      const pShape = createPlacement(shapeVo, centerPos, unitId, 'center');
      const localPlacements = [pShape];
      const unitObjIds = [shapeId];
      assignedIds.add(shapeId);

      const ownedTextIds = (ownedByOwner.get(shapeId) || []).filter(
        (id) => objectMap.get(id)?.kind === 'text' && !assignedIds.has(id)
      );
      ownedTextIds.forEach((tId) => {
        localPlacements.push(createPlacement(objectMap.get(tId), centerPos, unitId, 'center'));
        unitObjIds.push(tId);
        assignedIds.add(tId);
      });

      const ownedStrokeIds = (ownedByOwner.get(shapeId) || []).filter(
        (id) => objectMap.get(id)?.kind === 'freehand' && !assignedIds.has(id)
      );
      ownedStrokeIds.forEach((sId) => {
        const strokeVo = objectMap.get(sId);
        const strokeLocalPos = {
          x: strokeVo.bounds.x - shapeVo.bounds.x + strokeVo.size.width / 2,
          y: strokeVo.bounds.y - shapeVo.bounds.y + strokeVo.size.height / 2
        };
        localPlacements.push(createPlacement(strokeVo, strokeLocalPos, unitId, 'center'));
        unitObjIds.push(sId);
        assignedIds.add(sId);
      });

      const localBounds = unionBounds(localPlacements.map((p) => p.bounds));
      const origBounds = unionBounds(unitObjIds.map((id) => objectMap.get(id).bounds));

      const unit = {
        unitId,
        type: 'shape-unit',
        role: 'concept',
        objectIds: unitObjIds,
        localPlacements,
        localBounds,
        originalBounds: origBounds,
        centerX: origBounds.x + origBounds.width / 2,
        centerY: origBounds.y + origBounds.height / 2,
        width: localBounds.width,
        height: localBounds.height
      };

      assertShapeGeometryIntegrity(unit);
      atomicUnits.push(unit);
    });
  });

  visualObjects.forEach((vo) => {
    if (assignedIds.has(vo.objectId) || vo.kind !== 'shape') return;

    const unitId = `unit_shape_${vo.objectId}`;
    const shapeSize = vo.size;
    const centerPos = { x: shapeSize.width / 2, y: shapeSize.height / 2 };

    const pShape = createPlacement(vo, centerPos, unitId, 'center');
    const localPlacements = [pShape];
    const unitObjIds = [vo.objectId];
    assignedIds.add(vo.objectId);

    const ownedTextIds = (ownedByOwner.get(vo.objectId) || []).filter(
      (id) => objectMap.get(id)?.kind === 'text' && !assignedIds.has(id)
    );
    ownedTextIds.forEach((tId) => {
      localPlacements.push(createPlacement(objectMap.get(tId), centerPos, unitId, 'center'));
      unitObjIds.push(tId);
      assignedIds.add(tId);
    });

    const ownedStrokeIds = (ownedByOwner.get(vo.objectId) || []).filter(
      (id) => objectMap.get(id)?.kind === 'freehand' && !assignedIds.has(id)
    );
    ownedStrokeIds.forEach((sId) => {
      const strokeVo = objectMap.get(sId);
      const strokeLocalPos = {
        x: strokeVo.bounds.x - vo.bounds.x + strokeVo.size.width / 2,
        y: strokeVo.bounds.y - vo.bounds.y + strokeVo.size.height / 2
      };
      localPlacements.push(createPlacement(strokeVo, strokeLocalPos, unitId, 'center'));
      unitObjIds.push(sId);
      assignedIds.add(sId);
    });

    const localBounds = unionBounds(localPlacements.map((p) => p.bounds));
    const origBounds = unionBounds(unitObjIds.map((id) => objectMap.get(id).bounds));

    const unit = {
      unitId,
      type: 'shape-unit',
      role: 'concept',
      objectIds: unitObjIds,
      localPlacements,
      localBounds,
      originalBounds: origBounds,
      centerX: origBounds.x + origBounds.width / 2,
      centerY: origBounds.y + origBounds.height / 2,
      width: localBounds.width,
      height: localBounds.height
    };

    assertShapeGeometryIntegrity(unit);
    atomicUnits.push(unit);
  });

  const NOTE_TEXT_PADDING = 18; 
  visualObjects.forEach((vo) => {
    if (assignedIds.has(vo.objectId) || vo.kind !== 'sticky-note') return;

    const unitId = `unit_note_${vo.objectId}`;
    const noteCenter = { x: vo.size.width / 2, y: vo.size.height / 2 };
    const pNote = createPlacement(vo, noteCenter, unitId, 'center');
    const localPlacements = [pNote];
    const unitObjIds = [vo.objectId];

    const noteTextIds = (ownedByOwner.get(vo.objectId) || []).filter(
      (id) => objectMap.get(id)?.kind === 'text' && !assignedIds.has(id)
    );

    let noteTextTop = NOTE_TEXT_PADDING;
    noteTextIds.forEach((tId) => {
      const textVo = objectMap.get(tId);
      const textLocalPos = {
        x: vo.size.width / 2,
        y: noteTextTop + textVo.size.height / 2
      };
      localPlacements.push(createPlacement(textVo, textLocalPos, unitId, 'center'));
      noteTextTop += textVo.size.height + 6;
      unitObjIds.push(tId);
      assignedIds.add(tId);
    });

    const noteStrokeIds = (ownedByOwner.get(vo.objectId) || []).filter(
      (id) => objectMap.get(id)?.kind === 'freehand' && !assignedIds.has(id)
    );
    noteStrokeIds.forEach((sId) => {
      const strokeVo = objectMap.get(sId);
      const strokeLocalPos = {
        x: strokeVo.bounds.x - vo.bounds.x + strokeVo.size.width / 2,
        y: strokeVo.bounds.y - vo.bounds.y + strokeVo.size.height / 2
      };
      localPlacements.push(createPlacement(strokeVo, strokeLocalPos, unitId, 'center'));
      unitObjIds.push(sId);
      assignedIds.add(sId);
    });

    const localBounds = unionBounds(localPlacements.map((p) => p.bounds));
    const origBounds = unionBounds(unitObjIds.map((id) => objectMap.get(id).bounds));

    const unit = {
      unitId,
      type: 'note-unit',
      role: 'notes',
      objectIds: unitObjIds,
      localPlacements,
      localBounds,
      originalBounds: origBounds,
      centerX: origBounds.x + origBounds.width / 2,
      centerY: origBounds.y + origBounds.height / 2,
      width: localBounds.width,
      height: localBounds.height
    };

    assertShapeGeometryIntegrity(unit);
    atomicUnits.push(unit);
    assignedIds.add(vo.objectId);
  });

  const unassignedStrokes = visualObjects.filter(
    (vo) => !assignedIds.has(vo.objectId) && (vo.kind === 'freehand' || vo.semanticType === 'stroke')
  );

  if (unassignedStrokes.length > 0) {
    const strokeParent = new Map(unassignedStrokes.map((s) => [s.objectId, s.objectId]));
    const findRoot = (id) => {
      let curr = id;
      while (strokeParent.get(curr) && strokeParent.get(curr) !== curr) curr = strokeParent.get(curr);
      return curr;
    };
    const unionRoots = (idA, idB) => {
      const rA = findRoot(idA);
      const rB = findRoot(idB);
      if (rA !== rB) strokeParent.set(rB, rA);
    };

    for (let i = 0; i < unassignedStrokes.length; i++) {
      for (let j = i + 1; j < unassignedStrokes.length; j++) {
        const sA = unassignedStrokes[i];
        const sB = unassignedStrokes[j];

        const sharedStrokeId = sA.originalObject?.strokeId && sA.originalObject.strokeId === sB.originalObject?.strokeId;
        const sharedGroupId = sA.originalObject?.groupId && sA.originalObject.groupId === sB.originalObject?.groupId;
        const sharedDrawingId = sA.originalObject?.drawingId && sA.originalObject.drawingId === sB.originalObject?.drawingId;

        const sharedElem = sA.originalObject?.elementId && sA.originalObject.elementId === sB.originalObject?.elementId;

        const dx = Math.max(0, sA.bounds.x - (sB.bounds.x + sB.bounds.width), sB.bounds.x - (sA.bounds.x + sA.bounds.width));
        const dy = Math.max(0, sA.bounds.y - (sB.bounds.y + sB.bounds.height), sB.bounds.y - (sA.bounds.y + sA.bounds.height));
        const dist = Math.hypot(dx, dy);

        const scaleA = Math.max(sA.bounds.width, sA.bounds.height);
        const scaleB = Math.max(sB.bounds.width, sB.bounds.height);
        const maxCharScale = Math.max(scaleA, scaleB);
        const strokeWidthA = sA.originalObject?.strokeWidth || sA.originalObject?.visual?.strokeWidth || 3;
        const strokeWidthB = sB.originalObject?.strokeWidth || sB.originalObject?.visual?.strokeWidth || 3;
        const derivedGeometricThreshold = Math.min(100, Math.max(35, maxCharScale * 0.85 + Math.max(strokeWidthA, strokeWidthB) * 2));

        const maxAllowedGap = typeof options?.strokeClusteringThreshold === 'number'
          ? options.strokeClusteringThreshold
          : derivedGeometricThreshold;

        if (sharedStrokeId || sharedGroupId || sharedDrawingId || sharedElem || dist <= maxAllowedGap) {
          unionRoots(sA.objectId, sB.objectId);
        }
      }
    }

    const clustersByRoot = new Map();
    unassignedStrokes.forEach((s) => {
      const root = findRoot(s.objectId);
      if (!clustersByRoot.has(root)) clustersByRoot.set(root, []);
      clustersByRoot.get(root).push(s);
    });

    let autoFreeformCount = 0;
    clustersByRoot.forEach((clusterStrokes) => {
      if (clusterStrokes.length >= 2) {
        autoFreeformCount++;
        const unitId = `unit_auto_freeform_${autoFreeformCount}`;
        const clusterObjIds = clusterStrokes.map((s) => s.objectId);
        const origBounds = unionBounds(clusterStrokes.map((s) => s.bounds));

        const localPlacements = clusterStrokes.map((vo) => {
          const localPos = {
            x: vo.bounds.x - origBounds.x + vo.size.width / 2,
            y: vo.bounds.y - origBounds.y + vo.size.height / 2
          };
          return createPlacement(vo, localPos, unitId, 'center');
        });

        const localBounds = unionBounds(localPlacements.map((p) => p.bounds));
        const unit = {
          unitId,
          type: 'freeform-unit',
          role: 'freeform',
          objectIds: clusterObjIds,
          localPlacements,
          localBounds,
          originalBounds: origBounds,
          centerX: origBounds.x + origBounds.width / 2,
          centerY: origBounds.y + origBounds.height / 2,
          width: localBounds.width,
          height: localBounds.height
        };

        assertShapeGeometryIntegrity(unit);
        atomicUnits.push(unit);
        clusterObjIds.forEach((id) => assignedIds.add(id));
      }
    });
  }

  visualObjects.forEach((vo) => {
    if (assignedIds.has(vo.objectId)) return;

    if (vo.originalRotation !== vo.rotation) {
      rotationNormalizedTextIds.push(vo.objectId);
    }

    const unitId = `unit_single_${vo.objectId}`;
    const centerPos = { x: vo.size.width / 2, y: vo.size.height / 2 };
    const placement = createPlacement(vo, centerPos, unitId, 'center');
    const localBounds = placement.bounds;

    const unit = {
      unitId,
      type: vo.kind === 'text' ? 'text-unit' : (vo.kind === 'freehand' ? 'freeform-unit' : (vo.kind === 'connector' ? 'connector-unit' : (vo.kind === 'line' ? 'line-unit' : 'shape-unit'))),
      role: vo.kind === 'text' ? (vo.originalObject?.metadata?.isHeading ? 'heading' : 'text') : (vo.kind === 'connector' ? 'connector' : 'concept'),
      objectIds: [vo.objectId],
      localPlacements: [placement],
      localBounds,
      originalBounds: vo.bounds,
      centerX: vo.center.x,
      centerY: vo.center.y,
      width: localBounds.width,
      height: localBounds.height
    };

    assertShapeGeometryIntegrity(unit);
    atomicUnits.push(unit);
    assignedIds.add(vo.objectId);
  });

  
  
  
  
  const unitIdByObject = new Map();
  atomicUnits.forEach((u) => u.localPlacements.forEach((p) => unitIdByObject.set(p.objectId, u.unitId)));
  ownerByText.forEach((ownerId, textId) => {
    const tUnit = unitIdByObject.get(textId);
    const oUnit = unitIdByObject.get(ownerId);
    if (tUnit && oUnit && tUnit !== oUnit) detachedTextIds.push(textId);
  });

  const visualIntegrity = {
    totalWorkspaceObjects: visualObjects.length,
    totalVisualUnits: atomicUnits.length,
    shapeUnitCount: atomicUnits.filter((u) => u.type === 'shape-unit').length,
    textUnitCount: atomicUnits.filter((u) => u.type === 'text-unit').length,
    graphUnitCount: atomicUnits.filter((u) => u.type === 'graph-unit').length,
    connectorCount: visualObjects.filter((vo) => vo.kind === 'connector').length,
    freeformUnitCount: atomicUnits.filter((u) => u.type === 'freeform-unit').length,
    detachedTextIds,
    orphanConnectorIds,
    invalidShapeIds: [],
    invalidGeometryIds,
    duplicateUnitMembershipIds: [],
    missingObjectIds: visualObjects.filter((vo) => !assignedIds.has(vo.objectId)).map((vo) => vo.objectId),
    rotationNormalizedTextIds,
    originalBounds: unionBounds(visualObjects.map((v) => v.bounds)),
    reconstructedBounds: unionBounds(atomicUnits.map((u) => u.originalBounds)),
    geometryIntegrityPassed: true
  };

  return { atomicUnits, visualIntegrity };
};

export default {
  inspectWorkspaceVisualUnits,
  buildVisualObjectModel,
  reconstructVisualUnits,
  assertShapeGeometryIntegrity,
  normalizeAngle
};
