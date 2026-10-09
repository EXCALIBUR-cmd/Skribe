import { getObjectBounds } from './cleanupOpportunities.js';
import { STRUCTURE_TYPES, evaluateCompleteGeometryCollisions } from './discoverVisualStructures.js';

export const MACRO_CANDIDATE_TYPES = {
  PACK_ADJACENT_ALIGNED: 'PACK_ADJACENT_ALIGNED',
  RESOLVE_MACRO_OVERLAP: 'RESOLVE_MACRO_OVERLAP'
};

const MACRO_CONSTANTS = {
  PACKING_TARGET_GAP: 60,
  MAX_PACKING_GAP: 300,
  MIN_EXCESSIVE_GAP: 120
};

const translateBounds = (bounds, dx, dy) => {
  if (!bounds) return null;
  return {
    ...bounds,
    x: bounds.x + dx,
    y: bounds.y + dy,
    cx: bounds.cx + dx,
    cy: bounds.cy + dy
  };
};

const buildTranslatedGeometry = (blockId, block, dx, dy, options) => {
  const { objectMap, ownership, selectedCandidates } = options;
  const candNodeBounds = [];
  const candLabelBounds = [];
  const candConnectorGeometry = [];
  const candCompleteBounds = translateBounds(block.bounds, dx, dy);
  
  const affectedObjectIds = [...block.objectIds];
  const affectedConnectorIds = [...block.connectorIds];

  const selectedCand = selectedCandidates?.find(c => c.structureId === block.structureId);
  
  if (selectedCand && selectedCand.candidateNodeBounds) {
    selectedCand.candidateNodeBounds.forEach(b => candNodeBounds.push({ id: b.id, ...translateBounds(b, dx, dy) }));
    (selectedCand.candidateLabelBounds || []).forEach(b => candLabelBounds.push({ id: b.id, ...translateBounds(b, dx, dy) }));
    (selectedCand.candidateConnectorGeometry || []).forEach(c => {
      candConnectorGeometry.push({
        ...c,
        startPoint: c.startPoint ? { x: c.startPoint.x + dx, y: c.startPoint.y + dy } : null,
        endPoint: c.endPoint ? { x: c.endPoint.x + dx, y: c.endPoint.y + dy } : null
      });
    });
  } else {
    block.objectIds.forEach(id => {
      const obj = objectMap.get(id);
      if (obj) candNodeBounds.push({ id, ...translateBounds(getObjectBounds(obj), dx, dy) });
      
      const labels = ownership?.ownedByOwner?.get(id) || [];
      labels.forEach(lid => {
        const lObj = objectMap.get(lid);
        if (lObj && !affectedObjectIds.includes(lid)) {
          affectedObjectIds.push(lid);
          candLabelBounds.push({ id: lid, ...translateBounds(getObjectBounds(lObj), dx, dy) });
        }
      });
    });
    
    block.connectorIds.forEach(id => {
      const obj = objectMap.get(id);
      if (obj) {
        candConnectorGeometry.push({
          connId: id,
          startPoint: obj.startPoint ? { x: obj.startPoint.x + dx, y: obj.startPoint.y + dy } : null,
          endPoint: obj.endPoint ? { x: obj.endPoint.x + dx, y: obj.endPoint.y + dy } : null
        });
      }
    });
  }

  return {
    candidateNodeBounds: candNodeBounds,
    candidateLabelBounds: candLabelBounds,
    candidateConnectorGeometry: candConnectorGeometry,
    candidateCompleteBounds: candCompleteBounds,
    affectedObjectIds,
    affectedConnectorIds
  };
};

const calculateMacroQuality = (evidence, blockTranslations) => {
  let score = 0;

  evidence.relationships.forEach(rel => {
    const blockA = evidence.blocks.find(b => b.id === rel.blockA);
    const blockB = evidence.blocks.find(b => b.id === rel.blockB);
    
    const transA = blockTranslations[blockA.id] || { dx: 0, dy: 0 };
    const transB = blockTranslations[blockB.id] || { dx: 0, dy: 0 };
    
    const boundsA = translateBounds(blockA.bounds, transA.dx, transA.dy);
    const boundsB = translateBounds(blockB.bounds, transB.dx, transB.dy);

    const xOverlap = Math.max(0, Math.min(boundsA.x + boundsA.width, boundsB.x + boundsB.width) - Math.max(boundsA.x, boundsB.x));
    const yOverlap = Math.max(0, Math.min(boundsA.y + boundsA.height, boundsB.y + boundsB.height) - Math.max(boundsA.y, boundsB.y));
    const overlapArea = xOverlap * yOverlap;
    
    if (overlapArea > 0) {
      if (blockA.protected || blockB.protected) {
        score += 1000;
      } else {
        score += 50;
      }
    }

    if (rel.connected) {
      const gapX = Math.max(0, Math.max(boundsA.x, boundsB.x) - Math.min(boundsA.x + boundsA.width, boundsB.x + boundsB.width));
      const gapY = Math.max(0, Math.max(boundsA.y, boundsB.y) - Math.min(boundsA.y + boundsA.height, boundsB.y + boundsB.height));
      
      const gap = Math.min(gapX, gapY) === 0 ? Math.max(gapX, gapY) : Math.hypot(gapX, gapY);
      
      if (gap > MACRO_CONSTANTS.MIN_EXCESSIVE_GAP) {
        score += (gap - MACRO_CONSTANTS.PACKING_TARGET_GAP) * 0.1;
      }
    }
  });

  return -score;
};

