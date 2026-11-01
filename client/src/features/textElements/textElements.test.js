import assert from 'node:assert/strict';
import test from 'node:test';
import * as fabric from 'fabric';
import { CODE_FONT_FAMILY, CODE_INDENT, TEXT_ELEMENT_KINDS, createTextElement, getTextKind, installTextElementRendering } from './textElements.js';
import { captureCanvasHistory, restoreCanvasHistory } from '../../utils/canvasHistory.js';
import { SKRIBE_SERIALIZABLE_PROPERTIES } from '../../utils/fabricHydration.js';
import { getRegisteredSectionsForObject } from '../../components/properties/PropertyRegistry.js';
import { TOOL_REGISTRY } from '../../components/config/ToolRegistry.js';

const context = new Proxy({}, {
  get: (target, key) => {
    if (key === 'measureText') {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(target.font || '')?.[1] || 16);
      return (text) => ({ width: String(text).length * size * 0.6, fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2 });
    }
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
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 })
});
const document = { createElement, documentElement: { style: {} }, defaultView: null };
const window = { devicePixelRatio: 1, document, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({}) };
document.defaultView = window;
fabric.setEnv({ document, window, isTouchSupported: false, WebGLProbe: { queryWebGL() {}, isSupported() { return false; } }, dispose() {}, copyPasteData: {} });
installTextElementRendering(fabric);

const KINDS = ['heading', 'body', 'code', 'label'];

const recordingContext = () => {
  const calls = [];
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get: (target, key) => (key in target ? target[key] : (...args) => calls.push([key, ...args])),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    }
  });
  return { ctx, calls };
};

test('each Text Option creates its own typed element with distinct defaults', () => {
  const elements = Object.fromEntries(KINDS.map((kind) => [kind, createTextElement(fabric, kind, { left: 100, top: 80 })]));
  assert.deepEqual(KINDS.map((kind) => getTextKind(elements[kind])), KINDS);
  assert.ok(elements.heading instanceof fabric.Textbox);
  assert.ok(elements.body instanceof fabric.Textbox);
  assert.ok(elements.code instanceof fabric.IText && !(elements.code instanceof fabric.Textbox));
  assert.ok(elements.label instanceof fabric.IText && !(elements.label instanceof fabric.Textbox));
  assert.ok(elements.heading.fontSize > elements.body.fontSize);
  assert.ok(elements.body.fontSize > elements.code.fontSize);
  assert.ok(elements.code.fontSize > elements.label.fontSize);
  assert.equal(elements.heading.fontWeight, '700');
  assert.equal(elements.body.fontWeight, '400');
  assert.ok(elements.body.lineHeight > elements.heading.lineHeight);
  assert.equal(elements.code.fontFamily, CODE_FONT_FAMILY);
  assert.equal(elements.label.text, elements.label.text.toUpperCase());
  assert.ok(elements.heading.width > elements.body.width);
  assert.ok(elements.label.width < elements.body.width);
  assert.equal(elements.heading.backgroundColor, '');
  assert.equal(elements.body.backgroundColor, '');
  assert.ok(elements.code.backgroundColor && elements.code.padding > elements.label.padding);
  assert.ok(elements.label.backgroundColor && elements.label.padding > 0);
  assert.equal(elements.code.left, 100);
  assert.equal(elements.code.top, 80);
});

test('heading and body take the active colour while containers keep their readable text colour', () => {
  assert.equal(createTextElement(fabric, 'heading', { fill: '#dc2626' }).fill, '#dc2626');
  assert.equal(createTextElement(fabric, 'body', { fill: '#dc2626' }).fill, '#dc2626');
  assert.equal(createTextElement(fabric, 'code', { fill: '#dc2626' }).fill, TEXT_ELEMENT_KINDS.code.style.fill);
  assert.equal(createTextElement(fabric, 'label', { fill: '#dc2626' }).fill, TEXT_ELEMENT_KINDS.label.style.fill);
  assert.equal(createTextElement(fabric, 'paragraph'), null);
});

test('body text wraps to its width and keeps explicit line breaks', () => {
  const body = createTextElement(fabric, 'body');
  body.set({ text: 'First paragraph runs long enough to wrap onto more lines.\n\nSecond paragraph.' });
  body.initDimensions();
  assert.equal(body.width, TEXT_ELEMENT_KINDS.body.style.width);
  assert.ok(body.textLines.length > 3);
  assert.ok(body.textLines.includes(''));
});

test('code keeps indentation, repeated spaces and long lines without wrapping', () => {
  const source = 'if (ready) {\n    run(  a,   b );\n\treturn veryLongFunctionName(argumentNumberOne, argumentNumberTwo, argumentNumberThree);\n}';
  const code = createTextElement(fabric, 'code');
  code.set({ text: source });
  code.initDimensions();
  assert.equal(code.text, source);
  assert.equal(code.textLines.length, 4);
  assert.equal(code.textLines[1], '    run(  a,   b );');
  assert.ok(code.width > 600);
});

test('small label sizes itself to its content', () => {
  const label = createTextElement(fabric, 'label');
  const shortWidth = label.width;
  label.set({ text: 'IN REVIEW' });
  label.initDimensions();
  assert.ok(label.width > shortWidth);
  assert.equal(label.textLines.length, 1);
});

