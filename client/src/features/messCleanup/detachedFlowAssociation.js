import { getSemanticType } from './cleanupTypes.js';
import { getShapeBoundaryGeometry, getConnectorEndpointsAndTangents } from './connectorTopology.js';

export const MIN_DETACHED_ASSOCIATION_CONFIDENCE = 0.90;
export const MAX_CORRIDOR_PERPENDICULAR_DISTANCE = 140;
export const MAX_CORRIDOR_LONGITUDINAL_DISTANCE = 300;
export const MIN_PAIR_SCORE_MARGIN = 0.15;


export const getRayDistanceToShape = (rayOrigin, rayDir, shape) => {
  const g = getShapeBoundaryGeometry(shape);
  const dirLen = Math.hypot(rayDir.x, rayDir.y);
  if (dirLen === 0) return { perpDist: Infinity, longDist: Infinity, isAhead: false };

  const u = { x: rayDir.x / dirLen, y: rayDir.y / dirLen };
  const n = { x: -u.y, y: u.x };

  
  const samplePoints = [
    { x: g.left, y: g.cy },
    { x: g.right, y: g.cy },
    { x: g.cx, y: g.top },
    { x: g.cx, y: g.bottom },
    { x: g.cx, y: g.cy },
    { x: g.left, y: g.top },
    { x: g.right, y: g.top },
    { x: g.left, y: g.bottom },
    { x: g.right, y: g.bottom }
  ];

  let minPerp = Infinity;
  let minLong = Infinity;
  let maxLong = -Infinity;

  samplePoints.forEach((pt) => {
    const vx = pt.x - rayOrigin.x;
    const vy = pt.y - rayOrigin.y;
    const longProj = vx * u.x + vy * u.y;
    const perpProj = Math.abs(vx * n.x + vy * n.y);

    minLong = Math.min(minLong, longProj);
    maxLong = Math.max(maxLong, longProj);
    minPerp = Math.min(minPerp, perpProj);
  });

  
  
  if (Math.abs(u.y) < 0.1) {
    if (rayOrigin.y >= g.top && rayOrigin.y <= g.bottom) {
      minPerp = 0;
    } else if (rayOrigin.y < g.top) {
      minPerp = g.top - rayOrigin.y;
    } else {
      minPerp = rayOrigin.y - g.bottom;
    }
  } else if (Math.abs(u.x) < 0.1) {
    if (rayOrigin.x >= g.left && rayOrigin.x <= g.right) {
      minPerp = 0;
    } else if (rayOrigin.x < g.left) {
      minPerp = g.left - rayOrigin.x;
    } else {
      minPerp = rayOrigin.x - g.right;
    }
  }

  const isAhead = maxLong > 0;
  const longDist = Math.max(0, minLong);

  return {
    perpDist: minPerp,
    longDist,
    minLong,
    maxLong,
    isAhead
  };
};