const calculateMacroMovementCost = (blockTranslations, options) => {
  let totalDisplacement = 0;
  let materiallyMovedObjects = 0;
  let movedBlocks = 0;
  
  Object.keys(blockTranslations).forEach(blockId => {
    const { dx, dy } = blockTranslations[blockId];
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      movedBlocks++;
      const dist = Math.hypot(dx, dy);
      totalDisplacement += dist;
      materiallyMovedObjects += 1;
    }
  });

  return (movedBlocks * 0.5) + (totalDisplacement * 0.01) + (materiallyMovedObjects * 0.1);
};

export const generateMacroCandidates = (evidence, options = {}) => {
  const candidates = [];
  const blocks = evidence.blocks || [];
  const currentBoardQuality = calculateMacroQuality(evidence, {});

  evidence.relationships.forEach(rel => {
    const blockA = blocks.find(b => b.id === rel.blockA);
    const blockB = blocks.find(b => b.id === rel.blockB);
    
    if (!blockA || !blockB) return;

    if (rel.connected && !rel.overlapping && rel.alignmentEvidence.length > 0) {
      const gapX = rel.horizontalGap;
      const gapY = rel.verticalGap;
      const gap = Math.min(gapX, gapY) === 0 ? Math.max(gapX, gapY) : Math.hypot(gapX, gapY);
      
      if (gap > MACRO_CONSTANTS.MIN_EXCESSIVE_GAP && gap <= MACRO_CONSTANTS.MAX_PACKING_GAP) {
        const isHorizontal = gapX > gapY;
        const reduction = gap - MACRO_CONSTANTS.PACKING_TARGET_GAP;
        
        if (reduction > 10) {
          const dxA = isHorizontal ? (blockA.bounds.cx < blockB.bounds.cx ? reduction : -reduction) : 0;
          const dyA = !isHorizontal ? (blockA.bounds.cy < blockB.bounds.cy ? reduction : -reduction) : 0;
          
          if (!blockA.protected) {
            candidates.push(buildMacroCandidate(
              MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
              blockA,
              blockB,
              { [blockA.id]: { dx: dxA, dy: dyA } },
              evidence,
              currentBoardQuality,
              options
            ));
          }
          
          const dxB = isHorizontal ? (blockB.bounds.cx < blockA.bounds.cx ? reduction : -reduction) : 0;
          const dyB = !isHorizontal ? (blockB.bounds.cy < blockA.bounds.cy ? reduction : -reduction) : 0;
          
          if (!blockB.protected) {
            candidates.push(buildMacroCandidate(
              MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
              blockB,
              blockA,
              { [blockB.id]: { dx: dxB, dy: dyB } },
              evidence,
              currentBoardQuality,
              options
            ));
          }
        }
      }
    }

    if (rel.overlapping) {
      const isSemanticContainment = 
        (blockA.type === STRUCTURE_TYPES.STANDALONE && blockB.type === STRUCTURE_TYPES.FLOW) ||
        (blockB.type === STRUCTURE_TYPES.STANDALONE && blockA.type === STRUCTURE_TYPES.FLOW);
        
      if (isSemanticContainment && rel.overlapRatio > 0.8) {
        return;
      }

      const leftPenetration = (blockA.bounds.x + blockA.bounds.width) - blockB.bounds.x;
      const rightPenetration = (blockB.bounds.x + blockB.bounds.width) - blockA.bounds.x;
      const topPenetration = (blockA.bounds.y + blockA.bounds.height) - blockB.bounds.y;
      const bottomPenetration = (blockB.bounds.y + blockB.bounds.height) - blockA.bounds.y;
      
      const pX = leftPenetration < rightPenetration ? -leftPenetration : rightPenetration;
      const pY = topPenetration < bottomPenetration ? -topPenetration : bottomPenetration;
      
      const moveX = Math.abs(pX) < Math.abs(pY);
      const pad = 20;
      
      if (!blockA.protected) {
        const dxA = moveX ? (pX < 0 ? pX - pad : pX + pad) : 0;
        const dyA = !moveX ? (pY < 0 ? pY - pad : pY + pad) : 0;
        candidates.push(buildMacroCandidate(
          MACRO_CANDIDATE_TYPES.RESOLVE_MACRO_OVERLAP,
          blockA,
          blockB,
          { [blockA.id]: { dx: dxA, dy: dyA } },
          evidence,
          currentBoardQuality,
          options
        ));
      }
      
      if (!blockB.protected) {
        const dxB = moveX ? (pX < 0 ? -pX + pad : -pX - pad) : 0;
        const dyB = !moveX ? (pY < 0 ? -pY + pad : -pY - pad) : 0;
        candidates.push(buildMacroCandidate(
          MACRO_CANDIDATE_TYPES.RESOLVE_MACRO_OVERLAP,
          blockB,
          blockA,
          { [blockB.id]: { dx: dxB, dy: dyB } },
          evidence,
          currentBoardQuality,
          options
        ));
      }
    }
  });

  return deduplicateCandidates(candidates);
};

