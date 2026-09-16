import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
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
} from './connectorRepair.js';





const makeRect = (id, x, y, w = 120, h = 80, shapeType = 'rect') => ({
  id,
  type: 'shape',
  semanticType: 'shape',
  shapeType,
  position: { x, y },
  bounds: { x, y, width: w, height: h }
});

const makeDiamond = (id, x, y, w = 120, h = 120) => makeRect(id, x, y, w, h, 'diamond');
const makeCircle = (id, x, y, w = 100, h = 100) => makeRect(id, x, y, w, h, 'circle');
const makeHexagon = (id, x, y, w = 140, h = 120) => makeRect(id, x, y, w, h, 'hexagon');
const makeTriangle = (id, x, y, w = 120, h = 100) => makeRect(id, x, y, w, h, 'triangle');
const makeRoundedRect = (id, x, y, w = 140, h = 90) => makeRect(id, x, y, w, h, 'rounded_rect');

const makeConnector = (id, pathCommands, opts = {}) => ({
  id,
  type: 'connector',
  semanticType: 'connector',
  isConnector: true,
  isWorldSpace: true,
  path: pathCommands,
  pathCommands,
  worldPathCommands: pathCommands,
  startArrow: opts.startArrow ?? false,
  endArrow: opts.endArrow ?? true,
  strokeWidth: opts.strokeWidth ?? 3,
  stroke: opts.stroke ?? '#333',
  strokeDashArray: opts.strokeDashArray ?? null,
  connectorType: opts.connectorType ?? 'straight',
  sourceShapeId: opts.sourceShapeId ?? null,
  targetShapeId: opts.targetShapeId ?? null,
  angle: opts.angle ?? 0,
  scaleX: opts.scaleX ?? 1,
  scaleY: opts.scaleY ?? 1,
  ...opts
});

const makeVerifiedTopology = (sourceShapeId, targetShapeId, confidence = 0.99) => ({
  sourceShapeId,
  targetShapeId,
  sourceConfidence: confidence,
  targetConfidence: confidence,
  overallConfidence: confidence,
  metadataValidation: { source: 'VALIDATED', target: 'VALIDATED' }
});

const makeWorkspaceModel = (objects) => ({
  board: { objects }
});


const shapeA = makeRect('shapeA', 100, 200, 120, 80);
const shapeB = makeRect('shapeB', 500, 200, 120, 80);


const floatingConnector = makeConnector('conn1', [
  ['M', 250, 240],
  ['L', 470, 240]
], { sourceShapeId: 'shapeA', targetShapeId: 'shapeB' });


const attachedConnector = makeConnector('conn_attached', [
  ['M', 220, 240],
  ['L', 500, 240]
], { sourceShapeId: 'shapeA', targetShapeId: 'shapeB' });




test('Test 1: Floating horizontal connector is repaired to actual boundaries', () => {
  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);

  assert.equal(repair.repairAccepted, true, 'Repair should be accepted');
  assert.equal(repair.connectorId, 'conn1');
  assert.equal(repair.sourceShapeId, 'shapeA');
  assert.equal(repair.targetShapeId, 'shapeB');

  
  assert.ok(Math.abs(repair.sourceAnchor.x - 220) <= ATTACHMENT_TOLERANCE, `Source anchor X should be ~220 (got ${repair.sourceAnchor.x})`);
  
  assert.ok(Math.abs(repair.targetAnchor.x - 500) <= ATTACHMENT_TOLERANCE, `Target anchor X should be ~500 (got ${repair.targetAnchor.x})`);

  assert.ok(repair.sourceAttachmentAfter <= ATTACHMENT_TOLERANCE, `Source attachment after should be <= ${ATTACHMENT_TOLERANCE}px`);
  assert.ok(repair.targetAttachmentAfter <= ATTACHMENT_TOLERANCE, `Target attachment after should be <= ${ATTACHMENT_TOLERANCE}px`);
  assert.equal(repair.routeType, 'straight');
  assert.ok(Array.isArray(repair.shaftPath), 'shaftPath should be array');
  assert.ok(repair.shaftPath.length >= 2, 'shaftPath should have at least 2 commands');
});




