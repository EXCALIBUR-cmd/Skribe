import assert from 'node:assert/strict';
import test from 'node:test';
import * as fabric from 'fabric';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ICON_CATALOGUE, ICON_CATEGORIES, searchIcons } from './iconCatalogue.js';
import {
  DEFAULT_ICON_STYLE, ICON_COLORS, ICON_SIZES, ICON_STROKES, LUCIDE_ICON_TYPE, applyIconStyle, createIconObject,
  getIconSelectionProps, isLucideIcon, prepareIconObject, setIconSize, validateIconSvg
} from './iconObjects.js';
import { captureCanvasHistory, restoreCanvasHistory } from '../../utils/canvasHistory.js';
import { SKRIBE_SERIALIZABLE_PROPERTIES, hydrateSkribeFabricObject } from '../../utils/fabricHydration.js';
import { serializeCanvasObject } from '../../utils/boardNormalization.js';
import { getRegisteredSectionsForObject } from '../../components/properties/PropertyRegistry.js';
import { TOOL_REGISTRY } from '../../components/config/ToolRegistry.js';
import en from '../i18n/en.js';
import hi from '../i18n/hi.js';

const context = new Proxy({}, {
  get: (target, key) => (key in target ? target[key] : key === 'measureText' ? () => ({ width: 10 }) : () => {}),
  set: (target, key, value) => {
    target[key] = value;
    return true;
  }
});
const fakeCanvas = () => ({
  width: 300,
  height: 150,
  style: {},
  getContext: () => context,
  toDataURL: () => 'data:image/png;base64,PLACEHOLDER',
  setAttribute() {},
  getAttribute() { return null; },
  hasAttribute() { return false; },
  addEventListener() {},
  removeEventListener() {},
  classList: { add() {}, remove() {} },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 150 })
});
const document = { createElement: () => fakeCanvas(), documentElement: { style: {} }, defaultView: null };
const window = { devicePixelRatio: 1, document, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({}) };
document.defaultView = window;
fabric.setEnv({ document, window, isTouchSupported: false, WebGLProbe: { queryWebGL() {}, isSupported() { return false; } }, dispose() {}, copyPasteData: {} });

const attributesOf = (source) => Object.fromEntries([...source.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));

const pathOnlyParser = {
  ...fabric,
  loadSVGFromString: async (markup) => {
    const root = attributesOf(markup.match(/^<svg([^>]*)>/)[1]);
    const objects = [...markup.matchAll(/<(path|circle|rect|line|ellipse|polyline|polygon)\s([^>]*?)\/?>/g)].map(([, tag, attrs]) => (
      tag === 'path'
        ? new fabric.Path(attributesOf(attrs).d, { stroke: root.stroke, strokeWidth: Number(root['stroke-width']), fill: '', strokeLineCap: 'round', strokeLineJoin: 'round' })
        : null
    ));
    return { objects };
  }
};

const iconById = (id) => ICON_CATALOGUE.find((icon) => icon.id === id);
const markupFor = (id, { color = '#2563eb', strokeWidth = 2 } = {}) => renderToStaticMarkup(createElement(iconById(id).Icon, { size: 24, color, strokeWidth }));
const insertIcon = async (canvas, id, options = {}) => {
  const icon = iconById(id);
  const style = { ...DEFAULT_ICON_STYLE, color: '#2563eb', ...options };
  const group = await createIconObject(pathOnlyParser, markupFor(id, style), { icon, ...style, left: 640, top: 360 });
  group.id = `obj_${id}`;
  canvas.add(group);
  return group;
};
const newCanvas = () => new fabric.StaticCanvas(undefined, { width: 1280, height: 720, renderOnAddRemove: false });

