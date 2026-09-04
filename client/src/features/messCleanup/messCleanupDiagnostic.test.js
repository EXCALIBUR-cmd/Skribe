import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessCleanupInventory,
  logObjectDiagnostic,
  logMessCleanupInventory
} from './messCleanupDiagnostic.js';
import { normalizeObject } from './normalizeObjects.js';

test('1. line appears in line inventory', () => {
  const lineObj = normalizeObject({
    id: 'line_divider_1',
    elementId: 'line_divider_1',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true,
    left: 100,
    top: 50,
    width: 2,
    height: 400
  });

  const inventory = buildMessCleanupInventory([lineObj]);
  assert.equal(inventory.lines.length, 1);
  assert.equal(inventory.lines[0].id, 'line_divider_1');
  assert.equal(inventory.lines[0].semanticType, 'line');
  assert.equal(inventory.lines[0].isSkribeLine, true);
  assert.equal(inventory.lines[0].isStraightLine, true);
  assert.equal(inventory.totalLines, 1);
});

test('2. straight connector appears in connector inventory', () => {
  const straightConn = normalizeObject({
    id: 'conn_straight_1',
    elementId: 'conn_straight_1',
    type: 'path',
    isConnector: true,
    connectorType: 'straight',
    startArrow: false,
    endArrow: true,
    sourceShapeId: 's1',
    targetShapeId: 's2',
    left: 100,
    top: 100,
    width: 140,
    height: 10
  });

  const inventory = buildMessCleanupInventory([straightConn]);
  assert.equal(inventory.connectors.length, 1);
  assert.equal(inventory.connectors[0].id, 'conn_straight_1');
  assert.equal(inventory.connectors[0].connectorType, 'straight');
  assert.equal(inventory.connectors[0].source, 's1');
  assert.equal(inventory.connectors[0].target, 's2');
  assert.equal(inventory.connectors[0].endArrow, true);
  assert.equal(inventory.totalConnectors, 1);
});

test('3. elbow connector appears in connector inventory', () => {
  const elbowConn = normalizeObject({
    id: 'conn_elbow_1',
    elementId: 'conn_elbow_1',
    type: 'path',
    isConnector: true,
    connectorType: 'elbow',
    startArrow: false,
    endArrow: true,
    left: 200,
    top: 100,
    width: 150,
    height: 50
  });

  const inventory = buildMessCleanupInventory([elbowConn]);
  assert.equal(inventory.connectors.length, 1);
  assert.equal(inventory.connectors[0].connectorType, 'elbow');
});

test('4. curved connector appears in connector inventory', () => {
  const curvedConn = normalizeObject({
    id: 'conn_curved_1',
    elementId: 'conn_curved_1',
    type: 'path',
    isConnector: true,
    connectorType: 'curved',
    startArrow: false,
    endArrow: true,
    left: 300,
    top: 100,
    width: 120,
    height: 40
  });

  const inventory = buildMessCleanupInventory([curvedConn]);
  assert.equal(inventory.connectors.length, 1);
  assert.equal(inventory.connectors[0].connectorType, 'curved');
});

test('5. freehand appears in stroke inventory', () => {
  const strokeObj = normalizeObject({
    id: 'stroke_pen_1',
    elementId: 'stroke_pen_1',
    strokeId: 'stroke_pen_1',
    type: 'path',
    isVectorStroke: true,
    left: 50,
    top: 50,
    width: 30,
    height: 30
  });

  const inventory = buildMessCleanupInventory([strokeObj]);
  assert.equal(inventory.strokes.length, 1);
  assert.equal(inventory.strokes[0].id, 'stroke_pen_1');
  assert.equal(inventory.strokes[0].semanticType, 'stroke');
  assert.equal(inventory.totalStrokes, 1);
});

