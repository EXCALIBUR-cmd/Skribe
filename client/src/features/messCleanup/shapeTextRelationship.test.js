import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';

const createSimulatedCanvasWithRelationshipEngine = (initialObjects = []) => {
  const objects = [...initialObjects];
  const undoStack = [];
  const redoStack = [];
  let isHistoryProcessing = false;
  const emittedEvents = [];

  const saveState = () => {
    if (isHistoryProcessing) return;
    const serialized = JSON.stringify(objects.map((o) => ({ ...o })));
    if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== serialized) {
      undoStack.push(serialized);
      redoStack.length = 0;
    }
  };

  const isEligibleContainerShape = (obj) => {
    if (!obj) return false;
    if (obj.isTemporaryDrawPath || obj.isVectorStroke || obj.isStraightLine || obj.isConnector || obj.skribeLine) return false;
    if (obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'text' || obj.type === 'path' || obj.type === 'line') return false;
    if (obj.isStickyNote || obj.isChecklistNote || obj.isCalloutNote) return true;
    return ['rect', 'circle', 'triangle', 'diamond', 'polygon', 'group'].includes(obj.type) || Boolean(obj.elementId);
  };

  const isShapeUnattached = (shape) => {
    if (!shape) return false;
    if (!shape.attachedTextId) return true;
    const activeAttachedObj = objects.find((o) => o.id === shape.attachedTextId);
    return !activeAttachedObj;
  };

  const tryAttachTextToShape = (textObj) => {
    const isText = textObj.type === 'textbox' || textObj.type === 'i-text' || textObj.type === 'text';
    if (!isText) return null;

    if (textObj.parentShapeId) {
      const activeParent = objects.find((o) => o.id === textObj.parentShapeId);
      if (activeParent) return activeParent;
    }

    const textCenter = { x: textObj.left, y: textObj.top };
    const candidateShapes = [];

    objects.forEach((shape) => {
      if (shape === textObj || !isEligibleContainerShape(shape)) return;
      if (!isShapeUnattached(shape)) return;

      const scaleX = shape.scaleX || 1;
      const scaleY = shape.scaleY || 1;
      const width = (shape.width || 100) * scaleX;
      const height = (shape.height || 100) * scaleY;
      const shapeCenter = { x: shape.left, y: shape.top };

      const dx = textCenter.x - shapeCenter.x;
      const dy = textCenter.y - shapeCenter.y;
      const rad = -((shape.angle || 0) * Math.PI) / 180;
      const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
      const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

      if (Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2) {
        const area = width * height;
        candidateShapes.push({ shape, area });
      }
    });

    if (candidateShapes.length === 0) return null;

    candidateShapes.sort((a, b) => a.area - b.area);
    if (candidateShapes.length >= 2 && candidateShapes[0].area === candidateShapes[1].area) {
      return null;
    }

    const bestShape = candidateShapes[0].shape;

    const sharedElementId = bestShape.elementId || ('elem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    bestShape.elementId = sharedElementId;
    bestShape.attachedTextId = textObj.id;
    textObj.elementId = sharedElementId;
    textObj.parentShapeId = bestShape.id;

    emittedEvents.push({ type: 'canvas:object-modified', objectId: bestShape.id });
    emittedEvents.push({ type: 'canvas:object-modified', objectId: textObj.id });

    return bestShape;
  };

  const syncLinkedPosition = (target) => {
    if (!target) return;
    const attachedTextId = target.attachedTextId;
    let textObj = null;
    if (attachedTextId) {
      textObj = objects.find((o) => o.id === attachedTextId);
    }

    if (textObj) {
      textObj.left = target.left;
      textObj.top = target.top;
      textObj.angle = target.angle || 0;
    }
  };

  saveState();

  const canvas = {
    getObjects: () => objects,
    getUndoStack: () => undoStack,
    getRedoStack: () => redoStack,
    getEmittedEvents: () => emittedEvents,

    add: (obj) => {
      objects.push(obj);
      if (obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'text') {
        tryAttachTextToShape(obj);
      }
      saveState();
    },

    remove: (obj) => {
      const idx = objects.indexOf(obj);
      if (idx !== -1) {
        objects.splice(idx, 1);
        saveState();
      }
    },

    moveObject: (objectId, newLeft, newTop) => {
      const target = objects.find((o) => o.id === objectId);
      if (target) {
        target.left = newLeft;
        target.top = newTop;
        if (target.type === 'textbox' || target.type === 'i-text' || target.type === 'text') {
          if (!target.parentShapeId) {
            tryAttachTextToShape(target);
          }
        }
        syncLinkedPosition(target);
        saveState();
      }
    },

    eraseShape: (shapeId) => {
      const shapeIdx = objects.findIndex((o) => o.id === shapeId);
      if (shapeIdx !== -1) {
        const shape = objects[shapeIdx];
        const textIdx = objects.findIndex((o) => o.id === shape.attachedTextId || (shape.elementId && o.elementId === shape.elementId && o !== shape));
        if (textIdx !== -1) {
          objects.splice(textIdx, 1);
        }
        const newShapeIdx = objects.findIndex((o) => o.id === shapeId);
        if (newShapeIdx !== -1) {
          objects.splice(newShapeIdx, 1);
        }
        saveState();
      }
    },

    eraseText: (textId) => {
      const textIdx = objects.findIndex((o) => o.id === textId);
      if (textIdx !== -1) {
        const text = objects[textIdx];
        const shape = objects.find((o) => o.id === text.parentShapeId || (text.elementId && o.elementId === text.elementId && o !== text));
        if (shape) {
          delete shape.attachedTextId;
        }
        objects.splice(textIdx, 1);
        saveState();
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
      isHistoryProcessing = false;
    }
  };

  return canvas;
};

test('TEST 1: Create shape -> default textbox -> move shape -> text follows', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', attachedTextId: 'text_elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const text = { id: 'text_elem_1', elementId: 'elem_1', parentShapeId: 'shape_elem_1', type: 'textbox', left: 100, top: 100, width: 80, height: 20 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape, text]);

  canvas.moveObject('shape_elem_1', 200, 200);
  assert.equal(text.left, 200);
  assert.equal(text.top, 200);
});

