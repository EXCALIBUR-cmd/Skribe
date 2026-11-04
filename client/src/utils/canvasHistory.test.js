import assert from 'node:assert/strict';
import test from 'node:test';
import * as fabric from 'fabric';
import { applyHistoryEntry, conflictHistoryState, createHistoryEntry, rebaseHistoryState, serializeHistoryState, restoreHistoryIncrementally, captureCanvasHistory, diffCanvasHistory, loadCanvasTolerant, mergeRetainedObjects, restoreCanvasHistory, retainUnrestorable } from './canvasHistory.js';
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

const undoBoard = () => {
  const canvas = new fabric.StaticCanvas(null, { width: 800, height: 600 });
  const shape = new fabric.Rect({ id: 'u_shape', elementId: 'u_el', left: 10, top: 10, width: 100, height: 60, fill: '#fff', attachedTextId: 'u_text', metadata: { role: 'shape', note: 'a' } });
  const label = new fabric.Textbox('label', { id: 'u_text', elementId: 'u_el', parentShapeId: 'u_shape', left: 20, top: 20, width: 80, fontWeight: 'bold', metadata: { role: 'text' } });
  const other = new fabric.Circle({ id: 'u_circle', left: 200, top: 10, radius: 20, fill: '#abc' });
  const connector = new fabric.Path('M 0 0 L 50 50', { id: 'u_conn', isConnector: true, connectorType: 'straight', endArrow: true, sourceShapeId: 'u_shape', targetShapeId: 'u_circle', left: 120, top: 30, fill: '' });
  const group = new fabric.Group([new fabric.Rect({ width: 20, height: 20, fill: '#123' }), new fabric.Rect({ left: 25, width: 20, height: 20, fill: '#321' })], { id: 'u_group', left: 300, top: 100 });
  const line = new fabric.Line([0, 0, 40, 40], { id: 'u_line', left: 400, top: 10, stroke: '#000' });
  const filler = Array.from({ length: 12 }, (_, index) => new fabric.Rect({ id: `u_fill_${index}`, left: index * 30, top: 300, width: 20, height: 20, fill: '#eee' }));
  canvas.add(shape, label, other, connector, group, line, ...filler);
  return { canvas, shape, label, other, connector, group, line, memo: createSerializationMemo(SKRIBE_SERIALIZABLE_PROPERTIES) };
};

const assertRestored = (canvas, memo, snapshot, label) => {
  const wanted = JSON.parse(snapshot);
  assert.deepEqual(JSON.parse(captureCanvasHistory(canvas, memo)), wanted, `${label}: cached capture`);
  assert.deepEqual(JSON.parse(captureCanvasHistory(canvas)), wanted, `${label}: fresh capture`);
};

const historyCases = [
  ['one property', ({ shape }) => { shape.set({ left: 99 }); }, ['u_shape']],
  ['several objects together', ({ shape, label, other }) => { shape.set({ left: 50 }); label.set({ left: 55 }); other.set({ top: 77 }); }, ['u_shape', 'u_text', 'u_circle']],
  ['text and formatting', ({ label }) => { label.set({ text: 'changed', fontWeight: 'normal', fill: '#f00' }); }, ['u_text']],
  ['connector endpoints', ({ connector }) => { connector.sourceShapeId = 'u_circle'; connector.set({ stroke: '#f00' }); }, ['u_conn']],
  ['group child', ({ group }) => { group.item(0).set({ fill: '#999' }); }, ['u_group']],
  ['metadata in place', ({ shape }) => { shape.metadata.note = 'b'; }, ['u_shape']]
];

historyCases.forEach(([name, change, changed]) => {
  test(`undo and redo restore exactly and rebuild only what changed: ${name}`, async () => {
    const board = undoBoard();
    const { canvas, memo } = board;
    const before = captureCanvasHistory(canvas, memo);
    change(board);
    const after = captureCanvasHistory(canvas, memo);
    const untouched = canvas.getObjects().filter((object) => !changed.includes(object.id));
    const undone = await restoreHistoryIncrementally(canvas, before, memo);
    assert.deepEqual(undone.diff.modified.sort(), [...changed].sort());
    assert.equal(undone.fresh.length, changed.length);
    assertRestored(canvas, memo, before, 'undo');
    untouched.forEach((object) => assert.ok(canvas.getObjects().includes(object), object.id));
    const redone = await restoreHistoryIncrementally(canvas, after, memo);
    assert.equal(redone.fresh.length, changed.length);
    assertRestored(canvas, memo, after, 'redo');
    untouched.forEach((object) => assert.ok(canvas.getObjects().includes(object), object.id));
    canvas.getObjects().forEach((object) => assert.equal(object.canvas, canvas));
  });
});

