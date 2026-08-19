import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCleanup } from './applyCleanup.js';

const createMockCollaborativeEnvironment = () => {
  const socketServerEmits = [];
  const dbPatchCalls = [];

  const createClientCanvas = (initialObjects = [], clientId = 'user_a') => {
    const objects = [...initialObjects];
    const undoStack = [];
    const redoStack = [];
    let isBulkOperation = false;
    let isRemoteOperation = false;
    let isHistoryProcessing = false;
    let renderCount = 0;
    const localEmittedEvents = [];
    let viewportTransform = [1, 0, 0, 1, 0, 0];

    const saveState = () => {
      if (isHistoryProcessing || isRemoteOperation) return;
      const serialized = JSON.stringify(objects.map((o) => ({ ...o })));
      if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== serialized) {
        undoStack.push(serialized);
        redoStack.length = 0;
      }
    };

    saveState();

    const notifyObjectModified = (obj) => {
      if (isRemoteOperation || isHistoryProcessing || isBulkOperation) return;
      localEmittedEvents.push({ type: 'canvas:object-modified', objectId: obj.id });
      socketServerEmits.push({ type: 'canvas:object-modified', clientId, objectId: obj.id });
    };

    const triggerDebouncedPersistence = () => {
      if (isRemoteOperation || isHistoryProcessing || isBulkOperation) return;
      dbPatchCalls.push({ clientId, timestamp: Date.now(), objectCount: objects.length });
    };

    const canvas = {
      clientId,
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
      getLocalEmittedEvents: () => localEmittedEvents,

      moveObjectNormal: (objectId, left, top) => {
        const obj = objects.find((o) => o.id === objectId);
        if (obj) {
          obj.left = left;
          obj.top = top;
          notifyObjectModified(obj);
          saveState();
          triggerDebouncedPersistence();
        }
      },

      eraseObjectNormal: (objectId) => {
        const idx = objects.findIndex((o) => o.id === objectId);
        if (idx !== -1) {
          const removed = objects.splice(idx, 1)[0];
          if (!isBulkOperation && !isRemoteOperation) {
            localEmittedEvents.push({ type: 'canvas:object-removed', objectId });
            socketServerEmits.push({ type: 'canvas:object-removed', clientId, objectId });
            saveState();
            triggerDebouncedPersistence();
          }
        }
      },

      drawStrokeNormal: (strokeObj) => {
        objects.push(strokeObj);
        if (!isBulkOperation && !isRemoteOperation) {
          localEmittedEvents.push({ type: 'canvas:path-created', objectId: strokeObj.id });
          socketServerEmits.push({ type: 'canvas:path-created', clientId, objectId: strokeObj.id });
          saveState();
          triggerDebouncedPersistence();
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
            socketServerEmits.push({
              type: 'canvas:batch-modified',
              clientId,
              transactionId: result.transactionId,
              changes: result.changes
            });
            dbPatchCalls.push({ clientId, timestamp: Date.now(), objectCount: objects.length });
          }

          return result;
        } catch (error) {
          return { success: false, error: 'Exception during bulk apply', reason: error.message };
        } finally {
          isBulkOperation = false;
        }
      },

      applyRemoteBatchObjectsModified: ({ changes }) => {
        if (!Array.isArray(changes)) return;
        try {
          isRemoteOperation = true;
          changes.forEach((change) => {
            if (!change || !change.objectId || !change.newGeometry) return;
            const obj = objects.find((o) => o.id === change.objectId);
            if (obj) {
              const { left, top, angle, scaleX, scaleY } = change.newGeometry;
              if (left !== undefined) obj.left = left;
              if (top !== undefined) obj.top = top;
              if (angle !== undefined) obj.angle = angle;
              if (scaleX !== undefined) obj.scaleX = scaleX;
              if (scaleY !== undefined) obj.scaleY = scaleY;
            }
          });
          renderCount += 1;
        } finally {
          isRemoteOperation = false;
        }
      }
    };

    return canvas;
  };

  return {
    createClientCanvas,
    getSocketServerEmits: () => socketServerEmits,
    getDbPatchCalls: () => dbPatchCalls
  };
};

test('TEST 1: Successful local cleanup emits exactly ONE batch event', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([obj1], 'user_a');

  const proposal = { placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] };
  const res = clientA.applyMessCleanup(proposal, {});

  assert.equal(res.success, true);
  const batchEmits = env.getSocketServerEmits().filter((e) => e.type === 'canvas:batch-modified');
  assert.equal(batchEmits.length, 1);
});

test('TEST 2: No individual object-modified events are emitted during batch apply', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const obj2 = { id: 'shape_2', left: 20, top: 20 };
  const clientA = env.createClientCanvas([obj1, obj2], 'user_a');

  const proposal = {
    placements: [
      { objectId: 'shape_1', position: { x: 100, y: 100 } },
      { objectId: 'shape_2', position: { x: 200, y: 200 } }
    ]
  };
  clientA.applyMessCleanup(proposal, {});

  const singleModifies = env.getSocketServerEmits().filter((e) => e.type === 'canvas:object-modified');
  assert.equal(singleModifies.length, 0);
});