test('TEST 2: Create shape -> delete default textbox -> create replacement text inside shape -> move shape -> replacement text follows', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', attachedTextId: 'text_elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const defaultText = { id: 'text_elem_1', elementId: 'elem_1', parentShapeId: 'shape_elem_1', type: 'textbox', left: 100, top: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape, defaultText]);

  canvas.remove(defaultText);

  const replacementText = { id: 'obj_text_new', type: 'textbox', left: 100, top: 100, text: 'Replacement' };
  canvas.add(replacementText);

  assert.equal(shape.attachedTextId, 'obj_text_new');
  assert.equal(replacementText.parentShapeId, 'shape_elem_1');

  canvas.moveObject('shape_elem_1', 300, 300);
  assert.equal(replacementText.left, 300);
  assert.equal(replacementText.top, 300);
});

test('TEST 3: Replacement text can be edited without breaking the relationship', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape]);

  const replacementText = { id: 'obj_text_new', type: 'textbox', left: 100, top: 100, text: 'Initial' };
  canvas.add(replacementText);

  replacementText.text = 'Edited Content';
  canvas.moveObject('shape_elem_1', 400, 400);

  assert.equal(replacementText.left, 400);
  assert.equal(replacementText.text, 'Edited Content');
});

test('TEST 4: Replacement text can be moved while remaining linked', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape]);

  const replacementText = { id: 'obj_text_new', type: 'textbox', left: 100, top: 100, text: 'Replacement' };
  canvas.add(replacementText);

  canvas.moveObject('obj_text_new', 105, 105);
  assert.equal(replacementText.parentShapeId, 'shape_elem_1');

  canvas.moveObject('shape_elem_1', 500, 500);
  assert.equal(replacementText.left, 500);
});

