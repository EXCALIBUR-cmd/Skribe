import assert from 'node:assert/strict';
import test from 'node:test';
import * as fabric from 'fabric';
import { captureCanvasHistory, diffCanvasHistory, loadCanvasTolerant, mergeRetainedObjects, restoreCanvasHistory, retainUnrestorable } from './canvasHistory.js';
import { SKRIBE_SERIALIZABLE_PROPERTIES, hydrateCanvasObjects } from './fabricHydration.js';
import { playStickyEntrance } from './stickyEntrance.js';
import { createSerializationMemo, isMemoizable } from './serializationMemo.js';
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

test('Hydration matches saved data by id, so a shifted canvas never swaps identities', () => {
  const persist = (id, role) => ({ id, type: 'Rect', elementId: id, metadata: { role, elementId: id } });
  const raw = [persist('shape_elem_a', 'shape'), persist('shape_elem_b', 'shape'), persist('text_elem_b', 'text')];
  const live = [
    { id: 'shape_elem_a' },
    { id: 'text_elem_a', metadata: { role: 'text', elementId: 'a' } },
    { id: 'timestamp_elem_a', metadata: { role: 'timestamp', elementId: 'a' } },
    { id: 'shape_elem_b' },
    { id: 'text_elem_b' }
  ];
  hydrateCanvasObjects({ getObjects: () => live }, { objects: raw });
  assert.deepEqual(live.map((object) => object.id), ['shape_elem_a', 'text_elem_a', 'timestamp_elem_a', 'shape_elem_b', 'text_elem_b']);
  assert.deepEqual(live.map((object) => object.metadata?.role), ['shape', 'text', 'timestamp', 'shape', 'text']);
});

test('Hydration still fills objects without ids from the same position', () => {
  const live = [{ type: 'Path' }, { id: 'text_elem_x' }];
  hydrateCanvasObjects({ getObjects: () => live }, { objects: [{ type: 'Path', strokeId: 'stroke_1' }, { id: 'text_elem_x', elementId: 'x' }] });
  assert.equal(live[0].strokeId, 'stroke_1');
  assert.equal(live[1].elementId, 'x');
});

test('One object that cannot load keeps the rest of the board and is preserved for saving', async () => {
  const objects = [
    { type: 'Textbox', id: 'text_a', text: 'keep me', left: 1, top: 1, width: 100 },
    { type: 'NotARealType', id: 'bad_1', left: 2, top: 2 },
    { type: 'Textbox', id: 'text_b', text: 'and me', left: 3, top: 3, width: 100 }
  ];
  const canvas = new fabric.StaticCanvas(createElement());
  const { payload, unrestorable } = await loadCanvasTolerant(canvas, { version: '7.4.0', objects });
  assert.deepEqual(payload.objects.map((object) => object.id), ['text_a', 'text_b']);
  assert.deepEqual(canvas.getObjects().map((object) => object.text), ['keep me', 'and me']);
  assert.deepEqual(unrestorable, [{ index: 1, data: objects[1] }]);
  retainUnrestorable(canvas, unrestorable);
  retainUnrestorable(canvas, unrestorable);
  assert.equal(canvas.skribeRetainedObjects.length, 1);
  const merged = mergeRetainedObjects(payload.objects, canvas.skribeRetainedObjects);
  assert.deepEqual(merged.map((object) => object.id), ['text_a', 'bad_1', 'text_b']);
});

class FadePart {
  constructor() { this.opacity = 1; this.scaleX = 1; this.scaleY = 1; }
  set(values) { Object.assign(this, values); }
  toObject() { return { opacity: this.opacity, scaleX: this.scaleX, scaleY: this.scaleY }; }
}

