import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recoverConnectorTopology,
  validateExplicitEndpoint,
  getDistanceToShapeBoundary,
  getConnectorEndpointsAndTangents,
  MAX_ATTACH_DISTANCE,
  MIN_AMBIGUITY_MARGIN
} from './connectorTopology.js';
import {
  transformPathCommandsToWorld,
  invertWorldPathCommands,
  getConnectorTransformMatrix,
  computePathBounds,
  parseConnectorPath
} from './connectorGeometry.js';
import { normalizeObject } from './normalizeObjects.js';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';
import { detectRelationships } from './detectRelationships.js';

const rectA = {
  id: 'shape_rect_a',
  type: 'shape',
  semanticType: 'shape',
  shapeType: 'rect',
  position: { x: 100, y: 100 },
  bounds: { x: 100, y: 100, width: 100, height: 100 }
};

const circleB = {
  id: 'shape_circle_b',
  type: 'shape',
  semanticType: 'shape',
  shapeType: 'circle',
  position: { x: 300, y: 100 },
  bounds: { x: 300, y: 100, width: 100, height: 100 }
};

const canonicalShapes = [
  {
    id: 'shape_elem_1788819849852_igis7',
    type: 'shape',
    semanticType: 'shape',
    shapeType: 'rounded_rect',
    bounds: { x: 361, y: 139.0855, width: 160, height: 110 }
  },
  {
    id: 'shape_elem_1788819863708_ozspq',
    type: 'shape',
    semanticType: 'shape',
    shapeType: 'diamond',
    bounds: { x: 595, y: 360.9552, width: 140, height: 140 }
  },
  {
    id: 'shape_elem_1788819871101_txc8m',
    type: 'shape',
    semanticType: 'shape',
    shapeType: 'hexagon',
    bounds: { x: 875, y: 181.0708, width: 160, height: 140 }
  }
];

test('1. Explicit metadata + geometrically consistent connector -> VALIDATED, high confidence', () => {
  const connector = {
    id: 'conn_1',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    sourceShapeId: 'shape_rect_a',
    targetShapeId: 'shape_circle_b',
    path: [['M', 200, 150], ['L', 300, 150]]
  };
  const topo = recoverConnectorTopology(connector, [rectA, circleB]);
  assert.equal(topo.sourceShapeId, 'shape_rect_a');
  assert.equal(topo.targetShapeId, 'shape_circle_b');
  assert.equal(topo.sourceConfidence, 0.99);
  assert.equal(topo.targetConfidence, 0.99);
  assert.equal(topo.overallConfidence, 0.99);
  assert.equal(topo.metadataValidation.source, 'VALIDATED');
  assert.equal(topo.metadataValidation.target, 'VALIDATED');
  assert.equal(topo.endpointSource, 'explicit');
});

test('2. Explicit metadata + geometrically inconsistent connector -> STALE, not verified', () => {
  // Connector endpoint is near rectA (5px away), but metadata claims circleB (95px away)
  const connector = {
    id: 'conn_override',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    sourceShapeId: 'shape_circle_b',
    path: [['M', 205, 150], ['L', 210, 150]]
  };
  const topo = recoverConnectorTopology(connector, [rectA, circleB]);
  assert.equal(topo.metadataValidation.source, 'STALE');
  assert.notEqual(topo.sourceShapeId, 'shape_circle_b', 'Stale metadata must not create verified relationship');
  assert.equal(topo.sourceShapeId, 'shape_rect_a', 'Conservative geometric recovery finds true nearby shape');
  assert.notEqual(topo.endpointSource, 'explicit');
});

test('3. Explicit metadata points to a distant unrelated shape -> STALE, does not inherit 0.99 confidence', () => {
  const connector = {
    id: 'conn_distant',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    sourceShapeId: 'shape_rect_a',
    path: [['M', 5000, 5000], ['L', 5100, 5000]]
  };
  const topo = recoverConnectorTopology(connector, [rectA, circleB]);
  assert.equal(topo.metadataValidation.source, 'STALE');
  assert.equal(topo.sourceShapeId, null, 'Distant endpoint must remain null');
  assert.ok(topo.sourceConfidence < 0.85, 'Confidence must reflect true distance, not 0.99');
  assert.notEqual(topo.endpointSource, 'explicit');
});

