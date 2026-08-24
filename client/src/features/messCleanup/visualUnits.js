

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
    const isSticky = obj.metadata?.isStickyNote === true || obj.type === 'note';

    let kind = 'shape';
    if (semanticType === 'text') kind = 'text';
    else if (isSticky) kind = 'sticky-note';
    else if (semanticType === 'connector') kind = 'connector';
    else if (semanticType === 'stroke' || obj.metadata?.isVectorStroke) kind = 'freehand';
    else if (semanticType === 'line') kind = 'line';
    else if (semanticType === 'image') kind = 'image';

    const anchor = (kind === 'text' && !obj.relationshipMetadata?.parentShapeId) ? 'top-left' : 'center';
    const bounds = getPlacementBounds(pos, size, anchor, rawRotation);
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    };

    
    let rotation = rawRotation;
    if (kind === 'text') {
      const isAttached = Boolean(obj.relationshipMetadata?.parentShapeId);
      if (!isAttached && (Math.abs(rawRotation - 90) < 5 || Math.abs(rawRotation - 270) < 5)) {
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
        sourceObjectId: obj.relationshipMetadata?.sourceShapeId || null,
        targetObjectId: obj.relationshipMetadata?.targetShapeId || null,
        connectorType: obj.connector?.connectorType || 'straight'
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

const resolveContainerOwnership = (visualObjects, objectMap) => {
  const isContainer = (vo) => !!vo && (vo.kind === 'shape' || vo.kind === 'sticky-note');
  const isText = (vo) => !!vo && vo.kind === 'text';
  const areaOf = (vo) => Math.max(1, vo.bounds.width) * Math.max(1, vo.bounds.height);

  
  const claims = new Map(); 
  const claim = (textId, ownerId, tier, area) => {
    if (!textId || !ownerId || textId === ownerId) return;
    const prev = claims.get(textId);
    if (!prev || tier < prev.tier || (tier === prev.tier && area < prev.area)) {
      claims.set(textId, { ownerId, tier, area });
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
      if (isText(vo)) claim(vo.objectId, container.objectId, 1, areaOf(container));
    });
  });

  
  
  visualObjects.forEach((vo) => {
    if (!isText(vo) || claims.has(vo.objectId)) return;
    let best = null;
    let bestArea = Infinity;
    containers.forEach((c) => {
      if (c.objectId === vo.objectId) return;
      if (isPointInside(vo.center, c.bounds) && areaOf(c) < bestArea) {
        best = c;
        bestArea = areaOf(c);
      }
    });
    if (best) claim(vo.objectId, best.objectId, 2, bestArea);
  });

  
  const ownerByText = new Map();
  const ownedByOwner = new Map();
  claims.forEach((info, textId) => {
    ownerByText.set(textId, info.ownerId);
    if (!ownedByOwner.has(info.ownerId)) ownedByOwner.set(info.ownerId, []);
    ownedByOwner.get(info.ownerId).push(textId);
  });
  ownedByOwner.forEach((ids) => ids.sort((a, b) => String(a).localeCompare(String(b))));

  return { ownedByOwner, ownerByText };
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

export const reconstructVisualUnits = (visualObjects, semanticScene = null) => {
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
    return {
      objectId: vo.objectId,
      unitId,
      type: vo.semanticType || 'shape',
      relationshipMetadata: vo.originalObject.relationshipMetadata || {},
      position: { x: localPos.x, y: localPos.y },
      rotation,
      scale: { x: 1, y: 1 }, 
      anchor,
      size,
      bounds: getPlacementBounds(localPos, size, anchor, rotation)
    };
  };

  
  
  
  const { ownedByOwner, ownerByText } = resolveContainerOwnership(visualObjects, objectMap);

  
  const connectorVos = visualObjects.filter((vo) => vo.kind === 'connector' && !assignedIds.has(vo.objectId));
  const graphClusters = [];
  const processedConnIds = new Set();

  const addNodeWithLabels = (nodeId, set) => {
    if (!nodeId || !objectMap.has(nodeId)) return;
    set.add(nodeId);
    const vo = objectMap.get(nodeId);
    (vo.attachedTextIds || []).forEach((tId) => set.add(tId));
    const parentShapeTextId = vo.originalObject.relationshipMetadata?.attachedTextId;
    if (parentShapeTextId && objectMap.has(parentShapeTextId)) set.add(parentShapeTextId);
    
    
    (ownedByOwner.get(nodeId) || []).forEach((tId) => {
      if (objectMap.has(tId)) set.add(tId);
    });
  };

  
  connectorVos.forEach((connVo) => {
    if (processedConnIds.has(connVo.objectId)) return;
    const srcId = connVo.connectorMetadata?.sourceObjectId;
    const tgtId = connVo.connectorMetadata?.targetObjectId;

    const clusterObjIds = new Set([connVo.objectId]);
    addNodeWithLabels(srcId, clusterObjIds);
    addNodeWithLabels(tgtId, clusterObjIds);

    
    connectorVos.forEach((otherConn) => {
      if (processedConnIds.has(otherConn.objectId)) return;
      const oSrc = otherConn.connectorMetadata?.sourceObjectId;
      const oTgt = otherConn.connectorMetadata?.targetObjectId;
      if (clusterObjIds.has(oSrc) || clusterObjIds.has(oTgt)) {
        clusterObjIds.add(otherConn.objectId);
        addNodeWithLabels(oSrc, clusterObjIds);
        addNodeWithLabels(oTgt, clusterObjIds);
        processedConnIds.add(otherConn.objectId);
      }
    });

    processedConnIds.add(connVo.objectId);
    graphClusters.push(Array.from(clusterObjIds));
  });

  
  const flowchartGroups = (semanticScene?.groups || []).filter((g) => g.type === 'flowchart');
  flowchartGroups.forEach((g) => {
    const gObjIds = (g.objectIds || []).filter((id) => objectMap.has(id) && !assignedIds.has(id));
    if (gObjIds.length > 0 && !graphClusters.some((c) => gObjIds.some((id) => c.includes(id)))) {
      graphClusters.push(gObjIds);
    }
  });

  graphClusters.forEach((gObjIds, clusterIdx) => {
    const nodeIds = gObjIds.filter((id) => objectMap.get(id)?.kind !== 'connector' && !assignedIds.has(id));
    const connectorIds = gObjIds.filter((id) => objectMap.get(id)?.kind === 'connector' && !assignedIds.has(id));
    if (nodeIds.length === 0 && connectorIds.length === 0) return;

    const nodeClusters = [];
    const processedNodes = new Set();

    nodeIds.forEach((id) => {
      if (processedNodes.has(id)) return;
      const vo = objectMap.get(id);
      const cluster = [id];
      processedNodes.add(id);

      
      const attachedTextId = vo.attachedTextIds[0] || vo.originalObject.relationshipMetadata?.attachedTextId;
      if (attachedTextId && nodeIds.includes(attachedTextId) && !processedNodes.has(attachedTextId)) {
        cluster.push(attachedTextId);
        processedNodes.add(attachedTextId);
      }
      nodeClusters.push(cluster);
    });

    
    let isVerticalGraph = false;
    if (connectorIds.length > 0) {
      const connVo = objectMap.get(connectorIds[0]);
      const srcId = connVo?.connectorMetadata?.sourceObjectId;
      const tgtId = connVo?.connectorMetadata?.targetObjectId;
      if (srcId && tgtId && objectMap.has(srcId) && objectMap.has(tgtId)) {
        const srcCenter = objectMap.get(srcId).center;
        const tgtCenter = objectMap.get(tgtId).center;
        isVerticalGraph = Math.abs(tgtCenter.y - srcCenter.y) > Math.abs(tgtCenter.x - srcCenter.x) * 1.3;
      }
    }

    const unitId = `unit_graph_${clusterIdx + 1}`;
    const localPlacements = [];
    const nodeCenters = new Map();

    let curX = 0;
    let curY = 0;

    nodeClusters.forEach((cluster) => {
      const shapeId = cluster.find((id) => objectMap.get(id)?.kind !== 'text') || cluster[0];
      const textId = cluster.find((id) => id !== shapeId);

      const shapeVo = objectMap.get(shapeId);
      const shapePos = { x: curX + shapeVo.size.width / 2, y: curY + shapeVo.size.height / 2 };

      localPlacements.push(createPlacement(shapeVo, shapePos, unitId, 'center'));
      nodeCenters.set(shapeId, shapePos);

      if (textId) {
        const textVo = objectMap.get(textId);
        localPlacements.push(createPlacement(textVo, shapePos, unitId, 'center'));
        nodeCenters.set(textId, shapePos);
      }

      if (isVerticalGraph) {
        curY += shapeVo.size.height + 60;
      } else {
        curX += shapeVo.size.width + 80;
      }
    });

    
    connectorIds.forEach((connId) => {
      const connVo = objectMap.get(connId);
      const srcId = connVo?.connectorMetadata?.sourceObjectId;
      const tgtId = connVo?.connectorMetadata?.targetObjectId;
      const srcCenter = srcId ? nodeCenters.get(srcId) : null;
      const tgtCenter = tgtId ? nodeCenters.get(tgtId) : null;

      let connPos;
      if (srcCenter && tgtCenter) {
        connPos = { x: (srcCenter.x + tgtCenter.x) / 2, y: (srcCenter.y + tgtCenter.y) / 2 };
      } else {
        connPos = { x: 50, y: 50 };
        orphanConnectorIds.push(connId);
      }
      localPlacements.push(createPlacement(connVo, connPos, unitId, 'center'));
    });

    const localBounds = unionBounds(localPlacements.map((p) => p.bounds));
    const origBounds = unionBounds(gObjIds.map((id) => objectMap.get(id).bounds));

    const unit = {
      unitId,
      type: 'graph-unit',
      role: 'flowchart',
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
    const gObjIds = (g.objectIds || []).filter((id) => objectMap.has(id) && !assignedIds.has(id));
    if (gObjIds.length === 0) return;

    const shapeId = gObjIds.find((id) => objectMap.get(id)?.kind === 'shape');
    if (!shapeId) return;

    const shapeVo = objectMap.get(shapeId);
    const unitId = `unit_concept_${g.id}`;
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

    
    
    const explanationTextIds = gObjIds.filter(
      (id) => id !== shapeId
        && objectMap.get(id)?.kind === 'text'
        && !assignedIds.has(id)
        && !ownerByText.has(id)
        && (!g.id?.includes('unassigned') || Math.abs(objectMap.get(id).center.x - shapeVo.center.x) <= Math.max(shapeVo.size.width, 120))
    );

    let curBottomY = shapeSize.height + 16;

    explanationTextIds.forEach((tId) => {
      const textVo = objectMap.get(tId);
      
      const explPos = { x: shapeSize.width / 2, y: curBottomY + textVo.size.height / 2 };
      localPlacements.push(createPlacement(textVo, explPos, unitId, 'center'));
      curBottomY += textVo.size.height + 12;
      unitObjIds.push(tId);
      assignedIds.add(tId);
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
      type: vo.kind === 'text' ? 'text-unit' : (vo.kind === 'freehand' ? 'freeform-unit' : 'shape-unit'),
      role: vo.kind === 'text' ? (vo.originalObject?.metadata?.isHeading ? 'heading' : 'text') : 'concept',
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