test('undo restores a deleted object at its old layer and redo removes it again, with no duplicates', async () => {
  const { canvas, memo, other } = undoBoard();
  const before = captureCanvasHistory(canvas, memo);
  const position = canvas.getObjects().indexOf(other);
  canvas.remove(other);
  const after = captureCanvasHistory(canvas, memo);
  const undone = await restoreHistoryIncrementally(canvas, before, memo);
  assert.deepEqual(undone.diff.added, ['u_circle']);
  assert.equal(canvas.getObjects()[position].id, 'u_circle');
  assertRestored(canvas, memo, before, 'undo');
  const redone = await restoreHistoryIncrementally(canvas, after, memo);
  assert.deepEqual(redone.diff.removed, ['u_circle']);
  assert.equal(redone.fresh.length, 0);
  assertRestored(canvas, memo, after, 'redo');
  assert.equal(new Set(canvas.getObjects().map((object) => object.id)).size, canvas.getObjects().length);
});

test('undo removes a created object and redo brings it back', async () => {
  const { canvas, memo } = undoBoard();
  const before = captureCanvasHistory(canvas, memo);
  const created = new fabric.Textbox('new', { id: 'u_new', left: 5, top: 500, width: 90, metadata: { source: 'ai-diagram' } });
  canvas.add(created);
  const after = captureCanvasHistory(canvas, memo);
  await restoreHistoryIncrementally(canvas, before, memo);
  assert.equal(created.canvas, undefined);
  assertRestored(canvas, memo, before, 'undo');
  const redone = await restoreHistoryIncrementally(canvas, after, memo);
  assert.deepEqual(redone.diff.added, ['u_new']);
  assert.deepEqual(canvas.getObjects().at(-1).metadata, { source: 'ai-diagram' });
  assertRestored(canvas, memo, after, 'redo');
});

test('a layer-order change rebuilds nothing and keeps every instance', async () => {
  const { canvas, memo, shape } = undoBoard();
  const before = captureCanvasHistory(canvas, memo);
  const instances = new Set(canvas.getObjects());
  canvas.bringObjectToFront(shape);
  const after = captureCanvasHistory(canvas, memo);
  const undone = await restoreHistoryIncrementally(canvas, before, memo);
  assert.equal(undone.fresh.length, 0);
  assertRestored(canvas, memo, before, 'undo');
  const redone = await restoreHistoryIncrementally(canvas, after, memo);
  assert.equal(redone.fresh.length, 0);
  assert.equal(canvas.getObjects().at(-1), shape);
  canvas.getObjects().forEach((object) => assert.ok(instances.has(object)));
});

test('several undos then several redos walk the history exactly', async () => {
  const { canvas, memo, shape, label, other } = undoBoard();
  const states = [captureCanvasHistory(canvas, memo)];
  [() => shape.set({ left: 61 }), () => label.set({ text: 'second' }), () => canvas.remove(other)].forEach((change) => {
    change();
    states.push(captureCanvasHistory(canvas, memo));
  });
  for (const index of [2, 1, 0, 1, 2, 3]) {
    await restoreHistoryIncrementally(canvas, states[index], memo);
    assertRestored(canvas, memo, states[index], `state ${index}`);
  }
});

test('a full restore is used when an incremental one cannot be proven safe, and the result is the same', async () => {
  const cases = [
    ['most of the board changed', ({ canvas }) => canvas.getObjects().forEach((object) => object.set({ top: object.top + 1 }))],
    ['duplicate ids', ({ other, shape }) => { other.id = shape.id; }],
    ['object without an id', ({ other }) => { other.id = undefined; }],
    ['canvas background changed', ({ canvas }) => { canvas.backgroundColor = '#123456'; }],
    ['temporary object on the canvas', ({ canvas }) => { canvas.add(new fabric.Rect({ id: 'u_temp', width: 5, height: 5, excludeFromExport: true })); }]
  ];
  for (const [name, change] of cases) {
    const board = undoBoard();
    const { canvas, memo } = board;
    const before = captureCanvasHistory(canvas, memo);
    change(board);
    const result = await restoreHistoryIncrementally(canvas, before, memo);
    assert.equal(result.fresh, null, name);
    assert.equal(result.diff, null, name);
    assert.equal(canvas.getObjects().length, JSON.parse(before).objects.length, name);
    assertRestored(canvas, memo, before, name);
  }
});