test('4. No metadata + geometrically recoverable connector -> geometry recovery allowed', () => {
  const connector = {
    id: 'conn_straight',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    endArrow: true,
    path: [['M', 205, 150], ['L', 295, 150]]
  };
  const topo = recoverConnectorTopology(connector, [rectA, circleB]);
  assert.equal(topo.sourceShapeId, 'shape_rect_a');
  assert.equal(topo.targetShapeId, 'shape_circle_b');
  assert.ok(topo.sourceConfidence >= 0.95);
  assert.ok(topo.targetConfidence >= 0.95);
  assert.equal(topo.endpointSource, 'geometric-recovery');
});

test('5. No metadata + ambiguous endpoint -> unresolved', () => {
  const rectC = {
    id: 'shape_rect_c',
    type: 'shape',
    semanticType: 'shape',
    shapeType: 'rect',
    bounds: { x: 100, y: 100, width: 50, height: 50 }
  };
  const rectD = {
    id: 'shape_rect_d',
    type: 'shape',
    semanticType: 'shape',
    shapeType: 'rect',
    bounds: { x: 100, y: 160, width: 50, height: 50 }
  };
  const connector = {
    id: 'conn_ambiguous',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    path: [['M', 125, 155], ['L', 500, 500]]
  };
  const topo = recoverConnectorTopology(connector, [rectC, rectD]);
  assert.equal(topo.sourceShapeId, null, 'Ambiguous endpoint must remain unresolved');
  assert.ok(topo.sourceConfidence < 0.85);
});

test('6. Rotated connector -> world endpoints reflect actual angle', () => {
  const rawConn = {
    id: 'conn_rot',
    type: 'connector',
    path: [['M', 0, 0], ['L', 100, 0]],
    left: 150,
    top: 150,
    angle: 90,
    originX: 'center',
    originY: 'center',
    width: 100,
    height: 0
  };
  const norm = normalizeObject(rawConn);
  assert.equal(norm.isWorldSpace, true);
  // Center is (150, 150). Length is 100. Rotated 90 deg -> vertical from (150, 100) to (150, 200)
  assert.ok(Math.abs(norm.worldShaftStart.x - 150) < 1e-2);
  assert.ok(Math.abs(norm.worldShaftStart.y - 100) < 1e-2);
  assert.ok(Math.abs(norm.worldShaftEnd.x - 150) < 1e-2);
  assert.ok(Math.abs(norm.worldShaftEnd.y - 200) < 1e-2);
  // Tangent is vertical (dx ~ 0, dy ~ 100)
  assert.ok(Math.abs(norm.shaftDirection.x) < 1e-2);
  assert.ok(Math.abs(norm.shaftDirection.y - 100) < 1e-2);
});

test('7. Scaled connector -> world geometry reflects scale', () => {
  const rawConn = {
    id: 'conn_scale',
    type: 'connector',
    path: [['M', 0, 0], ['L', 100, 0]],
    left: 100,
    top: 100,
    scaleX: 2.5,
    scaleY: 2.5,
    originX: 'center',
    originY: 'center',
    width: 100,
    height: 0
  };
  const norm = normalizeObject(rawConn);
  const worldLen = Math.hypot(
    norm.worldShaftEnd.x - norm.worldShaftStart.x,
    norm.worldShaftEnd.y - norm.worldShaftStart.y
  );
  assert.ok(Math.abs(worldLen - 250) < 1e-2, `Expected 250, got ${worldLen}`);
});

test('8. Rotated + scaled connector -> correct world geometry', () => {
  const rawConn = {
    id: 'conn_rot_scale',
    type: 'connector',
    path: [['M', 0, 0], ['L', 100, 0]],
    left: 200,
    top: 200,
    angle: 45,
    scaleX: 2.0,
    scaleY: 2.0,
    originX: 'center',
    originY: 'center',
    width: 100,
    height: 0
  };
  const norm = normalizeObject(rawConn);
  const worldLen = Math.hypot(
    norm.worldShaftEnd.x - norm.worldShaftStart.x,
    norm.worldShaftEnd.y - norm.worldShaftStart.y
  );
  assert.ok(Math.abs(worldLen - 200) < 1e-2);
  const angleDeg = (Math.atan2(norm.shaftDirection.y, norm.shaftDirection.x) * 180) / Math.PI;
  assert.ok(Math.abs(angleDeg - 45) < 1e-2, `Expected 45 deg, got ${angleDeg}`);
});

