import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPreviewRenderModel } from './previewModel.js';

const workspaceModel = {
  version: 1,
  board: {
    objects: [
      {
        id: 'shape_1',
        type: 'shape',
        shapeType: 'rounded_rect',
        position: { x: 100, y: 100 },
        size: { width: 160, height: 100 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        relationshipMetadata: { attachedTextId: 'text_1' },
        metadata: {}
      },
      {
        id: 'text_1',
        type: 'text',
        text: 'Login',
        position: { x: 100, y: 100 },
        size: { width: 120, height: 24 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        relationshipMetadata: { parentShapeId: 'shape_1' },
        metadata: {}
      },
      {
        id: 'note_1',
        type: 'note',
        text: 'JWT required',
        position: { x: 300, y: 100 },
        size: { width: 180, height: 180 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        metadata: { isStickyNote: true, noteColor: '#fff3a0' }
      },
      {
        id: 'connector_1',
        type: 'connector',
        position: { x: 200, y: 100 },
        size: { width: 100, height: 10 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        relationshipMetadata: { sourceShapeId: 'shape_1', targetShapeId: 'note_1' },
        metadata: {}
      }
    ]
  }
};

const layoutProposal = {
  canvasBounds: { x: 0, y: 0, width: 500, height: 300 },
  placements: [
    { objectId: 'shape_1', unitId: 'unit_shape_1', position: { x: 100, y: 100 }, bounds: { x: 20, y: 50, width: 160, height: 100 }, size: { width: 160, height: 100 }, rotation: 0, scale: { x: 1, y: 1 }, anchor: 'center' },
    { objectId: 'text_1', unitId: 'unit_shape_1', position: { x: 100, y: 100 }, bounds: { x: 40, y: 88, width: 120, height: 24 }, size: { width: 120, height: 24 }, rotation: 0, scale: { x: 1, y: 1 }, anchor: 'top-left' },
    { objectId: 'note_1', unitId: 'unit_note_1', position: { x: 300, y: 100 }, bounds: { x: 210, y: 10, width: 180, height: 180 }, size: { width: 180, height: 180 }, rotation: 0, scale: { x: 1, y: 1 }, anchor: 'center' },
    { objectId: 'connector_1', unitId: 'unit_connector_1', position: { x: 200, y: 100 }, bounds: { x: 150, y: 95, width: 100, height: 10 }, size: { width: 100, height: 10 }, rotation: 0, scale: { x: 1, y: 1 }, anchor: 'center' }
  ]
};

test('projects preview records without mutating the source model', () => {
  const before = JSON.stringify(workspaceModel);
  const preview = buildPreviewRenderModel(workspaceModel, layoutProposal);

  assert.equal(preview.objects.length, 4);
  assert.equal(preview.objects.find((object) => object.originalObjectId === 'text_1').text, 'Login');
  assert.equal(preview.objects.find((object) => object.originalObjectId === 'note_1').noteColor, '#fff3a0');
  assert.equal(JSON.stringify(workspaceModel), before);
});

test('keeps linked object identity and connector metadata in preview records', () => {
  const preview = buildPreviewRenderModel(workspaceModel, layoutProposal);
  const shape = preview.objects.find((object) => object.originalObjectId === 'shape_1');
  const text = preview.objects.find((object) => object.originalObjectId === 'text_1');
  const connector = preview.objects.find((object) => object.originalObjectId === 'connector_1');

  assert.equal(shape.originalObjectId, 'shape_1');
  assert.equal(text.originalObjectId, 'text_1');
  assert.equal(text.position.x, shape.position.x);
  assert.equal(connector.relationshipMetadata.sourceShapeId, 'shape_1');
  assert.equal(connector.relationshipMetadata.targetShapeId, 'note_1');
  assert.doesNotThrow(() => JSON.stringify(preview));
});