const buildMacroCandidate = (type, movingBlock, anchorBlock, blockTranslations, evidence, currentBoardQuality, options) => {
  const trans = blockTranslations[movingBlock.id];
  const translatedGeometry = buildTranslatedGeometry(movingBlock.id, movingBlock, trans.dx, trans.dy, options);
  
  const candidateBoardQuality = calculateMacroQuality(evidence, blockTranslations);
  const benefit = Number((candidateBoardQuality - currentBoardQuality).toFixed(2));
  
  const movementCost = Number(calculateMacroMovementCost(blockTranslations, options).toFixed(2));

  let confidence = 0.5;
  let risk = 1.0;
  
  if (type === MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED) {
    confidence = 0.90;
    risk = 0.5 + (Math.hypot(trans.dx, trans.dy) * 0.001);
  } else if (type === MACRO_CANDIDATE_TYPES.RESOLVE_MACRO_OVERLAP) {
    confidence = 0.85;
    risk = 0.8;
  }

  if (benefit <= 0) {
    return {
      candidateId: `macro_${type}_${movingBlock.id}_${anchorBlock.id}`,
      type,
      safe: false,
      rejectionReason: 'benefit <= 0'
    };
  }

  let hasUnroutedCrossConnector = false;
  if (options.objectMap && movingBlock && anchorBlock) {
    const rawConns = (options.rawObjects || []).filter(o => o.type === 'connector' || o.semanticType === 'connector');
    for (const c of rawConns) {
      const sId = c.sourceShapeId || c.relationshipMetadata?.sourceShapeId;
      const tId = c.targetShapeId || c.relationshipMetadata?.targetShapeId;
      if (!sId || !tId) continue;
      const sInMoving = movingBlock.objectIds.includes(sId);
      const tInMoving = movingBlock.objectIds.includes(tId);
      if (sInMoving !== tInMoving) {
        const transMoving = blockTranslations[movingBlock.id] || { dx: 0, dy: 0 };
        const otherBlockId = sInMoving ? anchorBlock.id : movingBlock.id;
        const transOther = blockTranslations[otherBlockId] || { dx: 0, dy: 0 };
        if (transMoving.dx !== transOther.dx || transMoving.dy !== transOther.dy) {
          const hasReroute = translatedGeometry.candidateConnectorGeometry.some(cg => cg.connId === c.id && cg.recomputed);
          if (!hasReroute) {
            hasUnroutedCrossConnector = true;
            break;
          }
        }
      }
    }
  }

  if (hasUnroutedCrossConnector) {
    return {
      candidateId: `macro_${type}_${movingBlock.id}_${anchorBlock.id}`,
      type,
      safe: false,
      rejectionReason: 'cross_structure_connector_requires_rerouting'
    };
  }

  let isCollisionSafe = true;
  let rejectionReason = null;
  
  if (options.rawObjects && options.objectMap) {
    const nonMemberObjects = options.rawObjects.filter(obj => 
      !translatedGeometry.affectedObjectIds.includes(obj.id) &&
      !translatedGeometry.affectedConnectorIds.includes(obj.id)
    );

    const collisionResult = evaluateCompleteGeometryCollisions({
      completeGeometry: translatedGeometry,
      nonMemberObjects
    });
    
    if (collisionResult.collidedObjectIds.length > 0 || collisionResult.newForbiddenConnectorCollisions > 0) {
      isCollisionSafe = false;
      rejectionReason = 'collision_detected';
    }
  }

  if (!isCollisionSafe) {
    return {
      candidateId: `macro_${type}_${movingBlock.id}_${anchorBlock.id}`,
      type,
      safe: false,
      rejectionReason
    };
  }
  
  const utility = Number((benefit * confidence - movementCost - risk).toFixed(2));
  
  return {
    candidateId: `macro_${type}_${movingBlock.id}_${anchorBlock.id}`,
    type,
    
    blockIds: [movingBlock.id],
    affectedObjectIds: translatedGeometry.affectedObjectIds,
    affectedConnectorIds: translatedGeometry.affectedConnectorIds,
    
    blockTranslations,
    
    objectGeometry: translatedGeometry,
    
    currentBoardQuality,
    candidateBoardQuality,
    benefit,
    
    movementCost,
    confidence,
    risk,
    utility,
    
    safe: true,
    evidence: [`moved block ${movingBlock.id}`, `heuristic_confidence:${confidence}`, `heuristic_risk:${risk.toFixed(3)}`]
  };
};