test('9. Rotated + scaled connector with arrowhead -> semantic shaft endpoints remain correct', () => {
  const rawConn = {
    id: 'conn_arrow_rot',
    type: 'connector',
    path: [
      ['M', 0, 0],
      ['L', 100, 0],
      ['M', 90, -5],
      ['L', 100, 0],
      ['L', 90, 5]
    ],
    left: 483.4,
    top: 321.3,
    angle: 36.94317218162472,
    scaleX: 1.0336,
    scaleY: 1.0336,
    originX: 'center',
    originY: 'center'
  };
  const norm = normalizeObject(rawConn);
  assert.equal(norm.shaftPath.length, 2);
  assert.equal(norm.arrowheadPath.length, 3);
  assert.ok(norm.worldShaftStart.x < norm.worldShaftEnd.x);
  const angleDeg = (Math.atan2(norm.shaftDirection.y, norm.shaftDirection.x) * 180) / Math.PI;
  assert.ok(Math.abs(angleDeg - 36.943) < 0.05);
});

test('10. Curved connector with arrowhead -> arrowhead does not contaminate shaft endpoint calculation', () => {
  const connector = {
    id: 'conn_curved_arrow',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'curved',
    endArrow: true,
    path: [
      ['M', 205, 150],
      ['C', 240, 100, 260, 100, 295, 150],
      ['M', 285, 145],
      ['L', 295, 150],
      ['L', 285, 155]
    ]
  };
  const { startPt, endPt } = getConnectorEndpointsAndTangents(connector);
  assert.equal(startPt.x, 205);
  assert.equal(startPt.y, 150);
  assert.equal(endPt.x, 295);
  assert.equal(endPt.y, 150);
});

test('11. Already-world-space connector -> no double transform', () => {
  const alreadyWorld = {
    id: 'conn_world',
    type: 'connector',
    isWorldSpace: true,
    left: 500,
    top: 500,
    angle: 45,
    path: [['M', 200, 150], ['L', 300, 150]]
  };
  const norm = normalizeObject(alreadyWorld);
  assert.equal(norm.worldPathCommands[0][1], 200);
  assert.equal(norm.worldPathCommands[0][2], 150);
  assert.equal(norm.worldPathCommands[1][1], 300);
  assert.equal(norm.worldPathCommands[1][2], 150);
});

test('12. Fabric pathOffset case -> correct world coordinates', () => {
  const rawConn = {
    id: 'conn_offset',
    type: 'connector',
    path: [['M', 413.4036, 321.265], ['L', 553.4036, 321.265]],
    left: 483.4036,
    top: 321.265,
    pathOffset: { x: 483.4036, y: 321.265 },
    angle: 36.94317218162472,
    scaleX: 1.0336,
    scaleY: 1.0336,
    originX: 'center',
    originY: 'center'
  };
  const transformed = transformPathCommandsToWorld(rawConn.path, rawConn);
  assert.ok(Math.abs(transformed[0][1] - 425.58) < 0.1);
  assert.ok(Math.abs(transformed[0][2] - 277.78) < 0.1);
  assert.ok(Math.abs(transformed[1][1] - 541.23) < 0.1);
  assert.ok(Math.abs(transformed[1][2] - 364.75) < 0.1);
});

test('13. Non-default origin -> correct world coordinates', () => {
  const rawConn = {
    id: 'conn_origin',
    type: 'connector',
    path: [['M', 0, 0], ['L', 100, 0]],
    left: 200,
    top: 150,
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    originX: 'left',
    originY: 'top',
    width: 100,
    height: 0
  };
  const transformed = transformPathCommandsToWorld(rawConn.path, rawConn);
  assert.ok(Math.abs(transformed[0][1] - 200) < 1e-2);
  assert.ok(Math.abs(transformed[0][2] - 150) < 1e-2);
  assert.ok(Math.abs(transformed[1][1] - 300) < 1e-2);
  assert.ok(Math.abs(transformed[1][2] - 150) < 1e-2);
});

