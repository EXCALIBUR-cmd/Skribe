import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hydrateSkribeFabricObject,
  hydrateCanvasObjects,
  SKRIBE_SERIALIZABLE_PROPERTIES
} from '../../utils/fabricHydration.js';
import { normalizeObject } from './normalizeObjects.js';
import { getSemanticType } from './cleanupTypes.js';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';

const createRawFabricPath = (props = {}) => ({
  type: 'path',
  left: props.left ?? 100,
  top: props.top ?? 100,
  width: props.width ?? 100,
  height: props.height ?? 50,
  stroke: props.stroke ?? '#000000',
  strokeWidth: props.strokeWidth ?? 2,
  path: props.path ?? [['M', 0, 0], ['L', 100, 50]],
  set(newProps) { Object.assign(this, newProps); },
  ...props
});

const createRawFabricRect = (props = {}) => ({
  type: 'rect',
  left: props.left ?? 200,
  top: props.top ?? 200,
  width: props.width ?? 150,
  height: props.height ?? 150,
  fill: props.fill ?? '#fff3a0',
  set(newProps) { Object.assign(this, newProps); },
  ...props
});

test('1. Line metadata survives serialization and hydration', () => {
  const serialized = {
    id: 'line_1787661297756_bk89k',
    elementId: 'line_1787661297756_bk89k',
    type: 'path',
    isStraightLine: true,
    isSkribeLine: true,
    skribeLine: {
      mode: 'straight',
      start: { x: 1403, y: 144 },
      end: { x: 1403, y: 810 }
    }
  };

  const rawObj = createRawFabricPath();
  hydrateSkribeFabricObject(rawObj, serialized);

  assert.equal(rawObj.id, 'line_1787661297756_bk89k');
  assert.equal(rawObj.elementId, 'line_1787661297756_bk89k');
  assert.equal(rawObj.isSkribeLine, true);
  assert.equal(rawObj.isStraightLine, true);
  assert.equal(rawObj.skribeLine?.start?.x, 1403);
});

test('2. Line metadata survives standard loadFromJSON / hydrateCanvasObjects', () => {
  const jsonPayload = {
    objects: [
      {
        id: 'line_123',
        elementId: 'line_123',
        type: 'path',
        isSkribeLine: true,
        isStraightLine: true,
        skribeLine: { mode: 'straight', start: { x: 10, y: 10 }, end: { x: 100, y: 10 } }
      }
    ]
  };

  const mockCanvas = {
    objects: [createRawFabricPath()],
    getObjects() { return this.objects; }
  };

  const hydrated = hydrateCanvasObjects(mockCanvas, jsonPayload);
  assert.equal(hydrated.length, 1);
  assert.equal(hydrated[0].id, 'line_123');
  assert.equal(hydrated[0].isSkribeLine, true);
  assert.equal(hydrated[0].isStraightLine, true);
});

test('3. Line ID is preserved without mutation to shape_line_', () => {
  const serialized = {
    id: 'line_test_456',
    elementId: 'line_test_456',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true
  };

  const rawObj = createRawFabricPath();
  hydrateSkribeFabricObject(rawObj, serialized);

  assert.equal(rawObj.id, 'line_test_456');
  assert.notEqual(rawObj.id, 'shape_line_test_456');
});

test('4. Line metadata survives undo / redo history cycle', () => {
  const originalState = {
    objects: [
      {
        id: 'line_undo_redo',
        elementId: 'line_undo_redo',
        type: 'path',
        isSkribeLine: true,
        isStraightLine: true
      }
    ]
  };

  const serializedStr = JSON.stringify(originalState);

  const parsed = JSON.parse(serializedStr);
  const mockCanvas = {
    objects: [createRawFabricPath()],
    getObjects() { return this.objects; }
  };
  hydrateCanvasObjects(mockCanvas, parsed);

  const restored = mockCanvas.objects[0];
  assert.equal(restored.id, 'line_undo_redo');
  assert.equal(restored.isSkribeLine, true);
  assert.equal(restored.isStraightLine, true);
});

test('5. Connector metadata survives deserialization', () => {
  const serialized = {
    id: 'conn_100',
    elementId: 'conn_100',
    type: 'path',
    isConnector: true,
    connectorType: 'elbow',
    startArrow: false,
    endArrow: true,
    sourceShapeId: 'shape_a',
    targetShapeId: 'shape_b'
  };

  const rawObj = createRawFabricPath();
  hydrateSkribeFabricObject(rawObj, serialized);

  assert.equal(rawObj.isConnector, true);
  assert.equal(rawObj.connectorType, 'elbow');
  assert.equal(rawObj.sourceShapeId, 'shape_a');
  assert.equal(rawObj.targetShapeId, 'shape_b');
  assert.equal(rawObj.endArrow, true);
});