test('the catalogue registers 100 to 150 distinct, resolvable Lucide icons across every category', () => {
  assert.ok(ICON_CATALOGUE.length >= 100 && ICON_CATALOGUE.length <= 150, `count ${ICON_CATALOGUE.length}`);
  assert.equal(new Set(ICON_CATALOGUE.map((icon) => icon.id)).size, ICON_CATALOGUE.length);
  assert.equal(new Set(ICON_CATALOGUE.map((icon) => icon.Icon)).size, ICON_CATALOGUE.length);
  const categoryIds = new Set(ICON_CATEGORIES.map((category) => category.id));
  for (const icon of ICON_CATALOGUE) {
    assert.equal(typeof icon.Icon?.render, 'function', `${icon.id} is not a Lucide component`);
    assert.ok(categoryIds.has(icon.category), `${icon.id} has unknown category ${icon.category}`);
    assert.ok(icon.name && icon.keywords, `${icon.id} needs a name and keywords`);
  }
  for (const category of ICON_CATEGORIES) {
    assert.ok(ICON_CATALOGUE.some((icon) => icon.category === category.id), `${category.id} is empty`);
  }
});

test('every catalogue icon renders to Lucide SVG artwork that passes validation', () => {
  for (const icon of ICON_CATALOGUE) {
    const markup = markupFor(icon.id);
    assert.ok(validateIconSvg(markup), `${icon.id} produced unsupported SVG: ${markup.slice(0, 120)}`);
    assert.match(markup, /stroke="#2563eb"/);
  }
});

test('svg validation rejects scripts, handlers, external references and foreign markup', () => {
  const good = markupFor('database');
  assert.equal(validateIconSvg(good), true);
  assert.equal(validateIconSvg(good.replace('<path', '<script>alert(1)</script><path')), false);
  assert.equal(validateIconSvg(good.replace('<path', '<path onload="alert(1)"')), false);
  assert.equal(validateIconSvg(good.replace('<path', '<image href="https://example.com/x.png"></image><path')), false);
  assert.equal(validateIconSvg(good.replace('<path', '<foreignObject></foreignObject><path')), false);
  assert.equal(validateIconSvg(good.replace('viewBox="0 0 24 24"', 'viewBox="0 0 48 48"')), false);
  assert.equal(validateIconSvg('<svg viewBox="0 0 24 24"></svg>'), false);
  assert.equal(validateIconSvg(`<svg viewBox="0 0 24 24">${'<path d="M0 0"></path>'.repeat(1000)}</svg>`), false);
  assert.equal(validateIconSvg(null), false);
});

