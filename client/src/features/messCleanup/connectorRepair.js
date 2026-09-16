/**
 * connectorRepair.js — Verified Connector Geometry Repair
 *
 * Phase 4F.19.3: Geometry-only repair layer.
 *
 * Contract:
 * - Topology is decided upstream (planner owns sourceShapeId, targetShapeId, confidence)
 * - This module owns ONLY: boundary anchors, connector route, shaft geometry, arrowhead geometry
 * - Never repairs UNKNOWN / AMBIGUOUS / STALE / INVALID / partial topology
 * - Never promotes topology as a side effect
 * - Never modifies protected objects
 */

import { getSemanticType } from './cleanupTypes.js';
import { recoverConnectorTopology, getShapeBoundaryGeometry } from './connectorTopology.js';
import { parseConnectorPath, transformPathCommandsToWorld, computePathBounds } from './connectorGeometry.js';
import { getObjectBounds } from './cleanupOpportunities.js';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

export const REPAIR_TOPOLOGY_THRESHOLD = 0.85;
export const ATTACHMENT_TOLERANCE = 5; // px — max acceptable attachment error
export const REPAIR_SKIP_TOLERANCE = 5; // px — if already within this, skip repair

// ──────────────────────────────────────────────────────────────────────────────
// Shape Boundary Intersection
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Computes the intersection point of a ray from `fromPoint` toward a target
 * point, with the boundary of `shapeObj`.
 *
 * Supports: rectangle, rounded rectangle, diamond, circle, triangle, hexagon/polygon.
 *
 * @param {Object} shapeObj - Shape object with bounds and shapeType
 * @param {Object} fromPoint - Point outside shape (direction origin) { x, y }
 * @param {Object} toPoint - Point inside/toward shape center { x, y }
 * @returns {{ x: number, y: number }} - Intersection point on shape boundary
 */
export const computeShapeBoundaryIntersection = (shapeObj, fromPoint, toPoint) => {
  const g = getShapeBoundaryGeometry(shapeObj);
  const shapeType = (g.shapeType || 'rect').toLowerCase();

  // Determine shape center
  const cx = g.cx;
  const cy = g.cy;

  // Direction from center toward the external point
  const dx = fromPoint.x - cx;
  const dy = fromPoint.y - cy;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    // Degenerate: fromPoint is at center; use toPoint direction instead
    const tdx = toPoint.x - cx;
    const tdy = toPoint.y - cy;
    if (Math.abs(tdx) < 0.001 && Math.abs(tdy) < 0.001) {
      // Both at center — fallback to right edge
      return { x: g.right, y: cy };
    }
    return computeShapeBoundaryIntersection(shapeObj, toPoint, fromPoint);
  }

  if (shapeType === 'circle') {
    return intersectCircle(cx, cy, g.width / 2, g.height / 2, dx, dy);
  }

  if (shapeType === 'diamond') {
    return intersectDiamond(g, dx, dy);
  }

  if (shapeType === 'triangle') {
    return intersectTriangle(g, dx, dy);
  }

  if (shapeType === 'hexagon' || shapeType === 'polygon') {
    return intersectHexagon(g, dx, dy);
  }

  if (shapeType === 'rounded_rect' || shapeType === 'roundedRect' || shapeType === 'rounded-rect') {
    return intersectRoundedRect(g, dx, dy);
  }

  // Default: rectangle
  return intersectRect(g, dx, dy);
};

/**
 * Intersects a ray from center in direction (dx, dy) with an axis-aligned rectangle.
 */
const intersectRect = (g, dx, dy) => {
  const hw = g.width / 2;
  const hh = g.height / 2;

  // t for each edge
  let t = Infinity;

  if (Math.abs(dx) > 0.001) {
    const tRight = hw / Math.abs(dx);
    const tLeft = hw / Math.abs(dx);
    const tX = dx > 0 ? tRight : tLeft;
    const yAtT = dy * tX;
    if (Math.abs(yAtT) <= hh + 0.01) {
      t = Math.min(t, tX);
    }
  }

  if (Math.abs(dy) > 0.001) {
    const tBottom = hh / Math.abs(dy);
    const tTop = hh / Math.abs(dy);
    const tY = dy > 0 ? tBottom : tTop;
    const xAtT = dx * tY;
    if (Math.abs(xAtT) <= hw + 0.01) {
      t = Math.min(t, tY);
    }
  }

  if (!Number.isFinite(t)) t = 1;

  return {
    x: g.cx + dx * t,
    y: g.cy + dy * t
  };
};

/**
 * Intersects a ray from center in direction (dx, dy) with a rounded rectangle.
 * Uses rectangle intersection but clamps to corner arcs.
 */
