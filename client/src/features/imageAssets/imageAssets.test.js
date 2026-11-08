import assert from 'node:assert/strict';
import test from 'node:test';
import * as fabric from 'fabric';
import { MAX_IMAGE_BYTES, configureAssetDelivery, detectImageType, formatFileSize, getInitialImageScale, installImageAssetLoading, primeAssetDelivery, rehydrateAssetImages, resetAssetDelivery, uploadImageAsset, validateImageFile } from './imageAssets.js';
import { captureCanvasHistory, restoreCanvasHistory } from '../../utils/canvasHistory.js';
import { TOOL_REGISTRY } from '../../components/config/ToolRegistry.js';
import apiClient, { setExpectedUser, setSessionRefusedHandler, setSessionUser } from '../../api/apiClient.js';

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
const fakeImage = () => {
  const image = { width: 0, height: 0, naturalWidth: 0, naturalHeight: 0, _src: '' };
  Object.defineProperty(image, 'src', {
    get() { return this._src; },
    set(value) {
      this._src = value;
      setTimeout(() => {
        if (String(value).includes('broken')) return this.onerror?.();
        Object.assign(this, { width: 640, height: 480, naturalWidth: 640, naturalHeight: 480 });
        return this.onload?.();
      });
    }
  });
  return image;
};
const document = { createElement: (tag) => (tag === 'img' ? fakeImage() : fakeCanvas()), documentElement: { style: {} }, defaultView: null };
const window = { devicePixelRatio: 1, document, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({}), requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: (id) => clearTimeout(id) };
document.defaultView = window;
fabric.setEnv({ document, window, isTouchSupported: false, WebGLProbe: { queryWebGL() {}, isSupported() { return false; } }, dispose() {}, copyPasteData: {} });
installImageAssetLoading(fabric);
installImageAssetLoading(fabric);

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const URL_OK = 'https://ik.imagekit.io/skribe/skribe/assets/ok.png';
const URL_BROKEN = 'https://ik.imagekit.io/skribe/skribe/assets/broken.png';

