import { getSemanticType } from './cleanupTypes.js';
import { STRUCTURE_TYPES, _planningStateCache } from './discoverVisualStructures.js';
import { getObjectBounds } from './cleanupOpportunities.js';

const RELATIONSHIP_TYPES = Object.freeze({
  CONNECTED: 'connected',
  ADJACENT: 'adjacent',
  ALIGNED: 'aligned',
  OVERLAPPING: 'overlapping',
  SEPARATED: 'separated',
  UNKNOWN: 'unknown'
});

const computeCompleteBounds = (objectIds, connectorIds, ownership, objectMap) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasContent = false;

  objectIds.forEach(id => {
    const obj = objectMap.get(id);
    if (!obj) return;
    const b = getObjectBounds(obj);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
    hasContent = true;

    const textIds = ownership?.ownedByOwner?.get(id) || [];
    textIds.forEach(tId => {
      const tObj = objectMap.get(tId);
      if (!tObj) return;
      const tB = getObjectBounds(tObj);
      minX = Math.min(minX, tB.x);
      minY = Math.min(minY, tB.y);
      maxX = Math.max(maxX, tB.x + tB.width);
      maxY = Math.max(maxY, tB.y + tB.height);
    });
  });

  connectorIds.forEach(id => {
    const obj = objectMap.get(id);
    if (!obj) return;
    const b = getObjectBounds(obj);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
    hasContent = true;
  });

  if (!hasContent) return null;

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return {
    x: minX,
    y: minY,
    width,
    height,
    cx: minX + width / 2,
    cy: minY + height / 2
  };
};

const getResolvedBounds = (struct, selectedCandidateMap) => {
  const selectedCandidate = selectedCandidateMap.get(struct.id);
  if (selectedCandidate && selectedCandidate.candidateCompleteBounds) {
    return { ...selectedCandidate.candidateCompleteBounds };
  }

  const cached = _planningStateCache.get(struct.id);
  if (cached) {
    const winningCand = (cached.candidateCompositions || [])[0];
    if (winningCand && winningCand.candidateCompleteBounds) {
      return { ...winningCand.candidateCompleteBounds };
    }
  }

  return null;
};

const isProtectedType = (type) => {
  return type === STRUCTURE_TYPES.CREATIVE || type === STRUCTURE_TYPES.STRUCTURAL;
};

const computeBoundsGap = (b1, b2) => {
  if (!b1 || !b2) return { horizontalGap: Infinity, verticalGap: Infinity, minDistance: Infinity };

  const left1 = b1.x;
  const right1 = b1.x + b1.width;
  const top1 = b1.y;
  const bottom1 = b1.y + b1.height;

  const left2 = b2.x;
  const right2 = b2.x + b2.width;
  const top2 = b2.y;
  const bottom2 = b2.y + b2.height;

  const horizontalGap = Math.max(0, Math.max(left1, left2) - Math.min(right1, right2));
  const verticalGap = Math.max(0, Math.max(top1, top2) - Math.min(bottom1, bottom2));

  const dx = Math.max(0, Math.max(left1, left2) - Math.min(right1, right2));
  const dy = Math.max(0, Math.max(top1, top2) - Math.min(bottom1, bottom2));
  const minDistance = Math.hypot(dx, dy);

  return { horizontalGap, verticalGap, minDistance };
};

const computeBoundsOverlap = (b1, b2) => {
  if (!b1 || !b2) return { overlapArea: 0, overlapRatio: 0 };

  const xOverlap = Math.max(0, Math.min(b1.x + b1.width, b2.x + b2.width) - Math.max(b1.x, b2.x));
  const yOverlap = Math.max(0, Math.min(b1.y + b1.height, b2.y + b2.height) - Math.max(b1.y, b2.y));
  const overlapArea = xOverlap * yOverlap;
  const smallerArea = Math.min(b1.width * b1.height, b2.width * b2.height);
  const overlapRatio = smallerArea > 0 ? overlapArea / smallerArea : 0;

  return { overlapArea, overlapRatio };
};

