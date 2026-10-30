import assert from 'node:assert/strict';
import test from 'node:test';
import * as fabric from 'fabric';
import { captureCanvasHistory, diffCanvasHistory, restoreCanvasHistory } from './canvasHistory.js';
import { SKRIBE_SERIALIZABLE_PROPERTIES } from './fabricHydration.js';
import { createConnectorObject } from './connectorUtils.js';
import { extractWorkspaceModel } from '../features/messCleanup/extractWorkspaceModel.js';
import { analyzeWorkspace } from '../features/messCleanup/analyzeWorkspace.js';
import { createLayoutProposal } from '../features/messCleanup/layoutEngine.js';
import { applyCleanup } from '../features/messCleanup/applyCleanup.js';

const context = new Proxy({}, {
  get: (target, key) => {
    if (key === 'measureText') return (text) => ({ width: String(text).length * 8, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3 });
    if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (key === 'canvas') return createElement();
    if (key in target) return target[key];
    return () => {};
  },
  set: (target, key, value) => {
    target[key] = value;
    return true;
  }
});

const createElement = () => ({
  width: 1600,
  height: 900,
  style: {},
  getContext: () => context,
  setAttribute() {},
  getAttribute() { return null; },
  hasAttribute() { return false; },
  addEventListener() {},
  removeEventListener() {},
  classList: { add() {}, remove() {} },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }),
  toDataURL: () => 'data:image/png;base64,AAAA',
  ownerDocument: null,
  parentNode: null
});

const document = { createElement, documentElement: { style: {} }, defaultView: null };
const window = {
  devicePixelRatio: 1,
  document,
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle: () => ({}),
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  cancelAnimationFrame: (handle) => clearTimeout(handle)
};
document.defaultView = window;
fabric.setEnv({
  document,
  window,
  isTouchSupported: false,
  WebGLProbe: { queryWebGL() {}, isSupported() { return false; } },
  dispose() {},
  copyPasteData: {}
});

const shapeWithLabel = (key, text, left, top, extra = {}) => {
  const shape = new fabric.Rect({ left, top, width: 160, height: 110, originX: 'center', originY: 'center', fill: '#3b82f6', ...extra.shape });
  Object.assign(shape, { id: `shape_${key}`, elementId: key, attachedTextId: `text_${key}`, ...extra.shapeProps });
  const label = new fabric.Textbox(text, { left, top, width: 140, originX: 'center', originY: 'center', fontSize: 16 });
  Object.assign(label, { id: `text_${key}`, elementId: key, parentShapeId: `shape_${key}` });
  return [shape, label];
};

const buildMessyBoard = () => {
  const canvas = new fabric.StaticCanvas(undefined, { width: 1600, height: 900, renderOnAddRemove: false });
  const [shapeA, textA] = shapeWithLabel('a', 'Planning', 200, 150);
  const [shapeB, textB] = shapeWithLabel('b', 'Design', 640, 430);
  const connector = createConnectorObject({ x1: 280, y1: 150, x2: 560, y2: 430, sourceShapeId: 'shape_a', targetShapeId: 'shape_b' });
  Object.assign(connector, { id: 'conn_ab', elementId: 'conn_ab' });
  const [noteOne, noteOneText] = shapeWithLabel('n1', 'Ideas', 980, 140, {
    shape: { width: 180, height: 180, fill: '#fce7f3' },
    shapeProps: { isStickyNote: true, noteColor: '#fce7f3', metadata: { isStickyNote: true, noteColor: '#fce7f3' } }
  });
  const [noteTwo, noteTwoText] = shapeWithLabel('n2', 'Research', 1330, 560, {
    shape: { width: 180, height: 180, fill: '#fff3a0' },
    shapeProps: { isStickyNote: true, noteColor: '#fff3a0', metadata: { isStickyNote: true, noteColor: '#fff3a0' } }
  });
  const standalone = new fabric.Textbox('Meeting notes', { left: 90, top: 760, width: 200, fontSize: 28 });
  Object.assign(standalone, { id: 'text_title', elementId: 'title' });
  canvas.add(shapeA, textA, shapeB, textB, connector, noteOne, noteOneText, noteTwo, noteTwoText, standalone);
  return canvas;
};

const boardState = (canvas) => JSON.parse(JSON.stringify(canvas.toObject([...SKRIBE_SERIALIZABLE_PROPERTIES]).objects));

const integrityView = (canvas) => canvas.getObjects().map((object) => ({
  id: object.id,
  type: object.type,
  left: object.left,
  top: object.top,
  elementId: object.elementId,
  attachedTextId: object.attachedTextId ?? null,
  parentShapeId: object.parentShapeId ?? null,
  sourceShapeId: object.sourceShapeId ?? null,
  targetShapeId: object.targetShapeId ?? null,
  isStickyNote: object.isStickyNote ?? null,
  noteColor: object.noteColor ?? null,
  path: object.isConnector ? JSON.stringify(object.path) : null
}));