const withFrames = async (run) => {
  const frames = [];
  const previous = globalThis.requestAnimationFrame;
  ['NodeList', 'HTMLCollection', 'SVGElement'].forEach((name) => { globalThis[name] = globalThis[name] || class {}; });
  const previousWindow = globalThis.window;
  globalThis.window = globalThis.window || globalThis;
  const previousDocument = globalThis.document;
  globalThis.document = globalThis.document || { hidden: false, querySelectorAll: () => [] };
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  const tick = (time) => frames.splice(0).forEach((callback) => callback(time));
  try {
    await run(tick);
  } finally {
    tick(1e9);
    globalThis.requestAnimationFrame = previous;
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
};

test('A sticky fade whose next frame arrives after its duration still ends fully visible and saves that way', async () => {
  await withFrames(async (tick) => {
    const parts = [new FadePart(), new FadePart(), new FadePart()];
    let renders = 0;
    playStickyEntrance(parts, { requestRenderAll: () => { renders += 1; } });
    assert.deepEqual(parts.map((part) => part.opacity), [0, 0, 0]);
    assert.deepEqual(parts[0].toObject(), { opacity: 1, scaleX: 1, scaleY: 1 });
    const drawn = renders;
    tick(1000);
    tick(1600);
    parts.forEach((part) => {
      assert.equal(part.opacity, 1);
      assert.equal(part.scaleX, 1);
      assert.equal(part.scaleY, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(part, 'toObject'), false);
      assert.deepEqual(part.toObject(), { opacity: 1, scaleX: 1, scaleY: 1 });
    });
    assert.ok(renders > drawn);
  });
});

test('A sticky fade with normal frames animates, serializes as visible throughout and ends fully visible', async () => {
  await withFrames(async (tick) => {
    const part = new FadePart();
    playStickyEntrance([part], { requestRenderAll: () => {} });
    tick(5000);
    tick(5016);
    tick(5100);
    assert.ok(part.opacity > 0 && part.scaleX > 0.9);
    assert.deepEqual(part.toObject(), { opacity: 1, scaleX: 1, scaleY: 1 });
    tick(5500);
    assert.equal(part.opacity, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(part, 'toObject'), false);
  });
});

const memoCanvas = () => {
  const canvas = new fabric.StaticCanvas(null, { width: 800, height: 600 });
  const rect = new fabric.Rect({ left: 10, top: 20, width: 100, height: 50, fill: '#fff', metadata: { role: 'shape', note: 'a' }, id: 'memo_rect', elementId: 'el_1' });
  const text = new fabric.Textbox('hello', { left: 30, top: 40, width: 120, id: 'memo_text', elementId: 'el_1', parentShapeId: 'memo_rect', metadata: { role: 'text' } });
  const path = new fabric.Path('M 0 0 L 10 10', { left: 50, top: 50, id: 'memo_path', isConnector: true });
  const group = new fabric.Group([new fabric.Rect({ width: 20, height: 20, fill: '#abc' }), new fabric.Rect({ left: 25, width: 20, height: 20, fill: '#cba' })], { id: 'memo_group' });
  canvas.add(rect, text, path, group);
  return { canvas, rect, text, path, group };
};

const assertMemoMatchesFresh = (canvas, memo, label) => {
  const cached = JSON.parse(captureCanvasHistory(canvas, memo));
  const fresh = JSON.parse(captureCanvasHistory(canvas));
  assert.deepEqual(cached, fresh, label);
};

test('a memoized history capture always equals a fresh capture, whatever way an object was changed', () => {
  const { canvas, rect, text, path, group } = memoCanvas();
  const memo = createSerializationMemo(SKRIBE_SERIALIZABLE_PROPERTIES);
  assertMemoMatchesFresh(canvas, memo, 'first capture');
  const changes = [
    ['set()', () => rect.set({ left: 99 })],
    ['direct property write', () => { rect.top = 77; }],
    ['nested metadata in place', () => { rect.metadata.note = 'changed'; }],
    ['property that did not exist before', () => { rect.attachedTextId = 'memo_text'; }],
    ['text content', () => { text.text = 'changed text'; }],
    ['per-character style', () => { text.styles = { 0: { 0: { fill: '#f00' } } }; }],
    ['connector path in place', () => { path.path[1][1] = 55; }],
    ['group child in place', () => { group.item(0).set({ fill: '#000' }); }],
    ['group child metadata', () => { group.item(1).metadata = { role: 'x' }; }],
    ['layer order', () => { canvas.bringObjectToFront(rect); }],
    ['removed object', () => { canvas.remove(text); }]
  ];
  changes.forEach(([label, change]) => {
    change();
    assertMemoMatchesFresh(canvas, memo, label);
  });
});

test('objects inside an active selection are serialized fresh and return to the memo once released', () => {
  const { canvas, rect, text } = memoCanvas();
  const memo = createSerializationMemo(SKRIBE_SERIALIZABLE_PROPERTIES);
  const produce = (object) => object.toObject(SKRIBE_SERIALIZABLE_PROPERTIES);
  const first = memo.read(rect, () => produce(rect));
  assert.equal(memo.read(rect, () => produce(rect)), first);
  const selection = new fabric.ActiveSelection([rect, text], { canvas });
  assert.equal(isMemoizable(rect), false);
  assert.equal(isMemoizable(selection), false);
  assert.notEqual(memo.read(rect, () => produce(rect)), first);
  selection.removeAll();
  assert.equal(isMemoizable(rect), true);
});

test('an unchanged object is not serialized again, and a changed one is', () => {
  const { rect, text } = memoCanvas();
  const memo = createSerializationMemo(SKRIBE_SERIALIZABLE_PROPERTIES);
  let produced = 0;
  const read = (object) => memo.read(object, () => { produced += 1; return object.toObject(SKRIBE_SERIALIZABLE_PROPERTIES); });
  const before = read(rect);
  read(text);
  assert.equal(produced, 2);
  assert.equal(read(rect), before);
  read(text);
  assert.equal(produced, 2);
  rect.left += 1;
  assert.notEqual(read(rect), before);
  assert.equal(produced, 3);
});

test('objects with a clip path or a gradient are never memoized', () => {
  const clipped = new fabric.Rect({ width: 10, height: 10, clipPath: new fabric.Rect({ width: 5, height: 5 }) });
  const painted = new fabric.Rect({ width: 10, height: 10, fill: new fabric.Gradient({ type: 'linear', colorStops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] }) });
  assert.equal(isMemoizable(clipped), false);
  assert.equal(isMemoizable(painted), false);
  assert.equal(isMemoizable(new fabric.Rect({ width: 10, height: 10 })), true);
});

test('a value that cannot be read never breaks serialization and is simply serialized again', () => {
  const { rect } = memoCanvas();
  const memo = createSerializationMemo(['cyclic']);
  const cycle = {};
  cycle.self = cycle;
  rect.cyclic = cycle;
  let produced = 0;
  const read = () => memo.read(rect, () => { produced += 1; return { id: rect.id }; });
  read();
  read();
  assert.equal(produced, 2);
});

test('an image is serialized again when its source changes, even though its other values are the same', () => {
  let source = 'https://ik.imagekit.io/x/one.png';
  const image = { getSrc: () => source, left: 1, toObject() { return { left: this.left, src: source }; } };
  const memo = createSerializationMemo([]);
  let produced = 0;
  const read = () => memo.read(image, () => { produced += 1; return image.toObject(); });
  assert.equal(read().src, 'https://ik.imagekit.io/x/one.png');
  read();
  assert.equal(produced, 1);
  source = 'https://ik.imagekit.io/x/two.png';
  assert.equal(read().src, 'https://ik.imagekit.io/x/two.png');
  assert.equal(produced, 2);
});