test('TEST 3: Batch payload contains only intended objects', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([obj1], 'user_a');

  const proposal = { placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] };
  clientA.applyMessCleanup(proposal, {});

  const batchEmit = env.getSocketServerEmits().find((e) => e.type === 'canvas:batch-modified');
  assert.equal(batchEmit.changes.length, 1);
  assert.equal(batchEmit.changes[0].objectId, 'shape_1');
  assert.equal(batchEmit.changes[0].newGeometry.left, 100);
});

test('TEST 4: Object IDs are preserved in payload and target objects', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', elementId: 'elem_1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([obj1], 'user_a');

  const proposal = { placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] };
  clientA.applyMessCleanup(proposal, {});

  assert.equal(obj1.id, 'shape_1');
  assert.equal(obj1.elementId, 'elem_1');
});

test('TEST 5: Remote client applies all changes', () => {
  const env = createMockCollaborativeEnvironment();
  const objA1 = { id: 'shape_1', left: 10, top: 10 };
  const objB1 = { id: 'shape_1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([objA1], 'user_a');
  const clientB = env.createClientCanvas([objB1], 'user_b');

  const proposal = { placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] };
  clientA.applyMessCleanup(proposal, {});

  const batchEmit = env.getSocketServerEmits().find((e) => e.type === 'canvas:batch-modified');
  clientB.applyRemoteBatchObjectsModified(batchEmit);

  assert.equal(clientB.getObjects()[0].left, 100);
  assert.equal(clientB.getObjects()[0].top, 100);
});

test('TEST 6: Remote client renders once', () => {
  const env = createMockCollaborativeEnvironment();
  const objB1 = { id: 'shape_1', left: 10, top: 10 };
  const clientB = env.createClientCanvas([objB1], 'user_b');
  const initialRenderCount = clientB.getRenderCount();

  const batchPayload = {
    transactionId: 'tx_1',
    changes: [{ objectId: 'shape_1', newGeometry: { left: 100, top: 100, angle: 0, scaleX: 1, scaleY: 1 } }]
  };
  clientB.applyRemoteBatchObjectsModified(batchPayload);

  assert.equal(clientB.getRenderCount(), initialRenderCount + 1);
});

test('TEST 7: Remote application does not emit the batch again', () => {
  const env = createMockCollaborativeEnvironment();
  const objB1 = { id: 'shape_1', left: 10, top: 10 };
  const clientB = env.createClientCanvas([objB1], 'user_b');

  const initialSocketEmits = env.getSocketServerEmits().length;
  const batchPayload = {
    transactionId: 'tx_1',
    changes: [{ objectId: 'shape_1', newGeometry: { left: 100, top: 100, angle: 0, scaleX: 1, scaleY: 1 } }]
  };
  clientB.applyRemoteBatchObjectsModified(batchPayload);

  assert.equal(env.getSocketServerEmits().length, initialSocketEmits);
});

test('TEST 8: Linked shape/text relationships remain intact', () => {
  const env = createMockCollaborativeEnvironment();
  const shape = { id: 's1', attachedTextId: 't1', left: 10, top: 10 };
  const text = { id: 't1', parentShapeId: 's1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([shape, text], 'user_a');

  const proposal = {
    placements: [
      { objectId: 's1', position: { x: 100, y: 100 } },
      { objectId: 't1', position: { x: 100, y: 100 } }
    ]
  };
  clientA.applyMessCleanup(proposal, {});

  assert.equal(shape.attachedTextId, 't1');
  assert.equal(text.parentShapeId, 's1');
});

test('TEST 9: Sticky-note fill/noteColor remain unchanged', () => {
  const env = createMockCollaborativeEnvironment();
  const pattern = { type: 'pattern' };
  const sticky = { id: 'n1', isStickyNote: true, noteColor: '#fff3a0', fill: pattern, left: 10, top: 10 };
  const clientA = env.createClientCanvas([sticky], 'user_a');

  const proposal = { placements: [{ objectId: 'n1', position: { x: 200, y: 200 } }] };
  clientA.applyMessCleanup(proposal, {});

  assert.equal(sticky.fill, pattern);
  assert.equal(sticky.noteColor, '#fff3a0');
});

test('TEST 10: Freehand path data remains unchanged', () => {
  const env = createMockCollaborativeEnvironment();
  const strokePath = [{ x: 0, y: 0 }];
  const stroke = { id: 'st1', type: 'path', isVectorStroke: true, path: strokePath, left: 10, top: 10 };
  const clientA = env.createClientCanvas([stroke], 'user_a');

  const proposal = { placements: [{ objectId: 'st1', position: { x: 150, y: 150 } }] };
  clientA.applyMessCleanup(proposal, {});

  assert.equal(stroke.path, strokePath);
});

test('TEST 11: Connector relationships remain unchanged', () => {
  const env = createMockCollaborativeEnvironment();
  const conn = { id: 'c1', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 10, top: 10 };
  const clientA = env.createClientCanvas([conn], 'user_a');

  const proposal = { placements: [{ objectId: 'c1', position: { x: 80, y: 80 } }] };
  clientA.applyMessCleanup(proposal, {});

  assert.equal(conn.sourceShapeId, 's1');
  assert.equal(conn.targetShapeId, 's2');
});

test('TEST 12: Viewport remains unchanged', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([obj1], 'user_a');
  clientA.setViewportTransform([2, 0, 0, 2, 50, 50]);

  const proposal = { placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] };
  clientA.applyMessCleanup(proposal, {});

  assert.deepEqual(clientA.getViewportTransform(), [2, 0, 0, 2, 50, 50]);
});