const applyMessCleanup = async (canvas) => {
  const workspaceModel = extractWorkspaceModel(canvas);
  const plan = await analyzeWorkspace(workspaceModel, null, { cleanupContext: { scopeType: 'BOARD', selectedObjectIds: [] } });
  const proposal = createLayoutProposal(plan, workspaceModel);
  return applyCleanup(canvas, proposal, workspaceModel);
};

test('Apply followed by Undo restores the exact serialized board, and Redo restores the cleanup', async () => {
  const canvas = buildMessyBoard();
  const original = boardState(canvas);
  const originalView = integrityView(canvas);
  const loadSnapshot = captureCanvasHistory(canvas);

  const result = await applyMessCleanup(canvas);
  assert.equal(result.success, true);
  const applied = boardState(canvas);
  const appliedView = integrityView(canvas);
  assert.notDeepEqual(appliedView.map(({ left, top }) => [left, top]), originalView.map(({ left, top }) => [left, top]));
  const applySnapshot = captureCanvasHistory(canvas);

  const restored = await restoreCanvasHistory(canvas, loadSnapshot);
  assert.equal(restored.length, original.length);
  assert.deepEqual(integrityView(canvas), originalView);
  assert.deepEqual(boardState(canvas), original);

  await restoreCanvasHistory(canvas, applySnapshot);
  assert.deepEqual(integrityView(canvas), appliedView);
  assert.deepEqual(boardState(canvas), applied);
});

test('Undo keeps ids, shape and text links, note flags and connector endpoints', async () => {
  const canvas = buildMessyBoard();
  const loadSnapshot = captureCanvasHistory(canvas);
  await applyMessCleanup(canvas);
  await restoreCanvasHistory(canvas, loadSnapshot);

  const byId = new Map(canvas.getObjects().map((object) => [object.id, object]));
  assert.deepEqual([...byId.keys()].sort(), ['conn_ab', 'shape_a', 'shape_b', 'shape_n1', 'shape_n2', 'text_a', 'text_b', 'text_n1', 'text_n2', 'text_title']);
  for (const key of ['a', 'b', 'n1', 'n2']) {
    assert.equal(byId.get(`shape_${key}`).attachedTextId, `text_${key}`);
    assert.equal(byId.get(`text_${key}`).parentShapeId, `shape_${key}`);
  }
  assert.equal(byId.get('shape_n1').isStickyNote, true);
  assert.equal(byId.get('shape_n2').noteColor, '#fff3a0');
  assert.equal(byId.get('conn_ab').isConnector, true);
  assert.equal(byId.get('conn_ab').sourceShapeId, 'shape_a');
  assert.equal(byId.get('conn_ab').targetShapeId, 'shape_b');
});

test('The broadcast diff for Apply lists exactly the objects Apply changed, and Undo lists the same objects back', async () => {
  const canvas = buildMessyBoard();
  const loadSnapshot = captureCanvasHistory(canvas);
  const originalView = new Map(integrityView(canvas).map((object) => [object.id, JSON.stringify(object)]));

  await applyMessCleanup(canvas);
  const applySnapshot = captureCanvasHistory(canvas);
  const applyDiff = diffCanvasHistory(loadSnapshot, applySnapshot);
  const changedByApply = integrityView(canvas).filter((object) => originalView.get(object.id) !== JSON.stringify(object)).map((object) => object.id);

  assert.deepEqual(applyDiff.added, []);
  assert.deepEqual(applyDiff.removed, []);
  assert.ok(applyDiff.modified.length > 0);
  assert.deepEqual([...applyDiff.modified].sort(), [...changedByApply].sort());

  await restoreCanvasHistory(canvas, loadSnapshot);
  const undoDiff = diffCanvasHistory(applySnapshot, captureCanvasHistory(canvas));
  assert.deepEqual(undoDiff, { added: [], modified: applyDiff.modified, removed: [] });
  assert.deepEqual(diffCanvasHistory(loadSnapshot, captureCanvasHistory(canvas)), { added: [], modified: [], removed: [] });
});

test('The broadcast diff reports undone additions and deletions by id', () => {
  const canvas = buildMessyBoard();
  const before = captureCanvasHistory(canvas);
  const extra = new fabric.Rect({ left: 40, top: 40, width: 20, height: 20 });
  Object.assign(extra, { id: 'shape_extra', elementId: 'extra' });
  canvas.add(extra);
  canvas.remove(canvas.getObjects().find((object) => object.id === 'text_title'));
  const after = captureCanvasHistory(canvas);

  assert.deepEqual(diffCanvasHistory(before, after), { added: ['shape_extra'], modified: [], removed: ['text_title'] });
  assert.deepEqual(diffCanvasHistory(after, before), { added: ['text_title'], modified: [], removed: ['shape_extra'] });
});