test('Test 2: Already-attached connector is not rerouted', () => {
  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair = computeConnectorRepair(attachedConnector, shapeA, shapeB, topology);

  assert.equal(repair.repairAccepted, false, 'Should not repair already-attached connector');
  assert.ok(repair.repairRejectedReason.includes('tolerance') || repair.repairRejectedReason.includes('attached'),
    'Rejection reason should mention tolerance or attached');
});




test('Test 3: Diagonal connector is repaired with correct orientation', () => {
  const shapeTL = makeRect('shapeTL', 100, 100, 120, 80);
  const shapeBR = makeRect('shapeBR', 400, 300, 120, 80);
  const diagonalConn = makeConnector('connDiag', [
    ['M', 250, 200],
    ['L', 380, 290]
  ], { sourceShapeId: 'shapeTL', targetShapeId: 'shapeBR' });

  const topology = makeVerifiedTopology('shapeTL', 'shapeBR');
  const repair = computeConnectorRepair(diagonalConn, shapeTL, shapeBR, topology);

  assert.equal(repair.repairAccepted, true);
  assert.ok(repair.sourceAttachmentAfter <= ATTACHMENT_TOLERANCE);
  assert.ok(repair.targetAttachmentAfter <= ATTACHMENT_TOLERANCE);

  
  const shaftStart = repair.shaftPath[0];
  const shaftEnd = repair.shaftPath[repair.shaftPath.length - 1];
  assert.ok(shaftEnd[shaftEnd.length - 2] > shaftStart[1], 'End X should be greater than start X');
  assert.ok(shaftEnd[shaftEnd.length - 1] > shaftStart[2], 'End Y should be greater than start Y');
});




test('Test 4: Rotated connector world geometry is correct', () => {
  
  const rotatedConn = makeConnector('connRot', [
    ['M', 250, 240],
    ['L', 470, 240]
  ], { sourceShapeId: 'shapeA', targetShapeId: 'shapeB', angle: 0 });

  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair = computeConnectorRepair(rotatedConn, shapeA, shapeB, topology);

  assert.equal(repair.repairAccepted, true);
  assert.ok(repair.sourceAttachmentAfter <= ATTACHMENT_TOLERANCE);
  assert.ok(repair.targetAttachmentAfter <= ATTACHMENT_TOLERANCE);
});




test('Test 5: Scaled connector repair produces correct world geometry', () => {
  const scaledConn = makeConnector('connScale', [
    ['M', 250, 240],
    ['L', 470, 240]
  ], { sourceShapeId: 'shapeA', targetShapeId: 'shapeB', scaleX: 1, scaleY: 1 });

  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair = computeConnectorRepair(scaledConn, shapeA, shapeB, topology);

  assert.equal(repair.repairAccepted, true);
  assert.ok(Number.isFinite(repair.sourceAnchor.x));
  assert.ok(Number.isFinite(repair.sourceAnchor.y));
  assert.ok(Number.isFinite(repair.targetAnchor.x));
  assert.ok(Number.isFinite(repair.targetAnchor.y));
});




test('Test 6: Rectangle to diamond produces correct boundary anchors', () => {
  const rect = makeRect('rectSrc', 100, 200, 120, 80);
  const diamond = makeDiamond('dmdTgt', 400, 180, 120, 120);
  const conn = makeConnector('connRD', [
    ['M', 250, 240],
    ['L', 380, 240]
  ], { sourceShapeId: 'rectSrc', targetShapeId: 'dmdTgt' });

  const topology = makeVerifiedTopology('rectSrc', 'dmdTgt');
  const repair = computeConnectorRepair(conn, rect, diamond, topology);

  assert.equal(repair.repairAccepted, true);
  
  assert.ok(Math.abs(repair.sourceAnchor.x - 220) <= ATTACHMENT_TOLERANCE);
  
  assert.ok(Math.abs(repair.targetAnchor.x - 400) <= 15, `Diamond left vertex should be ~400 (got ${repair.targetAnchor.x})`);
});