const intersectRoundedRect = (g, dx, dy) => {
  // Use smaller dimension for corner radius, capped at 20% of smaller side
  const cornerRadius = Math.min(g.width, g.height) * 0.15;
  const hw = g.width / 2;
  const hh = g.height / 2;

  // First get the rectangle intersection
  const rectPt = intersectRect(g, dx, dy);

  // Check if we're in a corner region
  const localX = rectPt.x - g.cx;
  const localY = rectPt.y - g.cy;

  const inCornerX = Math.abs(localX) > (hw - cornerRadius);
  const inCornerY = Math.abs(localY) > (hh - cornerRadius);

  if (inCornerX && inCornerY) {
    // We're in a corner arc region — intersect with corner circle
    const cornerCx = g.cx + Math.sign(localX) * (hw - cornerRadius);
    const cornerCy = g.cy + Math.sign(localY) * (hh - cornerRadius);

    const cdx = g.cx + dx - cornerCx;
    const cdy = g.cy + dy - cornerCy;
    const len = Math.hypot(cdx, cdy);
    if (len > 0.001) {
      return {
        x: cornerCx + (cdx / len) * cornerRadius,
        y: cornerCy + (cdy / len) * cornerRadius
      };
    }
  }

  return rectPt;
};

/**
 * Intersects a ray from center in direction (dx, dy) with a diamond (rhombus).
 * Diamond vertices: top, right, bottom, left of bounding box.
 */
const intersectDiamond = (g, dx, dy) => {
  const hw = g.width / 2;
  const hh = g.height / 2;

  // Diamond edges in normalized coordinates:
  // |x/hw| + |y/hh| = 1
  // Parameterize ray as (t*dx, t*dy):
  // |t*dx/hw| + |t*dy/hh| = 1
  // t * (|dx|/hw + |dy|/hh) = 1
  const denom = Math.abs(dx) / hw + Math.abs(dy) / hh;
  if (denom < 0.001) {
    return { x: g.cx + hw, y: g.cy };
  }

  const t = 1 / denom;

  return {
    x: g.cx + dx * t,
    y: g.cy + dy * t
  };
};

/**
 * Intersects a ray from center in direction (dx, dy) with a circle/ellipse.
 */
const intersectCircle = (cx, cy, rx, ry, dx, dy) => {
  if (rx < 0.001 || ry < 0.001) return { x: cx, y: cy };

  // Normalize to unit circle
  const ndx = dx / rx;
  const ndy = dy / ry;
  const len = Math.hypot(ndx, ndy);
  if (len < 0.001) return { x: cx + rx, y: cy };

  return {
    x: cx + rx * (ndx / len),
    y: cy + ry * (ndy / len)
  };
};

/**
 * Intersects a ray from center in direction (dx, dy) with a triangle.
 * Triangle: apex at top-center, base at bottom.
 */
const intersectTriangle = (g, dx, dy) => {
  const vertices = [
    { x: 0, y: -g.height / 2 },         // top apex
    { x: g.width / 2, y: g.height / 2 },   // bottom-right
    { x: -g.width / 2, y: g.height / 2 }   // bottom-left
  ];

  return intersectConvexPolygon(g.cx, g.cy, vertices, dx, dy);
};

/**
 * Intersects a ray from center in direction (dx, dy) with a regular hexagon.
 * Flat-top hexagon orientation.
 */
const intersectHexagon = (g, dx, dy) => {
  const hw = g.width / 2;
  const hh = g.height / 2;
  // Flat-top hexagon vertices (relative to center)
  const inset = hw * 0.25; // horizontal inset for top/bottom edges
  const vertices = [
    { x: -hw + inset, y: -hh },  // top-left
    { x: hw - inset, y: -hh },   // top-right
    { x: hw, y: 0 },             // right
    { x: hw - inset, y: hh },    // bottom-right
    { x: -hw + inset, y: hh },   // bottom-left
    { x: -hw, y: 0 }             // left
  ];

  return intersectConvexPolygon(g.cx, g.cy, vertices, dx, dy);
};

/**
 * Generic convex polygon ray intersection.
 * Vertices are relative to (cx, cy).
 */