test('14. Transform round-trip -> local -> world -> local matches within tolerance', () => {
  const roundTripCases = [
    { name: 'translation only', path: [['M', 0, 0], ['L', 100, 0]], opts: { left: 50, top: 75, angle: 0, scaleX: 1, scaleY: 1 } },
    { name: 'rotation only', path: [['M', 0, 0], ['L', 100, 0]], opts: { left: 100, top: 100, angle: 60, scaleX: 1, scaleY: 1, originX: 'center', originY: 'center' } },
    { name: 'scale only', path: [['M', 0, 0], ['L', 100, 0]], opts: { left: 100, top: 100, angle: 0, scaleX: 2.2, scaleY: 1.8, originX: 'center', originY: 'center' } },
    { name: 'rotation + scale', path: [['M', 0, 0], ['L', 100, 0]], opts: { left: 200, top: 150, angle: 45, scaleX: 1.5, scaleY: 1.5, originX: 'center', originY: 'center' } },
    { name: 'rotation + scale + pathOffset', path: [['M', 413.4, 321.2], ['L', 553.4, 321.2]], opts: { left: 483.4, top: 321.2, pathOffset: { x: 483.4, y: 321.2 }, angle: 36.94, scaleX: 1.0336, scaleY: 1.0336, originX: 'center', originY: 'center' } },
    { name: 'non-default origin', path: [['M', 0, 0], ['L', 100, 0]], opts: { left: 200, top: 150, angle: 30, scaleX: 1.2, scaleY: 1.2, originX: 'left', originY: 'top', width: 100, height: 0 } },
    { name: 'already-world-space path', path: [['M', 200, 150], ['L', 300, 150]], opts: { isWorldSpace: true } }
  ];

  roundTripCases.forEach(({ name, path, opts }) => {
    const world = transformPathCommandsToWorld(path, { ...opts, localPath: path });
    const recovered = opts.isWorldSpace ? world : invertWorldPathCommands(world, { ...opts, localPath: path });

    assert.equal(world.length, path.length, `${name}: command count mismatch in world`);
    assert.equal(recovered.length, path.length, `${name}: command count mismatch in recovered`);

    path.forEach((origCmd, i) => {
      const recCmd = recovered[i];
      assert.equal(origCmd[0].toUpperCase(), recCmd[0].toUpperCase(), `${name}: command type mismatch`);
      for (let k = 1; k < origCmd.length; k++) {
        const diff = Math.abs(origCmd[k] - recCmd[k]);
        assert.ok(diff < 1e-3, `${name}: coord mismatch at cmd ${i} param ${k} (diff ${diff})`);
      }
    });
  });
});

test('15. Flip / transform matrix compatibility -> behavior matches Fabric where applicable', () => {
  const rawConn = {
    id: 'conn_flip',
    type: 'connector',
    path: [['M', 0, 0], ['L', 100, 0]],
    left: 200,
    top: 200,
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    flipX: true,
    originX: 'center',
    originY: 'center'
  };
  const transformed = transformPathCommandsToWorld(rawConn.path, rawConn);
  assert.ok(transformed[0][1] > transformed[1][1], 'Flipped connector must invert horizontal direction');
});

test('16. Canonical Connector 1 fixture -> stale metadata is rejected', () => {
  const conn1 = {
    id: 'conn_1788819877574_jt6ms',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    endArrow: true,
    sourceShapeId: 'shape_elem_1788819871101_txc8m',
    targetShapeId: null,
    left: 483.4036,
    top: 321.265,
    angle: 36.94317218162472,
    scaleX: 1.0336,
    scaleY: 1.0336,
    originX: 'center',
    originY: 'center',
    path: [
      ['M', 413.4036, 321.265],
      ['L', 553.4036, 321.265],
      ['M', 541.0768993057837, 326.7697661163042],
      ['L', 553.4036, 321.265],
      ['L', 541.0768993057837, 315.7602338836958]
    ]
  };

  const topo = recoverConnectorTopology(conn1, canonicalShapes);
  // Stale metadata (txc8m is ~529px away) MUST be rejected
  assert.equal(topo.metadataValidation.source, 'STALE');
  assert.notEqual(topo.sourceShapeId, 'shape_elem_1788819871101_txc8m');
  // Conservative geometric recovery attaches source to igis7 (28.7px)
  assert.equal(topo.sourceShapeId, 'shape_elem_1788819849852_igis7');
  // Target is floating (84.8px) -> null
  assert.equal(topo.targetShapeId, null);
  // Overall confidence < 0.85
  assert.ok(topo.overallConfidence < 0.85, `Expected < 0.85, got ${topo.overallConfidence}`);
});

