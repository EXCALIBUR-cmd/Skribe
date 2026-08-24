import { LAYOUT_CONSTANTS, LAYOUT_FALLBACKS } from './layoutTypes.js';

const TEXT_TYPES = new Set(['text']);

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a).localeCompare(String(b)));

export const getObjectDimensions = (object = {}) => ({
  width: Math.max(1, Math.abs((object.size?.width || LAYOUT_CONSTANTS.DEFAULT_WIDTH) * (object.scale?.x || 1))),
  height: Math.max(1, Math.abs((object.size?.height || LAYOUT_CONSTANTS.DEFAULT_HEIGHT) * (object.scale?.y || 1)))
});

export const getAnchor = (object = {}) => {
  if (object.relationshipMetadata?.parentShapeId || object.relationshipMetadata?.attachedTextId) {
    return 'center';
  }
  return TEXT_TYPES.has(object.type) ? 'top-left' : 'center';
};

const getRotatedSize = (width, height, rotation = 0) => {
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return {
    width: width * cosine + height * sine,
    height: width * sine + height * cosine
  };
};

export const getPlacementBounds = (position, size, anchor = 'center', rotation = 0) => {
  const rotatedSize = getRotatedSize(size.width, size.height, rotation);
  const x = anchor === 'center' ? position.x - rotatedSize.width / 2 : position.x;
  const y = anchor === 'center' ? position.y - rotatedSize.height / 2 : position.y;
  return {
    x,
    y,
    width: rotatedSize.width,
    height: rotatedSize.height
  };
};

export const createObjectPlacement = (object, position, unitId, objectMap) => {
  const source = objectMap.get(object.id) || object;
  const size = getObjectDimensions(source);
  const rotation = typeof source.rotation === 'number' ? source.rotation : 0;
  const anchor = getAnchor(source);

  return {
    objectId: object.id,
    unitId,
    type: source.type || 'shape',
    relationshipMetadata: source.relationshipMetadata || {},
    position: { x: position.x, y: position.y },
    rotation,
    scale: {
      x: source.scale?.x || 1,
      y: source.scale?.y || 1
    },
    anchor,
    size,
    bounds: getPlacementBounds(position, size, anchor, rotation)
  };
};

const getRepresentative = (unit, objectMap) => {
  const members = unit.objectIds.map((id) => objectMap.get(id)).filter(Boolean);
  return members.find((object) => object.type !== 'text' && object.type !== 'connector') || members[0] || { id: unit.objectIds[0] };
};

export const createUnitPlacement = (unit, position, objectMap) => {
  const representative = getRepresentative(unit, objectMap);
  const representativePosition = objectMap.get(representative.id)?.position || { x: 0, y: 0 };
  const placements = unit.objectIds
    .map((objectId) => objectMap.get(objectId))
    .filter(Boolean)
    .map((object) => {
      const originalPosition = object.position || { x: 0, y: 0 };
      return createObjectPlacement(
        object,
        {
          x: position.x + originalPosition.x - representativePosition.x,
          y: position.y + originalPosition.y - representativePosition.y
        },
        unit.id,
        objectMap
      );
    });

  return {
    unitId: unit.id,
    objectIds: sortIds(unit.objectIds),
    position: { x: position.x, y: position.y },
    placements,
    bounds: unionBounds(placements.map((placement) => placement.bounds))
  };
};

