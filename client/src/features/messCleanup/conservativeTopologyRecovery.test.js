import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recoverConnectorTopology,
  getDistanceToShapeBoundary,
  getConnectorEndpointsAndTangents,
  MAX_ATTACH_DISTANCE,
  MIN_AMBIGUITY_MARGIN
} from './connectorTopology.js';
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

test('1. explicit endpoints preserved', () => {
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
  assert.equal(topo.endpointSource, 'explicit');
});

test('2. endpoints missing remain null', () => {
  const connector = {
    id: 'conn_floating',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    path: [['M', 5000, 5000], ['L', 5100, 5000]]
  };
  const topo = recoverConnectorTopology(connector, [rectA, circleB]);
  assert.equal(topo.sourceShapeId, null);
  assert.equal(topo.targetShapeId, null);
  assert.ok(topo.sourceConfidence < 0.95);
  assert.ok(topo.targetConfidence < 0.95);
  assert.equal(topo.endpointSource, 'none');
});

test('3. straight endpoint recovery', () => {
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

test('4. elbow endpoint recovery', () => {
  const connector = {
    id: 'conn_elbow',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'elbow',
    endArrow: true,
    path: [
      ['M', 205, 150],
      ['L', 250, 150],
      ['L', 250, 120],
      ['L', 295, 120]
    ]
  };
  const topo = recoverConnectorTopology(connector, [rectA, circleB]);
  assert.equal(topo.sourceShapeId, 'shape_rect_a');
  assert.equal(topo.targetShapeId, 'shape_circle_b');
  assert.ok(topo.sourceConfidence >= 0.95);
  assert.ok(topo.targetConfidence >= 0.95);
  assert.equal(topo.endpointSource, 'geometric-recovery');
});

test('5. curved endpoint recovery', () => {
  const connector = {
    id: 'conn_curved',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'curved',
    endArrow: true,
    path: [
      ['M', 205, 150],
      ['C', 240, 100, 260, 100, 295, 150]
    ]
  };
  const topo = recoverConnectorTopology(connector, [rectA, circleB]);
  assert.equal(topo.sourceShapeId, 'shape_rect_a');
  assert.equal(topo.targetShapeId, 'shape_circle_b');
  assert.ok(topo.sourceConfidence >= 0.95);
  assert.ok(topo.targetConfidence >= 0.95);
  assert.equal(topo.endpointSource, 'geometric-recovery');
});

test('6. arrowhead excluded from endpoint detection', () => {
  const connector = {
    id: 'conn_with_arrow',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    endArrow: true,
    path: [
      ['M', 205, 150],
      ['L', 295, 150],
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

test('7. boundary-distance matching', () => {
  const dist = getDistanceToShapeBoundary({ x: 295, y: 150 }, circleB);
  assert.equal(Math.round(dist), 5);
});

test('8. ambiguous candidate rejected', () => {
  const rectC = {
    id: 'shape_rect_c',
    type: 'shape',
    semanticType: 'shape',
    shapeType: 'rect',
    bounds: { x: 300, y: 100, width: 100, height: 100 }
  };
  const rectD = {
    id: 'shape_rect_d',
    type: 'shape',
    semanticType: 'shape',
    shapeType: 'rect',
    bounds: { x: 300, y: 120, width: 100, height: 100 }
  };
  const connector = {
    id: 'conn_ambiguous',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    endArrow: true,
    path: [['M', 50, 110], ['L', 295, 110]]
  };
  const topo = recoverConnectorTopology(connector, [rectC, rectD]);
  assert.equal(topo.targetShapeId, null, 'Ambiguous target rejected to null');
  assert.ok(topo.targetConfidence < 0.95, 'Target confidence below 0.95');
});

test('9. floating connector rejected', () => {
  const connector = {
    id: 'conn_floating_endpoint',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    endArrow: true,
    path: [['M', 100, 50], ['L', 200, 50]]
  };
  const topo = recoverConnectorTopology(connector, [rectA]);
  assert.equal(topo.sourceShapeId, null);
  assert.equal(topo.targetShapeId, null);
  assert.ok(topo.sourceConfidence < 0.95);
  assert.ok(topo.targetConfidence < 0.95);
});

test('10. deterministic recovery', () => {
  const connector = {
    id: 'conn_det',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    endArrow: true,
    path: [['M', 205, 150], ['L', 295, 150]]
  };
  const topo1 = recoverConnectorTopology(connector, [rectA, circleB]);
  const topo2 = recoverConnectorTopology(connector, [rectA, circleB]);
  assert.deepEqual(topo1, topo2, 'Deterministic output across runs');
});

test('11. direction preserved', () => {
  const connector = {
    id: 'conn_rev',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    startArrow: true,
    endArrow: false,
    path: [['M', 205, 150], ['L', 295, 150]]
  };
  const topo = recoverConnectorTopology(connector, [rectA, circleB]);
  assert.equal(topo.targetShapeId, 'shape_rect_a');
  assert.equal(topo.sourceShapeId, 'shape_circle_b');
});

test('12. explicit metadata outranks geometric recovery', () => {
  const connector = {
    id: 'conn_override',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    sourceShapeId: 'shape_circle_b',
    path: [['M', 205, 150], ['L', 210, 150]]
  };
  const topo = recoverConnectorTopology(connector, [rectA, circleB]);
  assert.equal(topo.sourceShapeId, 'shape_circle_b');
  assert.equal(topo.sourceConfidence, 0.99);
  assert.equal(topo.endpointSource, 'explicit');
});

test('13. confidence recorded', () => {
  const connector = {
    id: 'conn_conf',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    path: [['M', 205, 150], ['L', 295, 150]]
  };
  const topo = recoverConnectorTopology(connector, [rectA, circleB]);
  assert.equal(typeof topo.sourceConfidence, 'number');
  assert.equal(typeof topo.targetConfidence, 'number');
  assert.equal(typeof topo.overallConfidence, 'number');
});

test('14. provenance recorded', () => {
  const connExp = { id: 'c1', type: 'connector', sourceShapeId: 's1', path: [['M', 0, 0], ['L', 10, 10]] };
  const topoExp = recoverConnectorTopology(connExp, []);
  assert.equal(topoExp.endpointSource, 'explicit');

  const connRec = { id: 'c2', type: 'connector', path: [['M', 205, 150], ['L', 295, 150]] };
  const topoRec = recoverConnectorTopology(connRec, [rectA, circleB]);
  assert.equal(topoRec.endpointSource, 'geometric-recovery');

  const connNone = { id: 'c3', type: 'connector', path: [['M', 5000, 5000], ['L', 5100, 5000]] };
  const topoNone = recoverConnectorTopology(connNone, [rectA, circleB]);
  assert.equal(topoNone.endpointSource, 'none');
});

test('15. real Board 1 connectors', () => {
  const stickyNote = {
    id: 'shape_obj_1787517698229_2ryyx',
    type: 'note',
    semanticType: 'note',
    shapeType: 'rounded_rect',
    bounds: { x: -9053.0976, y: 18226.9104, width: 203.84, height: 140.14 }
  };
  const conn = {
    id: 'conn_obj_1787517712296_9ph0k',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'straight',
    endArrow: true,
    path: [['M', -8903.2495, 18215.6366], ['L', -8763.2495, 18215.6366]]
  };
  const topo = recoverConnectorTopology(conn, [stickyNote]);
  assert.equal(topo.sourceShapeId, 'shape_obj_1787517698229_2ryyx');
  assert.equal(topo.targetShapeId, null, 'Floating target is null');
  assert.equal(topo.endpointSource, 'geometric-recovery');
});

test('16. test A connectors with explicit endpoints', () => {
  const connWithExplicit = {
    id: 'conn_1787668898659_1a2k8',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'curved',
    sourceShapeId: 'shape_circle',
    targetShapeId: 'shape_rect',
    path: [['M', 630.2281, 199.2948], ['C', 679, 149, 721, 149, 770, 199]]
  };
  const topo = recoverConnectorTopology(connWithExplicit, []);
  assert.equal(topo.sourceShapeId, 'shape_circle');
  assert.equal(topo.targetShapeId, 'shape_rect');
  assert.equal(topo.endpointSource, 'explicit');
  assert.equal(topo.sourceConfidence, 0.99);
});

test('17. no fabricated endpoint IDs', () => {
  const conn = {
    id: 'conn_orphan',
    type: 'connector',
    semanticType: 'connector',
    connectorType: 'elbow',
    path: [['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['L', 20, 10]]
  };
  const topo = recoverConnectorTopology(conn, [rectA, circleB]);
  assert.equal(topo.sourceShapeId, null);
  assert.equal(topo.targetShapeId, null);
  assert.ok(!topo.sourceShapeId);
  assert.ok(!topo.targetShapeId);
});