test('a board that changed while objects were being rebuilt falls back to a full restore', async () => {
  const { canvas, memo, shape, other } = undoBoard();
  const before = captureCanvasHistory(canvas, memo);
  shape.set({ left: 71 });
  const pending = restoreHistoryIncrementally(canvas, before, memo);
  canvas.remove(other);
  const result = await pending;
  assert.equal(result.fresh, null);
  assertRestored(canvas, memo, before, 'after race');
});

test('an object that cannot be rebuilt falls back to the tolerant full restore', async () => {
  const { canvas, memo } = undoBoard();
  const target = JSON.parse(captureCanvasHistory(canvas, memo));
  target.objects[2] = { ...target.objects[2], type: 'NoSuchFabricType' };
  const result = await restoreHistoryIncrementally(canvas, JSON.stringify(target), memo);
  assert.equal(result.fresh, null);
  assert.equal(canvas.getObjects().some((object) => object.id === 'u_circle'), false);
  assert.ok(canvas.skribeRetainedObjects.some((entry) => entry.data.id === 'u_circle'));
});

test('a restored object is not served stale from the cache on the next edit', async () => {
  const { canvas, memo, shape } = undoBoard();
  const before = captureCanvasHistory(canvas, memo);
  shape.set({ left: 81 });
  await restoreHistoryIncrementally(canvas, before, memo);
  const restored = canvas.getObjects().find((object) => object.id === 'u_shape');
  assert.notEqual(restored, shape);
  restored.set({ left: 82 });
  assert.equal(JSON.parse(captureCanvasHistory(canvas, memo)).objects.find((object) => object.id === 'u_shape').left, 82);
  assertRestored(canvas, memo, captureCanvasHistory(canvas), 'edit after restore');
});

const historyState = (objects, head = '"version":"7"') => ({
  head,
  keys: objects.map((object) => `${object.id}#0`),
  strings: objects.map((object) => JSON.stringify(object))
});
const shapeA = { id: 'a', left: 10, top: 10, fill: 'red' };
const shapeB = { id: 'b', left: 50, top: 50, fill: 'blue' };
const shapeC = { id: 'c', left: 90, top: 90, fill: 'green' };
const objectsOf = (state) => JSON.parse(serializeHistoryState(state)).objects;
const byId = (snapshot, id) => objectsOf(snapshot).find((object) => object.id === id);

test('undo reverses a local edit and keeps an independent remote edit, and redo reapplies it', () => {
  const start = historyState([shapeA, shapeB]);
  const edited = historyState([{ ...shapeA, left: 200 }, shapeB]);
  const entry = createHistoryEntry(start, edited);
  const live = historyState([{ ...shapeA, left: 200 }, { ...shapeB, top: 500 }]);
  const undone = applyHistoryEntry(live, entry, 'undo');
  assert.equal(byId(undone, 'a').left, 10);
  assert.equal(byId(undone, 'b').top, 500);
  const redone = applyHistoryEntry(historyState(objectsOf(undone)), entry, 'redo');
  assert.equal(byId(redone, 'a').left, 200);
  assert.equal(byId(redone, 'b').top, 500);
});

test('a remote change is never part of the next local history entry', () => {
  const start = historyState([shapeA, shapeB]);
  const afterRemote = historyState([shapeA, { ...shapeB, top: 500 }]);
  const base = rebaseHistoryState(start, start, afterRemote);
  assert.equal(createHistoryEntry(base, afterRemote), null);
  const entry = createHistoryEntry(base, historyState([{ ...shapeA, left: 1 }, { ...shapeB, top: 500 }]));
  assert.deepEqual(entry.changes.map((change) => change.key), ['a#0']);
});

test('a remote change applied during a local gesture leaves the gesture in history', () => {
  const base = historyState([shapeA, shapeB]);
  const before = historyState([{ ...shapeA, left: 77 }, shapeB]);
  const after = historyState([{ ...shapeA, left: 77 }, { ...shapeB, top: 500 }]);
  const entry = createHistoryEntry(rebaseHistoryState(base, before, after), after);
  assert.deepEqual(entry.changes.map((change) => change.key), ['a#0']);
});

test('remote previews are absorbed and do not hide a local layer change', () => {
  const base = historyState([shapeA, shapeB]);
  const current = historyState([{ ...shapeB, left: 5 }, shapeA]);
  const entry = createHistoryEntry(rebaseHistoryState(base, current, current, new Set(['b#0'])), current);
  assert.deepEqual(entry.changes, []);
  assert.deepEqual(entry.order.before, ['a#0', 'b#0']);
});