const computeAlignmentEvidence = (b1, b2) => {
  if (!b1 || !b2) return [];
  const evidence = [];

  const cxDev = Math.abs(b1.cx - b2.cx);
  const cyDev = Math.abs(b1.cy - b2.cy);
  const leftDev = Math.abs(b1.x - b2.x);
  const rightDev = Math.abs((b1.x + b1.width) - (b2.x + b2.width));
  const topDev = Math.abs(b1.y - b2.y);
  const bottomDev = Math.abs((b1.y + b1.height) - (b2.y + b2.height));

  if (cyDev < 20) evidence.push({ axis: 'y', type: 'centerline', deviation: cyDev });
  if (cxDev < 20) evidence.push({ axis: 'x', type: 'centerline', deviation: cxDev });
  if (topDev < 15) evidence.push({ axis: 'y', type: 'top-edge', deviation: topDev });
  if (bottomDev < 15) evidence.push({ axis: 'y', type: 'bottom-edge', deviation: bottomDev });
  if (leftDev < 15) evidence.push({ axis: 'x', type: 'left-edge', deviation: leftDev });
  if (rightDev < 15) evidence.push({ axis: 'x', type: 'right-edge', deviation: rightDev });

  return evidence;
};

export const extractStructureBlocks = (visualStructures, options = {}) => {
  const {
    selectedCandidates = [],
    objectMap = new Map(),
    ownership = {},
    rawObjects = []
  } = options;

  const selectedCandidateMap = new Map();
  selectedCandidates.forEach(cand => {
    if (cand.structureId && !selectedCandidateMap.has(cand.structureId)) {
      selectedCandidateMap.set(cand.structureId, cand);
    }
  });

  const blocks = [];

  visualStructures.forEach(struct => {
    const resolvedBounds = getResolvedBounds(struct, selectedCandidateMap);
    const currentBounds = computeCompleteBounds(
      struct.objectIds || [],
      struct.connectorIds || [],
      ownership,
      objectMap
    );

    const effectiveBounds = resolvedBounds || currentBounds;
    if (!effectiveBounds) return;

    const hasLocalResolution = resolvedBounds !== null;
    const selectedCand = selectedCandidateMap.get(struct.id);

    blocks.push({
      id: `block_${struct.id}`,
      structureId: struct.id,
      type: struct.type,

      objectIds: [...(struct.objectIds || [])],
      connectorIds: [...(struct.connectorIds || [])],

      bounds: { ...effectiveBounds },
      center: { x: effectiveBounds.cx, y: effectiveBounds.cy },
      width: effectiveBounds.width,
      height: effectiveBounds.height,

      currentBounds: currentBounds ? { ...currentBounds } : null,
      resolvedBounds: resolvedBounds ? { ...resolvedBounds } : null,

      localResolution: hasLocalResolution ? {
        template: selectedCand?.template || null,
        benefit: selectedCand?.compositionBenefit ?? 0,
        quality: selectedCand?.quality ?? null,
        safe: selectedCand?.safe ?? true
      } : null,

      relationships: [...(struct.relationships || [])],

      confidence: struct.confidence,
      cleanupEligibility: struct.cleanupEligibility || 'eligible',
      protected: isProtectedType(struct.type) || struct.cleanupEligibility === 'outside-scope',

      evidence: [...(struct.evidence || [])]
    });
  });

  return blocks;
};

