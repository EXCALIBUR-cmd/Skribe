import fs from 'fs';
import { normalizeObject } from '../client/src/features/messCleanup/normalizeObjects.js';
import {
  getShapeBoundaryGeometry,
  getDistanceToShapeBoundary,
  checkDirectionCompatibility,
  getConnectorEndpointsAndTangents,
  MAX_ATTACH_DISTANCE,
  MIN_AMBIGUITY_MARGIN
} from '../client/src/features/messCleanup/connectorTopology.js';
import { extractSemanticShaftEndpoints } from '../client/src/features/messCleanup/discoverVisualStructures.js';
import { getSemanticType } from '../client/src/features/messCleanup/cleanupTypes.js';

const rawBoard = JSON.parse(
  fs.readFileSync(
    'C:/Users/singh/.gemini/antigravity-ide/brain/50fd7c5f-98be-4727-87e0-21e02f97850b/scratch/canonical_board.json',
    'utf8'
  )
);

const rawObjects = rawBoard.objects;
const normalizedObjects = rawObjects.map(normalizeObject);
const shapes = normalizedObjects.filter((o) => ['shape', 'note'].includes(getSemanticType(o)));
const connectors = normalizedObjects.filter((o) => getSemanticType(o) === 'connector' || o.isConnector);

// Function to find closest boundary point on a shape for a given test point
function getClosestBoundaryPoint(point, shape) {
  const g = getShapeBoundaryGeometry(shape);
  const px = point.x;
  const py = point.y;

  if (g.shapeType === 'circle') {
    const radius = Math.min(g.width, g.height) / 2;
    const angle = Math.atan2(py - g.cy, px - g.cx);
    return {
      x: Number((g.cx + radius * Math.cos(angle)).toFixed(1)),
      y: Number((g.cy + radius * Math.sin(angle)).toFixed(1))
    };
  }

  if (g.shapeType === 'diamond') {
    const vertices = [
      { x: g.cx, y: g.top },
      { x: g.right, y: g.cy },
      { x: g.cx, y: g.bottom },
      { x: g.left, y: g.cy }
    ];
    let minDist = Infinity;
    let bestPt = { x: g.cx, y: g.top };
    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const lenSq = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((px - v1.x) * dx + (py - v1.y) * dy) / lenSq));
      const projX = v1.x + t * dx;
      const projY = v1.y + t * dy;
      const d = Math.hypot(px - projX, py - projY);
      if (d < minDist) {
        minDist = d;
        bestPt = { x: Number(projX.toFixed(1)), y: Number(projY.toFixed(1)) };
      }
    }
    return bestPt;
  }

  // Rect / rounded_rect / polygon fallback
  const clampedX = Math.max(g.left, Math.min(g.right, px));
  const clampedY = Math.max(g.top, Math.min(g.bottom, py));

  // If inside box, project to nearest edge
  if (px >= g.left && px <= g.right && py >= g.top && py <= g.bottom) {
    const dists = [
      { d: px - g.left, pt: { x: g.left, y: py } },
      { d: g.right - px, pt: { x: g.right, y: py } },
      { d: py - g.top, pt: { x: px, y: g.top } },
      { d: g.bottom - py, pt: { x: px, y: g.bottom } }
    ];
    dists.sort((a, b) => a.d - b.d);
    return { x: Number(dists[0].pt.x.toFixed(1)), y: Number(dists[0].pt.y.toFixed(1)) };
  }

  return { x: Number(clampedX.toFixed(1)), y: Number(clampedY.toFixed(1)) };
}

function computeDirectionDot(point, tangent, shape, role) {
  const g = getShapeBoundaryGeometry(shape);
  const tanLen = Math.hypot(tangent.x, tangent.y);
  if (tanLen === 0) return 1.0;
  const u = role === 'source'
    ? { x: point.x - g.cx, y: point.y - g.cy }
    : { x: g.cx - point.x, y: g.cy - point.y };
  const uLen = Math.hypot(u.x, u.y);
  if (uLen === 0) return 1.0;
  return (tangent.x * u.x + tangent.y * u.y) / (tanLen * uLen);
}

console.log('================================================================================');
console.log('TRACE OF ALL ENDPOINTS AND CANDIDATE SHAPES');
console.log('================================================================================\n');

