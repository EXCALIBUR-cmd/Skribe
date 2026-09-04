import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObject } from './normalizeObjects.js';
import { getSemanticType, isConnectorPath } from './cleanupTypes.js';

const createMockSkribeLine = (id = 'line_1787661297756_bk89k') => ({
  type: 'path',
  id,
  elementId: id,
  isStraightLine: true,
  isSkribeLine: true,
  stroke: '#000000',
  strokeWidth: 2,
  left: 1403,
  top: 477,
  width: 2,
  height: 666,
  skribeLine: {
    mode: 'straight',
    start: { x: 1403, y: 144 },
    end: { x: 1403, y: 810 }
  }
});

const createMockConnector = (type = 'elbow', sourceId = 'shape_a', targetId = 'shape_b') => ({
  type: 'path',
  id: `conn_${type}_123`,
  elementId: `conn_${type}_123`,
  isConnector: true,
  connectorType: type,
  startArrow: false,
  endArrow: true,
  sourceShapeId: sourceId,
  targetShapeId: targetId,
  left: 200,
  top: 200,
  width: 100,
  height: 50,
  path: [['M', 0, 0], ['L', 50, 0], ['L', 50, 50], ['L', 100, 50]]
});

const createMockFreehandStroke = (strokeId = 'stroke_456') => ({
  type: 'path',
  id: strokeId,
  strokeId,
  isVectorStroke: true,
  left: 300,
  top: 300,
  width: 50,
  height: 50,
  path: [['M', 0, 0], ['Q', 10, 20, 30, 40], ['L', 50, 50]]
});

const createMockGenericPathShape = (shapeId = 'shape_custom_path') => ({
  type: 'path',
  id: shapeId,
  left: 500,
  top: 500,
  width: 120,
  height: 120,
  fill: '#3b82f6',
  path: [['M', 0, 0], ['L', 100, 0], ['L', 100, 100], ['L', 0, 100], ['Z']]
});

test('1. Skribe line explicit metadata establishes semanticType === line', () => {
  const line = createMockSkribeLine();
  assert.equal(getSemanticType(line), 'line');

  const normalized = normalizeObject(line);
  assert.equal(normalized.type, 'line');
  assert.equal(normalized.semanticType, 'line');
  assert.equal(normalized.isSkribeLine, true);
  assert.equal(normalized.isStraightLine, true);
});

test('2. Connector metadata survives and establishes semanticType === connector (straight, elbow, curved)', () => {
  ['straight', 'elbow', 'curved'].forEach((connType) => {
    const conn = createMockConnector(connType);
    assert.equal(getSemanticType(conn), 'connector');

    const normalized = normalizeObject(conn);
    assert.equal(normalized.type, 'connector');
    assert.equal(normalized.connectorType, connType);
    assert.equal(normalized.sourceShapeId, 'shape_a');
    assert.equal(normalized.targetShapeId, 'shape_b');
  });
});

test('3. Freehand vector stroke establishes semanticType === stroke', () => {
  const stroke = createMockFreehandStroke();
  assert.equal(getSemanticType(stroke), 'stroke');

  const normalized = normalizeObject(stroke);
  assert.equal(normalized.type, 'stroke');
  assert.equal(normalized.semanticType, 'stroke');
});

test('4. Arbitrary generic closed Path with fill is shape, never connector or line', () => {
  const pathShape = createMockGenericPathShape();
  assert.equal(getSemanticType(pathShape), 'shape');

  const normalized = normalizeObject(pathShape);
  assert.equal(normalized.type, 'shape');
});

test('5. Serialization & Deserialization property roundtrip preservation', () => {
  const propertiesToPreserve = [
    'id', 'elementId', 'strokeId',
    'isSkribeLine', 'isStraightLine', 'skribeLine',
    'isConnector', 'connectorType', 'startArrow', 'endArrow',
    'sourceShapeId', 'targetShapeId',
    'isStickyNote', 'noteColor',
    'isVectorStroke', 'metadata'
  ];

  const original = {
    ...createMockSkribeLine(),
    metadata: { author: 'user_1', role: 'divider' }
  };

  const serialized = JSON.parse(JSON.stringify(original));

  const rehydrated = {};
  propertiesToPreserve.forEach((p) => {
    if (serialized[p] !== undefined) rehydrated[p] = serialized[p];
  });

  assert.equal(rehydrated.isSkribeLine, true);
  assert.equal(rehydrated.isStraightLine, true);
  assert.equal(rehydrated.id, original.id);
  assert.equal(rehydrated.elementId, original.elementId);
  assert.equal(rehydrated.metadata?.role, 'divider');

  const normalized = normalizeObject(rehydrated);
  assert.equal(normalized.type, 'line');
  assert.equal(normalized.metadata?.role, 'divider');
});

test('6. Exact production trace reproduction: shape_line_1787661297756_bk89k', () => {
  const withMetadata = {
    id: 'shape_line_1787661297756_bk89k',
    type: 'path',
    elementId: 'line_1787661297756_bk89k',
    isSkribeLine: true,
    isStraightLine: true,
    left: 1403,
    top: 477,
    width: 2,
    height: 666
  };
  assert.equal(getSemanticType(withMetadata), 'line');
  assert.equal(normalizeObject(withMetadata).type, 'line');

  const strippedMetadataWithLinePrefix = {
    id: 'shape_line_1787661297756_bk89k',
    type: 'path',
    elementId: 'line_1787661297756_bk89k',
    left: 1403,
    top: 477,
    width: 2,
    height: 666
  };
  assert.equal(getSemanticType(strippedMetadataWithLinePrefix), 'line');
  assert.equal(normalizeObject(strippedMetadataWithLinePrefix).type, 'line');

  const bareUnknownPath = {
    id: 'unknown_path_999',
    type: 'path',
    left: 100,
    top: 100,
    width: 50,
    height: 50,
    path: [['M', 0, 0], ['L', 50, 50]]
  };
  assert.notEqual(getSemanticType(bareUnknownPath), 'connector');
});

test('7. No heuristic guessing from geometry (curve count / length)', () => {
  const curvedFreehandStroke = {
    id: 'stroke_curly',
    type: 'path',
    isVectorStroke: true,
    path: [['M', 0, 0], ['C', 10, 20, 30, 40, 50, 50]]
  };
  assert.equal(getSemanticType(curvedFreehandStroke), 'stroke');

  const straightLine = {
    id: 'line_test',
    type: 'path',
    isStraightLine: true,
    isSkribeLine: true,
    path: [['M', 0, 0], ['L', 100, 0]]
  };
  assert.equal(getSemanticType(straightLine), 'line');
});