export const findDetachedFlowAssociation = (connector, candidateShapes = [], context = {}) => {
  
  const semType = getSemanticType(connector);
  if (semType !== 'connector' && !connector.isConnector) {
    return null;
  }

  
  const hasFlowDirection = connector.hasExplicitArrow !== undefined
    ? Boolean(connector.hasExplicitArrow)
    : Boolean(
        connector.endArrow ||
        connector.startArrow ||
        connector.metadata?.endArrow ||
        connector.metadata?.startArrow
      );
  if (!hasFlowDirection) {
    return null;
  }

  
  const validShapes = candidateShapes.filter((s) => s && s.id !== connector.id && ['shape', 'note'].includes(getSemanticType(s)));
  if (validShapes.length < 2) {
    return null;
  }

  
  const { startPt, endPt, startTangent, endTangent } = getConnectorEndpointsAndTangents(connector, validShapes);

  const shaftDx = endPt.x - startPt.x;
  const shaftDy = endPt.y - startPt.y;
  const shaftLen = Math.hypot(shaftDx, shaftDy);

  if (shaftLen < 15) {
    return null; 
  }

  
  const isReversed = Boolean(connector.startArrow && !connector.endArrow);
  const forwardRayOrigin = isReversed ? startPt : endPt;
  const backwardRayOrigin = isReversed ? endPt : startPt;

  const fwdDir = isReversed
    ? { x: -shaftDx / shaftLen, y: -shaftDy / shaftLen }
    : { x: shaftDx / shaftLen, y: shaftDy / shaftLen };
  const bwdDir = { x: -fwdDir.x, y: -fwdDir.y };

  
  const pairEvaluations = [];

  for (const srcCandidate of validShapes) {
    
    const bwdEval = getRayDistanceToShape(backwardRayOrigin, bwdDir, srcCandidate);
    if (!bwdEval.isAhead) continue; 
    if (bwdEval.perpDist > MAX_CORRIDOR_PERPENDICULAR_DISTANCE) continue;
    if (bwdEval.longDist > MAX_CORRIDOR_LONGITUDINAL_DISTANCE) continue;

    for (const tgtCandidate of validShapes) {
      if (srcCandidate.id === tgtCandidate.id) continue;

      
      const fwdEval = getRayDistanceToShape(forwardRayOrigin, fwdDir, tgtCandidate);
      if (!fwdEval.isAhead) continue; 
      if (fwdEval.perpDist > MAX_CORRIDOR_PERPENDICULAR_DISTANCE) continue;
      if (fwdEval.longDist > MAX_CORRIDOR_LONGITUDINAL_DISTANCE) continue;

      
      const srcG = getShapeBoundaryGeometry(srcCandidate);
      const tgtG = getShapeBoundaryGeometry(tgtCandidate);
      const connCx = (startPt.x + endPt.x) / 2;
      const connCy = (startPt.y + endPt.y) / 2;

      
      const flowDx = tgtG.cx - srcG.cx;
      const flowDy = tgtG.cy - srcG.cy;
      const flowLen = Math.hypot(flowDx, flowDy);
      if (flowLen < 20) continue;

      const flowUnit = { x: flowDx / flowLen, y: flowDy / flowLen };
      const flowDot = fwdDir.x * flowUnit.x + fwdDir.y * flowUnit.y;
      if (flowDot < 0.60) continue; 

      
      const srcProj = srcG.cx * flowUnit.x + srcG.cy * flowUnit.y;
      const tgtProj = tgtG.cx * flowUnit.x + tgtG.cy * flowUnit.y;
      const connProj = connCx * flowUnit.x + connCy * flowUnit.y;

      const minProj = Math.min(srcProj, tgtProj);
      const maxProj = Math.max(srcProj, tgtProj);
      if (connProj < minProj - 30 || connProj > maxProj + 30) continue;

      
      const protectedObjects = context.protectedObjects || [];
      let hitsProtected = false;
      for (const prot of protectedObjects) {
        if (prot.id === srcCandidate.id || prot.id === tgtCandidate.id || prot.id === connector.id) continue;
        const protG = getShapeBoundaryGeometry(prot);
        
        const pFwd = getRayDistanceToShape(backwardRayOrigin, fwdDir, prot);
        if (pFwd.isAhead && pFwd.longDist < fwdEval.longDist && pFwd.perpDist < 30) {
          hitsProtected = true;
          break;
        }
      }
      if (hitsProtected) continue;

      
      
      const srcPerpScore = Math.max(0.4, 1.0 - (bwdEval.perpDist / MAX_CORRIDOR_PERPENDICULAR_DISTANCE) * 0.5);
      
      const tgtPerpScore = Math.max(0.4, 1.0 - (fwdEval.perpDist / MAX_CORRIDOR_PERPENDICULAR_DISTANCE) * 0.5);
      
      const srcLongScore = Math.max(0.6, 1.0 - (bwdEval.longDist / MAX_CORRIDOR_LONGITUDINAL_DISTANCE) * 0.3);
      const tgtLongScore = Math.max(0.6, 1.0 - (fwdEval.longDist / MAX_CORRIDOR_LONGITUDINAL_DISTANCE) * 0.3);
      
      const dirScore = flowDot; 

      
      const pairScore = Number(
        (srcPerpScore * 0.25 + tgtPerpScore * 0.25 + srcLongScore * 0.15 + tgtLongScore * 0.15 + dirScore * 0.20).toFixed(4)
      );

      const evidence = [
        `source-behind-shaft (${bwdEval.longDist.toFixed(1)}px long, ${bwdEval.perpDist.toFixed(1)}px perp)`,
        `target-ahead-of-shaft (${fwdEval.longDist.toFixed(1)}px long, ${fwdEval.perpDist.toFixed(1)}px perp)`,
        `directional-agreement (dot=${flowDot.toFixed(2)})`,
        `connector-between-endpoints`,
        `pair-coherence (${pairScore.toFixed(3)})`
      ];

      pairEvaluations.push({
        sourceCandidateId: srcCandidate.id,
        targetCandidateId: tgtCandidate.id,
        sourceCandidate: srcCandidate,
        targetCandidate: tgtCandidate,
        pairScore,
        evidence,
        corridorMetrics: {
          sourceLongDist: bwdEval.longDist,
          sourcePerpDist: bwdEval.perpDist,
          targetLongDist: fwdEval.longDist,
          targetPerpDist: fwdEval.perpDist,
          flowDot
        }
      });
    }
  }

  if (pairEvaluations.length === 0) {
    return {
      association: null,
      rejectionReason: 'NO_CORRIDOR_CANDIDATE_PAIRS',
      candidatesEvaluated: 0
    };
  }

  
  pairEvaluations.sort((a, b) => b.pairScore - a.pairScore);
  const best = pairEvaluations[0];
  const second = pairEvaluations[1];

  
  if (second) {
    const isDifferentPair = second.sourceCandidateId !== best.sourceCandidateId || second.targetCandidateId !== best.targetCandidateId;
    if (isDifferentPair) {
      const margin = best.pairScore - second.pairScore;
      if (margin < MIN_PAIR_SCORE_MARGIN) {
        const conflictType = second.targetCandidateId !== best.targetCandidateId ? 'AMBIGUOUS_TARGET' : 'AMBIGUOUS_SOURCE';
        return {
          association: null,
          rejectionReason: conflictType,
          evidence: `Best pair (${best.sourceCandidateId} -> ${best.targetCandidateId}, score ${best.pairScore.toFixed(2)}) conflicts with competing pair (${second.sourceCandidateId} -> ${second.targetCandidateId}, score ${second.pairScore.toFixed(2)}) within margin ${margin.toFixed(2)}`,
          candidatesEvaluated: pairEvaluations.length
        };
      }
    }
  }

  
  
  const baseConfidence = 0.90 + (best.pairScore - 0.70) * 0.25;
  const associationConfidence = Number(Math.min(0.96, Math.max(0.88, baseConfidence)).toFixed(2));

  if (associationConfidence < MIN_DETACHED_ASSOCIATION_CONFIDENCE) {
    return {
      association: null,
      rejectionReason: 'LOW_ASSOCIATION_CONFIDENCE',
      confidence: associationConfidence,
      candidatesEvaluated: pairEvaluations.length
    };
  }

  const association = {
    connectorId: connector.id,
    sourceCandidateId: best.sourceCandidateId,
    targetCandidateId: best.targetCandidateId,
    associationConfidence,
    evidence: best.evidence,
    routeType: connector.connectorType || connector.metadata?.connectorType || 'straight',
    corridorMetrics: best.corridorMetrics,
    provenance: 'detached-flow-intent'
  };

  return {
    association,
    rejectionReason: null,
    candidatesEvaluated: pairEvaluations.length
  };
};


export const findWorkspaceDetachedFlowAssociations = (rawObjects = [], objectMap = new Map(), context = {}) => {
  const connectors = rawObjects.filter((o) => getSemanticType(o) === 'connector');
  const candidateShapes = rawObjects.filter((o) => ['shape', 'note'].includes(getSemanticType(o)));

  const associations = [];
  const rejections = [];

  connectors.forEach((conn) => {
    
    const srcId = conn.sourceShapeId || conn.relationshipMetadata?.sourceShapeId || null;
    const tgtId = conn.targetShapeId || conn.relationshipMetadata?.targetShapeId || null;

    if (!srcId || !tgtId || !objectMap.has(srcId) || !objectMap.has(tgtId)) {
      const res = findDetachedFlowAssociation(conn, candidateShapes, context);
      if (res && res.association) {
        associations.push(res.association);
      } else if (res && res.rejectionReason) {
        rejections.push({
          connectorId: conn.id,
          reason: res.rejectionReason,
          evidence: res.evidence
        });
      }
    }
  });

  return { associations, rejections };
};