connectors.slice(0, 1).forEach((conn, cIdx) => {
  const raw = rawObjects.find((r) => r.id === conn.id);
  const topoEndpoints = getConnectorEndpointsAndTangents(conn);
  const shaftEndpoints = extractSemanticShaftEndpoints(conn);

  console.log(`\n################################################################################`);
  console.log(`CONNECTOR ${cIdx + 1}: ${conn.id}`);
  console.log(`Raw: angle=${raw.angle}°, scaleX=${raw.scaleX}, left=${raw.left}, top=${raw.top}`);
  console.log(`Explicit metadata: sourceShapeId="${raw.sourceShapeId || 'null'}", targetShapeId="${raw.targetShapeId || 'null'}"`);
  console.log(`################################################################################\n`);

  ['source', 'target'].forEach((role) => {
    const isSource = role === 'source';
    const pt = isSource ? topoEndpoints.startPt : topoEndpoints.endPt;
    const tan = isSource ? topoEndpoints.startTangent : topoEndpoints.endTangent;

    console.log(`--------------------------------------------------------------------------------`);
    console.log(`ENDPOINT: ${role.toUpperCase()}`);
    console.log(`  connectorId:        ${conn.id}`);
    console.log(`  endpointType:       ${role}`);
    console.log(`  endpointWorldPoint: (${pt.x.toFixed(4)}, ${pt.y.toFixed(4)})`);
    console.log(`  endpointDirection:  (${tan.x.toFixed(4)}, ${tan.y.toFixed(4)})`);
    console.log(`--------------------------------------------------------------------------------`);

    const scored = shapes.map((s) => {
      const boundaryPt = getClosestBoundaryPoint(pt, s);
      const dist = getDistanceToShapeBoundary(pt, s);
      const dirOk = checkDirectionCompatibility(pt, tan, s, role);
      const dot = computeDirectionDot(pt, tan, s, role);
      return {
        shape: s,
        candidateShapeId: s.id,
        candidateBoundaryPoint: boundaryPt,
        boundaryDistance: Number(dist.toFixed(2)),
        directionCompatibility: dirOk,
        directionDot: Number(dot.toFixed(3))
      };
    }).sort((a, b) => a.boundaryDistance - b.boundaryDistance);

    scored.forEach((cand, idx) => {
      const isBest = idx === 0;
      const secondDist = scored[1]?.boundaryDistance ?? Infinity;
      const ambiguityMargin = Number((secondDist - cand.boundaryDistance).toFixed(2));

      let confidenceContribution = 0;
      if (cand.boundaryDistance > MAX_ATTACH_DISTANCE) {
        confidenceContribution = Number(Math.max(0.2, 0.85 - (cand.boundaryDistance - MAX_ATTACH_DISTANCE) / 100).toFixed(4));
      } else if (!cand.directionCompatibility) {
        confidenceContribution = 0.70;
      } else if (secondDist <= MAX_ATTACH_DISTANCE + 15 && ambiguityMargin < MIN_AMBIGUITY_MARGIN) {
        confidenceContribution = 0.80;
      } else {
        confidenceContribution = cand.boundaryDistance <= 20 ? 0.97 : 0.95;
      }

      console.log(`\n  [Candidate ${idx + 1}] shapeId: ${cand.candidateShapeId}`);
      console.log(`    candidateBoundaryPoint: (${cand.candidateBoundaryPoint.x}, ${cand.candidateBoundaryPoint.y})`);
      console.log(`    boundaryDistance:       ${cand.boundaryDistance}px (threshold <= ${MAX_ATTACH_DISTANCE}px)`);
      console.log(`    directionCompatibility: ${cand.directionCompatibility} (dot=${cand.directionDot} >= -0.5)`);
      console.log(`    ambiguityMargin:        ${ambiguityMargin}px (required >= ${MIN_AMBIGUITY_MARGIN}px)`);
      console.log(`    confidenceContribution: ${confidenceContribution}`);
      if (cand.boundaryDistance > MAX_ATTACH_DISTANCE) {
        console.log(`    status:                 REJECTED: distance exceeds MAX_ATTACH_DISTANCE (${cand.boundaryDistance}px > ${MAX_ATTACH_DISTANCE}px)`);
      } else if (!cand.directionCompatibility) {
        console.log(`    status:                 REJECTED: direction incompatible`);
      } else {
        console.log(`    status:                 ACCEPTED candidate`);
      }
    });
  });
});