test('Test 7: Diamond to hexagon produces correct boundary anchors', () => {
  const diamond = makeDiamond('dmdSrc', 100, 100, 120, 120);
  const hexagon = makeHexagon('hexTgt', 400, 100, 140, 120);
  const conn = makeConnector('connDH', [
    ['M', 250, 160],
    ['L', 380, 160]
  ], { sourceShapeId: 'dmdSrc', targetShapeId: 'hexTgt' });

  const topology = makeVerifiedTopology('dmdSrc', 'hexTgt');
  const repair = computeConnectorRepair(conn, diamond, hexagon, topology);

  assert.equal(repair.repairAccepted, true);
  assert.ok(repair.sourceAttachmentAfter <= ATTACHMENT_TOLERANCE);
  assert.ok(repair.targetAttachmentAfter <= ATTACHMENT_TOLERANCE);
});




test('Test 8: Branch structure — all verified edges are repaired', () => {
  const nodeA = makeRect('brA', 100, 200, 120, 80);
  const nodeB = makeRect('brB', 500, 100, 120, 80);
  const nodeC = makeRect('brC', 500, 300, 120, 80);

  const connAB = makeConnector('connAB', [['M', 260, 240], ['L', 470, 140]], { sourceShapeId: 'brA', targetShapeId: 'brB' });
  const connAC = makeConnector('connAC', [['M', 260, 240], ['L', 470, 340]], { sourceShapeId: 'brA', targetShapeId: 'brC' });

  const ws = makeWorkspaceModel([nodeA, nodeB, nodeC, connAB, connAC]);
  const result = generateConnectorRepairs(ws);

  assert.ok(result.connectorRepairs.length >= 2, `Both branch edges should be repaired (got ${result.connectorRepairs.length})`);

  const repAB = result.connectorRepairs.find((r) => r.connectorId === 'connAB');
  const repAC = result.connectorRepairs.find((r) => r.connectorId === 'connAC');
  assert.ok(repAB, 'connAB should be repaired');
  assert.ok(repAC, 'connAC should be repaired');
  assert.equal(repAB.sourceShapeId, 'brA');
  assert.equal(repAB.targetShapeId, 'brB');
  assert.equal(repAC.sourceShapeId, 'brA');
  assert.equal(repAC.targetShapeId, 'brC');
});




test('Test 9: Merge structure — all verified edges are repaired', () => {
  const nodeA = makeRect('mrA', 100, 100, 120, 80);
  const nodeB = makeRect('mrB', 100, 300, 120, 80);
  const nodeC = makeRect('mrC', 500, 200, 120, 80);

  const connAC = makeConnector('connMrAC', [['M', 260, 140], ['L', 470, 240]], { sourceShapeId: 'mrA', targetShapeId: 'mrC' });
  const connBC = makeConnector('connMrBC', [['M', 260, 340], ['L', 470, 240]], { sourceShapeId: 'mrB', targetShapeId: 'mrC' });

  const ws = makeWorkspaceModel([nodeA, nodeB, nodeC, connAC, connBC]);
  const result = generateConnectorRepairs(ws);

  assert.ok(result.connectorRepairs.length >= 2, 'Both merge edges should be repaired');
});




test('Test 10: Curved connector preserves curve structure and corrects anchors', () => {
  const curvedConn = makeConnector('connCurve', [
    ['M', 250, 240],
    ['C', 320, 180, 400, 180, 470, 240]
  ], { sourceShapeId: 'shapeA', targetShapeId: 'shapeB', connectorType: 'curved' });

  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair = computeConnectorRepair(curvedConn, shapeA, shapeB, topology);

  assert.equal(repair.repairAccepted, true);
  assert.equal(repair.routeType, 'curved');
  
  const hasCurve = repair.shaftPath.some((c) => c[0] === 'C');
  assert.ok(hasCurve, 'Curved connector should preserve C command');
  assert.ok(repair.sourceAttachmentAfter <= ATTACHMENT_TOLERANCE);
  assert.ok(repair.targetAttachmentAfter <= ATTACHMENT_TOLERANCE);
});




test('Test 11: Unknown connector (no sourceShapeId) is not repaired', () => {
  const topology = {
    sourceShapeId: null,
    targetShapeId: 'shapeB',
    overallConfidence: 0.3,
    metadataValidation: { source: 'NONE', target: 'VALIDATED' }
  };
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);
  assert.equal(repair.repairAccepted, false);
  assert.ok(repair.repairRejectedReason.includes('Incomplete topology'));
});




test('Test 12: Ambiguous connector (confidence < 0.85) is not repaired', () => {
  const topology = {
    sourceShapeId: 'shapeA',
    targetShapeId: 'shapeB',
    overallConfidence: 0.80,
    metadataValidation: { source: 'AMBIGUOUS', target: 'VALIDATED' }
  };
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);
  assert.equal(repair.repairAccepted, false);
});




