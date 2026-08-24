import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';
import { normalizeObject } from './normalizeObjects.js';

test('TEST 1: fontWeight preservation', () => {
  const textObj = { id: 'text_1', type: 'textbox', text: 'Heading', fontSize: 24, fontWeight: 'bold', left: 10, top: 10, width: 100, height: 30 };
  const normalized = normalizeObject(textObj, 0);

  assert.equal(normalized.style.fontWeight, 'bold');
});

test('TEST 2: fontStyle preservation', () => {
  const textObj = { id: 'text_1', type: 'textbox', text: 'Italic text', fontSize: 16, fontStyle: 'italic', left: 10, top: 10, width: 100, height: 30 };
  const normalized = normalizeObject(textObj, 0);

  assert.equal(normalized.style.fontStyle, 'italic');
});

test('TEST 3: textAlign preservation', () => {
  const textObj = { id: 'text_1', type: 'textbox', text: 'Centered', fontSize: 18, textAlign: 'center', left: 10, top: 10, width: 100, height: 30 };
  const normalized = normalizeObject(textObj, 0);

  assert.equal(normalized.style.textAlign, 'center');
});

test('TEST 4: lineHeight preservation', () => {
  const textObj = { id: 'text_1', type: 'textbox', text: 'Multi-line', fontSize: 16, lineHeight: 1.4, left: 10, top: 10, width: 100, height: 30 };
  const normalized = normalizeObject(textObj, 0);

  assert.equal(normalized.style.lineHeight, 1.4);
});

test('TEST 5: text color preservation', () => {
  const textObj = { id: 'text_1', type: 'textbox', text: 'Red Text', fontSize: 16, fill: '#ef4444', left: 10, top: 10, width: 100, height: 30 };
  const normalized = normalizeObject(textObj, 0);

  assert.equal(normalized.style.color, '#ef4444');
  assert.equal(normalized.visual.fill, '#ef4444');
});

test('TEST 6: shape fill preservation', () => {
  const shapeObj = { id: 'rect_1', type: 'rect', fill: '#3b82f6', stroke: '#1d4ed8', strokeWidth: 2, left: 50, top: 50, width: 120, height: 80 };
  const normalized = normalizeObject(shapeObj, 1);

  assert.equal(normalized.visual.fill, '#3b82f6');
});

test('TEST 7: shape stroke preservation', () => {
  const shapeObj = { id: 'rect_1', type: 'rect', fill: '#ffffff', stroke: '#10b981', strokeWidth: 3, left: 50, top: 50, width: 120, height: 80 };
  const normalized = normalizeObject(shapeObj, 2);

  assert.equal(normalized.visual.stroke, '#10b981');
});

test('TEST 8: strokeWidth preservation', () => {
  const shapeObj = { id: 'rect_1', type: 'rect', strokeWidth: 5, left: 50, top: 50, width: 120, height: 80 };
  const normalized = normalizeObject(shapeObj, 3);

  assert.equal(normalized.visual.strokeWidth, 5);
});

test('TEST 9: sticky-note styling preservation', () => {
  const stickyObj = { id: 'sticky_1', isStickyNote: true, noteColor: '#fef08a', type: 'rect', fill: '#fef08a', left: 100, top: 100, width: 180, height: 180 };
  const normalized = normalizeObject(stickyObj, 4);

  assert.equal(normalized.metadata.isStickyNote, true);
  assert.equal(normalized.metadata.noteColor, '#fef08a');
  assert.equal(normalized.visual.fill, '#fef08a');
});

test('TEST 10: zIndex preservation', () => {
  const canvas = {
    getObjects: () => [
      { id: 'obj_first', type: 'rect', left: 0, top: 0, width: 100, height: 100 },
      { id: 'obj_second', type: 'textbox', text: 'Top', left: 10, top: 10, width: 80, height: 20 }
    ]
  };

  const model = extractWorkspaceModel(canvas);
  const first = model.board.objects.find((o) => o.id === 'obj_first');
  const second = model.board.objects.find((o) => o.id === 'obj_second');

  assert.equal(first.zIndex, 0);
  assert.equal(second.zIndex, 1);
});

test('TEST 11: connector styling and metadata preservation', () => {
  const connectorObj = {
    id: 'conn_1',
    isConnector: true,
    connectorType: 'curved',
    sourceShapeId: 'shape_a',
    targetShapeId: 'shape_b',
    stroke: '#6366f1',
    strokeWidth: 3,
    type: 'path',
    left: 10,
    top: 10,
    width: 100,
    height: 100
  };
  const normalized = normalizeObject(connectorObj, 5);

  assert.equal(normalized.connector.connectorType, 'curved');
  assert.equal(normalized.connector.sourceShapeId, 'shape_a');
  assert.equal(normalized.connector.targetShapeId, 'shape_b');
  assert.equal(normalized.connector.stroke, '#6366f1');
  assert.equal(normalized.connector.strokeWidth, 3);
});

test('TEST 12: freehand styling preservation', () => {
  const strokeObj = {
    id: 'stroke_1',
    isVectorStroke: true,
    stroke: '#ec4899',
    strokeWidth: 4,
    vectorStrokeData: { color: '#ec4899', width: 4, opacity: 0.9 },
    type: 'path',
    left: 0,
    top: 0,
    width: 50,
    height: 50
  };
  const normalized = normalizeObject(strokeObj, 6);

  assert.equal(normalized.vector.color, '#ec4899');
  assert.equal(normalized.vector.width, 4);
  assert.equal(normalized.vector.opacity, 0.9);
  assert.equal(normalized.visual.stroke, '#ec4899');
});

test('TEST 13: existing relationship IDs remain intact', () => {
  const shape = { id: 'shape_1', elementId: 'elem_100', attachedTextId: 'text_1', type: 'rect', left: 0, top: 0, width: 100, height: 100 };
  const normalized = normalizeObject(shape, 7);

  assert.equal(normalized.id, 'shape_1');
  assert.equal(normalized.elementId, 'elem_100');
  assert.equal(normalized.relationshipMetadata.attachedTextId, 'text_1');
});

test('TEST 14: JSON serialization remains valid', () => {
  const shape = { id: 'shape_1', elementId: 'elem_100', type: 'rect', fill: '#000', left: 0, top: 0, width: 100, height: 100 };
  const canvas = { getObjects: () => [shape] };

  const model = extractWorkspaceModel(canvas);
  const jsonStr = JSON.stringify(model);
  const parsed = JSON.parse(jsonStr);

  assert.equal(parsed.version, 1);
  assert.equal(parsed.board.objects[0].id, 'shape_1');
  assert.equal(parsed.board.objects[0].zIndex, 0);
});

test('TEST 15: extraction does not mutate Fabric objects', () => {
  const originalShape = { id: 'shape_1', type: 'rect', left: 20, top: 40, width: 100, height: 80, fill: '#ff0000' };
  const copy = JSON.parse(JSON.stringify(originalShape));
  const canvas = { getObjects: () => [originalShape] };

  extractWorkspaceModel(canvas);

  assert.deepEqual(originalShape, copy);
});

test('TEST 16: existing extraction tests continue passing', () => {
  const canvas = {
    getObjects: () => [
      { id: 'shape_1', type: 'rect', left: 0, top: 0, width: 100, height: 100 },
      { id: 'text_1', type: 'textbox', text: 'Hello', left: 0, top: 0, width: 80, height: 20 }
    ]
  };

  const model = extractWorkspaceModel(canvas);
  assert.equal(model.version, 1);
  assert.equal(model.board.objects.length, 2);
});