test('6. Elbow connector type preserved', () => {
  const raw = createRawFabricPath();
  hydrateSkribeFabricObject(raw, { id: 'c1', isConnector: true, connectorType: 'elbow' });
  assert.equal(raw.connectorType, 'elbow');
  assert.equal(getSemanticType(raw), 'connector');
});

test('7. Curved connector type preserved', () => {
  const raw = createRawFabricPath();
  hydrateSkribeFabricObject(raw, { id: 'c2', isConnector: true, connectorType: 'curved' });
  assert.equal(raw.connectorType, 'curved');
  assert.equal(getSemanticType(raw), 'connector');
});

test('8. Arrow metadata preserved', () => {
  const raw = createRawFabricPath();
  hydrateSkribeFabricObject(raw, {
    id: 'c3',
    isConnector: true,
    connectorType: 'straight',
    startArrow: true,
    endArrow: true
  });
  assert.equal(raw.startArrow, true);
  assert.equal(raw.endArrow, true);
});

test('9. Endpoint IDs preserved without fabricating missing ones', () => {
  const rawKnown = createRawFabricPath();
  hydrateSkribeFabricObject(rawKnown, {
    id: 'c4',
    isConnector: true,
    sourceShapeId: 'shape_1',
    targetShapeId: 'shape_2'
  });
  assert.equal(rawKnown.sourceShapeId, 'shape_1');
  assert.equal(rawKnown.targetShapeId, 'shape_2');

  const rawUnknown = createRawFabricPath();
  hydrateSkribeFabricObject(rawUnknown, {
    id: 'c5',
    isConnector: true,
    sourceShapeId: null,
    targetShapeId: null
  });
  assert.equal(rawUnknown.sourceShapeId, null);
  assert.equal(rawUnknown.targetShapeId, null);
});

test('10. Freehand vector stroke metadata preserved', () => {
  const raw = createRawFabricPath();
  hydrateSkribeFabricObject(raw, {
    id: 'stroke_1',
    strokeId: 'stroke_1',
    isVectorStroke: true,
    vectorStrokeData: { color: '#ef4444', width: 4 }
  });
  assert.equal(raw.isVectorStroke, true);
  assert.equal(raw.strokeId, 'stroke_1');
  assert.equal(getSemanticType(raw), 'stroke');
});

test('11. Sticky note metadata preserved', () => {
  const raw = createRawFabricRect();
  hydrateSkribeFabricObject(raw, {
    id: 'shape_sticky',
    elementId: 'elem_sticky',
    isStickyNote: true,
    noteColor: '#fef08a'
  });
  assert.equal(raw.isStickyNote, true);
  assert.equal(raw.noteColor, '#fef08a');
  assert.equal(getSemanticType(raw), 'note');
});

test('12. Text ownership metadata preserved (parentShapeId & attachedTextId)', () => {
  const textRaw = { type: 'textbox', set(p) { Object.assign(this, p); } };
  hydrateSkribeFabricObject(textRaw, {
    id: 'text_elem_1',
    elementId: 'elem_1',
    parentShapeId: 'shape_elem_1'
  });
  assert.equal(textRaw.parentShapeId, 'shape_elem_1');

  const shapeRaw = createRawFabricRect();
  hydrateSkribeFabricObject(shapeRaw, {
    id: 'shape_elem_1',
    elementId: 'elem_1',
    attachedTextId: 'text_elem_1'
  });
  assert.equal(shapeRaw.attachedTextId, 'text_elem_1');
});

test('13. Remote object hydration in collaborative sync', () => {
  const remotePayload = {
    id: 'line_remote_789',
    elementId: 'line_remote_789',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true,
    metadata: { source: 'collaborator_bob' }
  };

  const incomingObj = createRawFabricPath();
  hydrateSkribeFabricObject(incomingObj, remotePayload);

  assert.equal(incomingObj.id, 'line_remote_789');
  assert.equal(incomingObj.isSkribeLine, true);
  assert.equal(incomingObj.metadata?.source, 'collaborator_bob');
  assert.equal(getSemanticType(incomingObj), 'line');
});

test('14. No identity rewriting during hydration', () => {
  const originalIds = ['line_abc', 'conn_def', 'stroke_ghi', 'shape_jkl', 'text_mno'];
  originalIds.forEach((id) => {
    const raw = createRawFabricPath();
    hydrateSkribeFabricObject(raw, { id, elementId: id });
    assert.equal(raw.id, id);
    assert.equal(raw.elementId, id);
  });
});