test('image type comes from the file bytes, not its name or reported type', () => {
  assert.equal(detectImageType(new Uint8Array(PNG_HEAD)), 'image/png');
  assert.equal(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectImageType(new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')])), 'image/webp');
  assert.equal(detectImageType(new Uint8Array(Buffer.from('<svg xmlns="'))), null);
  assert.equal(detectImageType(new Uint8Array(Buffer.from('GIF89a'))), null);
});

test('files are checked one by one for emptiness, size and format before upload', async () => {
  assert.deepEqual(await validateImageFile(new File([], 'empty.png')), { ok: false, error: 'This file is empty.' });
  const large = await validateImageFile(new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.png'));
  assert.equal(large.ok, false);
  assert.match(large.error, /5 MB or smaller/);
  assert.deepEqual([formatFileSize(300), formatFileSize(24609), formatFileSize(6 * 1024 * 1024)], ['1 KB', '24 KB', '6.0 MB']);
  assert.equal((await validateImageFile(new File([new Uint8Array(MAX_IMAGE_BYTES)], 'at-limit.png'))).ok, false);
  const atLimit = new Uint8Array(MAX_IMAGE_BYTES);
  atLimit.set(PNG_HEAD);
  assert.deepEqual(await validateImageFile(new File([atLimit], 'at-limit.png')), { ok: true, mimeType: 'image/png' });
  assert.match((await validateImageFile(new File(['<svg/>'], 'logo.png', { type: 'image/png' }))).error, /PNG, JPG and WebP/);
});

test('uploads send the raw file to the board upload endpoint and report progress', async () => {
  const calls = [];
  const progress = [];
  const client = {
    post: async (url, body, options) => {
      calls.push({ url, body, options });
      options.onUploadProgress({ loaded: 50, total: 100 });
      options.onUploadProgress({ loaded: 100, total: 100 });
      return { success: true, data: { asset: { assetId: 'a1', url: URL_OK, width: 640, height: 480 } } };
    }
  };
  const file = new File([new Uint8Array(PNG_HEAD)], 'my photo.png', { type: 'image/png' });
  const asset = await uploadImageAsset({ file, boardId: 'board 1', onProgress: (value) => progress.push(value), client });
  assert.equal(asset.assetId, 'a1');
  assert.equal(calls[0].url, '/assets/images?boardId=board%201');
  assert.equal(calls[0].body, file);
  assert.equal(calls[0].options.headers['Content-Type'], 'image/png');
  assert.equal(calls[0].options.headers['X-File-Name'], 'my%20photo.png');
  assert.deepEqual(progress, [0.5, 1]);
  await assert.rejects(uploadImageAsset({ file, boardId: 'b', client: { post: async () => ({ data: {} }) } }), /without an image reference/);
});

test('large images are scaled down to the viewport, small ones keep their size and proportions', () => {
  assert.equal(getInitialImageScale(200, 100, 1600, 900), 1);
  const scale = getInitialImageScale(4000, 2000, 1600, 900);
  assert.equal(scale, 0.24);
  assert.equal(getInitialImageScale(1000, 3000, 1600, 900), 0.18);
  assert.equal(getInitialImageScale(0, 0, 1600, 900), 1);
});

test('the Image menu still offers Upload Image', () => {
  assert.ok(TOOL_REGISTRY.image.items.some((item) => item.id === 'upload_image' && item.actionType === 'upload'));
});

test('an uploaded image saves as its URL and asset id, never as embedded data, and restores the same way', async () => {
  const canvas = new fabric.StaticCanvas(undefined, { width: 1600, height: 900, renderOnAddRemove: false });
  const image = await fabric.FabricImage.fromURL(URL_OK, { crossOrigin: 'anonymous' });
  image.set({ left: 400, top: 300, scaleX: 0.5, scaleY: 0.5, metadata: { assetId: 'asset-1' } });
  image.id = 'obj_image';
  canvas.add(image, new fabric.Rect({ left: 10, top: 10, width: 50, height: 50 }));
  const saved = captureCanvasHistory(canvas);
  assert.equal(saved.includes('data:image'), false);
  assert.equal(saved.includes('blob:'), false);
  const [persisted] = JSON.parse(saved).objects;
  assert.equal(persisted.src, URL_OK);
  assert.equal(persisted.crossOrigin, 'anonymous');
  assert.deepEqual(persisted.metadata, { assetId: 'asset-1' });

  const restored = new fabric.StaticCanvas(undefined, { width: 1600, height: 900, renderOnAddRemove: false });
  await restoreCanvasHistory(restored, saved);
  const [back] = restored.getObjects();
  assert.equal(back.getSrc(), URL_OK);
  assert.equal(back.metadata.assetId, 'asset-1');
  assert.equal(back.scaleX, 0.5);
  assert.equal(back.skribeImageUnavailable, undefined);
});

test('an image that cannot be loaded keeps the board loading and keeps its saved reference', async () => {
  const board = {
    version: '7.4.0',
    objects: [
      { type: 'Image', version: '7.4.0', left: 100, top: 100, width: 320, height: 200, src: URL_BROKEN, crossOrigin: 'anonymous', metadata: { assetId: 'gone' } },
      { type: 'Rect', version: '7.4.0', left: 10, top: 10, width: 50, height: 50, fill: '#ff0000' },
      { type: 'Textbox', version: '7.4.0', left: 10, top: 300, width: 200, text: 'Still here' }
    ]
  };
  const canvas = new fabric.StaticCanvas(undefined, { width: 1600, height: 900, renderOnAddRemove: false });
  await restoreCanvasHistory(canvas, JSON.stringify(board));
  const [placeholder, rect, text] = canvas.getObjects();
  assert.equal(canvas.getObjects().length, 3);
  assert.equal(placeholder.skribeImageUnavailable, true);
  assert.equal(placeholder.width, 320);
  assert.equal(placeholder.height, 200);
  assert.equal(rect.fill, '#ff0000');
  assert.equal(text.text, 'Still here');
  const resaved = JSON.parse(captureCanvasHistory(canvas)).objects[0];
  assert.equal(resaved.src, URL_BROKEN);
  assert.equal(resaved.crossOrigin, 'anonymous');
  assert.deepEqual(resaved.metadata, { assetId: 'gone' });

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fabric.FabricImage.fromObject(board.objects[0], { signal: controller.signal }));
});

test('while another account is signed in, uploads and other user requests are refused before leaving the browser, and resume with the owner', async () => {
  const sent = [];
  const adapter = async (config) => { sent.push({ url: config.url, user: config.headers['X-Skribe-User'] }); return { data: { success: true, data: {} }, status: 200, statusText: 'OK', headers: {}, config }; };
  let rechecks = 0;
  setSessionRefusedHandler(() => { rechecks += 1; });
  setExpectedUser('user_a');
  setSessionUser('user_b');
  for (const [method, url] of [['post', '/assets/images?boardId=b1'], ['get', '/assets/usage'], ['post', '/mess-cleanup/analyze'], ['post', '/sidekick/chat'], ['patch', '/auth/me/preferences'], ['patch', '/boards/b1']]) {
    const refusal = await apiClient[method](url, {}, { adapter }).then(() => null, (err) => err);
    assert.equal(refusal?.errors?.code, 'IDENTITY_MISMATCH', url);
  }
  assert.deepEqual(sent, []);
  assert.equal(rechecks, 0);
  await apiClient.get('/auth/me', { adapter });
  assert.deepEqual(sent, [{ url: '/auth/me', user: 'user_a' }]);
  setSessionUser('user_a');
  await apiClient.post('/assets/images?boardId=b1', {}, { adapter });
  assert.deepEqual(sent[1], { url: '/assets/images?boardId=b1', user: 'user_a' });
  const serverRefusal = async (config) => Promise.reject(Object.assign(new Error('409'), { config, response: { status: 409, data: { success: false, errors: { code: 'IDENTITY_MISMATCH' } } } }));
  await apiClient.post('/sidekick/chat', {}, { adapter: serverRefusal }).catch(() => null);
  assert.equal(rechecks, 1);
  setSessionRefusedHandler(null);
  setExpectedUser(null);
  setSessionUser(undefined);
});

const deliveryHarness = (answer) => {
  let clock = 1_000_000;
  const scheduled = [];
  const calls = [];
  const timers = {
    setTimeout: (fn, ms) => (ms <= 0 ? setTimeout(fn, 0) : scheduled.push({ fn, at: clock + ms })),
    clearTimeout: (id) => { if (typeof id === 'number' && scheduled[id - 1]) scheduled[id - 1].fn = null; else clearTimeout(id); }
  };
  const signed = (id, tag = 'a') => ({ url: `https://cdn.test/skribe/assets/${id}.png?ik-t=${Math.floor((clock + 60000) / 1000)}&ik-s=${tag}${calls.length}`, expiresAt: clock + 60000 });
  configureAssetDelivery({ scope: `board_${Math.random()}`, sign: async (ids) => { calls.push([...ids]); return answer(ids, signed, calls.length); }, now: () => clock, timers });
  return {
    calls,
    signed,
    advance: async (ms) => {
      clock += ms;
      for (const job of scheduled) {
        if (job.fn && job.at <= clock) {
          const fn = job.fn;
          job.fn = null;
          fn();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
};
const privateImage = (id, extra = {}) => ({ type: 'Image', version: '7.4.0', left: 10, top: 10, width: 640, height: 480, src: `skribe-asset:${id}`, crossOrigin: 'anonymous', metadata: { assetId: id }, ...extra });

test('private images hydrate from one batched signing request, render from signed URLs and save only their stable asset reference', async () => {
  const h = deliveryHarness((ids, signed) => ({ urls: Object.fromEntries(ids.map((id) => [id, signed(id)])) }));
  const board = { version: '7.4.0', objects: [privateImage('p1'), privateImage('p2', { scaleX: 0.5, angle: 30 }), privateImage('p3'), { type: 'Image', version: '7.4.0', left: 0, top: 0, width: 640, height: 480, src: URL_OK, crossOrigin: 'anonymous', metadata: { assetId: 'legacy' } }] };
  const canvas = new fabric.StaticCanvas(undefined, { width: 1600, height: 900, renderOnAddRemove: false });
  await restoreCanvasHistory(canvas, JSON.stringify(board));
  assert.deepEqual(h.calls, [['p1', 'p2', 'p3']]);
  const objects = canvas.getObjects();
  assert.equal(objects.filter((o) => o.skribeImageUnavailable).length, 0);
  assert.match(objects[0]._element.src, /ik-s=/);
  assert.equal(objects[3]._element.src, URL_OK);
  const saved = captureCanvasHistory(canvas);
  assert.equal(/ik-s|ik-t|cdn\.test/.test(saved), false);
  const persisted = JSON.parse(saved).objects;
  assert.deepEqual(persisted.map((o) => o.src), ['skribe-asset:p1', 'skribe-asset:p2', 'skribe-asset:p3', URL_OK]);
  assert.deepEqual(persisted.map((o) => o.metadata.assetId), ['p1', 'p2', 'p3', 'legacy']);
  assert.equal(persisted[1].scaleX, 0.5);
  assert.equal(persisted[1].angle, 30);
  assert.equal(persisted[0].crossOrigin, 'anonymous');
  const again = new fabric.StaticCanvas(undefined, { width: 1600, height: 900, renderOnAddRemove: false });
  await restoreCanvasHistory(again, saved);
  assert.equal(h.calls.length, 1);
  assert.equal(captureCanvasHistory(again), saved);
  resetAssetDelivery();
});

test('signed URLs are renewed at 80% of their life without touching the canvas, and a failed load is re-signed once', async () => {
  const h = deliveryHarness((ids, signed, n) => ({ urls: Object.fromEntries(ids.map((id) => [id, n === 1 && id === 'p401' ? { ...signed(id), url: 'https://cdn.test/broken.png?ik-s=old' } : signed(id)])) }));
  const canvas = new fabric.StaticCanvas(undefined, { width: 1600, height: 900, renderOnAddRemove: false });
  let events = 0;
  canvas.on('object:modified', () => { events += 1; });
  await restoreCanvasHistory(canvas, JSON.stringify({ version: '7.4.0', objects: [privateImage('p401'), privateImage('ok')] }));
  assert.deepEqual(h.calls, [['p401', 'ok'], ['p401']]);
  assert.equal(canvas.getObjects().filter((o) => o.skribeImageUnavailable).length, 0);
  const before = captureCanvasHistory(canvas);
  await h.advance(47000);
  assert.equal(h.calls.length, 2);
  await h.advance(2000);
  assert.equal(h.calls.length, 3);
  assert.deepEqual([...h.calls[2]].sort(), ['ok', 'p401']);
  assert.equal(captureCanvasHistory(canvas), before);
  assert.equal(events, 0);
  resetAssetDelivery();
});

test('an image the server will not sign stays a placeholder that keeps its reference, and is restored in place once signing succeeds', async () => {
  let allow = false;
  deliveryHarness((ids, signed) => ({ urls: allow ? Object.fromEntries(ids.map((id) => [id, signed(id)])) : {}, rejected: allow ? [] : ids }));
  const canvas = new fabric.StaticCanvas(undefined, { width: 1600, height: 900, renderOnAddRemove: false });
  await restoreCanvasHistory(canvas, JSON.stringify({ version: '7.4.0', objects: [privateImage('late', { scaleX: 0.25 }), { type: 'Image', version: '7.4.0', width: 10, height: 10, src: 'skribe-asset:', crossOrigin: 'anonymous' }] }));
  const [late, corrupt] = canvas.getObjects();
  assert.equal(late.skribeImageUnavailable, true);
  assert.equal(corrupt.skribeImageUnavailable, true);
  const before = captureCanvasHistory(canvas);
  assert.equal(JSON.parse(before).objects[0].src, 'skribe-asset:late');
  allow = true;
  assert.equal(await rehydrateAssetImages(canvas), 1);
  assert.equal(late.skribeImageUnavailable, undefined);
  assert.match(late._element.src, /ik-s=/);
  assert.equal(late.width, 640);
  assert.equal(late.scaleX, 0.25);
  assert.equal(captureCanvasHistory(canvas), before);
  resetAssetDelivery();
});

test('a fresh upload previews from the URL it was issued with and is placed by its stable reference', async () => {
  const h = deliveryHarness(() => ({ urls: {} }));
  assert.equal(primeAssetDelivery('fresh', { url: 'https://cdn.test/skribe/assets/fresh.png?ik-t=1&ik-s=x', expiresAt: 1_000_000 + 60000 }), true);
  const image = await fabric.FabricImage.fromObject({ src: 'skribe-asset:fresh', crossOrigin: 'anonymous' });
  assert.equal(h.calls.length, 0);
  assert.equal(image.skribeImageUnavailable, undefined);
  image.set({ metadata: { assetId: 'fresh' } });
  const object = image.toObject(['metadata']);
  assert.equal(object.src, 'skribe-asset:fresh');
  assert.equal(object.crossOrigin, 'anonymous');
  assert.equal(JSON.stringify(object).includes('ik-s'), false);
  resetAssetDelivery();
});