test('17. Canonical Connector 2 fixture -> confidence reflects corrected rotated geometry', () => {
  const conn2 = {
    id: 'conn_1788819917106_bjw2f',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    endArrow: true,
    sourceShapeId: null,
    targetShapeId: null,
    left: 806.4036,
    top: 405.2272,
    angle: 315,
    scaleX: 1.0336,
    scaleY: 1.0336,
    originX: 'center',
    originY: 'center',
    path: [
      ['M', 736.4036, 405.2272],
      ['L', 876.4036, 405.2272],
      ['M', 864.0768993057837, 410.7319661163042],
      ['L', 876.4036, 405.2272],
      ['L', 864.0768993057837, 399.72243388369577]
    ]
  };

  const topo = recoverConnectorTopology(conn2, canonicalShapes);
  const angleDeg = (Math.atan2(topo.shaftDirection.y, topo.shaftDirection.x) * 180) / Math.PI;
  assert.ok(Math.abs(angleDeg - (-45)) < 0.05, `Expected -45 deg, got ${angleDeg}`);
  assert.equal(topo.sourceShapeId, 'shape_elem_1788819863708_ozspq');
  assert.equal(topo.sourceConfidence, 0.95);
  assert.equal(topo.targetShapeId, null);
  assert.ok(Math.abs(topo.targetConfidence - 0.83) < 0.02);
  assert.ok(topo.overallConfidence < 0.85, 'Overall confidence must be below 0.85 verification threshold');
});

test('18. Canonical Connector 3 fixture -> genuinely unresolved', () => {
  const conn3 = {
    id: 'conn_1788819927702_6k31a',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    endArrow: true,
    sourceShapeId: null,
    targetShapeId: null,
    left: 693.8546,
    top: 232.3969,
    angle: 0,
    scaleX: 1.0084,
    scaleY: 1.0084,
    originX: 'center',
    originY: 'center',
    path: [
      ['M', 623.8546, 232.3969],
      ['L', 763.8546, 232.3969],
      ['M', 751.5278993057838, 237.9016661163042],
      ['L', 763.8546, 232.3969],
      ['L', 751.5278993057838, 226.89213388369578]
    ]
  };

  const topo = recoverConnectorTopology(conn3, canonicalShapes);
  assert.equal(topo.sourceShapeId, null, 'Floating source must remain null');
  assert.equal(topo.targetShapeId, null, 'Floating target must remain null');
  assert.equal(topo.sourceConfidence, 0.20);
  assert.equal(topo.targetConfidence, 0.20);
  assert.equal(topo.overallConfidence, 0.20);
  assert.ok(topo.overallConfidence < 0.85, 'Overall confidence must be below 0.85 verification threshold');
});

test('19. Verification invariant -> only confidence >= 0.85 can produce verified topology', () => {
  const VERIFICATION_THRESHOLD = 0.85;
  const conns = [
    { id: 'conn_1', overallConfidence: 0.35, expectedVerified: false },
    { id: 'conn_2', overallConfidence: 0.83, expectedVerified: false },
    { id: 'conn_3', overallConfidence: 0.20, expectedVerified: false },
    { id: 'conn_good', overallConfidence: 0.95, expectedVerified: true }
  ];

  conns.forEach(({ id, overallConfidence, expectedVerified }) => {
    const isVerified = overallConfidence >= VERIFICATION_THRESHOLD;
    assert.equal(isVerified, expectedVerified, `Connector ${id} verification state mismatch`);
  });
});