export const unionBounds = (boundsList) => {
  const validBounds = boundsList.filter(Boolean);
  if (validBounds.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...validBounds.map((bounds) => bounds.x));
  const top = Math.min(...validBounds.map((bounds) => bounds.y));
  const right = Math.max(...validBounds.map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...validBounds.map((bounds) => bounds.y + bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

export const positionUnitsInGrid = (units, objectMap, origin, columns = LAYOUT_CONSTANTS.NOTES_COLUMNS) => {
  const placements = [];
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: Math.ceil(units.length / columns) }, () => 0);

  units.forEach((unit, index) => {
    const representative = getRepresentative(unit, objectMap);
    const size = getObjectDimensions(representative);
    columnWidths[index % columns] = Math.max(columnWidths[index % columns], size.width);
    rowHeights[Math.floor(index / columns)] = Math.max(rowHeights[Math.floor(index / columns)], size.height);
  });

  const columnOffsets = columnWidths.map((_, index) => (
    columnWidths.slice(0, index).reduce((sum, width) => sum + width + LAYOUT_CONSTANTS.COLUMN_GAP, 0)
  ));
  const rowOffsets = rowHeights.map((_, index) => (
    rowHeights.slice(0, index).reduce((sum, height) => sum + height + LAYOUT_CONSTANTS.ROW_GAP, 0)
  ));

  units.forEach((unit, index) => {
    const representative = getRepresentative(unit, objectMap);
    const size = getObjectDimensions(representative);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = origin.x + columnOffsets[column] + columnWidths[column] / 2;
    const y = origin.y + rowOffsets[row] + rowHeights[row] / 2;
    placements.push(createUnitPlacement(unit, { x, y }, objectMap));
  });

  return { placements, fallback: null };
};

export const positionUnitsVertically = (units, objectMap, origin, gap = LAYOUT_CONSTANTS.CONTENT_GAP) => {
  const placements = [];
  let currentY = origin.y;

  units.forEach((unit) => {
    const representative = getRepresentative(unit, objectMap);
    const size = getObjectDimensions(representative);
    const anchor = getAnchor(representative);

    const x = anchor === 'top-left' ? origin.x : origin.x + size.width / 2;
    const y = anchor === 'top-left' ? currentY : currentY + size.height / 2;

    const unitPlacement = createUnitPlacement(unit, { x, y }, objectMap);
    placements.push(unitPlacement);

    currentY = unitPlacement.bounds.y + unitPlacement.bounds.height + gap;
  });

  return { placements, fallback: null };
};

const getConnectorEdges = (section, objectMap, unitsByObjectId) => {
  const edges = [];
  section.objectIds
    .map((objectId) => objectMap.get(objectId))
    .filter((object) => object?.type === 'connector')
    .forEach((connector) => {
      const sourceId = connector.relationshipMetadata?.sourceShapeId;
      const targetId = connector.relationshipMetadata?.targetShapeId;
      const sourceUnit = unitsByObjectId.get(sourceId);
      const targetUnit = unitsByObjectId.get(targetId);
      if (sourceUnit && targetUnit && sourceUnit.id !== targetUnit.id) {
        edges.push({
          source: sourceUnit.id,
          target: targetUnit.id,
          sourceObjectId: sourceId,
          targetObjectId: targetId,
          connectorId: connector.id
        });
      }
    });
  return edges;
};

const getGraphLevels = (unitIds, edges) => {
  const incoming = new Map(unitIds.map((id) => [id, 0]));
  const outgoing = new Map(unitIds.map((id) => [id, []]));
  edges.forEach((edge) => {
    if (!incoming.has(edge.source) || !incoming.has(edge.target)) return;
    incoming.set(edge.target, incoming.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
  });

  const queue = [...unitIds].filter((id) => incoming.get(id) === 0).sort();
  const levels = new Map();
  queue.forEach((id) => levels.set(id, 0));
  let processed = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    processed += 1;
    const nextLevel = (levels.get(current) || 0) + 1;
    outgoing.get(current).sort().forEach((target) => {
      incoming.set(target, incoming.get(target) - 1);
      levels.set(target, Math.max(levels.get(target) || 0, nextLevel));
      if (incoming.get(target) === 0) queue.push(target);
    });
    queue.sort();
  }

  return processed === unitIds.length ? levels : null;
};

export const positionDiagramUnits = (section, units, objectMap, unitsByObjectId, origin) => {
  const edges = getConnectorEdges(section, objectMap, unitsByObjectId);
  const nodeUnits = units.filter((unit) => !unit.objectIds.some((id) => objectMap.get(id)?.type === 'connector'));
  const nodeIds = nodeUnits.map((unit) => unit.id).sort();
  const levels = getGraphLevels(nodeIds, edges);

  if (!levels) {
    const fallback = positionUnitsInGrid(nodeUnits, objectMap, origin, 1);
    const nodePlacementByUnitId = new Map(fallback.placements.map((placement) => [placement.unitId, placement]));
    const connectorPlacements = units
      .filter((unit) => unit.objectIds.some((id) => objectMap.get(id)?.type === 'connector'))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((unit) => {
        const connector = objectMap.get(unit.objectIds.find((id) => objectMap.get(id)?.type === 'connector'));
        const sourceUnit = unitsByObjectId.get(connector?.relationshipMetadata?.sourceShapeId);
        const targetUnit = unitsByObjectId.get(connector?.relationshipMetadata?.targetShapeId);
        const sourcePlacement = nodePlacementByUnitId.get(sourceUnit?.id);
        const targetPlacement = nodePlacementByUnitId.get(targetUnit?.id);
        const position = sourcePlacement && targetPlacement
          ? {
              x: (sourcePlacement.position.x + targetPlacement.position.x) / 2,
              y: (sourcePlacement.position.y + targetPlacement.position.y) / 2
            }
          : connector?.position || origin;
        return createUnitPlacement(unit, position, objectMap);
      });
    return { ...fallback, placements: [...fallback.placements, ...connectorPlacements], fallback: LAYOUT_FALLBACKS.CYCLIC_DIAGRAM, edges };
  }

  const vertical = edges.length > 0 && edges.every((edge) => {
    const source = objectMap.get(edge.sourceObjectId);
    const target = objectMap.get(edge.targetObjectId);
    if (!source || !target) return false;
    return Math.abs((target.position?.y || 0) - (source.position?.y || 0)) > Math.abs((target.position?.x || 0) - (source.position?.x || 0));
  });
  const levelGroups = new Map();
  nodeUnits.forEach((unit) => {
    const level = levels.get(unit.id) || 0;
    if (!levelGroups.has(level)) levelGroups.set(level, []);
    levelGroups.get(level).push(unit);
  });

  // Calculate max node dimensions across ALL levels for uniform spacing
  let maxNodeWidth = 0;
  let maxNodeHeight = 0;
  nodeUnits.forEach((unit) => {
    const representative = getRepresentative(unit, objectMap);
    const size = getObjectDimensions(representative);
    maxNodeWidth = Math.max(maxNodeWidth, size.width);
    maxNodeHeight = Math.max(maxNodeHeight, size.height);
  });

  const placements = [];
  const sortedLevels = [...levelGroups.keys()].sort((a, b) => a - b);
  sortedLevels.forEach((level) => {
    const group = levelGroups.get(level).sort((a, b) => a.id.localeCompare(b.id));
    const groupHeight = group.length * (maxNodeHeight + LAYOUT_CONSTANTS.ROW_GAP) - LAYOUT_CONSTANTS.ROW_GAP;
    group.forEach((unit, index) => {
      const representative = getRepresentative(unit, objectMap);
      const size = getObjectDimensions(representative);
      const primary = level * (maxNodeWidth + LAYOUT_CONSTANTS.OBJECT_GAP);
      // Center-align multi-node levels
      const totalSecondary = group.length * (maxNodeHeight + LAYOUT_CONSTANTS.ROW_GAP) - LAYOUT_CONSTANTS.ROW_GAP;
      const secondaryOffset = index * (maxNodeHeight + LAYOUT_CONSTANTS.ROW_GAP) - totalSecondary / 2 + maxNodeHeight / 2;
      const position = vertical
        ? { x: origin.x + secondaryOffset + size.width / 2, y: origin.y + primary + size.height / 2 }
        : { x: origin.x + primary + size.width / 2, y: origin.y + secondaryOffset + size.height / 2 };
      placements.push(createUnitPlacement(unit, position, objectMap));
    });
  });

  const nodePlacementByUnitId = new Map(placements.map((placement) => [placement.unitId, placement]));
  units
    .filter((unit) => unit.objectIds.some((id) => objectMap.get(id)?.type === 'connector'))
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((unit) => {
      const connector = objectMap.get(unit.objectIds.find((id) => objectMap.get(id)?.type === 'connector'));
      const sourceUnit = unitsByObjectId.get(connector?.relationshipMetadata?.sourceShapeId);
      const targetUnit = unitsByObjectId.get(connector?.relationshipMetadata?.targetShapeId);
      const sourcePlacement = nodePlacementByUnitId.get(sourceUnit?.id);
      const targetPlacement = nodePlacementByUnitId.get(targetUnit?.id);
      const originalPosition = connector?.position || { x: origin.x, y: origin.y };
      const position = sourcePlacement && targetPlacement
        ? {
            x: (sourcePlacement.position.x + targetPlacement.position.x) / 2,
            y: (sourcePlacement.position.y + targetPlacement.position.y) / 2
          }
        : originalPosition;
      placements.push(createUnitPlacement(unit, position, objectMap));
    });

  return { placements, fallback: null, edges, direction: vertical ? 'vertical' : 'horizontal' };
};

/**
 * Detects axis-aligned bounding-box collisions between placements.
 * Returns an array of [indexA, indexB] pairs.
 */
export const detectCollisions = (placements, annotations = []) => {
  const annotationTargetMap = new Map();
  if (Array.isArray(annotations)) {
    annotations.forEach((ann) => {
      if (ann && ann.objectId && Array.isArray(ann.targetObjectIds)) {
        if (!annotationTargetMap.has(ann.objectId)) {
          annotationTargetMap.set(ann.objectId, new Set());
        }
        ann.targetObjectIds.forEach((tid) => annotationTargetMap.get(ann.objectId).add(tid));
      }
    });
  }

  const collisions = [];
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i].bounds;
    if (!a) continue;
    const idA = placements[i].objectId;
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j].bounds;
      if (!b) continue;
      const idB = placements[j].objectId;

      // Skip if same unit (linked shape+text overlap is intentional)
      if (placements[i].unitId && placements[i].unitId === placements[j].unitId) continue;

      // Skip if one is an annotation targeting the other
      if (annotationTargetMap.get(idA)?.has(idB) || annotationTargetMap.get(idB)?.has(idA)) continue;

      // Skip if one is a connector attached to the other shape
      const sourceA = placements[i].relationshipMetadata?.sourceShapeId;
      const targetA = placements[i].relationshipMetadata?.targetShapeId;
      const sourceB = placements[j].relationshipMetadata?.sourceShapeId;
      const targetB = placements[j].relationshipMetadata?.targetShapeId;
      if (sourceA === idB || targetA === idB || sourceB === idA || targetB === idA) continue;

      if (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      ) {
        collisions.push([i, j]);
      }
    }
  }
  return collisions;
};