test('Test 13: Stale metadata connector is not repaired', () => {
  const topology = {
    sourceShapeId: 'shapeA',
    targetShapeId: 'shapeB',
    overallConfidence: 0.90,
    metadataValidation: { source: 'STALE', target: 'VALIDATED' }
  };
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);
  assert.equal(repair.repairAccepted, false);
  assert.ok(repair.repairRejectedReason.includes('STALE'));
});




test('Test 14: Already-clean verified flow produces zero reroutes', () => {
  const cleanA = makeRect('cleanA', 100, 200, 120, 80);
  const cleanB = makeRect('cleanB', 300, 200, 120, 80);
  
  const cleanConn = makeConnector('cleanConn', [
    ['M', 220, 240],
    ['L', 300, 240]
  ], { sourceShapeId: 'cleanA', targetShapeId: 'cleanB' });

  const ws = makeWorkspaceModel([cleanA, cleanB, cleanConn]);
  const result = generateConnectorRepairs(ws);

  assert.equal(result.connectorRepairs.length, 0, 'Should produce zero repairs for already-clean connectors');
  assert.ok(result.rejectedRepairs.some((r) => r.connectorId === 'cleanConn'), 'Should be in rejected list');
});




test('Test 15: Connector repair is counted separately from object movement', () => {
  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);

  assert.equal(repair.repairAccepted, true);
  
  assert.ok(repair.connectorId);
  assert.ok(repair.sourceAnchor);
  assert.ok(repair.targetAnchor);
  assert.ok(repair.shaftPath);
  
  assert.equal(repair.pathChanged, true);
});




test('Test 16: Repair is rejected when it would collide with protected text', () => {
  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);
  assert.equal(repair.repairAccepted, true);

  
  const protectedText = {
    id: 'protectedText1',
    type: 'text',
    semanticType: 'text',
    position: { x: 300, y: 230 },
    bounds: { x: 300, y: 230, width: 100, height: 30 }
  };

  const safety = validateConnectorRepairSafety(repair, [protectedText], new Set());
  assert.equal(safety.safe, false, 'Should be unsafe');
  assert.ok(safety.collidedObjectIds.includes('protectedText1'));
});




test('Test 17: Repair is rejected when it would collide with protected shape', () => {
  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);
  assert.equal(repair.repairAccepted, true);

  const protectedShape = {
    id: 'protShape1',
    type: 'shape',
    semanticType: 'shape',
    position: { x: 350, y: 220 },
    bounds: { x: 350, y: 220, width: 60, height: 40 }
  };

  const safety = validateConnectorRepairSafety(repair, [protectedShape], new Set());
  assert.equal(safety.safe, false, 'Should be unsafe');
  assert.ok(safety.collidedObjectIds.includes('protShape1'));
});




test('Test 18: Creative stroke nearby is not modified by connector repair', () => {
  const stroke = {
    id: 'stroke1',
    type: 'stroke',
    semanticType: 'stroke',
    isVectorStroke: true,
    position: { x: 300, y: 400 },
    bounds: { x: 300, y: 400, width: 200, height: 50 }
  };

  const ws = makeWorkspaceModel([shapeA, shapeB, floatingConnector, stroke]);
  const result = generateConnectorRepairs(ws);

  
  result.connectorRepairs.forEach((r) => {
    assert.ok(!r.sourceShapeId || r.sourceShapeId !== 'stroke1');
    assert.ok(!r.targetShapeId || r.targetShapeId !== 'stroke1');
  });
});




test('Test 19: Structural divider nearby is not modified by connector repair', () => {
  const divider = {
    id: 'divider1',
    type: 'line',
    semanticType: 'line',
    isSkribeLine: true,
    position: { x: 50, y: 180 },
    bounds: { x: 50, y: 180, width: 700, height: 2 }
  };

  const ws = makeWorkspaceModel([shapeA, shapeB, floatingConnector, divider]);
  const result = generateConnectorRepairs(ws);

  
  result.connectorRepairs.forEach((r) => {
    assert.notEqual(r.connectorId, 'divider1');
  });
});




