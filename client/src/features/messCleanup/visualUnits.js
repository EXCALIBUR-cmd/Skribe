/**
 * Visual Unit Reconstruction & Geometry Integrity
 *
 * Phase 4F.11: Visual Unit Reconstruction
 *
 * Reconstructs faithful visual units from WorkspaceModel before layout composition:
 * - Reconstructs Shape + Label + Explanation units
 * - Reconstructs Graph / Flowchart units with dynamically routed connectors
 * - Reconstructs Rigid Freehand Stroke units
 * - Normalizes standalone text to horizontal readable orientation
 * - Verifies geometry integrity on every shape, text, and connector
 */

import { getSemanticType, getShapeType } from './cleanupTypes.js';
import { getObjectDimensions, getPlacementBounds, unionBounds } from './layoutStrategies.js';

/**
 * Diagnostic inspector for WorkspaceModel visual units.
 * Produces a safe, compact diagnostic summary without dumping large image/vector payloads.
 */
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

/**
 * Normalizes an angle into standard [0, 360) range.
 */
export const normalizeAngle = (angle = 0) => {
  const a = angle % 360;
  return a < 0 ? a + 360 : a;
};

/**
 * Builds a clean VisualObjectModel from WorkspaceModel objects.
 */
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

    // Text rotation normalization: standalone text becomes horizontal unless intentionally styled
    let rotation = rawRotation;
    if (kind === 'text') {
      const isAttached = Boolean(obj.relationshipMetadata?.parentShapeId);
      if (!isAttached && (Math.abs(rawRotation - 90) < 5 || Math.abs(rawRotation - 270) < 5)) {
        rotation = 0; // Normalize vertical rotated text into readable horizontal text
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

/**
 * Geometric containment check: returns true if point is inside box.
 */
const isPointInside = (point, box, tolerance = 10) => (
  point.x >= box.x - tolerance &&
  point.x <= box.x + box.width + tolerance &&
  point.y >= box.y - tolerance &&
  point.y <= box.y + box.height + tolerance
);

/**
 * Asserts the geometry integrity of an atomic unit.
 */
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

    const tolerance = 2; // 2px rounding tolerance
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


/**
 * Reconstructs complete atomic visual units from VisualObjectModel and SemanticScene.
 */
export const reconstructVisualUnits = (visualObjects, semanticScene = null) => {
  const objectMap = new Map(visualObjects.map((vo) => [vo.objectId, vo]));
  const assignedIds = new Set();
  const atomicUnits = [];

  const invalidGeometryIds = [];
  const detachedTextIds = [];
  const orphanConnectorIds = [];
  const rotationNormalizedTextIds = [];

  // Helper to create placement record
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
      scale: { x: 1, y: 1 }, // Effective size is already baked into size
      anchor,
      size,
      bounds: getPlacementBounds(localPos, size, anchor, rotation)
    };
  };

  // 1. Reconstruct Flowchart / Graph Units from SemanticScene or raw Connectors
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
  };

  // Cluster connected nodes and connectors
  connectorVos.forEach((connVo) => {
    if (processedConnIds.has(connVo.objectId)) return;
    const srcId = connVo.connectorMetadata?.sourceObjectId;
    const tgtId = connVo.connectorMetadata?.targetObjectId;

    const clusterObjIds = new Set([connVo.objectId]);
    addNodeWithLabels(srcId, clusterObjIds);
    addNodeWithLabels(tgtId, clusterObjIds);

    // Expand cluster for chained connectors
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

  // Also include any semanticScene flowchart groups not already covered
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

      // Check attached text
      const attachedTextId = vo.attachedTextIds[0] || vo.originalObject.relationshipMetadata?.attachedTextId;
      if (attachedTextId && nodeIds.includes(attachedTextId) && !processedNodes.has(attachedTextId)) {
        cluster.push(attachedTextId);
        processedNodes.add(attachedTextId);
      }
      nodeClusters.push(cluster);
    });

    // Check connector direction for graph orientation
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

    // Route connectors between node centers
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

  // 2. Reconstruct Rigid Freehand Stroke Units
  const freeformGroups = (semanticScene?.groups || []).filter((g) => g.type === 'freeform');
  freeformGroups.forEach((g) => {
    const gObjIds = (g.objectIds || []).filter((id) => objectMap.has(id) && !assignedIds.has(id));
    if (gObjIds.length === 0) return;

    // Skip if pure text group
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

  // 3. Reconstruct Shape + Attached Label + Explanation Units
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

    // Identify attached label vs explanation text
    const attachedTextId = shapeVo.attachedTextIds[0] || shapeVo.originalObject.relationshipMetadata?.attachedTextId;
    const textIds = gObjIds.filter((id) => id !== shapeId && objectMap.get(id)?.kind === 'text');

    let curBottomY = shapeSize.height + 16;

    textIds.forEach((tId) => {
      const textVo = objectMap.get(tId);
      if (tId === attachedTextId || textVo.parentObjectId === shapeId || isPointInside(textVo.center, shapeVo.bounds)) {
        // Centered label inside shape
        localPlacements.push(createPlacement(textVo, centerPos, unitId, 'center'));
      } else {
        // Explanation text positioned underneath shape
        const explPos = { x: shapeSize.width / 2, y: curBottomY + textVo.size.height / 2 };
        localPlacements.push(createPlacement(textVo, explPos, unitId, 'center'));
        curBottomY += textVo.size.height + 12;
      }
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

  // 3b. Reconstruct Remaining Standalone Shapes (not part of concept groups)
  visualObjects.forEach((vo) => {
    if (assignedIds.has(vo.objectId) || vo.kind !== 'shape') return;

    let labelTextId = vo.attachedTextIds[0] || null;
    if (!labelTextId) {
      const childText = visualObjects.find(
        (o) => !assignedIds.has(o.objectId) && o.kind === 'text' && o.parentObjectId === vo.objectId
      );
      if (childText) labelTextId = childText.objectId;
    }
    if (!labelTextId) {
      const containedText = visualObjects.find(
        (o) => !assignedIds.has(o.objectId) && o.kind === 'text' && !o.parentObjectId && isPointInside(o.center, vo.bounds)
      );
      if (containedText) labelTextId = containedText.objectId;
    }

    const unitId = `unit_shape_${vo.objectId}`;
    const shapeSize = vo.size;
    const centerPos = { x: shapeSize.width / 2, y: shapeSize.height / 2 };

    const pShape = createPlacement(vo, centerPos, unitId, 'center');
    const localPlacements = [pShape];
    const unitObjIds = [vo.objectId];
    assignedIds.add(vo.objectId);

    if (labelTextId && objectMap.has(labelTextId) && !assignedIds.has(labelTextId)) {
      const textVo = objectMap.get(labelTextId);
      const pText = createPlacement(textVo, centerPos, unitId, 'center');
      localPlacements.push(pText);
      unitObjIds.push(labelTextId);
      assignedIds.add(labelTextId);
    }

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

  // 4. Reconstruct Sticky Notes (background + attached text = one atomic note-unit)
  //
  // A sticky note is authored as two objects: a colored background (rect,
  // isStickyNote) and a separate text object linked back to it. They MUST be
  // reconstructed as a single rigid unit, or the text detaches and drifts away
  // during layout. The link is resolved from explicit relationship metadata
  // only (attachedTextId, then the reverse parentShapeId), never from proximity.
  const NOTE_TEXT_PADDING = 18; // matches sticky-note text padding in FabricCanvas
  visualObjects.forEach((vo) => {
    if (assignedIds.has(vo.objectId) || vo.kind !== 'sticky-note') return;

    const unitId = `unit_note_${vo.objectId}`;
    const noteCenter = { x: vo.size.width / 2, y: vo.size.height / 2 };
    const pNote = createPlacement(vo, noteCenter, unitId, 'center');
    const localPlacements = [pNote];
    const unitObjIds = [vo.objectId];

    // Resolve the note's text child via explicit metadata (highest priority first).
    let noteTextId = vo.attachedTextIds[0] || null;
    if (!(noteTextId && objectMap.has(noteTextId) && !assignedIds.has(noteTextId))) {
      noteTextId = null;
    }
    if (!noteTextId) {
      const childText = visualObjects.find(
        (o) => !assignedIds.has(o.objectId) && o.kind === 'text' && o.parentObjectId === vo.objectId
      );
      if (childText) noteTextId = childText.objectId;
    }

    if (noteTextId && objectMap.has(noteTextId) && !assignedIds.has(noteTextId)) {
      const textVo = objectMap.get(noteTextId);
      // Re-seat the text neatly inside the note at the authored top-left padding.
      // Horizontally centering the text box reproduces the note's symmetric side
      // padding; vertically anchoring near the top keeps notes reading top-down.
      const textLocalPos = {
        x: vo.size.width / 2,
        y: NOTE_TEXT_PADDING + textVo.size.height / 2
      };
      localPlacements.push(createPlacement(textVo, textLocalPos, unitId, 'center'));
      unitObjIds.push(noteTextId);
      assignedIds.add(noteTextId);
    }

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

  // 5. Reconstruct Remaining Standalone Text, Shapes, and Strokes
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
      role: vo.kind === 'text' ? 'text' : 'concept',
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
