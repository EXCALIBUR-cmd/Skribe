import assert from 'node:assert/strict';
import test from 'node:test';
import * as fabric from 'fabric';
import { adaptColor, applyCanvasTheme, contrastRatio, installThemeRendering, isDarkSurface, parseColor } from './canvasTheme.js';
import { CANVAS_BACKGROUNDS, resolveAppearance, resolveCanvasBackground, normalizePreferences, DEFAULT_PREFERENCES } from './preferenceOptions.js';
import { APPEARANCES, CANVAS_BACKGROUNDS as SERVER_BACKGROUNDS, LANDING_PAGES, LANGUAGES } from '../../../../server/src/constants/preferences.js';
import { APPEARANCE_OPTIONS, LANDING_OPTIONS, LANGUAGE_OPTIONS } from './preferenceOptions.js';

const drawn = [];
const context = new Proxy({}, {
  get: (target, key) => {
    if (key === 'measureText') return (text) => ({ width: String(text).length * 8, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3 });
    if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (key === 'canvas') return createElement();
    if (key in target) return target[key];
    return () => {};
  },
  set: (target, key, value) => {
    if ((key === 'fillStyle' || key === 'strokeStyle') && typeof value === 'string') drawn.push(value.toLowerCase());
    target[key] = value;
    return true;
  }
});
const createElement = () => ({
  width: 1600, height: 900, style: { setProperty() {}, removeProperty() {} }, getContext: () => context,
  setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; }, removeAttribute() {},
  addEventListener() {}, removeEventListener() {}, appendChild() {}, append() {}, remove() {}, insertBefore() {},
  removeChild() {}, replaceChild() {}, classList: { add() {}, remove() {} },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }), toDataURL: () => 'data:image/png;base64,AAAA',
  get ownerDocument() { return document; }, parentNode: null
});
const document = { createElement, documentElement: { style: {}, scrollLeft: 0, scrollTop: 0 }, body: { scrollLeft: 0, scrollTop: 0 }, defaultView: null };
const window = { devicePixelRatio: 1, document, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({}), requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: (h) => clearTimeout(h) };
document.defaultView = window;
fabric.setEnv({ document, window, isTouchSupported: false, WebGLProbe: { queryWebGL() {}, isSupported() { return false; } }, dispose() {}, copyPasteData: {} });
installThemeRendering(fabric.FabricObject);

const DARK = resolveCanvasBackground('default', 'dark');
const LIGHT = resolveCanvasBackground('default', 'light');

const buildBoard = () => {
  const canvas = new fabric.Canvas(createElement(), { width: 1600, height: 900, renderOnAddRemove: false });
  const objects = {
    ink: new fabric.Path('M 0 0 L 10 10', { id: 'ink', stroke: '#000000', fill: '', strokeWidth: 3, objectCaching: false }),
    looseText: new fabric.Textbox('Loose', { id: 'loose', fill: '#1e293b', left: 10, top: 10, objectCaching: false }),
    sticky: new fabric.Rect({ id: 'sticky', fill: '#fff3a0', stroke: '#e5c100', width: 120, height: 120, isStickyNote: true, objectCaching: false }),
    stickyText: new fabric.Textbox('Note', { id: 'sticky_text', fill: '#1e293b', parentShapeId: 'sticky', objectCaching: false }),
    outline: new fabric.Rect({ id: 'outline', fill: 'transparent', stroke: '#1e293b', width: 80, height: 40, objectCaching: false }),
    outlineText: new fabric.Textbox('Label', { id: 'outline_text', fill: '#000000', parentShapeId: 'outline', objectCaching: false }),
    card: new fabric.Rect({ id: 'card', fill: '#ffffff', stroke: '#cbd5e1', width: 80, height: 40, objectCaching: false }),
    red: new fabric.Rect({ id: 'red', fill: '#ef4444', stroke: '#b91c1c', width: 30, height: 30, objectCaching: false })
  };
  Object.values(objects).forEach((object) => canvas.add(object));
  return { canvas, objects };
};

const snapshot = (canvas) => JSON.stringify(canvas.getObjects().map((o) => o.toObject(['id', 'parentShapeId', 'isStickyNote'])));