test('search matches names, keywords and synonyms locally, ranks name matches first and filters by category', () => {
  const ids = (query, category) => searchIcons(query, category).map((icon) => icon.id);
  assert.equal(ids('database')[0], 'database');
  assert.equal(ids('DataBase')[0], 'database');
  for (const id of ['database', 'server', 'hard-drive', 'cloud']) assert.ok(ids('storage').includes(id), `storage misses ${id}`);
  const arrows = ids('arrow');
  for (const id of ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-up-right']) assert.ok(arrows.includes(id), `arrow misses ${id}`);
  assert.ok(arrows.indexOf('arrow-right') < arrows.indexOf('move'));
  for (const id of ['laptop', 'monitor', 'tablet', 'keyboard']) assert.ok(ids('laptop').includes(id), `laptop misses ${id}`);
  assert.equal(ids('laptop')[0], 'laptop');
  assert.deepEqual(ids('arrow up').filter((id) => id.startsWith('arrow')).sort(), ['arrow-up', 'arrow-up-down', 'arrow-up-right']);
  assert.deepEqual(ids('qwertyzz'), []);
  assert.equal(ids('').length, ICON_CATALOGUE.length);
  const business = searchIcons('', 'business');
  assert.ok(business.length > 0 && business.every((icon) => icon.category === 'business'));
  assert.deepEqual(ids('database', 'business'), []);
});

test('an inserted icon is one vector group at the requested centre, size, colour and stroke', async () => {
  const canvas = newCanvas();
  const group = await insertIcon(canvas, 'arrow-right', { size: 72, strokeWidth: 3, color: '#16a34a' });
  assert.equal(canvas.getObjects().length, 1);
  assert.equal(group.type, 'group');
  assert.equal(group.getObjects().length, 2);
  assert.ok(group.getObjects().every((part) => part.type === 'path' && part.stroke === '#16a34a' && part.strokeWidth === 3));
  assert.equal(group.scaleX, 3);
  assert.equal(group.scaleY, group.scaleX);
  const center = group.getCenterPoint();
  assert.ok(Math.abs(center.x - 640) < 1e-6 && Math.abs(center.y - 360) < 1e-6);
  assert.equal(group.subTargetCheck, false);
  assert.deepEqual(group.metadata, {
    assetType: LUCIDE_ICON_TYPE, iconId: 'arrow-right', iconName: 'Arrow Right', category: 'arrows',
    color: '#16a34a', strokeWidth: 3, designWidth: 24, designHeight: 24
  });
  assert.deepEqual(['ml', 'mr', 'mt', 'mb'].map((key) => group.isControlVisible(key)), [false, false, false, false]);
  assert.deepEqual(['tl', 'tr', 'bl', 'br', 'mtr'].map((key) => group.isControlVisible(key)), [true, true, true, true, true]);
  assert.deepEqual(getIconSelectionProps(group), { isLucideIcon: true, iconName: 'Arrow Right', iconColor: '#16a34a', iconStrokeWidth: 3, iconSize: 72 });
});

test('invalid artwork or an unreadable element stops insertion instead of adding a partial icon', async () => {
  const icon = iconById('database');
  const options = { icon, ...DEFAULT_ICON_STYLE, left: 0, top: 0 };
  await assert.rejects(createIconObject(pathOnlyParser, '<svg viewBox="0 0 24 24"><script></script></svg>', options), /not valid/);
  await assert.rejects(createIconObject(pathOnlyParser, markupFor('database'), options), /could not be read/);
});

test('icons save as vector paths with their metadata and restore without any network fetch', async () => {
  const canvas = newCanvas();
  await insertIcon(canvas, 'arrow-right', { size: 96, strokeWidth: 1.5, color: '#dc2626' });
  canvas.add(new fabric.Rect({ left: 10, top: 10, width: 50, height: 50 }));
  const saved = captureCanvasHistory(canvas);
  assert.equal(/data:|base64|blob:|https?:/.test(saved), false);
  const [persisted] = JSON.parse(saved).objects;
  assert.equal(persisted.type, 'Group');
  assert.equal(persisted.metadata.iconId, 'arrow-right');
  assert.ok(persisted.objects.every((part) => part.type === 'Path' && part.stroke === '#dc2626' && part.strokeWidth === 1.5));

  const restored = newCanvas();
  await restoreCanvasHistory(restored, saved);
  const [icon, rect] = restored.getObjects();
  assert.equal(isLucideIcon(icon), true);
  assert.equal(rect.type, 'rect');
  assert.deepEqual(icon.metadata, persisted.metadata);
  assert.equal(icon.scaleX, 4);
  assert.ok(icon.getObjects().every((part) => part.stroke === '#dc2626' && part.strokeWidth === 1.5));
  assert.equal(icon.isControlVisible('ml'), false);
  const center = icon.getCenterPoint();
  assert.ok(Math.abs(center.x - 640) < 1e-6 && Math.abs(center.y - 360) < 1e-6);
});

test('the collaboration payload carries the whole icon and rebuilds it with metadata and controls', async () => {
  const canvas = newCanvas();
  const group = await insertIcon(canvas, 'arrow-up-right');
  const payload = JSON.parse(JSON.stringify(serializeCanvasObject(canvas, group, SKRIBE_SERIALIZABLE_PROPERTIES)));
  assert.equal(payload.id, 'obj_arrow-up-right');
  const [remote] = await fabric.util.enlivenObjects([JSON.parse(JSON.stringify(payload))]);
  hydrateSkribeFabricObject(remote, payload);
  assert.equal(isLucideIcon(remote), true);
  assert.deepEqual(remote.metadata, group.metadata);
  assert.equal(remote.getObjects().length, group.getObjects().length);
  assert.equal(remote.isControlVisible('mr'), false);
  const copy = await group.clone();
  copy.metadata = { ...group.metadata };
  prepareIconObject(copy);
  assert.equal(isLucideIcon(copy), true);
  assert.equal(copy.isControlVisible('mb'), false);
  assert.ok(copy.getObjects().every((part, index) => part.stroke === group.getObjects()[index].stroke));
});

test('colour, stroke and size edits update the parts and metadata in place, keep the centre and record history', async () => {
  const canvas = newCanvas();
  const group = await insertIcon(canvas, 'arrow-right', { size: 48 });
  const before = captureCanvasHistory(canvas);
  group.set({ angle: 30 });
  const centerBefore = group.getCenterPoint();

  assert.equal(applyIconStyle(group, { color: '#7C3AED' }), true);
  assert.equal(applyIconStyle(group, { strokeWidth: 3 }), true);
  assert.ok(group.getObjects().every((part) => part.stroke === '#7c3aed' && part.strokeWidth === 3));
  assert.equal(group.metadata.color, '#7c3aed');
  assert.equal(group.metadata.strokeWidth, 3);
  assert.equal(group.metadata.iconId, 'arrow-right');
  assert.equal(group.angle, 30);
  assert.equal(group.scaleX, 2);
  assert.ok(group.getCenterPoint().distanceFrom(centerBefore) < 1e-6);

  assert.equal(setIconSize(group, 96), true);
  assert.equal(group.scaleX, 4);
  assert.equal(group.scaleY, 4);
  assert.ok(group.getCenterPoint().distanceFrom(centerBefore) < 1e-6);
  assert.equal(setIconSize(group, 5000), true);
  assert.equal(group.scaleX, 1024 / 24);

  assert.equal(applyIconStyle(group, { color: 'red; background:url(x)' }), false);
  assert.equal(applyIconStyle(group, { strokeWidth: 40 }), false);
  assert.equal(applyIconStyle(new fabric.Rect(), { color: '#000000' }), false);
  assert.equal(setIconSize(new fabric.Rect(), 32), false);

  const after = captureCanvasHistory(canvas);
  assert.notEqual(after, before);
  const undone = newCanvas();
  await restoreCanvasHistory(undone, before);
  assert.equal(undone.getObjects()[0].metadata.color, '#2563eb');
  const redone = newCanvas();
  await restoreCanvasHistory(redone, after);
  assert.equal(redone.getObjects()[0].metadata.color, '#7c3aed');
  assert.ok(redone.getObjects()[0].getObjects().every((part) => part.strokeWidth === 3));
});

test('undoing an insertion removes the icon and redoing brings it back', async () => {
  const canvas = newCanvas();
  canvas.add(new fabric.Rect({ left: 10, top: 10, width: 50, height: 50 }));
  const before = captureCanvasHistory(canvas);
  await insertIcon(canvas, 'arrow-down');
  const after = captureCanvasHistory(canvas);
  const target = newCanvas();
  await restoreCanvasHistory(target, after);
  assert.equal(target.getObjects().filter(isLucideIcon).length, 1);
  await restoreCanvasHistory(target, before);
  assert.equal(target.getObjects().filter(isLucideIcon).length, 0);
  await restoreCanvasHistory(target, after);
  assert.equal(target.getObjects().filter(isLucideIcon).length, 1);
});

test('the Image menu opens the gallery, icons get their own property section and every label is translated', () => {
  const item = TOOL_REGISTRY.image.items.find((entry) => entry.id === 'icons_gallery');
  assert.equal(item.toolType, 'icons');
  assert.ok(TOOL_REGISTRY.image.items.some((entry) => entry.id === 'upload_image' && entry.actionType === 'upload'));
  assert.deepEqual(TOOL_REGISTRY.image.items.map((entry) => entry.id), ['upload_image', 'icons_gallery']);
  const iconSections = getRegisteredSectionsForObject({ hasSelection: true, type: 'group', isLucideIcon: true }).map((section) => section.id);
  assert.ok(iconSections.includes('icon'));
  assert.equal(iconSections.includes('appearance'), false);
  assert.equal(getRegisteredSectionsForObject({ hasSelection: true, type: 'group' }).some((section) => section.id === 'icon'), false);
  const keys = [
    'icons.sectionTitle', 'icons.category.all',
    ...ICON_CATEGORIES.map((category) => category.labelKey),
    ...ICON_COLORS.map((option) => `icons.color.${option.id}`),
    ...ICON_SIZES.map((option) => `icons.size.${option.id}`),
    ...ICON_STROKES.map((option) => `icons.stroke.${option.id}`)
  ];
  for (const key of keys) {
    assert.ok(key in en, `en missing ${key}`);
    assert.ok(key in hi, `hi missing ${key}`);
  }
});
