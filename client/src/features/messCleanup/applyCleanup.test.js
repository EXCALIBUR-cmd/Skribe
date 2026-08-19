import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCleanup, validateProposal } from './applyCleanup.js';

const createMockCanvas = (objects = []) => {
  let renderCount = 0;
  return {
    getObjects: () => objects,
    requestRenderAll: () => {
      renderCount += 1;
    },
    getRenderCount: () => renderCount
  };
};

test('TEST 1: Valid proposal moves multiple objects', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10, angle: 0, scaleX: 1, scaleY: 1, originX: 'center', originY: 'center' };
  const obj2 = { id: 'shape_2', left: 50, top: 50, angle: 0, scaleX: 1, scaleY: 1, originX: 'center', originY: 'center' };
  const canvas = createMockCanvas([obj1, obj2]);

  const proposal = {
    placements: [
      { objectId: 'shape_1', position: { x: 100, y: 100 }, rotation: 0, anchor: 'center' },
      { objectId: 'shape_2', position: { x: 300, y: 300 }, rotation: 15, anchor: 'center' }
    ]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, true);
  assert.equal(res.appliedCount, 2);
  assert.equal(obj1.left, 100);
  assert.equal(obj1.top, 100);
  assert.equal(obj2.left, 300);
  assert.equal(obj2.top, 300);
  assert.equal(obj2.angle, 15);
});

test('TEST 2: All object IDs are preserved', () => {
  const obj1 = { id: 'shape_1', elementId: 'elem_1', left: 10, top: 10 };
  const canvas = createMockCanvas([obj1]);

  const proposal = {
    placements: [{ objectId: 'shape_1', position: { x: 150, y: 150 } }]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, true);
  assert.equal(obj1.id, 'shape_1');
  assert.equal(obj1.elementId, 'elem_1');
});

test('TEST 3: Original geometry is not mutated before validation', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createMockCanvas([obj1]);

  const invalidProposal = {
    placements: [
      { objectId: 'shape_1', position: { x: 100, y: 100 } },
      { objectId: 'non_existent_shape', position: { x: 200, y: 200 } }
    ]
  };

  const res = applyCleanup(canvas, invalidProposal, {});
  assert.equal(res.success, false);
  assert.equal(obj1.left, 10);
  assert.equal(obj1.top, 10);
});

test('TEST 4: Invalid object ID causes complete rejection', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createMockCanvas([obj1]);

  const proposal = {
    placements: [{ objectId: 'missing_id', position: { x: 100, y: 100 } }]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, false);
  assert.equal(res.error, 'Validation failed');
  assert.ok(res.reason.includes('not found'));
});

test('TEST 5: Invalid coordinate causes complete rejection', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createMockCanvas([obj1]);

  const proposal = {
    placements: [{ objectId: 'shape_1', position: { x: NaN, y: 100 } }]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, false);
  assert.equal(obj1.left, 10);
});

test('TEST 6: Duplicate placement IDs are rejected', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createMockCanvas([obj1]);

  const proposal = {
    placements: [
      { objectId: 'shape_1', position: { x: 100, y: 100 } },
      { objectId: 'shape_1', position: { x: 200, y: 200 } }
    ]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, false);
  assert.ok(res.reason.includes('Duplicate placement objectId'));
});

test('TEST 7: Linked shape/text retain their relationship', () => {
  const shape = { id: 'shape_1', elementId: 'elem_1', attachedTextId: 'text_1', left: 10, top: 10 };
  const text = { id: 'text_1', elementId: 'elem_1', parentShapeId: 'shape_1', left: 10, top: 10 };
  const canvas = createMockCanvas([shape, text]);

  const proposal = {
    placements: [
      { objectId: 'shape_1', position: { x: 100, y: 100 } },
      { objectId: 'text_1', position: { x: 100, y: 100 } }
    ]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, true);
  assert.equal(shape.attachedTextId, 'text_1');
  assert.equal(text.parentShapeId, 'shape_1');
  assert.equal(shape.elementId, 'elem_1');
  assert.equal(text.elementId, 'elem_1');
});

test('TEST 8: Linked shape/text proposed positions are not overwritten by generic syncLinkedPosition() behavior', () => {
  const shape = { id: 'shape_1', attachedTextId: 'text_1', left: 10, top: 10, originX: 'center', originY: 'center' };
  const text = { id: 'text_1', parentShapeId: 'shape_1', left: 10, top: 10, originX: 'center', originY: 'center' };
  const canvas = createMockCanvas([shape, text]);

  const proposal = {
    placements: [
      { objectId: 'shape_1', position: { x: 200, y: 200 }, anchor: 'center' },
      { objectId: 'text_1', position: { x: 210, y: 215 }, anchor: 'center' }
    ]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, true);
  assert.equal(shape.left, 200);
  assert.equal(shape.top, 200);
  assert.equal(text.left, 210);
  assert.equal(text.top, 215);
});