test('TEST 13: Failed validation produces no partial remote state', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([obj1], 'user_a');

  const invalidProposal = {
    placements: [
      { objectId: 'shape_1', position: { x: 100, y: 100 } },
      { objectId: 'missing_shape', position: { x: 200, y: 200 } }
    ]
  };

  const res = clientA.applyMessCleanup(invalidProposal, {});
  assert.equal(res.success, false);
  assert.equal(env.getSocketServerEmits().length, 0);
  assert.equal(env.getDbPatchCalls().length, 0);
});

test('TEST 14: Existing normal object synchronization still works', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([obj1], 'user_a');

  clientA.applyMessCleanup({ placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] }, {});
  const initialEmitCount = env.getSocketServerEmits().length;

  clientA.moveObjectNormal('shape_1', 120, 120);
  assert.equal(env.getSocketServerEmits().length, initialEmitCount + 1);
  assert.equal(env.getSocketServerEmits()[initialEmitCount].type, 'canvas:object-modified');
});

test('TEST 15: Existing eraser synchronization still works', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([obj1], 'user_a');

  clientA.applyMessCleanup({ placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] }, {});

  clientA.eraseObjectNormal('shape_1');
  const lastEmit = env.getSocketServerEmits()[env.getSocketServerEmits().length - 1];
  assert.equal(lastEmit.type, 'canvas:object-removed');
});

test('TEST 16: Existing drawing synchronization still works', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([obj1], 'user_a');

  clientA.applyMessCleanup({ placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] }, {});

  clientA.drawStrokeNormal({ id: 'stroke_new', left: 0, top: 0 });
  const lastEmit = env.getSocketServerEmits()[env.getSocketServerEmits().length - 1];
  assert.equal(lastEmit.type, 'canvas:path-created');
});

test('TEST 17: Existing sticky-note synchronization still works', () => {
  const env = createMockCollaborativeEnvironment();
  const sticky = { id: 'n1', isStickyNote: true, noteColor: '#fff3a0', left: 10, top: 10 };
  const clientA = env.createClientCanvas([sticky], 'user_a');

  clientA.applyMessCleanup({ placements: [{ objectId: 'n1', position: { x: 100, y: 100 } }] }, {});
  clientA.moveObjectNormal('n1', 120, 120);

  const lastEmit = env.getSocketServerEmits()[env.getSocketServerEmits().length - 1];
  assert.equal(lastEmit.type, 'canvas:object-modified');
});

test('TEST 18: Existing undo/redo behavior remains intact', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([obj1], 'user_a');

  clientA.applyMessCleanup({ placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] }, {});
  clientA.undo();
  assert.equal(clientA.getObjects()[0].left, 10);

  clientA.redo();
  assert.equal(clientA.getObjects()[0].left, 100);
});

test('TEST 19: Persistence occurs at the correct board-level boundary', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const clientA = env.createClientCanvas([obj1], 'user_a');

  clientA.applyMessCleanup({ placements: [{ objectId: 'shape_1', position: { x: 100, y: 100 } }] }, {});

  assert.equal(env.getDbPatchCalls().length, 1);
  assert.equal(env.getDbPatchCalls()[0].objectCount, 1);
});

test('TEST 20: No per-object database writes are introduced', () => {
  const env = createMockCollaborativeEnvironment();
  const obj1 = { id: 'shape_1', left: 10, top: 10 };
  const obj2 = { id: 'shape_2', left: 20, top: 20 };
  const obj3 = { id: 'shape_3', left: 30, top: 30 };
  const clientA = env.createClientCanvas([obj1, obj2, obj3], 'user_a');

  const proposal = {
    placements: [
      { objectId: 'shape_1', position: { x: 100, y: 100 } },
      { objectId: 'shape_2', position: { x: 200, y: 200 } },
      { objectId: 'shape_3', position: { x: 300, y: 300 } }
    ]
  };

  clientA.applyMessCleanup(proposal, {});
  assert.equal(env.getDbPatchCalls().length, 1);
});
