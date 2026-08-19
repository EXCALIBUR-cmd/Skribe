import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCleanup } from './applyCleanup.js';

const createSimulatedFabricCanvas = (initialObjects = []) => {
  const objects = [...initialObjects];
  const undoStack = [];
  const redoStack = [];
  let isBulkOperation = false;
  let isRemoteOperation = false;
  let isHistoryProcessing = false;
  let renderCount = 0;
  const emittedEvents = [];
  const persistenceCalls = [];
  let viewportTransform = [1, 0, 0, 1, 0, 0];

  const saveState = () => {
    if (isHistoryProcessing || isRemoteOperation || isBulkOperation) return;
    const serialized = JSON.stringify(objects.map((o) => ({ ...o })));
    if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== serialized) {
      undoStack.push(serialized);
      redoStack.length = 0;
    }
  };

  saveState();

  const notifyObjectModified = (obj) => {
    if (isRemoteOperation || isHistoryProcessing || isBulkOperation) return;
    emittedEvents.push({ type: 'canvas:object-modified', objectId: obj.id });
  };

  const notifyPersistence = () => {
    if (isRemoteOperation || isHistoryProcessing || isBulkOperation) return;
    persistenceCalls.push({ type: 'save' });
  };

  const canvas = {
    getObjects: () => objects,
    requestRenderAll: () => {
      renderCount += 1;
    },
    getRenderCount: () => renderCount,
    getViewportTransform: () => [...viewportTransform],
    setViewportTransform: (vt) => {
      viewportTransform = [...vt];
    },
    getUndoStack: () => undoStack,
    getRedoStack: () => redoStack,
    getEmittedEvents: () => emittedEvents,
    getPersistenceCalls: () => persistenceCalls,
    isBulkOperationActive: () => isBulkOperation,

    moveObjectNormal: (objectId, left, top) => {
      const obj = objects.find((o) => o.id === objectId);
      if (obj) {
        obj.left = left;
        obj.top = top;
        notifyObjectModified(obj);
        saveState();
        notifyPersistence();
      }
    },

    undo: () => {
      if (undoStack.length <= 1) return;
      isHistoryProcessing = true;
      const current = undoStack.pop();
      redoStack.push(current);
      const prev = JSON.parse(undoStack[undoStack.length - 1]);
      objects.length = 0;
      prev.forEach((item) => objects.push(item));
      renderCount += 1;
      isHistoryProcessing = false;
    },

    redo: () => {
      if (redoStack.length === 0) return;
      isHistoryProcessing = true;
      const next = redoStack.pop();
      undoStack.push(next);
      const restored = JSON.parse(next);
      objects.length = 0;
      restored.forEach((item) => objects.push(item));
      renderCount += 1;
      isHistoryProcessing = false;
    },

    applyMessCleanup: (layoutProposal, workspaceModel) => {
      if (isHistoryProcessing || isBulkOperation) {
        return { success: false, error: 'Canvas busy', reason: 'Canvas is processing' };
      }

      try {
        isBulkOperation = true;
        const result = applyCleanup(canvas, layoutProposal, workspaceModel);

        if (result.success) {
          isBulkOperation = false;
          saveState();
          isBulkOperation = true;
        }

        return result;
      } catch (error) {
        return { success: false, error: 'Exception during bulk apply', reason: error.message };
      } finally {
        isBulkOperation = false;
      }
    }
  };

  return canvas;
};

test('TEST 1: Normal state exists before cleanup', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createSimulatedFabricCanvas([obj1]);
  assert.equal(canvas.getUndoStack().length, 1);
});

test('TEST 2: Apply cleanup successfully moves objects', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10, originX: 'center', originY: 'center' };
  const canvas = createSimulatedFabricCanvas([obj1]);
  const proposal = { placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 }, anchor: 'center' }] };

  const res = canvas.applyMessCleanup(proposal, {});
  assert.equal(res.success, true);
  assert.equal(obj1.left, 100);
  assert.equal(obj1.top, 100);
});

test('TEST 3: Exactly one logical undo step is created', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createSimulatedFabricCanvas([obj1]);
  const initialStackSize = canvas.getUndoStack().length;

  const proposal = { placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] };
  const res = canvas.applyMessCleanup(proposal, {});

  assert.equal(res.success, true);
  assert.equal(canvas.getUndoStack().length, initialStackSize + 1);
});

test('TEST 4: Ctrl+Z restores exact S_pre', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createSimulatedFabricCanvas([obj1]);
  const proposal = { placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] };

  canvas.applyMessCleanup(proposal, {});
  assert.equal(obj1.left, 100);

  canvas.undo();
  assert.equal(canvas.getObjects()[0].left, 10);
});

test('TEST 5: Ctrl+Y restores exact S_post', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createSimulatedFabricCanvas([obj1]);
  const proposal = { placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] };

  canvas.applyMessCleanup(proposal, {});
  canvas.undo();
  assert.equal(canvas.getObjects()[0].left, 10);

  canvas.redo();
  assert.equal(canvas.getObjects()[0].left, 100);
});

test('TEST 6: Failed Apply creates no history change', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createSimulatedFabricCanvas([obj1]);
  const initialStackSize = canvas.getUndoStack().length;

  const invalidProposal = { placements: [{ objectId: 'missing_id', position: { x: 100, y: 100 } }] };
  const res = canvas.applyMessCleanup(invalidProposal, {});

  assert.equal(res.success, false);
  assert.equal(canvas.getUndoStack().length, initialStackSize);
  assert.equal(canvas.getObjects()[0].left, 10);
});

test('TEST 7: Normal object movement after cleanup still creates normal history', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createSimulatedFabricCanvas([obj1]);
  const proposal = { placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] };

  canvas.applyMessCleanup(proposal, {});
  const stackSizeAfterCleanup = canvas.getUndoStack().length;

  canvas.moveObjectNormal('shape_1', 150, 150);
  assert.equal(canvas.getUndoStack().length, stackSizeAfterCleanup + 1);
  assert.equal(canvas.getObjects()[0].left, 150);
});

test('TEST 8: Normal undo after cleanup still works', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createSimulatedFabricCanvas([obj1]);

  canvas.applyMessCleanup({ placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] }, {});
  canvas.moveObjectNormal('shape_1', 150, 150);

  canvas.undo();
  assert.equal(canvas.getObjects()[0].left, 100);
});

test('TEST 9: Normal redo after cleanup still works', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createSimulatedFabricCanvas([obj1]);

  canvas.applyMessCleanup({ placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] }, {});
  canvas.moveObjectNormal('shape_1', 150, 150);

  canvas.undo();
  assert.equal(canvas.getObjects()[0].left, 100);

  canvas.redo();
  assert.equal(canvas.getObjects()[0].left, 150);
});

test('TEST 10: isBulkOperationRef is false after successful Apply', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createSimulatedFabricCanvas([obj1]);

  const res = canvas.applyMessCleanup({ placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] }, {});
  assert.equal(res.success, true);
  assert.equal(canvas.isBulkOperationActive(), false);
});

test('TEST 11: isBulkOperationRef is false after failed Apply', () => {
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const canvas = createSimulatedFabricCanvas([obj1]);

  const res = canvas.applyMessCleanup({ placements: [{ objectId: 'missing_id', position: { x: 100, y: 100 } }] }, {});
  assert.equal(res.success, false);
  assert.equal(canvas.isBulkOperationActive(), false);
});