test('6. semanticType is explicitly logged', () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const lineObj = { id: 'line_1', elementId: 'line_1', type: 'path', isSkribeLine: true };
    logObjectDiagnostic(lineObj, 0, 1);
    assert.ok(logs.some((l) => l.includes('SEMANTIC TYPE: line')));

    logs.length = 0;
    const connObj = { id: 'conn_1', elementId: 'conn_1', type: 'path', isConnector: true, connectorType: 'curved' };
    logObjectDiagnostic(connObj, 0, 1);
    assert.ok(logs.some((l) => l.includes('SEMANTIC TYPE: connector')));
  } finally {
    console.log = origLog;
  }
});

test('7. connector fields only appear for connectors', () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const lineObj = { id: 'line_1', elementId: 'line_1', type: 'path', isSkribeLine: true, isStraightLine: true };
    logObjectDiagnostic(lineObj, 0, 1);

    assert.ok(!logs.some((l) => l.startsWith('connectorType:')));
    assert.ok(!logs.some((l) => l.startsWith('isConnector:')));
    assert.ok(!logs.some((l) => l.startsWith('startArrow:')));
    assert.ok(!logs.some((l) => l.startsWith('endArrow:')));
  } finally {
    console.log = origLog;
  }
});

test('8. line fields only appear for lines', () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const connObj = { id: 'conn_1', elementId: 'conn_1', type: 'path', isConnector: true, connectorType: 'straight' };
    logObjectDiagnostic(connObj, 0, 1);

    assert.ok(!logs.some((l) => l.startsWith('isSkribeLine:')));
    assert.ok(!logs.some((l) => l.startsWith('isStraightLine:')));
  } finally {
    console.log = origLog;
  }
});

test('9. connector count is accurate', () => {
  const objects = [
    normalizeObject({ id: 'c1', type: 'path', isConnector: true, connectorType: 'straight' }),
    normalizeObject({ id: 'c2', type: 'path', isConnector: true, connectorType: 'elbow' }),
    normalizeObject({ id: 'c3', type: 'path', isConnector: true, connectorType: 'curved' }),
    normalizeObject({ id: 'l1', type: 'path', isSkribeLine: true, isStraightLine: true }),
    normalizeObject({ id: 's1', type: 'rect', width: 100, height: 100 })
  ];

  const inventory = buildMessCleanupInventory(objects);
  assert.equal(inventory.totalConnectors, 3);
  assert.equal(inventory.totalLines, 1);
  assert.equal(inventory.totalShapes, 1);
  assert.equal(inventory.totalObjects, 5);
});

test('10. real-board inventory is accurate (3 connectors, 1 line)', () => {
  const straightConn = normalizeObject({
    id: 'conn_obj_1787517712296_9ph0k',
    elementId: 'obj_1787517712296_9ph0k',
    type: 'path',
    isConnector: true,
    connectorType: 'straight',
    endArrow: true
  });

  const curvedConn = normalizeObject({
    id: 'conn_obj_1787519562242_q5aq9',
    elementId: 'obj_1787519562242_q5aq9',
    type: 'path',
    isConnector: true,
    connectorType: 'curved',
    endArrow: true
  });

  const elbowConn = normalizeObject({
    id: 'conn_obj_1787519581308_8rw9w',
    elementId: 'obj_1787519581308_8rw9w',
    type: 'path',
    isConnector: true,
    connectorType: 'elbow',
    endArrow: true
  });

  const verticalLine = normalizeObject({
    id: 'line_1787519528340_i029o',
    elementId: 'line_1787519528340_i029o',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true
  });

  const handwriting = normalizeObject({
    id: 'stroke_1',
    elementId: 'stroke_1',
    strokeId: 'stroke_1',
    type: 'path',
    isVectorStroke: true
  });

  const inventory = buildMessCleanupInventory([straightConn, curvedConn, elbowConn, verticalLine, handwriting]);

  assert.equal(inventory.totalConnectors, 3, 'Must detect exactly 3 connectors');
  assert.equal(inventory.totalLines, 1, 'Must detect exactly 1 line divider');
  assert.equal(inventory.totalStrokes, 1, 'Must detect exactly 1 stroke');

  assert.deepEqual(
    inventory.connectors.map((c) => c.connectorType),
    ['straight', 'curved', 'elbow']
  );
});
