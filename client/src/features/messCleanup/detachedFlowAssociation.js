import { getSemanticType } from './cleanupTypes.js';
import { getShapeBoundaryGeometry, getConnectorEndpointsAndTangents } from './connectorTopology.js';

export const MIN_DETACHED_ASSOCIATION_CONFIDENCE = 0.90;
export const MAX_CORRIDOR_PERPENDICULAR_DISTANCE = 140;
export const MAX_CORRIDOR_LONGITUDINAL_DISTANCE = 300;
export const MIN_PAIR_SCORE_MARGIN = 0.15;

export const getShapePolygonVertices = (shape) => {
  const g = getShapeBoundaryGeometry(shape);
  if (Array.isArray(shape?.points) && shape.points.length >= 3) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    shape.points.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    return shape.points.map((p) => ({
      x: g.left + ((p.x - minX) / spanX) * g.width,
      y: g.top + ((p.y - minY) / spanY) * g.height
    }));
  }
  if (g.shapeType === 'diamond') {
    return [
      { x: g.cx, y: g.top },
      { x: g.right, y: g.cy },
      { x: g.cx, y: g.bottom },
      { x: g.left, y: g.cy }
    ];
  }
  if (g.shapeType === 'triangle') {
    return [
      { x: g.cx, y: g.top },
      { x: g.right, y: g.bottom },
      { x: g.left, y: g.bottom }
    ];
  }
  if (g.shapeType === 'hexagon') {
    return [
      { x: g.left + 0.25 * g.width, y: g.top },
      { x: g.left + 0.75 * g.width, y: g.top },
      { x: g.right, y: g.cy },
      { x: g.left + 0.75 * g.width, y: g.bottom },
      { x: g.left + 0.25 * g.width, y: g.bottom },
      { x: g.left, y: g.cy }
    ];
  }
  return [
    { x: g.left, y: g.top },
    { x: g.right, y: g.top },
    { x: g.right, y: g.bottom },
    { x: g.left, y: g.bottom }
  ];
};