test('only near-grey colours with poor contrast on a dark surface change, and they gain contrast', () => {
  assert.notEqual(adaptColor('#000000', DARK), '#000000');
  assert.ok(contrastRatio(parseColor(adaptColor('#1e293b', DARK)), parseColor(DARK)) >= 3);
  assert.equal(adaptColor('#fff3a0', DARK), '#fff3a0');
  assert.equal(adaptColor('#ef4444', DARK), '#ef4444');
  assert.equal(adaptColor('#ffffff', DARK), '#ffffff');
  assert.equal(adaptColor('transparent', DARK), 'transparent');
  assert.equal(adaptColor('rgba(0, 0, 0, 0)', DARK), 'rgba(0, 0, 0, 0)');
  assert.match(adaptColor('rgba(0, 0, 0, 0.5)', DARK), /^rgba\(\d+, \d+, \d+, 0\.5\)$/);
});

test('every dark palette background counts as a dark surface and every light one does not', () => {
  for (const background of CANVAS_BACKGROUNDS) {
    const expectDark = ['graphite', 'slate', 'midnight', 'espresso'].includes(background.key);
    assert.equal(isDarkSurface(background.light), expectDark, background.key);
  }
  assert.equal(isDarkSurface(DARK), true);
  assert.equal(isDarkSurface(LIGHT), false);
});

test('dark rendering adapts ink, loose text and outlines but keeps sticky notes, coloured shapes and text on light containers', () => {
  const { canvas } = buildBoard();
  applyCanvasTheme(canvas, DARK);
  drawn.length = 0;
  canvas.renderAll();
  const painted = new Set(drawn);
  assert.ok(painted.has(adaptColor('#000000', DARK)), 'freehand ink is lightened');
  assert.ok(painted.has(adaptColor('#1e293b', DARK)), 'loose text and outline strokes are lightened');
  assert.ok(painted.has('#fff3a0'), 'sticky note fill is preserved');
  assert.ok(painted.has('#1e293b'), 'text on the sticky note keeps its dark colour');
  assert.ok(painted.has('#ef4444') && painted.has('#b91c1c'), 'coloured shapes are preserved');
  assert.ok(painted.has('#ffffff'), 'white card keeps its fill');
});

test('text on pattern-filled sticky notes is judged against the note colour, not the canvas', () => {
  const canvas = new fabric.Canvas(createElement(), { width: 400, height: 400, renderOnAddRemove: false });
  const patternFill = () => new fabric.Gradient({ type: 'linear', coords: { x1: 0, y1: 0, x2: 0, y2: 10 }, colorStops: [{ offset: 0, color: '#fce7f3' }, { offset: 1, color: '#fce7f3' }] });
  const pink = new fabric.Rect({ id: 'pink', fill: patternFill(), noteColor: '#fce7f3', width: 100, height: 100, objectCaching: false });
  const pinkText = new fabric.Textbox('design', { id: 'pink_text', fill: '#1e293b', parentShapeId: 'pink', objectCaching: false });
  const pinkDate = new fabric.Text('30 Oct', { id: 'pink_date', fill: 'rgba(0,0,0,0.4)', parentShapeId: 'pink', objectCaching: false });
  const black = new fabric.Rect({ id: 'black', fill: patternFill(), noteColor: '#000000', width: 100, height: 100, objectCaching: false });
  const blackText = new fabric.Textbox('Ideas', { id: 'black_text', fill: '#334155', parentShapeId: 'black', objectCaching: false });
  const unknown = new fabric.Rect({ id: 'unknown', fill: patternFill(), width: 100, height: 100, objectCaching: false });
  const unknownText = new fabric.Textbox('Keep', { id: 'unknown_text', fill: '#111111', parentShapeId: 'unknown', objectCaching: false });
  [pink, pinkText, pinkDate, black, blackText, unknown, unknownText].forEach((object) => canvas.add(object));
  applyCanvasTheme(canvas, DARK);
  drawn.length = 0;
  canvas.renderAll();
  const painted = new Set(drawn);
  assert.ok(painted.has('#1e293b'), 'dark text on a pink note stays dark');
  assert.ok(painted.has('rgba(0,0,0,0.4)'), 'the date on a pink note stays as stored');
  assert.ok(painted.has(adaptColor('#334155', '#000000')), 'dark text on a black note is lightened against the note');
  assert.ok(painted.has('#111111'), 'text on a container of unknown colour is preserved');
});