export const extractBoardEvidence = (blocks, options = {}) => {
  const {
    rawObjects = [],
    objectMap = new Map()
  } = options;

  let boardMinX = Infinity, boardMinY = Infinity;
  let boardMaxX = -Infinity, boardMaxY = -Infinity;

  blocks.forEach(block => {
    boardMinX = Math.min(boardMinX, block.bounds.x);
    boardMinY = Math.min(boardMinY, block.bounds.y);
    boardMaxX = Math.max(boardMaxX, block.bounds.x + block.bounds.width);
    boardMaxY = Math.max(boardMaxY, block.bounds.y + block.bounds.height);
  });

  const boardBounds = blocks.length > 0 ? {
    x: boardMinX,
    y: boardMinY,
    width: Math.max(1, boardMaxX - boardMinX),
    height: Math.max(1, boardMaxY - boardMinY),
    cx: boardMinX + (boardMaxX - boardMinX) / 2,
    cy: boardMinY + (boardMaxY - boardMinY) / 2
  } : null;

  let occupiedMinX = Infinity, occupiedMinY = Infinity;
  let occupiedMaxX = -Infinity, occupiedMaxY = -Infinity;
  let hasOccupied = false;

  rawObjects.forEach(obj => {
    const b = getObjectBounds(obj);
    if (b.width <= 0 && b.height <= 0) return;
    occupiedMinX = Math.min(occupiedMinX, b.x);
    occupiedMinY = Math.min(occupiedMinY, b.y);
    occupiedMaxX = Math.max(occupiedMaxX, b.x + b.width);
    occupiedMaxY = Math.max(occupiedMaxY, b.y + b.height);
    hasOccupied = true;
  });

  const occupiedBounds = hasOccupied ? {
    x: occupiedMinX,
    y: occupiedMinY,
    width: Math.max(1, occupiedMaxX - occupiedMinX),
    height: Math.max(1, occupiedMaxY - occupiedMinY),
    cx: occupiedMinX + (occupiedMaxX - occupiedMinX) / 2,
    cy: occupiedMinY + (occupiedMaxY - occupiedMinY) / 2
  } : null;

  const protectedBlocks = blocks.filter(b => b.protected);
  let protectedMinX = Infinity, protectedMinY = Infinity;
  let protectedMaxX = -Infinity, protectedMaxY = -Infinity;
  let hasProtected = false;

  protectedBlocks.forEach(block => {
    protectedMinX = Math.min(protectedMinX, block.bounds.x);
    protectedMinY = Math.min(protectedMinY, block.bounds.y);
    protectedMaxX = Math.max(protectedMaxX, block.bounds.x + block.bounds.width);
    protectedMaxY = Math.max(protectedMaxY, block.bounds.y + block.bounds.height);
    hasProtected = true;
  });

  const protectedOccupiedBounds = hasProtected ? {
    x: protectedMinX,
    y: protectedMinY,
    width: Math.max(1, protectedMaxX - protectedMinX),
    height: Math.max(1, protectedMaxY - protectedMinY),
    cx: protectedMinX + (protectedMaxX - protectedMinX) / 2,
    cy: protectedMinY + (protectedMaxY - protectedMinY) / 2
  } : null;

  const relationships = [];
  const sortedBlocks = [...blocks].sort((a, b) => a.id.localeCompare(b.id));

  for (let i = 0; i < sortedBlocks.length; i++) {
    for (let j = i + 1; j < sortedBlocks.length; j++) {
      const a = sortedBlocks[i];
      const b = sortedBlocks[j];

      const gap = computeBoundsGap(a.bounds, b.bounds);
      const overlap = computeBoundsOverlap(a.bounds, b.bounds);
      const alignmentEvidence = computeAlignmentEvidence(a.bounds, b.bounds);

      let connected = false;
      a.relationships.forEach(rel => {
        if (rel.type === 'connectedTo') {
          const targetInB = b.objectIds.includes(rel.targetObjectId) || b.objectIds.includes(rel.sourceObjectId);
          if (targetInB) connected = true;
        }
      });
      b.relationships.forEach(rel => {
        if (rel.type === 'connectedTo') {
          const targetInA = a.objectIds.includes(rel.targetObjectId) || a.objectIds.includes(rel.sourceObjectId);
          if (targetInA) connected = true;
        }
      });

      const rel = {
        blockA: a.id,
        blockB: b.id,
        structureA: a.structureId,
        structureB: b.structureId,
        connected,
        overlapping: overlap.overlapArea > 0,
        overlapArea: overlap.overlapArea,
        overlapRatio: Number(overlap.overlapRatio.toFixed(4)),
        horizontalGap: gap.horizontalGap,
        verticalGap: gap.verticalGap,
        minDistance: Number(gap.minDistance.toFixed(2)),
        alignmentEvidence,
        relativePosition: {
          dx: Number((b.center.x - a.center.x).toFixed(2)),
          dy: Number((b.center.y - a.center.y).toFixed(2))
        }
      };

      relationships.push(rel);
    }
  }

  const blockSummary = {
    total: blocks.length,
    byType: {},
    protectedCount: protectedBlocks.length,
    withLocalResolution: blocks.filter(b => b.localResolution !== null).length,
    standaloneCount: blocks.filter(b => b.type === STRUCTURE_TYPES.STANDALONE).length
  };

  blocks.forEach(b => {
    blockSummary.byType[b.type] = (blockSummary.byType[b.type] || 0) + 1;
  });

  return {
    blocks,
    relationships,
    boardBounds,
    occupiedBounds,
    protectedOccupiedBounds,
    blockSummary,
    evidence: {
      blockCount: blocks.length,
      relationshipCount: relationships.length,
      connectedPairs: relationships.filter(r => r.connected).length,
      overlappingPairs: relationships.filter(r => r.overlapping).length,
      alignedPairs: relationships.filter(r => r.alignmentEvidence.length > 0).length,
      protectedBlockCount: protectedBlocks.length
    }
  };
};

export { RELATIONSHIP_TYPES };

export default {
  extractStructureBlocks,
  extractBoardEvidence,
  RELATIONSHIP_TYPES
};