/**
 * Resolves collisions by nudging the second object in each pair.
 * Deterministic: sorted by objectId. Maximum MAX_COLLISION_PASSES iterations.
 */
export const resolveCollisions = (placements, annotations = []) => {
  const nudge = LAYOUT_CONSTANTS.COLLISION_NUDGE;
  const maxPasses = LAYOUT_CONSTANTS.MAX_COLLISION_PASSES;
  let totalResolved = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const collisions = detectCollisions(placements, annotations);
    if (collisions.length === 0) break;

    collisions.forEach(([i, j]) => {
      const a = placements[i].bounds;
      const b = placements[j].bounds;
      if (!a || !b) return;

      // Calculate minimum displacement to separate
      const overlapX = Math.min(a.x + a.width - b.x, b.x + b.width - a.x);
      const overlapY = Math.min(a.y + a.height - b.y, b.y + b.height - a.y);

      if (overlapX <= 0 || overlapY <= 0) return;

      // Nudge along the axis with smaller overlap
      if (overlapX < overlapY) {
        const dx = (a.x + a.width / 2 < b.x + b.width / 2) ? overlapX + nudge : -(overlapX + nudge);
        placements[j].position.x += dx;
        placements[j].bounds.x += dx;
      } else {
        const dy = (a.y + a.height / 2 < b.y + b.height / 2) ? overlapY + nudge : -(overlapY + nudge);
        placements[j].position.y += dy;
        placements[j].bounds.y += dy;
      }
      totalResolved++;
    });
  }

  return totalResolved;
};