const intersectConvexPolygon = (cx, cy, vertices, dx, dy) => {
  let bestT = Infinity;

  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];

    // Segment: v1 → v2
    // Ray: t * (dx, dy)
    // Solve: t*(dx,dy) = v1 + s*(v2-v1)
    const edgeDx = v2.x - v1.x;
    const edgeDy = v2.y - v1.y;

    const denom = dx * edgeDy - dy * edgeDx;
    if (Math.abs(denom) < 1e-10) continue;

    const t = (v1.x * edgeDy - v1.y * edgeDx) / denom;
    const s = (v1.x * dy - v1.y * dx) / denom;

    if (t > 0 && s >= -0.001 && s <= 1.001) {
      if (t < bestT) {
        bestT = t;
      }
    }
  }

  if (!Number.isFinite(bestT) || bestT <= 0) {
    // Fallback: closest edge point
    bestT = 1;
  }

  return {
    x: cx + dx * bestT,
    y: cy + dy * bestT
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// Ideal Anchor Computation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Computes ideal source and target boundary anchors for a connector between two shapes.
 *
 * @param {Object} sourceShape - Source shape object
 * @param {Object} targetShape - Target shape object
 * @param {Object} [routeHint] - Optional direction hint { dx, dy }
 * @returns {{ sourceAnchor: {x,y}, targetAnchor: {x,y} }}
 */
export const computeIdealConnectorAnchors = (sourceShape, targetShape, routeHint = null) => {
  const srcBounds = getObjectBounds(sourceShape);
  const tgtBounds = getObjectBounds(targetShape);

  const srcCenter = { x: srcBounds.cx, y: srcBounds.cy };
  const tgtCenter = { x: tgtBounds.cx, y: tgtBounds.cy };

  // Source anchor: intersection of line from tgtCenter through srcCenter with source boundary
  const sourceAnchor = computeShapeBoundaryIntersection(sourceShape, tgtCenter, srcCenter);

  // Target anchor: intersection of line from srcCenter through tgtCenter with target boundary
  const targetAnchor = computeShapeBoundaryIntersection(targetShape, srcCenter, tgtCenter);

  return { sourceAnchor, targetAnchor };
};

// ──────────────────────────────────────────────────────────────────────────────
// Connector Repair
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Computes the current world-space shaft endpoints of a connector.
 */
const getCurrentShaftEndpoints = (connector) => {
  let pathCommands = connector?.worldPathCommands || connector?.worldPath || connector?.path || connector?.pathCommands;

  if (!connector?.isWorldSpace && !connector?.worldPathCommands && pathCommands) {
    pathCommands = transformPathCommandsToWorld(pathCommands, connector);
  }

  const parsed = parseConnectorPath(pathCommands);
  if (!parsed || !parsed.mainCommands || parsed.mainCommands.length === 0) {
    const b = getObjectBounds(connector);
    return {
      shaftStart: { x: b.x, y: b.y },
      shaftEnd: { x: b.x + b.width, y: b.y + b.height }
    };
  }

  const isReversed = Boolean(connector.startArrow && !connector.endArrow);

  return {
    shaftStart: isReversed ? parsed.endPt : parsed.startPt,
    shaftEnd: isReversed ? parsed.startPt : parsed.endPt,
    parsed
  };
};

/**
 * Determines the connector route type from an existing connector.
 */
const detectRouteType = (connector) => {
  const ct = connector.connectorType || connector.metadata?.connectorType || connector.connectorMetadata?.connectorType || null;
  if (ct === 'curved' || ct === 'elbow') return ct;

  const pathCommands = connector?.worldPathCommands || connector?.worldPath || connector?.path || connector?.pathCommands;
  if (pathCommands) {
    const parsed = parseConnectorPath(pathCommands);
    if (parsed) {
      const hasCurve = parsed.mainCommands.some((c) => c[0] === 'C' || c[0] === 'c' || c[0] === 'Q' || c[0] === 'q');
      if (hasCurve) return 'curved';
      if (parsed.mainCommands.length > 2) return 'elbow';
    }
  }

  return 'straight';
};

/**
 * Generates a repaired straight shaft path from source anchor to target anchor.
 */
const generateStraightShaftPath = (sourceAnchor, targetAnchor) => {
  return [
    ['M', sourceAnchor.x, sourceAnchor.y],
    ['L', targetAnchor.x, targetAnchor.y]
  ];
};

/**
 * Generates a repaired curved shaft path, preserving curve structure from the original.
 */
const generateCurvedShaftPath = (sourceAnchor, targetAnchor, originalParsed) => {
  if (!originalParsed || !originalParsed.mainCommands) {
    return generateStraightShaftPath(sourceAnchor, targetAnchor);
  }

  const origCmds = originalParsed.mainCommands;
  const curveCmd = origCmds.find((c) => c[0] === 'C' || c[0] === 'c');

  if (!curveCmd || curveCmd.length < 7) {
    return generateStraightShaftPath(sourceAnchor, targetAnchor);
  }

  // Re-anchor the cubic bezier while preserving proportional control points
  const origStart = originalParsed.startPt;
  const origEnd = originalParsed.endPt;
  const origDx = origEnd.x - origStart.x;
  const origDy = origEnd.y - origStart.y;
  const origLenSq = origDx * origDx + origDy * origDy;
  const origLen = Math.max(1, Math.sqrt(origLenSq));

  const origCp1 = { x: Number(curveCmd[1]), y: Number(curveCmd[2]) };
  const origCp2 = { x: Number(curveCmd[3]), y: Number(curveCmd[4]) };

  // Project control points into local coordinate system (along + perpendicular to shaft)
  const cp1Proj = origLenSq > 0.001
    ? ((origCp1.x - origStart.x) * origDx + (origCp1.y - origStart.y) * origDy) / origLenSq
    : 0.35;
  const cp1Perp = origLen > 0.001
    ? ((origCp1.y - origStart.y) * origDx - (origCp1.x - origStart.x) * origDy) / origLen
    : 0;

  const cp2Proj = origLenSq > 0.001
    ? ((origCp2.x - origStart.x) * origDx + (origCp2.y - origStart.y) * origDy) / origLenSq
    : 0.65;
  const cp2Perp = origLen > 0.001
    ? ((origCp2.y - origStart.y) * origDx - (origCp2.x - origStart.x) * origDy) / origLen
    : 0;

  // Reconstruct in new coordinate system
  const newDx = targetAnchor.x - sourceAnchor.x;
  const newDy = targetAnchor.y - sourceAnchor.y;
  const newLen = Math.max(1, Math.sqrt(newDx * newDx + newDy * newDy));
  const newUx = newDx / newLen;
  const newUy = newDy / newLen;
  const newVx = -newUy;
  const newVy = newUx;

  const t1 = Number.isFinite(cp1Proj) ? cp1Proj : 0.35;
  const t2 = Number.isFinite(cp2Proj) ? cp2Proj : 0.65;
  const h1 = Number.isFinite(cp1Perp) ? cp1Perp : -Math.max(30, newLen * 0.25);
  const h2 = Number.isFinite(cp2Perp) ? cp2Perp : -Math.max(30, newLen * 0.25);

  const newCp1 = {
    x: sourceAnchor.x + t1 * newDx + h1 * newVx,
    y: sourceAnchor.y + t1 * newDy + h1 * newVy
  };
  const newCp2 = {
    x: sourceAnchor.x + t2 * newDx + h2 * newVx,
    y: sourceAnchor.y + t2 * newDy + h2 * newVy
  };

  return [
    ['M', sourceAnchor.x, sourceAnchor.y],
    ['C', newCp1.x, newCp1.y, newCp2.x, newCp2.y, targetAnchor.x, targetAnchor.y]
  ];
};

/**
 * Generates arrowhead path commands positioned at the shaft endpoint.
 */
const generateArrowheadPath = (shaftEndPt, tangent, strokeWidth = 3) => {
  const headLen = Math.max(12, strokeWidth * 4.5);
  const wingAngle = 0.42;

  const tanLen = Math.hypot(tangent.x, tangent.y);
  if (tanLen < 0.001) return [];

  const angle = Math.atan2(tangent.y, tangent.x);
  const leftX = shaftEndPt.x - headLen * Math.cos(angle - wingAngle);
  const leftY = shaftEndPt.y - headLen * Math.sin(angle - wingAngle);
  const rightX = shaftEndPt.x - headLen * Math.cos(angle + wingAngle);
  const rightY = shaftEndPt.y - headLen * Math.sin(angle + wingAngle);

  return [
    ['M', leftX, leftY],
    ['L', shaftEndPt.x, shaftEndPt.y],
    ['L', rightX, rightY]
  ];
};

/**
 * Computes a full connector repair for a verified connector.
 *
 * Returns repair payload or rejection.
 *
 * @param {Object} connector - The connector object
 * @param {Object} sourceShape - Source shape object
 * @param {Object} targetShape - Target shape object
 * @param {Object} topology - Recovered topology from connectorTopology.js
 * @returns {Object} Repair result
 */
export const computeConnectorRepair = (connector, sourceShape, targetShape, topology) => {
  const connectorId = connector.id;

  // ── Gate 1: Verify topology threshold ──
  if (!topology.sourceShapeId || !topology.targetShapeId) {
    return {
      repairAccepted: false,
      connectorId,
      repairRejectedReason: 'Incomplete topology: missing source or target shape ID'
    };
  }

  const confidence = topology.overallConfidence ?? Math.min(topology.sourceConfidence ?? 0, topology.targetConfidence ?? 0);
  if (confidence < REPAIR_TOPOLOGY_THRESHOLD) {
    return {
      repairAccepted: false,
      connectorId,
      repairRejectedReason: `Topology confidence ${confidence.toFixed(3)} below threshold ${REPAIR_TOPOLOGY_THRESHOLD}`
    };
  }

  // ── Gate 2: Validate metadata status ──
  const srcStatus = topology.metadataValidation?.source;
  const tgtStatus = topology.metadataValidation?.target;
  const invalidStatuses = ['INVALID', 'STALE', 'AMBIGUOUS'];

  if (srcStatus && invalidStatuses.includes(srcStatus)) {
    return {
      repairAccepted: false,
      connectorId,
      repairRejectedReason: `Source metadata status is ${srcStatus}`
    };
  }

  if (tgtStatus && invalidStatuses.includes(tgtStatus)) {
    return {
      repairAccepted: false,
      connectorId,
      repairRejectedReason: `Target metadata status is ${tgtStatus}`
    };
  }

  // ── Compute current endpoints ──
  const current = getCurrentShaftEndpoints(connector);

  // ── Compute ideal anchors ──
  const { sourceAnchor, targetAnchor } = computeIdealConnectorAnchors(sourceShape, targetShape);

  // ── Gate 3: Check if already within tolerance ──
  const sourceAttachmentBefore = Math.hypot(current.shaftStart.x - sourceAnchor.x, current.shaftStart.y - sourceAnchor.y);
  const targetAttachmentBefore = Math.hypot(current.shaftEnd.x - targetAnchor.x, current.shaftEnd.y - targetAnchor.y);

  if (sourceAttachmentBefore <= REPAIR_SKIP_TOLERANCE && targetAttachmentBefore <= REPAIR_SKIP_TOLERANCE) {
    return {
      repairAccepted: false,
      connectorId,
      repairRejectedReason: 'Already attached within tolerance',
      sourceAttachmentBefore,
      targetAttachmentBefore,
      visuallyAttached: true
    };
  }

  // ── Generate repaired geometry ──
  const routeType = detectRouteType(connector);
  let shaftPath;

  if (routeType === 'curved') {
    shaftPath = generateCurvedShaftPath(sourceAnchor, targetAnchor, current.parsed);
  } else {
    shaftPath = generateStraightShaftPath(sourceAnchor, targetAnchor);
  }

  // Arrowhead
  const hasEndArrow = connector.endArrow !== false;
  const hasStartArrow = Boolean(connector.startArrow);
  const strokeWidth = connector.strokeWidth || connector.visual?.strokeWidth || 3;

  let arrowheadPath = [];
  if (hasEndArrow) {
    const lastShaftCmd = shaftPath[shaftPath.length - 1];
    const prevCmd = shaftPath.length > 1 ? shaftPath[shaftPath.length - 2] : null;

    let tangent;
    if (lastShaftCmd[0] === 'C' && lastShaftCmd.length >= 7) {
      tangent = {
        x: lastShaftCmd[5] - lastShaftCmd[3],
        y: lastShaftCmd[6] - lastShaftCmd[4]
      };
    } else if (prevCmd) {
      const prevX = prevCmd[prevCmd.length - 2];
      const prevY = prevCmd[prevCmd.length - 1];
      tangent = {
        x: lastShaftCmd[lastShaftCmd.length - 2] - prevX,
        y: lastShaftCmd[lastShaftCmd.length - 1] - prevY
      };
    } else {
      tangent = { x: targetAnchor.x - sourceAnchor.x, y: targetAnchor.y - sourceAnchor.y };
    }

    arrowheadPath = generateArrowheadPath(targetAnchor, tangent, strokeWidth);
  }

  if (hasStartArrow) {
    const firstCmd = shaftPath[0];
    const secondCmd = shaftPath.length > 1 ? shaftPath[1] : null;

    let startTangent;
    if (secondCmd && (secondCmd[0] === 'C' || secondCmd[0] === 'c') && secondCmd.length >= 7) {
      startTangent = {
        x: firstCmd[1] - secondCmd[1],
        y: firstCmd[2] - secondCmd[2]
      };
    } else if (secondCmd) {
      startTangent = {
        x: firstCmd[1] - secondCmd[1],
        y: firstCmd[2] - secondCmd[2]
      };
    } else {
      startTangent = { x: sourceAnchor.x - targetAnchor.x, y: sourceAnchor.y - targetAnchor.y };
    }

    const startArrowCmds = generateArrowheadPath(sourceAnchor, startTangent, strokeWidth);
    arrowheadPath = [...arrowheadPath, ...startArrowCmds];
  }

  // ── Validate repair quality ──
  const sourceAttachmentAfter = Math.hypot(
    shaftPath[0][1] - sourceAnchor.x,
    shaftPath[0][2] - sourceAnchor.y
  );
  const lastShaft = shaftPath[shaftPath.length - 1];
  const targetAttachmentAfter = Math.hypot(
    lastShaft[lastShaft.length - 2] - targetAnchor.x,
    lastShaft[lastShaft.length - 1] - targetAnchor.y
  );

  if (sourceAttachmentAfter > ATTACHMENT_TOLERANCE || targetAttachmentAfter > ATTACHMENT_TOLERANCE) {
    return {
      repairAccepted: false,
      connectorId,
      repairRejectedReason: `Repair attachment error exceeds tolerance: source=${sourceAttachmentAfter.toFixed(2)}px, target=${targetAttachmentAfter.toFixed(2)}px`,
      sourceAttachmentAfter,
      targetAttachmentAfter
    };
  }

  const pathChanged = sourceAttachmentBefore > REPAIR_SKIP_TOLERANCE || targetAttachmentBefore > REPAIR_SKIP_TOLERANCE;

  return {
    repairAccepted: true,
    connectorId,
    sourceShapeId: topology.sourceShapeId,
    targetShapeId: topology.targetShapeId,
    topologyConfidence: confidence,
    routeType,
    sourceAnchor: { x: sourceAnchor.x, y: sourceAnchor.y },
    targetAnchor: { x: targetAnchor.x, y: targetAnchor.y },
    shaftPath: shaftPath.map((cmd) => [...cmd]),
    arrowheadPath: arrowheadPath.map((cmd) => [...cmd]),

    // Diagnostics
    currentShaftStart: { ...current.shaftStart },
    currentShaftEnd: { ...current.shaftEnd },
    candidateShaftStart: { x: sourceAnchor.x, y: sourceAnchor.y },
    candidateShaftEnd: { x: targetAnchor.x, y: targetAnchor.y },
    sourceAttachmentBefore,
    targetAttachmentBefore,
    sourceAttachmentAfter,
    targetAttachmentAfter,
    pathChanged,
    visuallyAttached: sourceAttachmentAfter <= ATTACHMENT_TOLERANCE && targetAttachmentAfter <= ATTACHMENT_TOLERANCE,
    repairRejectedReason: null
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// Protected-Object Safety Validation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a repaired connector does not collide with protected objects.
 *
 * @param {Object} repairPayload - Accepted repair from computeConnectorRepair
 * @param {Array} protectedObjects - Non-member objects to check against
 * @param {Set} memberObjectIds - IDs of objects in the connector's structure (excluded from collision)
 * @returns {{ safe: boolean, collidedObjectIds: string[] }}
 */
export const validateConnectorRepairSafety = (repairPayload, protectedObjects, memberObjectIds) => {
  if (!repairPayload || !repairPayload.repairAccepted) {
    return { safe: true, collidedObjectIds: [] };
  }

  const allPathCmds = [...repairPayload.shaftPath, ...repairPayload.arrowheadPath];
  const pathBounds = computePathBounds(allPathCmds);
  if (!pathBounds) {
    return { safe: true, collidedObjectIds: [] };
  }

  // Add stroke padding
  const padding = 5;
  const repairedBounds = {
    x: pathBounds.x - padding,
    y: pathBounds.y - padding,
    width: pathBounds.width + padding * 2,
    height: pathBounds.height + padding * 2
  };

  const collidedObjectIds = [];
  const memberSet = memberObjectIds instanceof Set ? memberObjectIds : new Set(memberObjectIds || []);

  for (const obj of protectedObjects) {
    if (memberSet.has(obj.id)) continue;
    if (obj.id === repairPayload.connectorId) continue;
    if (obj.id === repairPayload.sourceShapeId) continue;
    if (obj.id === repairPayload.targetShapeId) continue;

    const sem = getSemanticType(obj);
    // Skip other connectors from collision checking (connectors can cross)
    if (sem === 'connector') continue;

    const objBounds = getObjectBounds(obj);

    // Bounding-box overlap check
    const xOverlap = Math.max(0, Math.min(repairedBounds.x + repairedBounds.width, objBounds.x + objBounds.width) - Math.max(repairedBounds.x, objBounds.x));
    const yOverlap = Math.max(0, Math.min(repairedBounds.y + repairedBounds.height, objBounds.y + objBounds.height) - Math.max(repairedBounds.y, objBounds.y));
    const overlapArea = xOverlap * yOverlap;

    if (overlapArea > 4) { // Meaningful overlap (> 2px x 2px)
      collidedObjectIds.push(obj.id);
    }
  }

  return {
    safe: collidedObjectIds.length === 0,
    collidedObjectIds
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// Repair Orchestration
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Generates connector repair payloads for all verified connectors in the workspace.
 *
 * @param {Object} workspaceModel - Full workspace model
 * @param {Array} structures - Discovered visual structures (from discoverVisualStructures)
 * @param {Object} options - Options
 * @returns {{ connectorRepairs: Array, rejectedRepairs: Array, diagnostics: Object }}
 */
export const generateConnectorRepairs = (workspaceModel, structures = [], options = {}) => {
  const rawObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const objectMap = new Map(rawObjects.map((o) => [o.id, o]));

  const connectorObjects = rawObjects.filter((o) => getSemanticType(o) === 'connector');
  const shapeObjects = rawObjects.filter((o) => ['shape', 'note'].includes(getSemanticType(o)));

  const connectorRepairs = [];
  const rejectedRepairs = [];

  // Build set of all member IDs across all structures (for protected-object checks)
  const allStructureMemberIds = new Set();
  (structures || []).forEach((s) => {
    (s.nodeIds || []).forEach((id) => allStructureMemberIds.add(id));
    (s.connectorIds || []).forEach((id) => allStructureMemberIds.add(id));
  });

  const protectedObjects = rawObjects.filter((o) => {
    const sem = getSemanticType(o);
    return sem !== 'connector' || !allStructureMemberIds.has(o.id);
  });

  for (const conn of connectorObjects) {
    const hasMetadataTopology = Boolean(
      conn.sourceShapeId ||
      conn.targetShapeId ||
      conn.relationshipMetadata?.sourceShapeId ||
      conn.relationshipMetadata?.targetShapeId
    );

    // If connector has metadata topology, recover/validate it.
    // If not, only detached flow intent association from structures can provide topology.
    let effectiveTopology = null;
    if (hasMetadataTopology) {
      effectiveTopology = recoverConnectorTopology(conn, shapeObjects);
    } else {
      const detachedStruct = (structures || []).find(
        (s) => s.type === 'flow' && s.connectorIds?.includes(conn.id) && s.detachedFlowAssociation
      );
      if (detachedStruct?.detachedFlowAssociation) {
        const assoc = detachedStruct.detachedFlowAssociation;
        effectiveTopology = {
          connectorId: conn.id,
          sourceShapeId: assoc.sourceCandidateId,
          targetShapeId: assoc.targetCandidateId,
          overallConfidence: assoc.associationConfidence,
          confidence: assoc.associationConfidence,
          routeType: assoc.routeType || 'straight',
          endpointSource: 'detached-flow-intent'
        };
      }
    }

    // Only attempt repair for verified or high-confidence detached flow intent connectors
    if (!effectiveTopology || !effectiveTopology.sourceShapeId || !effectiveTopology.targetShapeId) {
      rejectedRepairs.push({
        connectorId: conn.id,
        reason: 'Incomplete topology',
        sourceShapeId: effectiveTopology?.sourceShapeId || null,
        targetShapeId: effectiveTopology?.targetShapeId || null,
        overallConfidence: effectiveTopology?.overallConfidence || 0
      });
      continue;
    }

    const confidence = effectiveTopology.overallConfidence ?? 0;
    if (confidence < REPAIR_TOPOLOGY_THRESHOLD) {
      rejectedRepairs.push({
        connectorId: conn.id,
        reason: `Confidence ${confidence.toFixed(3)} below threshold ${REPAIR_TOPOLOGY_THRESHOLD}`,
        sourceShapeId: effectiveTopology.sourceShapeId,
        targetShapeId: effectiveTopology.targetShapeId,
        overallConfidence: confidence
      });
      continue;
    }

    // Check if structure declared this connector unknown / ambiguous / preserve
    const unknownStruct = (structures || []).find(
      (s) => s.id === `struct_unknown_conn_${conn.id}` || (s.type === 'standalone' && s.connectorIds?.includes(conn.id))
    );
    if (unknownStruct) {
      rejectedRepairs.push({
        connectorId: conn.id,
        reason: 'Connector classified as unknown/ambiguous by structure analysis',
        overallConfidence: 0
      });
      continue;
    }

    const sourceShape = objectMap.get(effectiveTopology.sourceShapeId);
    const targetShape = objectMap.get(effectiveTopology.targetShapeId);

    if (!sourceShape || !targetShape) {
      rejectedRepairs.push({
        connectorId: conn.id,
        reason: 'Source or target shape not found in workspace',
        sourceShapeId: effectiveTopology.sourceShapeId,
        targetShapeId: effectiveTopology.targetShapeId,
        overallConfidence: confidence
      });
      continue;
    }

    const isNote = (obj) => getSemanticType(obj) === 'note' || Boolean(obj?.isStickyNote);
    if (isNote(sourceShape) || isNote(targetShape)) {
      rejectedRepairs.push({
        connectorId: conn.id,
        reason: 'Connectors attached to notes/annotations are excluded from flowchart geometry repair',
        sourceShapeId: effectiveTopology.sourceShapeId,
        targetShapeId: effectiveTopology.targetShapeId,
        overallConfidence: confidence
      });
      continue;
    }

    // Compute repair
    const repair = computeConnectorRepair(conn, sourceShape, targetShape, effectiveTopology);

    if (!repair.repairAccepted) {
      rejectedRepairs.push({
        connectorId: conn.id,
        reason: repair.repairRejectedReason,
        sourceShapeId: effectiveTopology.sourceShapeId,
        targetShapeId: effectiveTopology.targetShapeId,
        overallConfidence: confidence,
        visuallyAttached: repair.visuallyAttached
      });
      continue;
    }

    // Validate safety against protected objects
    const memberIds = new Set([conn.id, effectiveTopology.sourceShapeId, effectiveTopology.targetShapeId]);
    const safety = validateConnectorRepairSafety(repair, protectedObjects, memberIds);

    if (!safety.safe) {
      rejectedRepairs.push({
        connectorId: conn.id,
        reason: `Protected-object collision: ${safety.collidedObjectIds.join(', ')}`,
        sourceShapeId: effectiveTopology.sourceShapeId,
        targetShapeId: effectiveTopology.targetShapeId,
        overallConfidence: confidence,
        collidedObjectIds: safety.collidedObjectIds
      });
      continue;
    }

    connectorRepairs.push(repair);
  }

  return {
    connectorRepairs,
    rejectedRepairs,
    diagnostics: {
      totalConnectors: connectorObjects.length,
      repairedCount: connectorRepairs.length,
      rejectedCount: rejectedRepairs.length,
      skippedAlreadyAttached: rejectedRepairs.filter((r) => r.visuallyAttached).length
    }
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// Preview/Apply Identity (Amendment 2)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Allowed repair payload fields for schema validation (Amendment 1).
 */
export const REPAIR_PAYLOAD_ALLOWED_FIELDS = new Set([
  'connectorId',
  'sourceShapeId',
  'targetShapeId',
  'topologyConfidence',
  'routeType',
  'sourceAnchor',
  'targetAnchor',
  'shaftPath',
  'arrowheadPath'
]);

/**
 * Diagnostic-only fields that may be present but are NOT geometry-bearing.
 */
export const REPAIR_DIAGNOSTIC_FIELDS = new Set([
  'repairAccepted',
  'repairRejectedReason',
  'currentShaftStart',
  'currentShaftEnd',
  'candidateShaftStart',
  'candidateShaftEnd',
  'sourceAttachmentBefore',
  'targetAttachmentBefore',
  'sourceAttachmentAfter',
  'targetAttachmentAfter',
  'pathChanged',
  'visuallyAttached'
]);

/**
 * Validates that a repair payload conforms to the strict schema.
 * Rejects unexpected coordinate-bearing fields.
 *
 * @param {Object} repair - Repair payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateRepairPayloadSchema = (repair) => {
  const errors = [];

  if (!repair || typeof repair !== 'object') {
    return { valid: false, errors: ['Repair payload must be a non-null object'] };
  }

  // Check required fields
  const required = ['connectorId', 'sourceShapeId', 'targetShapeId', 'topologyConfidence', 'routeType', 'sourceAnchor', 'targetAnchor', 'shaftPath'];
  for (const field of required) {
    if (repair[field] === undefined || repair[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check for unexpected fields
  const allAllowed = new Set([...REPAIR_PAYLOAD_ALLOWED_FIELDS, ...REPAIR_DIAGNOSTIC_FIELDS]);
  for (const key of Object.keys(repair)) {
    if (!allAllowed.has(key)) {
      errors.push(`Unexpected field in repair payload: '${key}'`);
    }
  }

  // Validate anchor structure
  if (repair.sourceAnchor && (typeof repair.sourceAnchor.x !== 'number' || typeof repair.sourceAnchor.y !== 'number')) {
    errors.push('sourceAnchor must have numeric x and y');
  }
  if (repair.targetAnchor && (typeof repair.targetAnchor.x !== 'number' || typeof repair.targetAnchor.y !== 'number')) {
    errors.push('targetAnchor must have numeric x and y');
  }

  // Validate shaftPath is array of path commands
  if (repair.shaftPath && !Array.isArray(repair.shaftPath)) {
    errors.push('shaftPath must be an array');
  }

  // Validate arrowheadPath if present
  if (repair.arrowheadPath !== undefined && repair.arrowheadPath !== null && !Array.isArray(repair.arrowheadPath)) {
    errors.push('arrowheadPath must be an array');
  }

  // Validate topologyConfidence
  if (typeof repair.topologyConfidence === 'number') {
    if (repair.topologyConfidence < REPAIR_TOPOLOGY_THRESHOLD) {
      errors.push(`topologyConfidence ${repair.topologyConfidence} below required threshold ${REPAIR_TOPOLOGY_THRESHOLD}`);
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Compares two repair payloads for geometric equivalence.
 * Used to enforce the Preview == Apply invariant (Amendment 2).
 *
 * @param {Object} previewRepair - Repair from preview
 * @param {Object} appliedRepair - Repair from apply
 * @param {number} [tolerance=0.01] - Floating-point tolerance for coordinates
 * @returns {{ equivalent: boolean, mismatches: string[] }}
 */
export const compareRepairGeometry = (previewRepair, appliedRepair, tolerance = 0.01) => {
  const mismatches = [];

  if (!previewRepair || !appliedRepair) {
    return { equivalent: false, mismatches: ['One or both payloads are null'] };
  }

  // Exact string equality fields
  const exactFields = ['connectorId', 'sourceShapeId', 'targetShapeId', 'routeType'];
  for (const field of exactFields) {
    if (previewRepair[field] !== appliedRepair[field]) {
      mismatches.push(`${field}: '${previewRepair[field]}' !== '${appliedRepair[field]}'`);
    }
  }

  // Numeric coordinate comparison with tolerance
  const comparePoint = (name, p1, p2) => {
    if (!p1 || !p2) {
      mismatches.push(`${name}: one is null`);
      return;
    }
    if (Math.abs(p1.x - p2.x) > tolerance || Math.abs(p1.y - p2.y) > tolerance) {
      mismatches.push(`${name}: (${p1.x.toFixed(4)}, ${p1.y.toFixed(4)}) !== (${p2.x.toFixed(4)}, ${p2.y.toFixed(4)})`);
    }
  };

  comparePoint('sourceAnchor', previewRepair.sourceAnchor, appliedRepair.sourceAnchor);
  comparePoint('targetAnchor', previewRepair.targetAnchor, appliedRepair.targetAnchor);

  // Path command comparison
  const comparePaths = (name, path1, path2) => {
    const p1 = path1 || [];
    const p2 = path2 || [];
    if (p1.length !== p2.length) {
      mismatches.push(`${name}: command count ${p1.length} !== ${p2.length}`);
      return;
    }
    for (let i = 0; i < p1.length; i++) {
      const c1 = p1[i];
      const c2 = p2[i];
      if (c1[0] !== c2[0]) {
        mismatches.push(`${name}[${i}]: command type '${c1[0]}' !== '${c2[0]}'`);
        continue;
      }
      for (let j = 1; j < Math.max(c1.length, c2.length); j++) {
        const v1 = Number(c1[j] ?? 0);
        const v2 = Number(c2[j] ?? 0);
        if (Math.abs(v1 - v2) > tolerance) {
          mismatches.push(`${name}[${i}][${j}]: ${v1.toFixed(4)} !== ${v2.toFixed(4)}`);
        }
      }
    }
  };

  comparePaths('shaftPath', previewRepair.shaftPath, appliedRepair.shaftPath);
  comparePaths('arrowheadPath', previewRepair.arrowheadPath, appliedRepair.arrowheadPath);

  return {
    equivalent: mismatches.length === 0,
    mismatches
  };
};

export default {
  computeShapeBoundaryIntersection,
  computeIdealConnectorAnchors,
  computeConnectorRepair,
  validateConnectorRepairSafety,
  generateConnectorRepairs,
  validateRepairPayloadSchema,
  compareRepairGeometry,
  REPAIR_TOPOLOGY_THRESHOLD,
  ATTACHMENT_TOLERANCE,
  REPAIR_SKIP_TOLERANCE,
  REPAIR_PAYLOAD_ALLOWED_FIELDS,
  REPAIR_DIAGNOSTIC_FIELDS
};
