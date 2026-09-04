
import { parseConnectorPath } from './connectorGeometry.js';

export const MAX_ATTACH_DISTANCE = 35;
export const MIN_AMBIGUITY_MARGIN = 15;

export const getShapeBoundaryGeometry = (shape) => {
  const left = shape.bounds?.x ?? shape.position?.x ?? shape.left ?? 0;
  const top = shape.bounds?.y ?? shape.position?.y ?? shape.top ?? 0;
  const width = shape.bounds?.width ?? shape.size?.width ?? shape.width ?? 0;
  const height = shape.bounds?.height ?? shape.size?.height ?? shape.height ?? 0;
  const cx = left + width / 2;
  const cy = top + height / 2;
  const shapeType = shape.shapeType || shape.type || 'rect';

  return {
    left,
    top,
    width,
    height,
    cx,
    cy,
    right: left + width,
    bottom: top + height,
    shapeType
  };
};

const distToSegment = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
};

export const getDistanceToShapeBoundary = (point, shape) => {
  const g = getShapeBoundaryGeometry(shape);

  if (g.shapeType === 'circle') {
    const radius = Math.min(g.width, g.height) / 2;
    const distToCenter = Math.hypot(point.x - g.cx, point.y - g.cy);
    return Math.abs(distToCenter - radius);
  }

  if (g.shapeType === 'diamond') {
    const vertices = [
      { x: g.cx, y: g.top },
      { x: g.right, y: g.cy },
      { x: g.cx, y: g.bottom },
      { x: g.left, y: g.cy }
    ];
    let minDist = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      minDist = Math.min(minDist, distToSegment(point, v1, v2));
    }
    return minDist;
  }

  if (g.shapeType === 'triangle') {
    const vertices = [
      { x: g.cx, y: g.top },
      { x: g.right, y: g.bottom },
      { x: g.left, y: g.bottom }
    ];
    let minDist = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      minDist = Math.min(minDist, distToSegment(point, v1, v2));
    }
    return minDist;
  }

  const isInside = point.x >= g.left && point.x <= g.right && point.y >= g.top && point.y <= g.bottom;
  if (isInside) {
    return Math.min(
      point.x - g.left,
      g.right - point.x,
      point.y - g.top,
      g.bottom - point.y
    );
  }

  const dx = Math.max(g.left - point.x, 0, point.x - g.right);
  const dy = Math.max(g.top - point.y, 0, point.y - g.bottom);
  return Math.hypot(dx, dy);
};

export const getConnectorEndpointsAndTangents = (connector) => {
  const parsed = parseConnectorPath(connector.path || connector.pathCommands);
  if (!parsed || !parsed.mainCommands || parsed.mainCommands.length === 0) {
    const bounds = connector.bounds || connector.position || { x: 0, y: 0, width: 0, height: 0 };
    return {
      startPt: { x: bounds.x, y: bounds.y },
      endPt: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      startTangent: { x: 1, y: 0 },
      endTangent: { x: 1, y: 0 }
    };
  }

  const cmds = parsed.mainCommands;
  const startPt = { x: Number(cmds[0][1]), y: Number(cmds[0][2]) };
  
  let startTangent = { x: 1, y: 0 };
  if (cmds.length > 1) {
    const nextCmd = cmds[1];
    const type = nextCmd[0];
    if (type === 'L' || type === 'l') {
      startTangent = { x: Number(nextCmd[1]) - startPt.x, y: Number(nextCmd[2]) - startPt.y };
    } else if (type === 'C' || type === 'c' || type === 'Q' || type === 'q') {
      startTangent = { x: Number(nextCmd[1]) - startPt.x, y: Number(nextCmd[2]) - startPt.y };
    }
  }

  const lastCmd = cmds[cmds.length - 1];
  const lastType = lastCmd[0];
  const endX = Number(lastCmd[lastCmd.length - 2]);
  const endY = Number(lastCmd[lastCmd.length - 1]);
  const endPt = { x: endX, y: endY };

  let endTangent = { x: 1, y: 0 };
  if (cmds.length > 1) {
    if (lastType === 'C' || lastType === 'c') {
      endTangent = { x: endX - Number(lastCmd[3]), y: endY - Number(lastCmd[4]) };
    } else if (lastType === 'Q' || lastType === 'q') {
      endTangent = { x: endX - Number(lastCmd[1]), y: endY - Number(lastCmd[2]) };
    } else {
      const prevCmd = cmds[cmds.length - 2];
      const prevX = Number(prevCmd[prevCmd.length - 2]);
      const prevY = Number(prevCmd[prevCmd.length - 1]);
      endTangent = { x: endX - prevX, y: endY - prevY };
    }
  }

  return { startPt, endPt, startTangent, endTangent };
};