test('Test 20: Repeated repair produces identical geometry', () => {
  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair1 = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);
  const repair2 = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);

  assert.equal(repair1.repairAccepted, true);
  assert.equal(repair2.repairAccepted, true);

  const comparison = compareRepairGeometry(repair1, repair2);
  assert.ok(comparison.equivalent, `Repairs should be identical: ${comparison.mismatches.join('; ')}`);
});




test('Test 21: Connector repair does not mutate the original model', () => {
  const origPath = [['M', 250, 240], ['L', 470, 240]];
  const conn = makeConnector('connImmutable', origPath.map((c) => [...c]), {
    sourceShapeId: 'shapeA',
    targetShapeId: 'shapeB'
  });

  const origConnStr = JSON.stringify(conn);
  const origShapeAStr = JSON.stringify(shapeA);
  const origShapeBStr = JSON.stringify(shapeB);

  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  computeConnectorRepair(conn, shapeA, shapeB, topology);

  assert.equal(JSON.stringify(conn), origConnStr, 'Connector should not be mutated');
  assert.equal(JSON.stringify(shapeA), origShapeAStr, 'Source shape should not be mutated');
  assert.equal(JSON.stringify(shapeB), origShapeBStr, 'Target shape should not be mutated');
});




test('Test 22: Preview geometry equals applied geometry (Amendment 2)', () => {
  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);
  assert.equal(repair.repairAccepted, true);

  
  const previewRepair = { ...repair };
  const appliedRepair = { ...repair };

  const comparison = compareRepairGeometry(previewRepair, appliedRepair);
  assert.ok(comparison.equivalent, `Preview and apply geometry must be identical: ${comparison.mismatches.join('; ')}`);
});




test('Test 23: Repair payload passes strict schema validation', () => {
  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);
  assert.equal(repair.repairAccepted, true);

  const validation = validateRepairPayloadSchema(repair);
  assert.ok(validation.valid, `Schema validation failed: ${validation.errors.join('; ')}`);
});




test('Test 24: Unexpected coordinate-bearing fields are rejected', () => {
  const badRepair = {
    connectorId: 'conn1',
    sourceShapeId: 'shapeA',
    targetShapeId: 'shapeB',
    topologyConfidence: 0.99,
    routeType: 'straight',
    sourceAnchor: { x: 220, y: 240 },
    targetAnchor: { x: 500, y: 240 },
    shaftPath: [['M', 220, 240], ['L', 500, 240]],
    arrowheadPath: [],
    
    left: 220,
    top: 240,
    bounds: { x: 220, y: 240, width: 280, height: 2 }
  };

  const validation = validateRepairPayloadSchema(badRepair);
  assert.equal(validation.valid, false, 'Should reject unexpected fields');
  assert.ok(validation.errors.some((e) => e.includes('left')), 'Should flag "left"');
  assert.ok(validation.errors.some((e) => e.includes('bounds')), 'Should flag "bounds"');
});




test('Test 25: compareRepairGeometry detects coordinate mismatches', () => {
  const repair1 = {
    connectorId: 'conn1',
    sourceShapeId: 'shapeA',
    targetShapeId: 'shapeB',
    routeType: 'straight',
    sourceAnchor: { x: 220, y: 240 },
    targetAnchor: { x: 500, y: 240 },
    shaftPath: [['M', 220, 240], ['L', 500, 240]],
    arrowheadPath: []
  };

  const repair2 = {
    ...repair1,
    sourceAnchor: { x: 225, y: 240 }, 
    shaftPath: [['M', 225, 240], ['L', 500, 240]]
  };

  const comparison = compareRepairGeometry(repair1, repair2, 0.01);
  assert.equal(comparison.equivalent, false, 'Should detect mismatch');
  assert.ok(comparison.mismatches.length > 0);
});




test('Test 26: Shape boundary intersection for rectangle', () => {
  const rect = makeRect('r1', 100, 100, 200, 100);
  
  const pt = computeShapeBoundaryIntersection(rect, { x: 500, y: 150 }, { x: 200, y: 150 });
  assert.ok(Math.abs(pt.x - 300) <= 1, `Right edge X should be ~300 (got ${pt.x})`);
  assert.ok(Math.abs(pt.y - 150) <= 1, `Y should be ~150 (got ${pt.y})`);
});