test('a same-field conflict keeps the newer remote value and a different field still merges', () => {
  const entry = createHistoryEntry(historyState([shapeA]), historyState([{ ...shapeA, left: 200 }]));
  assert.equal(applyHistoryEntry(historyState([{ ...shapeA, left: 999 }]), entry, 'undo'), null);
  const merged = applyHistoryEntry(historyState([{ ...shapeA, left: 200, fill: 'pink' }]), entry, 'undo');
  assert.deepEqual([byId(merged, 'a').left, byId(merged, 'a').fill], [10, 'pink']);
  assert.equal(applyHistoryEntry(historyState([{ ...shapeA, left: 999 }]), entry, 'redo'), null);
});

test('a blocked undo stays blocked on redo, so the remote value survives both', () => {
  const entry = createHistoryEntry(historyState([shapeA]), historyState([{ ...shapeA, left: 200, top: 300 }]));
  const live = historyState([{ ...shapeA, left: 200, top: 622 }]);
  assert.equal(applyHistoryEntry(live, entry, 'undo'), null);
  assert.equal(applyHistoryEntry(live, entry, 'redo'), null);
});

test('undoing a local create removes it, but a remotely edited create is kept', () => {
  const entry = createHistoryEntry(historyState([shapeA]), historyState([shapeA, shapeB]));
  const undone = applyHistoryEntry(historyState([{ ...shapeA, left: 3 }, shapeB]), entry, 'undo');
  assert.deepEqual(objectsOf(undone).map((object) => object.id), ['a']);
  assert.equal(byId(undone, 'a').left, 3);
  assert.equal(applyHistoryEntry(historyState([shapeA, { ...shapeB, top: 1 }]), entry, 'undo'), null);
});

test('undoing a local delete restores the object in place between remote changes', () => {
  const entry = createHistoryEntry(historyState([shapeA, shapeB, shapeC]), historyState([shapeA, shapeC]));
  const undone = applyHistoryEntry(historyState([shapeA, { id: 'n', left: 1 }, { ...shapeC, top: 7 }]), entry, 'undo');
  const ids = objectsOf(undone).map((object) => object.id);
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c', 'n']);
  assert.ok(ids.indexOf('a') < ids.indexOf('b') && ids.indexOf('b') < ids.indexOf('c'));
  assert.equal(byId(undone, 'c').top, 7);
  const redone = applyHistoryEntry(historyState(objectsOf(undone)), entry, 'redo');
  assert.deepEqual(objectsOf(redone).map((object) => object.id), ['a', 'n', 'c']);
});

test('an object a collaborator deleted is not brought back by undo', () => {
  const entry = createHistoryEntry(historyState([shapeA, shapeB]), historyState([{ ...shapeA, left: 200 }, shapeB]));
  assert.equal(applyHistoryEntry(historyState([shapeB]), entry, 'undo'), null);
});

test('linked objects move together: a conflict on one member blocks the whole linked set', () => {
  const shape = { id: 's', left: 0, top: 0, attachedTextId: 't' };
  const text = { id: 't', left: 0, top: 0, parentShapeId: 's' };
  const connector = { id: 'k', left: 0, top: 0, sourceShapeId: 's', targetShapeId: 'x' };
  const other = { id: 'o', left: 0, top: 0 };
  const moved = (object) => ({ ...object, left: 100 });
  const entry = createHistoryEntry(historyState([shape, text, connector, other]), historyState([shape, text, connector, other].map(moved)));
  const undone = applyHistoryEntry(historyState([moved(shape), { ...moved(text), left: 555 }, moved(connector), moved(other)]), entry, 'undo');
  assert.equal(byId(undone, 's').left, 100);
  assert.equal(byId(undone, 't').left, 555);
  assert.equal(byId(undone, 'k').left, 100);
  assert.equal(byId(undone, 'o').left, 0);
});

test('a remote edit to a label does not block undoing the move of its shape', () => {
  const shape = { id: 's', left: 0, attachedTextId: 't' };
  const text = { id: 't', left: 0, parentShapeId: 's', text: 'old' };
  const entry = createHistoryEntry(historyState([shape, text]), historyState([{ ...shape, left: 100 }, { ...text, left: 100 }]));
  const undone = applyHistoryEntry(historyState([{ ...shape, left: 100 }, { ...text, left: 100, text: 'new' }]), entry, 'undo');
  assert.deepEqual([byId(undone, 's').left, byId(undone, 't').left, byId(undone, 't').text], [0, 0, 'new']);
});