export const getRayDistanceToShape = (rayOrigin, rayDir, shape) => {
  const g = getShapeBoundaryGeometry(shape);
  const dirLen = Math.hypot(rayDir.x, rayDir.y);
  if (dirLen === 0) return { perpDist: Infinity, longDist: Infinity, isAhead: false };

  const u = { x: rayDir.x / dirLen, y: rayDir.y / dirLen };
  const n = { x: -u.y, y: u.x };

  const vertices = getShapePolygonVertices(shape);
  let minPerp = Infinity;
  let minLong = Infinity;
  let maxLong = -Infinity;

  vertices.forEach((pt) => {
    const vx = pt.x - rayOrigin.x;
    const vy = pt.y - rayOrigin.y;
    const longProj = vx * u.x + vy * u.y;
    const perpProj = Math.abs(vx * n.x + vy * n.y);

    minLong = Math.min(minLong, longProj);
    maxLong = Math.max(maxLong, longProj);
    minPerp = Math.min(minPerp, perpProj);
  });

  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    const dx = v2.x - v1.x;
    const dy = v2.y - v1.y;
    const denom = u.x * dy - u.y * dx;
    if (Math.abs(denom) > 1e-6) {
      const wx = v1.x - rayOrigin.x;
      const wy = v1.y - rayOrigin.y;
      const t = (wx * dy - wy * dx) / denom;
      const s = (wx * u.y - wy * u.x) / denom;
      if (s >= 0 && s <= 1 && t >= 0) {
        minPerp = 0;
        minLong = Math.min(minLong, t);
        break;
      }
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

/**
 * Evaluates candidate source shapes behind a connector shaft and target shapes ahead.
 *
 * @param {Object} connector - Normalized connector object
 * @param {Array<Object>} candidateShapes - Eligible shape objects
 * @param {Object} context - Optional scene context and protected objects
 * @returns {Object|null} Detached flow association or null
 */
export const findDetachedFlowAssociation = (connector, candidateShapes = [], context = {}) => {
  // Precondition 1: Connector semantic type must be connector
  const semType = getSemanticType(connector);
  if (semType !== 'connector' && !connector.isConnector) {
    return null;
  }

  // Precondition 2: Connector must have an arrowhead or explicit flow direction
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

  // Precondition 3: Must have at least two candidate shapes
  const validShapes = candidateShapes.filter((s) => s && s.id !== connector.id && ['shape', 'note'].includes(getSemanticType(s)));
  if (validShapes.length < 2) {
    return null;
  }

  // Extract shaft endpoints and directional vectors
  const { startPt, endPt, startTangent, endTangent } = getConnectorEndpointsAndTangents(connector, validShapes);

  const shaftDx = endPt.x - startPt.x;
  const shaftDy = endPt.y - startPt.y;
  const shaftLen = Math.hypot(shaftDx, shaftDy);

  if (shaftLen < 15) {
    return null; // Degenerate connector
  }

  // Forward unit vector (source -> target direction)
  const isReversed = Boolean(connector.startArrow && !connector.endArrow);
  const forwardRayOrigin = isReversed ? startPt : endPt;
  const backwardRayOrigin = isReversed ? endPt : startPt;

  const fwdDir = isReversed
    ? { x: -shaftDx / shaftLen, y: -shaftDy / shaftLen }
    : { x: shaftDx / shaftLen, y: shaftDy / shaftLen };
  const bwdDir = { x: -fwdDir.x, y: -fwdDir.y };

  // Evaluate all possible (source, target) pairs
  const pairEvaluations = [];

  for (const srcCandidate of validShapes) {
    // Source must lie behind the backward ray
    const bwdEval = getRayDistanceToShape(backwardRayOrigin, bwdDir, srcCandidate);
    if (!bwdEval.isAhead) continue; // Behind connector start in backward direction
    if (bwdEval.perpDist > MAX_CORRIDOR_PERPENDICULAR_DISTANCE) continue;
    if (bwdEval.longDist > MAX_CORRIDOR_LONGITUDINAL_DISTANCE) continue;

    for (const tgtCandidate of validShapes) {
      if (srcCandidate.id === tgtCandidate.id) continue;

      // Target must lie ahead in the forward direction
      const fwdEval = getRayDistanceToShape(forwardRayOrigin, fwdDir, tgtCandidate);
      if (!fwdEval.isAhead) continue; // Ahead of connector end in forward direction
      if (fwdEval.perpDist > MAX_CORRIDOR_PERPENDICULAR_DISTANCE) continue;
      if (fwdEval.longDist > MAX_CORRIDOR_LONGITUDINAL_DISTANCE) continue;

      // Spatial between-ness: connector center must lie between source and target
      const srcG = getShapeBoundaryGeometry(srcCandidate);
      const tgtG = getShapeBoundaryGeometry(tgtCandidate);
      const connCx = (startPt.x + endPt.x) / 2;
      const connCy = (startPt.y + endPt.y) / 2;

      // Vector from src to tgt
      const flowDx = tgtG.cx - srcG.cx;
      const flowDy = tgtG.cy - srcG.cy;
      const flowLen = Math.hypot(flowDx, flowDy);
      if (flowLen < 20) continue;

      const flowUnit = { x: flowDx / flowLen, y: flowDy / flowLen };
      const flowDot = fwdDir.x * flowUnit.x + fwdDir.y * flowUnit.y;
      if (flowDot < 0.60) continue; // Arrow direction must strongly agree with source -> target vector

      // Check if connector lies between src and tgt along flow axis
      const srcProj = srcG.cx * flowUnit.x + srcG.cy * flowUnit.y;
      const tgtProj = tgtG.cx * flowUnit.x + tgtG.cy * flowUnit.y;
      const connProj = connCx * flowUnit.x + connCy * flowUnit.y;

      const minProj = Math.min(srcProj, tgtProj);
      const maxProj = Math.max(srcProj, tgtProj);
      if (connProj < minProj - 30 || connProj > maxProj + 30) continue;

      // Check for protected content interference in corridor
      const allObstacles = [...validShapes, ...(context.protectedObjects || [])];
      let isObstructed = false;
      for (const obs of allObstacles) {
        if (!obs || obs.id === srcCandidate.id || obs.id === tgtCandidate.id || obs.id === connector.id) continue;
        const obsBwd = getRayDistanceToShape(backwardRayOrigin, bwdDir, obs);
        if (obsBwd.isAhead && obsBwd.longDist < bwdEval.longDist - 10 && obsBwd.perpDist < 35) {
          isObstructed = true;
          break;
        }
        const obsFwd = getRayDistanceToShape(forwardRayOrigin, fwdDir, obs);
        if (obsFwd.isAhead && obsFwd.longDist < fwdEval.longDist - 10 && obsFwd.perpDist < 35) {
          isObstructed = true;
          break;
        }
      }
      if (isObstructed) continue;

      const srcPerpScore = Math.max(0, 1.0 - (bwdEval.perpDist / MAX_CORRIDOR_PERPENDICULAR_DISTANCE));
      const tgtPerpScore = Math.max(0, 1.0 - (fwdEval.perpDist / MAX_CORRIDOR_PERPENDICULAR_DISTANCE));
      const srcLongScore = Math.max(0, 1.0 - (bwdEval.longDist / MAX_CORRIDOR_LONGITUDINAL_DISTANCE));
      const tgtLongScore = Math.max(0, 1.0 - (fwdEval.longDist / MAX_CORRIDOR_LONGITUDINAL_DISTANCE));
      const dirScore = flowDot;

      const pairScore = Number(
        (srcPerpScore * 0.25 + tgtPerpScore * 0.25 + srcLongScore * 0.20 + tgtLongScore * 0.20 + dirScore * 0.10).toFixed(4)
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

  // Sort candidate pairs by score descending
  pairEvaluations.sort((a, b) => b.pairScore - a.pairScore);
  const best = pairEvaluations[0];
  const second = pairEvaluations[1];

  // Ambiguity check: if a second pair exists with conflicting source or target, enforce score margin
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

  // Compute final association confidence based on pair score
  // High confidence required: associationConfidence >= MIN_DETACHED_ASSOCIATION_CONFIDENCE (0.90)
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

/**
 * Evaluates all unverified connectors in a workspace and returns map of detached flow associations.
 */
export const findWorkspaceDetachedFlowAssociations = (rawObjects = [], objectMap = new Map(), context = {}) => {
  const connectors = rawObjects.filter((o) => getSemanticType(o) === 'connector');
  const candidateShapes = rawObjects.filter((o) => ['shape', 'note'].includes(getSemanticType(o)));

  const associations = [];
  const rejections = [];

  connectors.forEach((conn) => {
    // Only inspect connectors with incomplete/unverified metadata
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