test('light surfaces render exactly the original colours', () => {
  const { canvas } = buildBoard();
  applyCanvasTheme(canvas, LIGHT);
  assert.ok(!canvas.skribeTheme);
  drawn.length = 0;
  canvas.renderAll();
  const painted = new Set(drawn);
  assert.ok(painted.has('#000000'));
  assert.ok(painted.has('#1e293b'));
  assert.ok(!painted.has(adaptColor('#1e293b', DARK)));
});

test('rendering in dark never changes stored object data, geometry or ids, even after repeated switching', () => {
  const { canvas, objects } = buildBoard();
  const before = snapshot(canvas);
  const jsonBefore = JSON.stringify(canvas.toJSON());
  const geometry = canvas.getObjects().map((o) => [o.id, o.left, o.top, o.width, o.height, o.scaleX, o.angle]);
  let modifiedEvents = 0;
  canvas.on('object:modified', () => { modifiedEvents += 1; });
  for (let i = 0; i < 5; i += 1) {
    applyCanvasTheme(canvas, i % 2 ? LIGHT : DARK);
    canvas.renderAll();
    assert.equal(snapshot(canvas), before, `serialization unchanged after pass ${i}`);
  }
  applyCanvasTheme(canvas, DARK);
  canvas.renderAll();
  assert.equal(objects.ink.stroke, '#000000');
  assert.equal(objects.looseText.fill, '#1e293b');
  assert.equal(JSON.stringify(canvas.toJSON()), jsonBefore);
  assert.deepEqual(canvas.getObjects().map((o) => [o.id, o.left, o.top, o.width, o.height, o.scaleX, o.angle]), geometry);
  assert.equal(modifiedEvents, 0);
});

test('a theme change invalidates cached object renders so stale colours are not reused', () => {
  const { canvas, objects } = buildBoard();
  objects.ink.objectCaching = true;
  canvas.renderAll();
  objects.ink.dirty = false;
  applyCanvasTheme(canvas, DARK);
  assert.equal(objects.ink.dirty, true);
});

test('images are drawn untouched', () => {
  const canvas = new fabric.Canvas(createElement(), { width: 100, height: 100, renderOnAddRemove: false });
  const image = new fabric.FabricImage(createElement(), { id: 'img', backgroundColor: '#000000' });
  canvas.add(image);
  applyCanvasTheme(canvas, DARK);
  drawn.length = 0;
  canvas.renderAll();
  assert.ok(!drawn.includes(adaptColor('#000000', DARK)));
});

test('client preference options mirror the server validation lists', () => {
  assert.deepEqual(APPEARANCE_OPTIONS.map((o) => o.value), [...APPEARANCES]);
  assert.deepEqual(LANGUAGE_OPTIONS.map((o) => o.value), [...LANGUAGES]);
  assert.deepEqual(LANDING_OPTIONS.map((o) => o.value), [...LANDING_PAGES]);
  assert.deepEqual(CANVAS_BACKGROUNDS.map((o) => o.key), [...SERVER_BACKGROUNDS]);
});

test('appearance resolution keeps System as a choice and follows the OS', () => {
  assert.equal(resolveAppearance('system', true), 'dark');
  assert.equal(resolveAppearance('system', false), 'light');
  assert.equal(resolveAppearance('light', true), 'light');
  assert.equal(resolveAppearance('dark', false), 'dark');
  assert.equal(resolveCanvasBackground('default', 'dark'), DARK);
  assert.equal(resolveCanvasBackground('midnight', 'light'), '#0F1117');
  assert.equal(resolveCanvasBackground('unknown', 'light'), LIGHT);
});

test('stored preference values are sanitised before use', () => {
  assert.deepEqual(normalizePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences({ appearance: 'sepia', language: 'fr', landingPage: 'x', reduceMotion: 'yes' }), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences({ appearance: 'dark', language: 'hi', landingPage: 'lastBoard', reduceMotion: true }), { appearance: 'dark', language: 'hi', landingPage: 'lastBoard', reduceMotion: true });
});
