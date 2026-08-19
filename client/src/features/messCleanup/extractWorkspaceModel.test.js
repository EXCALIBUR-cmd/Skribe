import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';

const createCanvas = (objects) => ({
  getObjects: () => objects
});

const findObject = (model, id) => model.board.objects.find((object) => object.id === id);

test('extracts text content and geometry without mutating the object', () => {
  const textbox = {
    type: 'textbox',
    id: 'text_1',
    left: 100,
    top: 150,
    width: 180,
    height: 32,
    angle: 12,
    scaleX: 1.2,
    scaleY: 0.9,
    text: 'Authentication',
    fontSize: 24,
    fontFamily: 'Quicksand',
    textAlign: 'center'
  };
  const before = JSON.stringify(textbox);

  const object = findObject(extractWorkspaceModel(createCanvas([textbox])), 'text_1');

  assert.equal(object.type, 'text');
  assert.equal(object.text, 'Authentication');
  assert.deepEqual(object.position, { x: 100, y: 150 });
  assert.deepEqual(object.size, { width: 180, height: 32 });
  assert.deepEqual(object.scale, { x: 1.2, y: 0.9 });
  assert.equal(object.style.fontSize, 24);
  assert.equal(JSON.stringify(textbox), before);
});

test('extracts geometric shapes and linked shape text relationships', () => {
  const shape = {
    type: 'rect',
    id: 'shape_1',
    elementId: 'element_1',
    attachedTextId: 'text_1',
    left: 40,
    top: 60,
    width: 160,
    height: 110,
    rx: 24,
    ry: 24
  };
  const text = {
    type: 'textbox',
    id: 'text_1',
    elementId: 'element_1',
    parentShapeId: 'shape_1',
    left: 40,
    top: 60,
    width: 140,
    height: 24,
    text: 'Login'
  };

  const model = extractWorkspaceModel(createCanvas([shape, text]));
  const shapeModel = findObject(model, 'shape_1');
  const textModel = findObject(model, 'text_1');

  assert.equal(shapeModel.type, 'shape');
  assert.equal(shapeModel.shapeType, 'rounded_rect');
  assert.deepEqual(shapeModel.relationships, [
    { type: 'contains_text', targetId: 'text_1' },
    { type: 'shared_element', targetId: 'text_1' }
  ]);
  assert.deepEqual(textModel.relationships, [
    { type: 'contained_by', targetId: 'shape_1' },
    { type: 'shared_element', targetId: 'shape_1' }
  ]);
});

test('preserves note metadata and connector endpoint relationships', () => {
  const sticky = {
    type: 'rect',
    id: 'shape_note',
    elementId: 'element_note',
    attachedTextId: 'text_note',
    isStickyNote: true,
    noteColor: '#fff3a0',
    left: 10,
    top: 20,
    width: 180,
    height: 180
  };
  const noteText = {
    type: 'textbox',
    id: 'text_note',
    elementId: 'element_note',
    parentShapeId: 'shape_note',
    left: 20,
    top: 30,
    width: 140,
    height: 30,
    text: 'JWT required'
  };
  const connector = {
    type: 'path',
    id: 'connector_1',
    isConnector: true,
    connectorType: 'elbow',
    sourceShapeId: 'shape_note',
    targetShapeId: 'shape_2',
    left: 100,
    top: 100,
    width: 200,
    height: 100
  };

  const model = extractWorkspaceModel(createCanvas([sticky, noteText, connector]));
  const stickyModel = findObject(model, 'shape_note');
  const connectorModel = findObject(model, 'connector_1');

  assert.equal(stickyModel.type, 'note');
  assert.equal(stickyModel.metadata.isStickyNote, true);
  assert.equal(stickyModel.metadata.noteColor, '#fff3a0');
  assert.deepEqual(connectorModel.connector, {
    sourceShapeId: 'shape_note',
    targetShapeId: 'shape_2',
    connectorType: 'elbow'
  });
  assert.deepEqual(connectorModel.relationships, [
    { type: 'connects_from', targetId: 'shape_note' },
    { type: 'connects_to', targetId: 'shape_2' }
  ]);
});

test('extracts vector strokes and excludes temporary draw paths', () => {
  const stroke = {
    type: 'path',
    id: 'stroke_1',
    strokeId: 'stroke_1',
    isVectorStroke: true,
    vectorStrokeData: { id: 'stroke_1', color: '#000000', width: 4, opacity: 1, style: 'solid', points: [{ x: 1, y: 2 }] },
    left: 20,
    top: 30,
    width: 80,
    height: 40
  };
  const temporaryPath = {
    type: 'path',
    id: 'stroke_temp',
    strokeId: 'stroke_temp',
    isTemporaryDrawPath: true,
    left: 0,
    top: 0
  };

  const model = extractWorkspaceModel(createCanvas([stroke, temporaryPath]));

  assert.equal(model.board.objects.length, 1);
  assert.equal(model.board.objects[0].type, 'stroke');
  assert.equal(model.board.objects[0].strokeId, 'stroke_1');
  assert.deepEqual(model.board.objects[0].vector, {
    color: '#000000',
    width: 4,
    opacity: 1,
    style: 'solid'
  });
});

test('does not generate missing identities and always returns JSON-safe data', () => {
  const object = { type: 'circle', left: 1, top: 2, width: 20, height: 20 };
  const model = extractWorkspaceModel(createCanvas([object]));
  const normalized = model.board.objects[0];

  assert.equal(normalized.id, undefined);
  assert.equal(normalized.identityWarning, 'missing-id');
  assert.doesNotThrow(() => JSON.stringify(model));
  assert.equal(object.id, undefined);
});