test('Tab inserts an indent in code blocks and is left to Fabric elsewhere', () => {
  const code = createTextElement(fabric, 'code');
  const calls = [];
  const area = {
    selectionStart: 3,
    selectionEnd: 5,
    setRangeText: (...args) => calls.push(['setRangeText', ...args]),
    dispatchEvent: (event) => calls.push(['dispatch', event.type])
  };
  Object.assign(code, { isEditing: true, hiddenTextarea: area });
  const event = { key: 'Tab', keyCode: 9, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
  code.onKeyDown(event);
  assert.equal(event.prevented, true);
  assert.deepEqual(calls, [['setRangeText', CODE_INDENT, 3, 5, 'end'], ['dispatch', 'input']]);

  calls.length = 0;
  code.onKeyDown({ ...event, shiftKey: true, preventDefault() {}, stopImmediatePropagation() {} });
  assert.deepEqual(calls, []);

  const body = createTextElement(fabric, 'label');
  Object.assign(body, { isEditing: false, hiddenTextarea: area });
  body.onKeyDown({ ...event, preventDefault() { throw new Error('label must not take Tab'); } });
  assert.deepEqual(calls, []);
});

test('code and label draw a padded rounded container uncached; legacy text renders as before', () => {
  for (const kind of ['code', 'label']) {
    const element = createTextElement(fabric, kind);
    const { ctx, calls } = recordingContext();
    element._renderBackground(ctx);
    const rect = calls.find(([name]) => name === 'roundRect');
    assert.ok(rect, kind);
    assert.equal(rect[3], element.width + element.padding * 2);
    assert.equal(rect[5], TEXT_ELEMENT_KINDS[kind].radius);
    assert.equal(element.shouldCache(), false);
  }

  const legacy = new fabric.Textbox('Legacy', { width: 200, backgroundColor: '#ffeeaa' });
  const { ctx, calls } = recordingContext();
  legacy._renderBackground(ctx);
  assert.deepEqual(calls.map(([name]) => name), ['fillRect']);
  assert.equal(getTextKind(legacy), null);
  assert.equal(getTextKind({ metadata: { textKind: 'toString' } }), null);
  assert.equal(legacy.shouldCache(), true);
  assert.equal(createTextElement(fabric, 'heading').shouldCache(), true);
});

test('all four types survive save, reload and undo with their content and container', async () => {
  const canvas = new fabric.StaticCanvas(undefined, { width: 1600, height: 900, renderOnAddRemove: false });
  const elements = KINDS.map((kind, index) => {
    const element = createTextElement(fabric, kind, { left: 200 + index * 300, top: 200 });
    element.id = `text_${kind}`;
    return element;
  });
  elements[2].set({ text: 'def main():\n    print("  spaced  ")\n' });
  const legacy = new fabric.Textbox('Old note', { left: 50, top: 600, width: 200, fontSize: 22, fontWeight: 'bold', fontFamily: 'Quicksand' });
  legacy.id = 'text_legacy';
  canvas.add(...elements, legacy);

  const saved = captureCanvasHistory(canvas);
  const persisted = JSON.parse(saved).objects;
  assert.deepEqual(persisted.map((object) => object.metadata?.textKind ?? null), [...KINDS, null]);
  assert.deepEqual(persisted.map((object) => object.type), ['Textbox', 'Textbox', 'IText', 'IText', 'Textbox']);

  const restored = new fabric.StaticCanvas(undefined, { width: 1600, height: 900, renderOnAddRemove: false });
  await restoreCanvasHistory(restored, saved);
  const objects = restored.getObjects();
  assert.deepEqual(objects.map(getTextKind), [...KINDS, null]);
  assert.equal(objects[2].text, 'def main():\n    print("  spaced  ")\n');
  assert.equal(objects[2].backgroundColor, TEXT_ELEMENT_KINDS.code.style.backgroundColor);
  assert.equal(objects[2].padding, TEXT_ELEMENT_KINDS.code.style.padding);
  assert.equal(objects[3].padding, TEXT_ELEMENT_KINDS.label.style.padding);
  assert.equal(objects[4].fontFamily, 'Quicksand');
  assert.equal(objects[4].fontWeight, 'bold');
  assert.equal(objects[4].metadata, undefined);
  assert.equal(JSON.stringify(objects[4].toObject([...SKRIBE_SERIALIZABLE_PROPERTIES])), JSON.stringify(persisted[4]));
});

test('the Text Options menu maps each entry to its own kind with a subtitle', () => {
  const items = TOOL_REGISTRY.text.items;
  assert.deepEqual(items.map((item) => item.textKind), KINDS);
  assert.equal(new Set(items.map((item) => item.icon)).size, 4);
  assert.ok(items.every((item) => item.toolType === 'text' && item.description));
});

test('the properties toolbar exposes controls that fit each kind and keeps legacy text unchanged', () => {
  const typography = (props) => getRegisteredSectionsForObject({ hasSelection: true, hasText: true, ...props }).find((section) => section.id === 'typography');
  const legacy = typography({ type: 'textbox' });
  assert.equal(legacy.hasFontFamily, true);
  assert.equal(legacy.hasBold, true);
  assert.equal(legacy.fontSizes, undefined);

  const heading = typography({ type: 'textbox', textKind: 'heading' });
  assert.ok(heading.fontSizes.includes(40) && heading.fontWeights.length > 1 && heading.hasTextAlign);
  assert.ok(!heading.hasBackground && !heading.hasLineHeight);

  const body = typography({ type: 'textbox', textKind: 'body' });
  assert.ok(body.hasLineHeight && body.fontSizes.includes(18) && body.hasTextAlign);
  assert.ok(!body.hasBackground && !body.fontWeights);

  const code = typography({ type: 'i-text', textKind: 'code' });
  assert.ok(code.hasBackground && code.fontSizes.includes(14));
  assert.ok(!code.hasFontFamily && !code.hasTextAlign && !code.fontWeights && !code.hasBold);

  const label = typography({ type: 'i-text', textKind: 'label' });
  assert.ok(label.hasBackground && label.fontWeights.length > 1 && label.hasTextAlign && label.hasTextColor);
  assert.ok(!label.hasFontSize && !label.hasFontFamily);
});