test('TEST 5: Replacement relationship survives board serialization and reload', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape]);

  const replacementText = { id: 'obj_text_new', type: 'textbox', left: 100, top: 100 };
  canvas.add(replacementText);

  const serialized = JSON.stringify(canvas.getObjects());
  const restoredObjects = JSON.parse(serialized);

  const restoredShape = restoredObjects.find((o) => o.id === 'shape_elem_1');
  const restoredText = restoredObjects.find((o) => o.id === 'obj_text_new');

  assert.equal(restoredShape.attachedTextId, 'obj_text_new');
  assert.equal(restoredText.parentShapeId, 'shape_elem_1');
});

test('TEST 6: User A establishes replacement relationship -> User B receives relationship metadata -> User B moves shape -> text follows', () => {
  const shapeA = { id: 'shape_elem_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const clientA = createSimulatedCanvasWithRelationshipEngine([shapeA]);

  const replacementTextA = { id: 'obj_text_new', type: 'textbox', left: 100, top: 100 };
  clientA.add(replacementTextA);

  const shapeB = JSON.parse(JSON.stringify(shapeA));
  const replacementTextB = JSON.parse(JSON.stringify(replacementTextA));
  const clientB = createSimulatedCanvasWithRelationshipEngine([shapeB, replacementTextB]);

  clientB.moveObject('shape_elem_1', 250, 250);
  assert.equal(replacementTextB.left, 250);
});

test('TEST 7: Erase shape -> linked replacement text is removed', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape]);

  const replacementText = { id: 'obj_text_new', type: 'textbox', left: 100, top: 100 };
  canvas.add(replacementText);

  canvas.eraseShape('shape_elem_1');
  assert.equal(canvas.getObjects().length, 0);
});

test('TEST 8: Erase replacement text -> shape remains and becomes eligible for another replacement text', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape]);

  const replacementText = { id: 'obj_text_new', type: 'textbox', left: 100, top: 100 };
  canvas.add(replacementText);

  canvas.eraseText('obj_text_new');
  assert.equal(canvas.getObjects().length, 1);
  assert.equal(shape.attachedTextId, undefined);

  const text2 = { id: 'obj_text_v2', type: 'textbox', left: 100, top: 100 };
  canvas.add(text2);
  assert.equal(shape.attachedTextId, 'obj_text_v2');
});

test('TEST 9: Undo relationship creation restores the pre-association state', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape]);

  const replacementText = { id: 'obj_text_new', type: 'textbox', left: 100, top: 100 };
  canvas.add(replacementText);
  assert.equal(canvas.getObjects().length, 2);

  canvas.undo();
  assert.equal(canvas.getObjects().length, 1);
});

test('TEST 10: Redo relationship creation restores the association', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape]);

  const replacementText = { id: 'obj_text_new', type: 'textbox', left: 100, top: 100 };
  canvas.add(replacementText);
  canvas.undo();
  assert.equal(canvas.getObjects().length, 1);

  canvas.redo();
  assert.equal(canvas.getObjects().length, 2);
  assert.equal(canvas.getObjects()[0].attachedTextId, 'obj_text_new');
});

test('TEST 11: Independent text outside a shape remains independent', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape]);

  const outsideText = { id: 'obj_text_out', type: 'textbox', left: 500, top: 500 };
  canvas.add(outsideText);

  assert.equal(outsideText.parentShapeId, undefined);
  assert.equal(shape.attachedTextId, undefined);
});

test('TEST 12: Independent text merely near a shape does not automatically attach', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape]);

  const nearText = { id: 'obj_text_near', type: 'textbox', left: 160, top: 160 };
  canvas.add(nearText);

  assert.equal(nearText.parentShapeId, undefined);
});