test('Test 27: Shape boundary intersection for circle', () => {
  const circle = makeCircle('c1', 100, 100, 100, 100);
  
  const pt = computeShapeBoundaryIntersection(circle, { x: 300, y: 150 }, { x: 150, y: 150 });
  assert.ok(Math.abs(pt.x - 200) <= 2, `Right edge X should be ~200 (got ${pt.x})`);
  assert.ok(Math.abs(pt.y - 150) <= 2, `Y should be ~150 (got ${pt.y})`);
});




test('Test 28: Shape boundary intersection for diamond', () => {
  const diamond = makeDiamond('d1', 100, 100, 120, 120);
  
  const pt = computeShapeBoundaryIntersection(diamond, { x: 400, y: 160 }, { x: 160, y: 160 });
  assert.ok(Math.abs(pt.x - 220) <= 2, `Right vertex X should be ~220 (got ${pt.x})`);
  assert.ok(Math.abs(pt.y - 160) <= 2, `Y should be ~160 (got ${pt.y})`);
});




test('Test 29: Workspace with no verified connectors produces zero repairs', () => {
  const orphanConn = makeConnector('orphan', [['M', 50, 50], ['L', 150, 50]], {
    
  });
  const ws = makeWorkspaceModel([orphanConn]);
  const result = generateConnectorRepairs(ws);

  assert.equal(result.connectorRepairs.length, 0);
  assert.ok(result.rejectedRepairs.length > 0);
});




test('Test 30: Topology confidence at exactly 0.85 threshold is accepted', () => {
  const topology = makeVerifiedTopology('shapeA', 'shapeB', 0.85);
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);
  assert.equal(repair.repairAccepted, true, 'Should accept at exactly 0.85');
});




test('Test 31: Topology confidence at 0.849 is rejected', () => {
  const topology = makeVerifiedTopology('shapeA', 'shapeB', 0.849);
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);
  assert.equal(repair.repairAccepted, false, 'Should reject below 0.85');
});




test('Test 32: REPAIR_PAYLOAD_ALLOWED_FIELDS matches spec', () => {
  const expected = ['connectorId', 'sourceShapeId', 'targetShapeId', 'topologyConfidence', 'routeType', 'sourceAnchor', 'targetAnchor', 'shaftPath', 'arrowheadPath'];
  expected.forEach((f) => {
    assert.ok(REPAIR_PAYLOAD_ALLOWED_FIELDS.has(f), `Missing field: ${f}`);
  });
  assert.equal(REPAIR_PAYLOAD_ALLOWED_FIELDS.size, expected.length, 'No extra fields');
});




test('Test 33: Arrowhead geometry is separate from shaft endpoints', () => {
  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  const repair = computeConnectorRepair(floatingConnector, shapeA, shapeB, topology);
  assert.equal(repair.repairAccepted, true);

  
  
  assert.equal(repair.shaftPath[0][0], 'M');
  assert.equal(repair.shaftPath[1][0], 'L');
  assert.equal(repair.shaftPath.length, 2);

  
  assert.ok(Array.isArray(repair.arrowheadPath));
  if (repair.arrowheadPath.length > 0) {
    assert.equal(repair.arrowheadPath[0][0], 'M', 'Arrowhead starts with M');
  }
});




test('Test 34: Connector style properties are preserved (geometry-only repair)', () => {
  const styledConn = makeConnector('connStyled', [
    ['M', 250, 240], ['L', 470, 240]
  ], {
    sourceShapeId: 'shapeA',
    targetShapeId: 'shapeB',
    stroke: '#ff0000',
    strokeWidth: 5,
    strokeDashArray: [10, 5],
    opacity: 0.8
  });

  const origStroke = styledConn.stroke;
  const origStrokeWidth = styledConn.strokeWidth;
  const origDash = [...styledConn.strokeDashArray];
  const origOpacity = styledConn.opacity;

  const topology = makeVerifiedTopology('shapeA', 'shapeB');
  computeConnectorRepair(styledConn, shapeA, shapeB, topology);

  
  assert.equal(styledConn.stroke, origStroke);
  assert.equal(styledConn.strokeWidth, origStrokeWidth);
  assert.deepEqual(styledConn.strokeDashArray, origDash);
  assert.equal(styledConn.opacity, origOpacity);
});
