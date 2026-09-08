
import { parseConnectorPath, transformPathCommandsToWorld } from './connectorGeometry.js';

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

export const getConnectorEndpointsAndTangents = (connector, candidateShapes = []) => {
  let pathCommands = connector?.worldPathCommands || connector?.worldPath || connector?.path || connector?.pathCommands;
  if (!connector?.isWorldSpace && !connector?.worldPathCommands && pathCommands) {
    pathCommands = transformPathCommandsToWorld(pathCommands, connector);
  }
  const parsed = parseConnectorPath(pathCommands);
  if (!parsed || !parsed.mainCommands || parsed.mainCommands.length === 0) {
    const bounds = connector.bounds || connector.position || { x: 0, y: 0, width: 0, height: 0 };
    const explicitSource = connector.sourceShapeId || connector.relationshipMetadata?.sourceShapeId || null;
    const explicitTarget = connector.targetShapeId || connector.relationshipMetadata?.targetShapeId || null;

    if (candidateShapes && candidateShapes.length > 0 && (explicitSource || explicitTarget)) {
      const srcShape = candidateShapes.find((s) => s.id === explicitSource);
      const tgtShape = candidateShapes.find((s) => s.id === explicitTarget);
      if (srcShape && tgtShape) {
        const srcG = getShapeBoundaryGeometry(srcShape);
        const tgtG = getShapeBoundaryGeometry(tgtShape);

        const corners = [
          { x: bounds.x, y: bounds.y },
          { x: bounds.x + bounds.width, y: bounds.y },
          { x: bounds.x, y: bounds.y + bounds.height },
          { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
        ];

        const startPt = corners.slice().sort((a, b) => Math.hypot(a.x - srcG.cx, a.y - srcG.cy) - Math.hypot(b.x - srcG.cx, b.y - srcG.cy))[0];
        const endPt = corners.slice().sort((a, b) => Math.hypot(a.x - tgtG.cx, a.y - tgtG.cy) - Math.hypot(b.x - tgtG.cx, b.y - tgtG.cy))[0];
        const tan = { x: endPt.x - startPt.x || 1, y: endPt.y - startPt.y || 0 };

        return {
          startPt,
          endPt,
          startTangent: tan,
          endTangent: tan
        };
      }
    }

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

export const isPointInsideShape = (point, shape) => {
  if (!point || !shape) return false;
  const g = getShapeBoundaryGeometry(shape);
  if (g.shapeType === 'circle') {
    const radius = Math.min(g.width, g.height) / 2;
    return Math.hypot(point.x - g.cx, point.y - g.cy) <= radius;
  }
  if (g.shapeType === 'diamond') {
    const rx = g.width / 2;
    const ry = g.height / 2;
    if (rx === 0 || ry === 0) return false;
    return (Math.abs(point.x - g.cx) / rx + Math.abs(point.y - g.cy) / ry) <= 1.0;
  }
  if (g.shapeType === 'triangle') {
    const x1 = g.cx, y1 = g.top;
    const x2 = g.right, y2 = g.bottom;
    const x3 = g.left, y3 = g.bottom;
    const denom = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    if (Math.abs(denom) < 1e-6) return false;
    const a = ((y2 - y3) * (point.x - x3) + (x3 - x2) * (point.y - y3)) / denom;
    const b = ((y3 - y1) * (point.x - x3) + (x1 - x3) * (point.y - y3)) / denom;
    const c = 1 - a - b;
    return a >= 0 && a <= 1 && b >= 0 && b <= 1 && c >= 0 && c <= 1;
  }
  return point.x >= g.left && point.x <= g.right && point.y >= g.top && point.y <= g.bottom;
};

export const getDistanceToShape = (point, shape) => {
  if (isPointInsideShape(point, shape)) {
    return 0;
  }
  return getDistanceToShapeBoundary(point, shape);
};

export const MAX_EXPLICIT_ATTACH_DISTANCE = 50;

export const evaluateEndpointCandidate = (point, tangent, candidateShapes, role, connectorId) => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { shapeId: null, confidence: 0.0, evidence: 'invalid endpoint point' };
  }

  const scored = candidateShapes
    .filter((s) => s.id !== connectorId)
    .map((s) => ({
      shape: s,
      dist: getDistanceToShape(point, s),
      directionOk: isPointInsideShape(point, s) || checkDirectionCompatibility(point, tangent, s, role)
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

export const validateExplicitEndpoint = ({
  explicitShapeId,
  endpoint,
  tangent,
  candidateShapes = [],
  role = 'source',
  connectorId = null,
  otherEndShapeId = null
}) => {
  if (!explicitShapeId) {
    return {
      status: 'NONE',
      shapeId: null,
      confidence: 0.0,
      evidence: 'no explicit metadata'
    };
  }

  // 1. Look up the referenced shape
  const referencedShape = candidateShapes.find((s) => s.id === explicitShapeId);
  if (!referencedShape) {
    return {
      status: 'INVALID',
      shapeId: null,
      confidence: 0.0,
      evidence: `referenced shape ${explicitShapeId} not found among candidates`
    };
  }

  // 2. Compute distance to the referenced shape (0 if inside, boundary distance if outside)
  const isInside = isPointInsideShape(endpoint, referencedShape);
  const dist = isInside ? 0 : getDistanceToShapeBoundary(endpoint, referencedShape);

  // 3. Check direction compatibility (if inside, direction is trivially compatible)
  const directionOk = isInside || checkDirectionCompatibility(endpoint, tangent, referencedShape, role);

  // 4. Compare against nearby competing shapes (excluding otherEndShapeId, and requiring directionOk)
  const otherShapes = candidateShapes
    .filter((s) => s.id !== connectorId && s.id !== explicitShapeId && s.id !== otherEndShapeId)
    .map((s) => ({
      shape: s,
      dist: getDistanceToShape(endpoint, s),
      directionOk: isPointInsideShape(endpoint, s) || checkDirectionCompatibility(endpoint, tangent, s, role)
    }))
    .filter((s) => s.directionOk)
    .sort((a, b) => a.dist - b.dist);

  const closestOther = otherShapes[0];

  // 5. Check if referenced shape is geometrically plausible (<= MAX_EXPLICIT_ATTACH_DISTANCE)
  if (dist > MAX_EXPLICIT_ATTACH_DISTANCE) {
    return {
      status: 'STALE',
      shapeId: null,
      confidence: Math.max(0.2, 0.85 - (dist - MAX_EXPLICIT_ATTACH_DISTANCE) / 100),
      evidence: `persisted ${role} ${explicitShapeId} is geometrically inconsistent (${dist.toFixed(1)}px > ${MAX_EXPLICIT_ATTACH_DISTANCE}px)`
    };
  }

  // 6. Direction compatibility
  if (!directionOk) {
    return {
      status: 'STALE',
      shapeId: null,
      confidence: 0.70,
      evidence: `persisted ${role} ${explicitShapeId} direction incompatible`
    };
  }

  // 7. Check for competing shapes and ambiguity
  if (closestOther && closestOther.dist <= MAX_EXPLICIT_ATTACH_DISTANCE) {
    const diff = dist - closestOther.dist;
    if (diff >= MIN_AMBIGUITY_MARGIN) {
      return {
        status: 'STALE',
        shapeId: null,
        confidence: 0.75,
        evidence: `persisted ${role} ${explicitShapeId} (${dist.toFixed(1)}px) conflicts with closer shape ${closestOther.shape.id} (${closestOther.dist.toFixed(1)}px)`
      };
    } else if (Math.abs(diff) < MIN_AMBIGUITY_MARGIN && Math.abs(diff) > 0.001) {
      return {
        status: 'AMBIGUOUS',
        shapeId: null,
        confidence: 0.80,
        evidence: `persisted ${role} ${explicitShapeId} (${dist.toFixed(1)}px) is ambiguous with competing shape ${closestOther.shape.id} (${closestOther.dist.toFixed(1)}px)`
      };
    }
  }

  // 8. VALIDATED: consistent geometry
  return {
    status: 'VALIDATED',
    shapeId: explicitShapeId,
    confidence: 0.99,
    evidence: `persisted ${role} ${explicitShapeId} validated by boundary proximity (${dist.toFixed(1)}px)`
  };
};

export const recoverConnectorTopology = (connector, candidateShapes = []) => {
  const explicitSource = connector.sourceShapeId || connector.relationshipMetadata?.sourceShapeId || null;
  const explicitTarget = connector.targetShapeId || connector.relationshipMetadata?.targetShapeId || null;

  const { startPt, endPt, startTangent, endTangent } = getConnectorEndpointsAndTangents(connector, candidateShapes);

  const isReversed = Boolean(connector.startArrow && !connector.endArrow);
  const sourcePt = isReversed ? endPt : startPt;
  const sourceTan = isReversed ? { x: -endTangent.x, y: -endTangent.y } : startTangent;
  const targetPt = isReversed ? startPt : endPt;
  const targetTan = isReversed ? { x: -startTangent.x, y: -startTangent.y } : endTangent;

  // Validate explicit source metadata
  let sourceShapeId = null;
  let sourceConfidence = 0.0;
  let sourceEvidence = null;
  const sourceValidation = validateExplicitEndpoint({
    explicitShapeId: explicitSource,
    endpoint: sourcePt,
    tangent: sourceTan,
    candidateShapes,
    role: 'source',
    connectorId: connector.id,
    otherEndShapeId: explicitTarget
  });

  if (sourceValidation.status === 'VALIDATED') {
    sourceShapeId = sourceValidation.shapeId;
    sourceConfidence = sourceValidation.confidence;
    sourceEvidence = sourceValidation.evidence;
  } else if (sourceValidation.status === 'STALE' || sourceValidation.status === 'INVALID') {
    const geom = evaluateEndpointCandidate(sourcePt, sourceTan, candidateShapes, 'source', connector.id);
    sourceConfidence = geom.confidence;
    sourceEvidence = `${sourceValidation.evidence}; geometric recovery: ${geom.evidence}`;
    if (geom.confidence >= 0.95) {
      sourceShapeId = geom.shapeId;
    }
  } else if (sourceValidation.status === 'AMBIGUOUS') {
    sourceConfidence = sourceValidation.confidence;
    sourceEvidence = sourceValidation.evidence;
    sourceShapeId = null;
  } else {
    // No explicit metadata
    const geom = evaluateEndpointCandidate(sourcePt, sourceTan, candidateShapes, 'source', connector.id);
    sourceConfidence = geom.confidence;
    sourceEvidence = geom.evidence;
    if (geom.confidence >= 0.95) {
      sourceShapeId = geom.shapeId;
    }
  }

  // Validate explicit target metadata
  let targetShapeId = null;
  let targetConfidence = 0.0;
  let targetEvidence = null;
  const targetValidation = validateExplicitEndpoint({
    explicitShapeId: explicitTarget,
    endpoint: targetPt,
    tangent: targetTan,
    candidateShapes,
    role: 'target',
    connectorId: connector.id,
    otherEndShapeId: explicitSource
  });

  if (targetValidation.status === 'VALIDATED') {
    targetShapeId = targetValidation.shapeId;
    targetConfidence = targetValidation.confidence;
    targetEvidence = targetValidation.evidence;
  } else if (targetValidation.status === 'STALE' || targetValidation.status === 'INVALID') {
    const geom = evaluateEndpointCandidate(targetPt, targetTan, candidateShapes, 'target', connector.id);
    targetConfidence = geom.confidence;
    targetEvidence = `${targetValidation.evidence}; geometric recovery: ${geom.evidence}`;
    if (geom.confidence >= 0.95) {
      targetShapeId = geom.shapeId;
    }
  } else if (targetValidation.status === 'AMBIGUOUS') {
    targetConfidence = targetValidation.confidence;
    targetEvidence = targetValidation.evidence;
    targetShapeId = null;
  } else {
    // No explicit metadata
    const geom = evaluateEndpointCandidate(targetPt, targetTan, candidateShapes, 'target', connector.id);
    targetConfidence = geom.confidence;
    targetEvidence = geom.evidence;
    if (geom.confidence >= 0.95) {
      targetShapeId = geom.shapeId;
    }
  }

  const bothExplicitValidated = sourceValidation.status === 'VALIDATED' && targetValidation.status === 'VALIDATED';
  const hasValidatedExplicit = sourceValidation.status === 'VALIDATED' || targetValidation.status === 'VALIDATED';
  const hasRecovered = Boolean(
    (sourceShapeId && sourceValidation.status !== 'VALIDATED' && sourceConfidence >= 0.95) ||
    (targetShapeId && targetValidation.status !== 'VALIDATED' && targetConfidence >= 0.95)
  );

  const endpointSource = bothExplicitValidated
    ? 'explicit'
    : (hasValidatedExplicit
      ? (hasRecovered ? 'hybrid' : 'explicit')
      : (hasRecovered ? 'geometric-recovery' : 'none'));

  const finalSourceShapeId = sourceConfidence >= 0.95 ? sourceShapeId : null;
  const finalTargetShapeId = targetConfidence >= 0.95 ? targetShapeId : null;
  const overallConfidence = Math.min(sourceConfidence, targetConfidence);

  const shaftDirection = {
    x: endPt.x - startPt.x,
    y: endPt.y - startPt.y
  };

  return {
    sourceShapeId: finalSourceShapeId,
    targetShapeId: finalTargetShapeId,
    sourceConfidence,
    targetConfidence,
    overallConfidence,
    sourceEvidence,
    targetEvidence,
    endpointSource,
    rawMetadata: {
      sourceShapeId: explicitSource,
      targetShapeId: explicitTarget
    },
    metadataValidation: {
      source: sourceValidation.status,
      target: targetValidation.status
    },
    worldShaftStart: startPt,
    worldShaftEnd: endPt,
    shaftDirection
  };
};

export default recoverConnectorTopology;
