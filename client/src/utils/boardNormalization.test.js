import assert from 'node:assert/strict';
import test from 'node:test';
import * as fabric from 'fabric';
import { resolveElementLinks, serializeCanvasObject, isTimestampObject, longestIncreasingIndices } from './boardNormalization.js';
import { SKRIBE_SERIALIZABLE_PROPERTIES } from './fabricHydration.js';

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
  style: { setProperty() {}, removeProperty() {} },
  getContext: () => context,
  setAttribute() {},
  getAttribute() { return null; },
  hasAttribute() { return false; },
  removeAttribute() {},
  addEventListener() {},
  removeEventListener() {},
  appendChild() {},
  append() {},
  remove() {},
  insertBefore() {},
  removeChild() {},
  replaceChild() {},
  classList: { add() {}, remove() {} },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }),
  toDataURL: () => 'data:image/png;base64,AAAA',
  get ownerDocument() { return document; },
  parentNode: null
});

const document = { createElement, documentElement: { style: {}, scrollLeft: 0, scrollTop: 0 }, body: { scrollLeft: 0, scrollTop: 0 }, defaultView: null };
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

const note = (key, extra = {}) => ({ type: 'Rect', id: `shape_${key}`, elementId: key, isStickyNote: true, ...extra });
const text = (id, elementId, extra = {}) => ({ type: 'Textbox', id, elementId, ...extra });
const timestamp = (elementId, extra = {}) => ({ type: 'Text', id: `timestamp_${elementId}`, elementId, metadata: { role: 'timestamp' }, ...extra });

test('a note links to its label and never to its timestamp, whatever order the objects load in', () => {
  const board = [timestamp('n1'), note('n1', { attachedTextId: 'timestamp_n1' }), text('text_n1', 'n1', { parentShapeId: 'shape_n1' })];
  const orders = [board, [...board].reverse(), [board[1], board[0], board[2]]];
  const results = orders.map((objects) => Object.fromEntries(resolveElementLinks(objects)));
  results.forEach((result) => assert.deepEqual(result, results[0]));
  assert.equal(results[0].shape_n1.attachedTextId, 'text_n1');
  assert.equal(results[0].text_n1.parentShapeId, 'shape_n1');
  assert.equal(results[0].timestamp_n1.parentShapeId, 'shape_n1');
  assert.equal(isTimestampObject(board[0]), true);
});

test('valid stored links are kept, and a missing link prefers the text_<elementId> label', () => {
  const kept = resolveElementLinks([note('k', { attachedTextId: 'label_custom' }), text('label_custom', 'k'), text('text_k', 'k')]);
  assert.equal(kept.get('shape_k').attachedTextId, 'label_custom');
  const preferred = resolveElementLinks([note('p'), text('aaa_other', 'p'), text('text_p', 'p')]);
  assert.equal(preferred.get('shape_p').attachedTextId, 'text_p');
  const codeUnitOrder = resolveElementLinks([note('c'), text('label_a', 'c'), text('label_B', 'c')]);
  assert.equal(codeUnitOrder.get('shape_c').attachedTextId, 'label_B');
  const timestampOnly = resolveElementLinks([note('t', { attachedTextId: 'timestamp_t' }), timestamp('t')]);
  assert.equal(timestampOnly.get('shape_t'), undefined);
  assert.equal(resolveElementLinks([text('text_x', 'x')]).size, 0);
});

test('objects inside a multi-selection serialize in canvas coordinates and keep their selection layout', () => {
  const canvas = new fabric.Canvas(createElement(), { width: 1600, height: 900, renderOnAddRemove: false });
  const a = new fabric.Rect({ left: 100, top: 100, width: 80, height: 60 });
  const b = new fabric.Rect({ left: 400, top: 300, width: 80, height: 60 });
  Object.assign(a, { id: 'shape_a', elementId: 'a' });
  Object.assign(b, { id: 'shape_b', elementId: 'b' });
  canvas.add(a, b);
  const before = serializeCanvasObject(canvas, a, SKRIBE_SERIALIZABLE_PROPERTIES);

  const selection = new fabric.ActiveSelection([a, b], { canvas });
  canvas.setActiveObject(selection);
  selection.set({ left: selection.left + 50, top: selection.top + 20 });
  selection.setCoords();
  const relative = { left: a.left, top: a.top };
  const moved = serializeCanvasObject(canvas, a, SKRIBE_SERIALIZABLE_PROPERTIES);

  assert.equal(moved.id, 'shape_a');
  assert.equal(moved.elementId, 'a');
  assert.ok(Math.abs(moved.left - (before.left + 50)) < 1e-6, `left ${moved.left}`);
  assert.ok(Math.abs(moved.top - (before.top + 20)) < 1e-6, `top ${moved.top}`);
  assert.deepEqual({ left: a.left, top: a.top }, relative);
  assert.ok(Math.abs(a.toJSON().left - moved.left) > 1);
  assert.equal(a.group, selection);
  assert.equal(serializeCanvasObject(canvas, null, SKRIBE_SERIALIZABLE_PROPERTIES), null);
});

test('serialized snapshots do not share nested Skribe data with the live object', () => {
  const card = new fabric.Rect({ left: 10, top: 10, width: 120, height: 120 });
  Object.assign(card, { id: 'shape_k', elementId: 'k', isChecklistNote: true, checklistItems: [{ id: 'c1', checked: false, text: 'Ship' }], metadata: { tags: ['a'] } });
  const before = serializeCanvasObject(null, card, SKRIBE_SERIALIZABLE_PROPERTIES);
  card.checklistItems[0].checked = true;
  card.metadata.tags.push('b');
  const after = serializeCanvasObject(null, card, SKRIBE_SERIALIZABLE_PROPERTIES);
  assert.equal(before.checklistItems[0].checked, false);
  assert.deepEqual(before.metadata.tags, ['a']);
  assert.equal(after.checklistItems[0].checked, true);
  assert.notEqual(after.checklistItems, card.checklistItems);
});

test('only the objects outside the longest ordered run need to move', () => {
  assert.deepEqual([...longestIncreasingIndices([3, 0, 1, 2])].sort(), [1, 2, 3]);
  assert.deepEqual([...longestIncreasingIndices([0, 1, 2, 3])].sort(), [0, 1, 2, 3]);
  assert.equal(longestIncreasingIndices([4, 3, 2, 1, 0]).size, 1);
  assert.equal(longestIncreasingIndices([]).size, 0);
  assert.equal(longestIncreasingIndices([0, 5, 1, 2, 6, 3]).size, 4);
});