test('15. ensureObjectId does not fabricate semantics when domain metadata exists', () => {
  const line = createRawFabricPath();
  hydrateSkribeFabricObject(line, {
    id: 'line_101',
    elementId: 'line_101',
    isSkribeLine: true,
    isStraightLine: true
  });

  const normalized = normalizeObject(line);
  assert.equal(normalized.type, 'line');
  assert.equal(normalized.id, 'line_101');
});

test('16. Round-trip semantic equality across all 4 path classes', () => {
  const lRaw = createRawFabricPath();
  hydrateSkribeFabricObject(lRaw, { id: 'l1', isSkribeLine: true, isStraightLine: true });
  assert.equal(normalizeObject(lRaw).type, 'line');

  const cElbow = createRawFabricPath();
  hydrateSkribeFabricObject(cElbow, { id: 'c1', isConnector: true, connectorType: 'elbow' });
  assert.equal(normalizeObject(cElbow).type, 'connector');

  const cCurved = createRawFabricPath();
  hydrateSkribeFabricObject(cCurved, { id: 'c2', isConnector: true, connectorType: 'curved' });
  assert.equal(normalizeObject(cCurved).type, 'connector');

  const sRaw = createRawFabricPath();
  hydrateSkribeFabricObject(sRaw, { id: 's1', isVectorStroke: true });
  assert.equal(normalizeObject(sRaw).type, 'stroke');
});

test('17. Path geometry remains unchanged during hydration', () => {
  const pathCommands = [['M', 10, 20], ['L', 30, 40], ['Z']];
  const raw = createRawFabricPath({ path: pathCommands });
  hydrateSkribeFabricObject(raw, { id: 'p1', isSkribeLine: true });
  assert.deepEqual(raw.path, pathCommands);
});

test('18. Real observed production line reproduction', () => {
  const cleanLine = createRawFabricPath({
    left: 1403,
    top: 477,
    width: 2,
    height: 666
  });
  hydrateSkribeFabricObject(cleanLine, {
    id: 'line_1787661297756_bk89k',
    elementId: 'line_1787661297756_bk89k',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true
  });

  assert.equal(cleanLine.id, 'line_1787661297756_bk89k');
  assert.equal(cleanLine.isSkribeLine, true);
  assert.equal(cleanLine.isStraightLine, true);

  const normalized = normalizeObject(cleanLine);
  assert.equal(normalized.id, 'line_1787661297756_bk89k');
  assert.equal(normalized.type, 'line');
  assert.equal(normalized.isSkribeLine, true);
});

test('19. No curve-count semantic inference', () => {
  const strokeWithCurves = createRawFabricPath({
    path: [['M', 0, 0], ['C', 10, 20, 30, 40, 50, 60]]
  });
  hydrateSkribeFabricObject(strokeWithCurves, {
    id: 'stroke_curve',
    isVectorStroke: true
  });

  assert.equal(getSemanticType(strokeWithCurves), 'stroke');
  assert.equal(normalizeObject(strokeWithCurves).type, 'stroke');
});

test('20. No path-length semantic inference', () => {
  const genericLongPath = createRawFabricPath({
    width: 5,
    height: 1000,
    path: [['M', 0, 0], ['L', 5, 1000], ['L', 5, 0], ['Z']]
  });
  hydrateSkribeFabricObject(genericLongPath, {
    id: 'shape_long_custom'
  });

  assert.equal(getSemanticType(genericLongPath), 'shape');
  assert.equal(normalizeObject(genericLongPath).type, 'shape');
});

test('21. Production integration: raw persisted JSON -> hydrateCanvasObjects -> extractWorkspaceModel -> normalizeObject', () => {
  const rawMongoLine = {
    type: 'Path',
    version: '7.4.0',
    originX: 'center',
    originY: 'center',
    left: 1402.9689,
    top: 477,
    width: 1.5467,
    height: 666,
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 2,
    path: [['M', 1404, 144], ['Q', 1401.9, 488.8, 1404, 810]],
    elementId: 'line_1787661297756_bk89k'
  };

  const mockFabricPath = createRawFabricPath({
    type: 'path',
    left: 1403,
    top: 477,
    width: 2,
    height: 666
  });

  const canvas = {
    getObjects: () => [mockFabricPath]
  };

  hydrateCanvasObjects(canvas, [rawMongoLine]);
  assert.equal(mockFabricPath.id, 'line_1787661297756_bk89k');
  assert.equal(mockFabricPath.elementId, 'line_1787661297756_bk89k');
  assert.equal(mockFabricPath.isSkribeLine, true);
  assert.equal(mockFabricPath.isStraightLine, true);

  const model = extractWorkspaceModel(canvas);
  const extractedLine = model.board.objects[0];

  assert.equal(extractedLine.id, 'line_1787661297756_bk89k');
  assert.equal(extractedLine.elementId, 'line_1787661297756_bk89k');
  assert.equal(extractedLine.type, 'line');
  assert.equal(extractedLine.isSkribeLine, true);
  assert.equal(extractedLine.isStraightLine, true);
});

