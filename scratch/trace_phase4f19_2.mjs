import fs from 'fs';
import { normalizeObject } from '../client/src/features/messCleanup/normalizeObjects.js';
import {
  recoverConnectorTopology,
  getConnectorEndpointsAndTangents,
  getShapeBoundaryGeometry,
  getDistanceToShapeBoundary,
  checkDirectionCompatibility,
  evaluateEndpointCandidate,
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

console.log('================================================================================');
console.log('PHASE 4F.19.2 — FORENSIC TRACE OF CANONICAL CONNECTORS & SHAPES');
console.log('================================================================================\n');

// 1. Inspect Shapes
console.log('--- SHAPES ---');
const shapes = normalizedObjects.filter((o) => ['shape', 'note'].includes(getSemanticType(o)));
shapes.forEach((s) => {
  const g = getShapeBoundaryGeometry(s);
  const raw = rawObjects.find((r) => r.id === s.id);
  console.log(`\nShape [${s.id}]:`);
  console.log(`  Raw Type: ${raw.type}, shapeType: ${raw.shapeType}`);
  console.log(`  Raw Pos: left=${raw.left}, top=${raw.top}, originX=${raw.originX}, originY=${raw.originY}, angle=${raw.angle}`);
  console.log(`  Norm Pos: left=${s.left}, top=${s.top}, width=${s.width}, height=${s.height}`);
  console.log(`  Bounds Geometry: left=${g.left}, top=${g.top}, right=${g.right}, bottom=${g.bottom}, cx=${g.cx}, cy=${g.cy}, shapeType=${g.shapeType}`);
});

// 2. Inspect Connectors
console.log('\n\n--- CONNECTORS ---');
const connectors = normalizedObjects.filter((o) => getSemanticType(o) === 'connector' || o.isConnector);

connectors.forEach((conn, idx) => {
  const raw = rawObjects.find((r) => r.id === conn.id);
  console.log(`\n================================================================================`);
  console.log(`CONNECTOR ${idx + 1}: ${conn.id}`);
  console.log(`================================================================================`);
  console.log('RAW OBJECT:');
  console.log(`  type: ${raw.type}`);
  console.log(`  left: ${raw.left}, top: ${raw.top}, width: ${raw.width}, height: ${raw.height}`);
  console.log(`  originX: ${raw.originX}, originY: ${raw.originY}`);
  console.log(`  pathOffset: x=${raw.pathOffset?.x}, y=${raw.pathOffset?.y}`);
  console.log(`  angle: ${raw.angle}`);
  console.log(`  path (first 3 commands):`, raw.path ? raw.path.slice(0, 3) : 'NONE');
  console.log(`  path total commands:`, raw.path ? raw.path.length : 0);

  console.log('\nNORMALIZED OBJECT:');
  console.log(`  left: ${conn.left}, top: ${conn.top}, width: ${conn.width}, height: ${conn.height}`);
  console.log(`  path commands:`, conn.path ? conn.path.slice(0, 3) : 'NONE');

  console.log('\nSEMANTIC SHAFT ENDPOINTS (extractSemanticShaftEndpoints):');
  const shaft = extractSemanticShaftEndpoints(conn);
  console.log(`  sourceAnchor:`, shaft?.sourceAnchor);
  console.log(`  targetAnchor:`, shaft?.targetAnchor);
  console.log(`  hasArrowhead: ${shaft?.hasArrowhead}`);

  console.log('\nTOPOLOGY ENDPOINTS & TANGENTS (getConnectorEndpointsAndTangents):');
  const topoEndpoints = getConnectorEndpointsAndTangents(conn);
  console.log(`  startPt:`, topoEndpoints.startPt, `startTangent:`, topoEndpoints.startTangent);
  console.log(`  endPt:`, topoEndpoints.endPt, `endTangent:`, topoEndpoints.endTangent);

  // Trace evaluation against each candidate shape
  ['source', 'target'].forEach((role) => {
    const pt = role === 'source' ? topoEndpoints.startPt : topoEndpoints.endPt;
    const tan = role === 'source' ? topoEndpoints.startTangent : topoEndpoints.endTangent;

    console.log(`\n--- Evaluating ${role.toUpperCase()} endpoint: point=(${pt.x}, ${pt.y}), tan=(${tan.x}, ${tan.y}) ---`);

    shapes.forEach((s) => {
      const g = getShapeBoundaryGeometry(s);
      const dist = getDistanceToShapeBoundary(pt, s);
      const dirOk = checkDirectionCompatibility(pt, tan, s, role);
      console.log(`  Candidate [${s.id}] (${g.shapeType}):`);
      console.log(`    Shape Center: (${g.cx}, ${g.cy}), Bounds: [${g.left}, ${g.top}, ${g.right}, ${g.bottom}]`);
      console.log(`    Distance to boundary: ${dist.toFixed(2)}px (MAX_ATTACH_DISTANCE=${MAX_ATTACH_DISTANCE})`);
      console.log(`    Direction compatible: ${dirOk}`);
    });

    const candidateResult = evaluateEndpointCandidate(pt, tan, shapes, role, conn.id);
    console.log(`  => evaluateEndpointCandidate result:`, candidateResult);
  });

  const fullTopo = recoverConnectorTopology(conn, shapes);
  console.log(`\nFINAL recoverConnectorTopology result:`);
  console.log(JSON.stringify(fullTopo, null, 2));
});