test('a linked object is not restored when the shape it needs was removed by a collaborator', () => {
  const connector = { id: 'k', sourceShapeId: 's', targetShapeId: 'o' };
  const shape = { id: 's' };
  const other = { id: 'o' };
  const entry = createHistoryEntry(historyState([shape, other, connector]), historyState([shape, other]));
  assert.equal(applyHistoryEntry(historyState([other]), entry, 'undo'), null);
  assert.deepEqual(objectsOf(applyHistoryEntry(historyState([shape, other]), entry, 'undo')).map((object) => object.id), ['s', 'o', 'k']);
});

test('layer order reverses without losing remote additions, and a remote reorder is not overwritten', () => {
  const entry = createHistoryEntry(historyState([shapeA, shapeB, shapeC]), historyState([shapeC, shapeA, shapeB]));
  const ids = objectsOf(applyHistoryEntry(historyState([shapeC, { id: 'n' }, shapeA, shapeB]), entry, 'undo')).map((object) => object.id);
  assert.deepEqual(ids.filter((id) => id !== 'n'), ['a', 'b', 'c']);
  assert.ok(ids.includes('n'));
  assert.equal(applyHistoryEntry(historyState([shapeB, shapeC, shapeA]), entry, 'undo'), null);
});

test('a canvas-level change reverses only when no collaborator changed it since', () => {
  const entry = createHistoryEntry(historyState([shapeA], '"background":"a"'), historyState([shapeA], '"background":"b"'));
  assert.equal(JSON.parse(serializeHistoryState(applyHistoryEntry(historyState([shapeA], '"background":"b"'), entry, 'undo'))).background, 'a');
  assert.equal(applyHistoryEntry(historyState([shapeA], '"background":"z"'), entry, 'undo'), null);
});

test('objects with duplicate ids stay separate in history entries', () => {
  const state = (first, second) => ({ head: '', keys: ['d#0', 'd#1'], strings: [JSON.stringify({ id: 'd', left: first }), JSON.stringify({ id: 'd', left: second })] });
  const entry = createHistoryEntry(state(1, 2), state(1, 9));
  assert.deepEqual(entry.changes.map((change) => change.key), ['d#1']);
  assert.deepEqual(objectsOf(applyHistoryEntry(state(1, 9), entry, 'undo')).map((object) => object.left), [1, 2]);
});

test('an edit conflict undo restores the collaborator version only for conflicted objects', () => {
  const mine = { ...shapeA, left: 1 };
  const other = { ...shapeB };
  const current = historyState([mine, other]);
  const entry = createHistoryEntry(conflictHistoryState([{ ...shapeA, left: 2 }, other], [mine, other], current), current);
  assert.deepEqual(entry.changes.map((change) => change.key), ['a#0']);
  assert.equal(byId(applyHistoryEntry(current, entry, 'undo'), 'a').left, 2);
});

test('serialized history state is a valid snapshot', () => {
  assert.deepEqual(JSON.parse(serializeHistoryState(historyState([shapeA]))), { version: '7', objects: [shapeA] });
});

test('undoing a create a collaborator already removed still reverses the rest of the action', () => {
  const label = { ...shapeC, parentShapeId: 'b' };
  const entry = createHistoryEntry(historyState([shapeB]), historyState([{ ...shapeB, left: 1 }, label]));
  const undone = applyHistoryEntry(historyState([{ ...shapeB, left: 1 }]), entry, 'undo');
  assert.equal(byId(undone, 'b').left, 50);
  assert.equal(byId(undone, 'c'), undefined);
});

test('undo removes a field the action added while keeping a remote edit to another field', () => {
  const entry = createHistoryEntry(historyState([shapeA]), historyState([{ ...shapeA, tag: 'mine' }]));
  const undone = applyHistoryEntry(historyState([{ ...shapeA, tag: 'mine', top: 500 }]), entry, 'undo');
  assert.equal('tag' in byId(undone, 'a'), false);
  assert.equal(byId(undone, 'a').top, 500);
});

test('a remote layer reorder is absorbed into the history base and stays out of the next entry', () => {
  const start = historyState([shapeA, shapeB]);
  const reordered = historyState([shapeB, shapeA]);
  const base = rebaseHistoryState(start, start, reordered);
  assert.deepEqual(base.keys, ['b#0', 'a#0']);
  assert.equal(createHistoryEntry(base, reordered), null);
});