test('22. Corrupted legacy ID (shape_line_...) is repaired to canonical line_... during hydration and extraction', () => {
  const corruptedObj = createRawFabricPath({
    id: 'shape_line_1787661297756_bk89k',
    elementId: 'line_1787661297756_bk89k'
  });

  const canvas = {
    getObjects: () => [corruptedObj]
  };

  const model = extractWorkspaceModel(canvas);
  const line = model.board.objects[0];

  assert.equal(line.id, 'line_1787661297756_bk89k');
  assert.equal(line.type, 'line');
  assert.equal(line.isSkribeLine, true);
  assert.equal(line.isStraightLine, true);
});

test('23. All four path classes preserve canonical IDs and semantics through extractWorkspaceModel', () => {
  const line = createRawFabricPath({ elementId: 'line_divider_1' });
  const elbowConn = createRawFabricPath({ elementId: 'conn_elbow_1', connectorType: 'elbow' });
  const curvedConn = createRawFabricPath({ elementId: 'conn_curved_1', connectorType: 'curved' });
  const stroke = createRawFabricPath({ elementId: 'stroke_pen_1', strokeId: 'stroke_pen_1' });

  const canvas = {
    getObjects: () => [line, elbowConn, curvedConn, stroke]
  };

  const model = extractWorkspaceModel(canvas);
  const [extractedLine, extractedElbow, extractedCurved, extractedStroke] = model.board.objects;

  assert.equal(extractedLine.id, 'line_divider_1');
  assert.equal(extractedLine.type, 'line');

  assert.equal(extractedElbow.id, 'conn_elbow_1');
  assert.equal(extractedElbow.type, 'connector');
  assert.equal(extractedElbow.connectorType, 'elbow');

  assert.equal(extractedCurved.id, 'conn_curved_1');
  assert.equal(extractedCurved.type, 'connector');
  assert.equal(extractedCurved.connectorType, 'curved');

  assert.equal(extractedStroke.id, 'stroke_pen_1');
  assert.equal(extractedStroke.type, 'stroke');
});

test('24. Exact Real Board Connector Reproduction: raw MongoDB record (9ph0k) -> hydration -> extractWorkspaceModel', () => {
  const rawMongoStraightConnector = {
    type: 'Path',
    version: '7.4.0',
    originX: 'center',
    originY: 'center',
    left: -8833.2495,
    top: 18215.6366,
    width: 140,
    height: 11.0095,
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 8,
    path: [
      ['M', -9084.343717102052, 18034.64861565875],
      ['L', -8944.343717102052, 18034.64861565875],
      ['M', -8956.67041779627, 18040.153381775053],
      ['L', -8944.343717102052, 18034.64861565875],
      ['L', -8956.67041779627, 18029.143849542445]
    ],
    stackIndex: 13,
    attachedTextId: 'text_obj_1787517712296_9ph0k',
    elementId: 'obj_1787517712296_9ph0k'
  };

  assert.equal(rawMongoStraightConnector.id, undefined);
  assert.equal(rawMongoStraightConnector.isConnector, undefined);
  assert.equal(rawMongoStraightConnector.connectorType, undefined);
  assert.equal(rawMongoStraightConnector.sourceShapeId, undefined);
  assert.equal(rawMongoStraightConnector.targetShapeId, undefined);

  const mockFabricObj = createRawFabricPath({
    type: 'path',
    path: rawMongoStraightConnector.path,
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 8,
    elementId: 'obj_1787517712296_9ph0k'
  });

  const canvas = {
    getObjects: () => [mockFabricObj]
  };

  hydrateCanvasObjects(canvas, [rawMongoStraightConnector]);

  assert.equal(mockFabricObj.isConnector, true);
  assert.equal(mockFabricObj.connectorType, 'straight');
  assert.equal(mockFabricObj.endArrow, true);
  assert.equal(mockFabricObj.id, 'conn_obj_1787517712296_9ph0k');
  assert.equal(mockFabricObj.sourceShapeId, undefined);
  assert.equal(mockFabricObj.targetShapeId, undefined);

  const model = extractWorkspaceModel(canvas);
  const normalized = model.board.objects[0];

  assert.equal(normalized.id, 'conn_obj_1787517712296_9ph0k');
  assert.equal(normalized.type, 'connector');
  assert.equal(normalized.semanticType, 'connector');
  assert.equal(normalized.connector.connectorType, 'straight');
  assert.equal(normalized.connector.sourceShapeId, null);
  assert.equal(normalized.connector.targetShapeId, null);
});