export const checkDirectionCompatibility = (point, tangent, shape, role) => {
  const g = getShapeBoundaryGeometry(shape);
  const tanLen = Math.hypot(tangent.x, tangent.y);
  if (tanLen === 0) return true;

  if (role === 'source') {
    const u = { x: point.x - g.cx, y: point.y - g.cy };
    const uLen = Math.hypot(u.x, u.y);
    if (uLen === 0) return true;
    const dot = (tangent.x * u.x + tangent.y * u.y) / (tanLen * uLen);
    return dot >= -0.5;
  }

  if (role === 'target') {
    const u = { x: g.cx - point.x, y: g.cy - point.y };
    const uLen = Math.hypot(u.x, u.y);
    if (uLen === 0) return true;
    const dot = (tangent.x * u.x + tangent.y * u.y) / (tanLen * uLen);
    return dot >= -0.5;
  }

  return true;
};

export const evaluateEndpointCandidate = (point, tangent, candidateShapes, role, connectorId) => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { shapeId: null, confidence: 0.0, evidence: 'invalid endpoint point' };
  }

  const scored = candidateShapes
    .filter((s) => s.id !== connectorId)
    .map((s) => ({
      shape: s,
      dist: getDistanceToShapeBoundary(point, s),
      directionOk: checkDirectionCompatibility(point, tangent, s, role)
    }))
    .sort((a, b) => a.dist - b.dist);

  if (scored.length === 0) {
    return { shapeId: null, confidence: 0.0, evidence: 'no candidate shapes' };
  }

  const best = scored[0];
  const second = scored[1];

  if (best.dist > MAX_ATTACH_DISTANCE) {
    return {
      shapeId: null,
      confidence: Math.max(0.2, 0.85 - (best.dist - MAX_ATTACH_DISTANCE) / 100),
      evidence: `floating endpoint (closest shape boundary: ${best.dist.toFixed(1)}px)`
    };
  }

  if (!best.directionOk) {
    return {
      shapeId: null,
      confidence: 0.70,
      evidence: `direction incompatible with shape ${best.shape.id}`
    };
  }

  if (second && second.dist <= MAX_ATTACH_DISTANCE + 15) {
    const margin = second.dist - best.dist;
    if (margin < MIN_AMBIGUITY_MARGIN) {
      return {
        shapeId: null,
        confidence: 0.80,
        evidence: `ambiguous candidates (${best.shape.id} at ${best.dist.toFixed(1)}px vs ${second.shape.id} at ${second.dist.toFixed(1)}px, margin ${margin.toFixed(1)}px)`
      };
    }
  }

  const confidence = best.dist <= 20 ? 0.97 : 0.95;
  return {
    shapeId: best.shape.id,
    confidence,
    evidence: `unambiguous boundary proximity (${best.dist.toFixed(1)}px)`
  };
};

export const recoverConnectorTopology = (connector, candidateShapes = []) => {
  const explicitSource = connector.sourceShapeId || connector.relationshipMetadata?.sourceShapeId || null;
  const explicitTarget = connector.targetShapeId || connector.relationshipMetadata?.targetShapeId || null;

  let sourceShapeId = explicitSource;
  let targetShapeId = explicitTarget;
  let sourceConfidence = explicitSource ? 0.99 : 0.0;
  let targetConfidence = explicitTarget ? 0.99 : 0.0;
  let sourceEvidence = explicitSource ? 'explicit-persisted-metadata' : null;
  let targetEvidence = explicitTarget ? 'explicit-persisted-metadata' : null;

  const { startPt, endPt, startTangent, endTangent } = getConnectorEndpointsAndTangents(connector);

  const isReversed = Boolean(connector.startArrow && !connector.endArrow);
  const sourcePt = isReversed ? endPt : startPt;
  const sourceTan = isReversed ? { x: -endTangent.x, y: -endTangent.y } : startTangent;
  const targetPt = isReversed ? startPt : endPt;
  const targetTan = isReversed ? { x: -startTangent.x, y: -startTangent.y } : endTangent;

  if (!explicitSource) {
    const res = evaluateEndpointCandidate(sourcePt, sourceTan, candidateShapes, 'source', connector.id);
    sourceConfidence = res.confidence;
    sourceEvidence = res.evidence;
    if (res.confidence >= 0.95) {
      sourceShapeId = res.shapeId;
    }
  }

  if (!explicitTarget) {
    const res = evaluateEndpointCandidate(targetPt, targetTan, candidateShapes, 'target', connector.id);
    targetConfidence = res.confidence;
    targetEvidence = res.evidence;
    if (res.confidence >= 0.95) {
      targetShapeId = res.shapeId;
    }
  }

  const hasExplicit = Boolean(explicitSource || explicitTarget);
  const hasRecovered = Boolean(
    (sourceShapeId && !explicitSource && sourceConfidence >= 0.95) ||
    (targetShapeId && !explicitTarget && targetConfidence >= 0.95)
  );

  const endpointSource = hasExplicit
    ? 'explicit'
    : (hasRecovered ? 'geometric-recovery' : 'none');

  const finalSourceShapeId = sourceConfidence >= 0.95 ? sourceShapeId : null;
  const finalTargetShapeId = targetConfidence >= 0.95 ? targetShapeId : null;

  return {
    sourceShapeId: finalSourceShapeId,
    targetShapeId: finalTargetShapeId,
    sourceConfidence,
    targetConfidence,
    overallConfidence: Math.min(sourceConfidence, targetConfidence),
    sourceEvidence,
    targetEvidence,
    endpointSource
  };
};

export default recoverConnectorTopology;