const deduplicateCandidates = (candidates) => {
  const unique = [];
  const signatures = new Set();
  
  candidates.forEach(cand => {
    if (!cand.safe) return;

    const blockIds = Object.keys(cand.blockTranslations).sort();
    const transSigs = blockIds.map(id => {
      const trans = cand.blockTranslations[id];
      return `${id}:${Math.round(trans.dx)},${Math.round(trans.dy)}`;
    }).join('|');
    
    const sig = `${cand.type}|${transSigs}`;
    if (!signatures.has(sig)) {
      signatures.add(sig);
      unique.push(cand);
    }
  });

  unique.sort((a, b) => b.utility - a.utility);
  
  return unique;
};

export const selectMacroCandidates = (macroCandidates, options = {}) => {
  const { simulatedPlacements, rawObjects, blocks } = options;
  const selected = [];
  const rejected = [];
  const ownedBlocks = new Set();
  
  const finalBoundsMap = new Map();
  if (simulatedPlacements) {
    simulatedPlacements.forEach(p => {
      finalBoundsMap.set(p.objectId, p.bounds);
    });
  }

  const sortedCandidates = [...macroCandidates].sort((a, b) => {
    if (b.utility !== a.utility) return b.utility - a.utility;
    return String(a.candidateId).localeCompare(String(b.candidateId));
  });

  for (const cand of sortedCandidates) {
    if (!cand.safe) {
      rejected.push({ candidateId: cand.candidateId, reason: cand.rejectionReason || 'unsafe' });
      continue;
    }

    const isOutOfScope = cand.blockIds.some(bId => {
      const b = blocks?.find(x => x.id === bId);
      return b && (b.protected || b.cleanupEligibility === 'outside-scope');
    });
    if (isOutOfScope) {
      rejected.push({ candidateId: cand.candidateId, reason: 'outside_scope' });
      continue;
    }
    
    const hasConflict = cand.blockIds.some(bId => ownedBlocks.has(bId));
    if (hasConflict) {
      rejected.push({ candidateId: cand.candidateId, reason: 'block_ownership_conflict' });
      continue;
    }

    const nonMemberObjects = (rawObjects || [])
      .filter(obj => !cand.affectedObjectIds.includes(obj.id) && !cand.affectedConnectorIds.includes(obj.id))
      .map(obj => {
        const finalBounds = finalBoundsMap.get(obj.id);
        if (finalBounds) {
           return { ...obj, bounds: finalBounds, x: finalBounds.x, y: finalBounds.y, width: finalBounds.width, height: finalBounds.height };
        }
        return obj;
      });

    const collisionResult = evaluateCompleteGeometryCollisions({
      completeGeometry: cand.objectGeometry,
      nonMemberObjects
    });
    
    if (collisionResult.collidedObjectIds.length > 0 || collisionResult.newForbiddenConnectorCollisions > 0) {
      rejected.push({ candidateId: cand.candidateId, reason: 'combined_plan_collision_detected' });
      continue;
    }
    
    selected.push(cand);
    cand.blockIds.forEach(bId => ownedBlocks.add(bId));
    
    cand.affectedObjectIds.forEach(id => {
      const movingBlockId = cand.blockIds[0];
      const trans = cand.blockTranslations[movingBlockId];
      if (trans) {
        const existing = finalBoundsMap.get(id) || rawObjects.find(o => o.id === id)?.bounds;
        if (existing) {
          finalBoundsMap.set(id, {
            ...existing,
            x: existing.x + trans.dx,
            y: existing.y + trans.dy,
            width: existing.width,
            height: existing.height
          });
        }
      }
    });
  }

  return { selectedMacroCandidates: selected, macroConflicts: rejected };
};

export default {
  MACRO_CANDIDATE_TYPES,
  generateMacroCandidates,
  selectMacroCandidates
};