test('TEST 13: Text inside multiple overlapping shapes chooses smallest deterministic eligible container', () => {
  const outerShape = { id: 'outer', elementId: 'elem_outer', type: 'rect', left: 100, top: 100, width: 300, height: 300 };
  const innerShape = { id: 'inner', elementId: 'elem_inner', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([outerShape, innerShape]);

  const text = { id: 'obj_text_nested', type: 'textbox', left: 100, top: 100 };
  canvas.add(text);

  assert.equal(text.parentShapeId, 'inner');
  assert.equal(innerShape.attachedTextId, 'obj_text_nested');
});

test('TEST 14: Ambiguous containment does not create a random relationship', () => {
  const shapeA = { id: 'shapeA', elementId: 'elem_a', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const shapeB = { id: 'shapeB', elementId: 'elem_b', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shapeA, shapeB]);

  const text = { id: 'obj_text_ambiguous', type: 'textbox', left: 100, top: 100 };
  canvas.add(text);

  assert.equal(text.parentShapeId, undefined);
});

test('TEST 15: Sticky notes remain unaffected', () => {
  const sticky = { id: 'sticky_1', elementId: 'elem_sticky', attachedTextId: 'text_sticky', isStickyNote: true, type: 'rect', left: 100, top: 100, width: 180, height: 180 };
  const stickyText = { id: 'text_sticky', elementId: 'elem_sticky', parentShapeId: 'sticky_1', type: 'textbox', left: 100, top: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([sticky, stickyText]);

  canvas.moveObject('sticky_1', 200, 200);
  assert.equal(stickyText.left, 200);
  assert.equal(stickyText.parentShapeId, 'sticky_1');
});

test('TEST 16: Connectors remain unaffected', () => {
  const conn = { id: 'conn_1', isConnector: true, type: 'path', left: 100, top: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([conn]);

  const text = { id: 'text_1', type: 'textbox', left: 100, top: 100 };
  canvas.add(text);

  assert.equal(text.parentShapeId, undefined);
  assert.equal(conn.attachedTextId, undefined);
});

test('TEST 17: Freehand strokes remain unaffected', () => {
  const stroke = { id: 'stroke_1', isVectorStroke: true, type: 'path', left: 100, top: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([stroke]);

  const text = { id: 'text_1', type: 'textbox', left: 100, top: 100 };
  canvas.add(text);

  assert.equal(text.parentShapeId, undefined);
});

test('TEST 18: Existing linked shape/text behavior remains unchanged', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', attachedTextId: 'text_elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const text = { id: 'text_elem_1', elementId: 'elem_1', parentShapeId: 'shape_elem_1', type: 'textbox', left: 100, top: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape, text]);

  canvas.moveObject('shape_elem_1', 150, 150);
  assert.equal(text.left, 150);
});

test('TEST 19: Mess Cleanup extraction recognizes replacement shape/text as a linked unit', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100, angle: 0, scaleX: 1, scaleY: 1 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape]);

  const replacementText = { id: 'obj_text_new', type: 'textbox', left: 100, top: 100, text: 'Linked Unit Test', angle: 0, scaleX: 1, scaleY: 1 };
  canvas.add(replacementText);

  const model = extractWorkspaceModel(canvas);
  const extractedShapeUnit = model.board.objects.find((o) => o.id === 'shape_elem_1');
  const extractedTextUnit = model.board.objects.find((o) => o.id === 'obj_text_new');

  assert.equal(extractedShapeUnit.relationshipMetadata.attachedTextId, 'obj_text_new');
  assert.equal(extractedTextUnit.relationshipMetadata.parentShapeId, 'shape_elem_1');
  assert.equal(extractedShapeUnit.elementId, extractedTextUnit.elementId);
});

test('TEST 20: Stale attachedTextId from deleted default text does not prevent replacement attachment', () => {
  const shape = { id: 'shape_elem_1', elementId: 'elem_1', attachedTextId: 'stale_deleted_text_id', type: 'rect', left: 100, top: 100, width: 100, height: 100 };
  const canvas = createSimulatedCanvasWithRelationshipEngine([shape]);

  const replacementText = { id: 'obj_text_fresh', type: 'textbox', left: 100, top: 100 };
  canvas.add(replacementText);

  assert.equal(shape.attachedTextId, 'obj_text_fresh');
  assert.equal(replacementText.parentShapeId, 'shape_elem_1');
});