test('TEST 9: Sticky note retains fill, noteColor, ruled-paper pattern, and text after geometry update', () => {
  const patternObj = { type: 'pattern', sourceCanvas: {} };
  const sticky = {
    id: 'note_1',
    isStickyNote: true,
    noteColor: '#fff3a0',
    fill: patternObj,
    text: 'JWT Token',
    left: 10,
    top: 10
  };
  const canvas = createMockCanvas([sticky]);

  const proposal = {
    placements: [{ objectId: 'note_1', position: { x: 250, y: 250 } }]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, true);
  assert.equal(sticky.left, 250);
  assert.equal(sticky.top, 250);
  assert.equal(sticky.isStickyNote, true);
  assert.equal(sticky.noteColor, '#fff3a0');
  assert.equal(sticky.fill, patternObj);
  assert.equal(sticky.text, 'JWT Token');
});

test('TEST 10: Freehand path data remains identical', () => {
  const strokePath = [{ x: 0, y: 0 }, { x: 10, y: 20 }];
  const stroke = {
    id: 'stroke_1',
    strokeId: 'stroke_1',
    type: 'path',
    isVectorStroke: true,
    path: strokePath,
    stroke: '#000000',
    strokeWidth: 4,
    left: 10,
    top: 10
  };
  const canvas = createMockCanvas([stroke]);

  const proposal = {
    placements: [{ objectId: 'stroke_1', position: { x: 120, y: 140 } }]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, true);
  assert.equal(stroke.left, 120);
  assert.equal(stroke.top, 140);
  assert.equal(stroke.strokeId, 'stroke_1');
  assert.equal(stroke.path, strokePath);
  assert.equal(stroke.stroke, '#000000');
  assert.equal(stroke.strokeWidth, 4);
});

test('TEST 11: Connector identity and relationships remain intact', () => {
  const shapeA = { id: 'shape_a', left: 10, top: 10 };
  const shapeB = { id: 'shape_b', left: 100, top: 10 };
  const connector = {
    id: 'conn_1',
    isConnector: true,
    connectorType: 'elbow',
    sourceShapeId: 'shape_a',
    targetShapeId: 'shape_b',
    left: 50,
    top: 10
  };
  const canvas = createMockCanvas([shapeA, shapeB, connector]);

  const proposal = {
    placements: [
      { objectId: 'shape_a', position: { x: 20, y: 20 } },
      { objectId: 'shape_b', position: { x: 200, y: 20 } },
      { objectId: 'conn_1', position: { x: 110, y: 20 } }
    ]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, true);
  assert.equal(connector.id, 'conn_1');
  assert.equal(connector.sourceShapeId, 'shape_a');
  assert.equal(connector.targetShapeId, 'shape_b');
  assert.equal(connector.connectorType, 'elbow');
});

test('TEST 12: A mutation exception rolls the entire operation back', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const obj2 = { id: 'shape_2', left: 20, top: 20, shouldThrowOnSet: true };
  const canvas = createMockCanvas([obj1, obj2]);

  const proposal = {
    placements: [
      { objectId: 'shape_1', position: { x: 100, y: 100 } },
      { objectId: 'shape_2', position: { x: 200, y: 200 } }
    ]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, false);
  assert.equal(obj1.left, 10);
  assert.equal(obj1.top, 10);
  assert.equal(obj2.left, 20);
  assert.equal(obj2.top, 20);
});

test('TEST 13: Exactly one final render is requested on successful apply', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createMockCanvas([obj1]);

  const proposal = {
    placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }]
  };

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, true);
  assert.equal(canvas.getRenderCount(), 1);
});

test('TEST 14: No socket/network operation occurs', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createMockCanvas([obj1]);

  const proposal = {
    placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }]
  };

  const globalSocket = globalThis.socket;
  const res = applyCleanup(canvas, proposal, {});

  assert.equal(res.success, true);
  assert.equal(globalThis.socket, globalSocket);
});

test('TEST 15: Input Layout Proposal is not mutated', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createMockCanvas([obj1]);

  const proposal = {
    placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }]
  };
  const proposalBefore = JSON.stringify(proposal);

  applyCleanup(canvas, proposal, {});
  assert.equal(JSON.stringify(proposal), proposalBefore);
});

test('TEST 16: Input Workspace Model is not mutated', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createMockCanvas([obj1]);

  const proposal = {
    placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }]
  };
  const model = { version: 1, board: { objects: [{ id: 'shape_1' }] } };
  const modelBefore = JSON.stringify(model);

  applyCleanup(canvas, proposal, model);
  assert.equal(JSON.stringify(model), modelBefore);
});

test('TEST 17: Repeated application of the same proposal behaves deterministically', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createMockCanvas([obj1]);

  const proposal = {
    placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }]
  };

  const res1 = applyCleanup(canvas, proposal, {});
  assert.equal(res1.success, true);
  assert.equal(obj1.left, 100);

  const res2 = applyCleanup(canvas, proposal, {});
  assert.equal(res2.success, true);
  assert.equal(obj1.left, 100);
});
