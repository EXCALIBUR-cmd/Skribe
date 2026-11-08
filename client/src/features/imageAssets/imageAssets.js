import apiClient from '../../api/apiClient.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp';
export const MAX_INITIAL_VIEWPORT_SHARE = 0.6;
export const ASSET_REF_PREFIX = 'skribe-asset:';

const DELIVERY_BATCH = 100;
const REFRESH_SHARE = 0.8;
const STALE_MARGIN_MS = 5000;

export const assetIdFromSource = (src) => (typeof src === 'string' && src.startsWith(ASSET_REF_PREFIX) && src.length > ASSET_REF_PREFIX.length ? src.slice(ASSET_REF_PREFIX.length) : null);

const delivery = {
  scope: null,
  sign: null,
  cache: new Map(),
  waiting: new Map(),
  flushTimer: null,
  refreshTimer: null,
  generation: 0,
  fabric: null,
  now: () => Date.now(),
  timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) }
};

const remember = (assetId, entry) => {
  if (!entry || typeof entry.url !== 'string' || !entry.url || !Number.isFinite(entry.expiresAt)) return null;
  const issuedAt = delivery.now();
  delivery.cache.set(assetId, { url: entry.url, expiresAt: entry.expiresAt, refreshAt: issuedAt + Math.max(0, entry.expiresAt - issuedAt) * REFRESH_SHARE });
  return entry.url;
};

const scheduleRefresh = () => {
  if (delivery.refreshTimer) delivery.timers.clearTimeout(delivery.refreshTimer);
  delivery.refreshTimer = null;
  if (!delivery.sign || delivery.cache.size === 0) return;
  const next = Math.min(...[...delivery.cache.values()].map((entry) => entry.refreshAt));
  delivery.refreshTimer = delivery.timers.setTimeout(() => {
    delivery.refreshTimer = null;
    const due = [...delivery.cache.entries()].filter(([, entry]) => entry.refreshAt <= delivery.now() + 1000).map(([id]) => id);
    if (due.length > 0) requestUrls(due);
    else scheduleRefresh();
  }, Math.max(1000, next - delivery.now()));
};

const requestUrls = async (ids) => {
  const { sign, generation } = delivery;
  const issued = {};
  if (!sign || ids.length === 0) return issued;
  for (let start = 0; start < ids.length; start += DELIVERY_BATCH) {
    const chunk = ids.slice(start, start + DELIVERY_BATCH);
    const answer = await Promise.resolve().then(() => sign(chunk)).catch(() => null);
    if (generation !== delivery.generation) return {};
    chunk.forEach((id) => {
      const url = remember(id, answer?.urls?.[id]);
      if (url) issued[id] = url;
      else delivery.cache.delete(id);
    });
  }
  scheduleRefresh();
  return issued;
};

const flushDelivery = async () => {
  delivery.flushTimer = null;
  const batch = new Map(delivery.waiting);
  delivery.waiting.clear();
  const issued = await requestUrls([...batch.keys()]);
  batch.forEach((waiters, id) => waiters.forEach((done) => done(issued[id] || null)));
};

export const resolveAssetUrl = (assetId, { force = false } = {}) => {
  const cached = delivery.cache.get(assetId);
  if (!force && cached && delivery.now() < cached.expiresAt - STALE_MARGIN_MS) return Promise.resolve(cached.url);
  if (force) delivery.cache.delete(assetId);
  if (!delivery.sign || !assetId) return Promise.resolve(null);
  return new Promise((resolve) => {
    delivery.waiting.set(assetId, [...(delivery.waiting.get(assetId) || []), resolve]);
    if (!delivery.flushTimer) delivery.flushTimer = delivery.timers.setTimeout(flushDelivery, 0);
  });
};

export const resetAssetDelivery = () => {
  delivery.generation += 1;
  if (delivery.flushTimer) delivery.timers.clearTimeout(delivery.flushTimer);
  if (delivery.refreshTimer) delivery.timers.clearTimeout(delivery.refreshTimer);
  delivery.flushTimer = null;
  delivery.refreshTimer = null;
  const waiting = [...delivery.waiting.values()];
  delivery.waiting.clear();
  waiting.forEach((waiters) => waiters.forEach((done) => done(null)));
  delivery.cache.clear();
  delivery.scope = null;
  delivery.sign = null;
};

export const configureAssetDelivery = ({ scope = null, sign = null, now = null, timers = null } = {}) => {
  if (delivery.scope !== scope) resetAssetDelivery();
  delivery.scope = scope;
  delivery.sign = typeof sign === 'function' ? sign : null;
  if (now) delivery.now = now;
  if (timers) delivery.timers = timers;
};

export const primeAssetDelivery = (assetId, entry) => {
  if (!assetId || !remember(assetId, entry)) return false;
  scheduleRefresh();
  return true;
};

export const rehydrateAssetImages = async (canvas) => {
  const fabric = delivery.fabric;
  if (!canvas || !fabric || typeof canvas.getObjects !== 'function') return 0;
  const pending = canvas.getObjects().filter((object) => object.skribeImageUnavailable && assetIdFromSource(object.getSrc?.()));
  let restored = 0;
  await Promise.all(pending.map(async (image) => {
    const url = await resolveAssetUrl(assetIdFromSource(image.getSrc()));
    if (!url) return;
    const element = await fabric.util.loadImage(url, { crossOrigin: image.crossOrigin ?? 'anonymous' }).catch(() => null);
    if (!element || !image.skribeImageUnavailable) return;
    image.setElement(element, { width: image.width, height: image.height });
    delete image.skribeImageUnavailable;
    restored += 1;
  }));
  if (restored > 0) canvas.requestRenderAll?.();
  return restored;
};

const startsWith = (bytes, signature, offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (text) => [...text].map((char) => char.charCodeAt(0));

export const detectImageType = (bytes) => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  return null;
};

export const formatFileSize = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

export const validateImageFile = async (file) => {
  if (!file || file.size === 0) return { ok: false, error: 'This file is empty.' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: `This file is ${formatFileSize(file.size)}. Images must be 5 MB or smaller.` };
  const mimeType = detectImageType(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!mimeType) return { ok: false, error: 'Only PNG, JPG and WebP images are supported.' };
  return { ok: true, mimeType };
};

export const uploadImageAsset = async ({ file, boardId, onProgress, client = apiClient }) => {
  const response = await client.post(`/assets/images?boardId=${encodeURIComponent(boardId)}`, file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'image') },
    onUploadProgress: (event) => {
      if (onProgress && event.total) onProgress(Math.min(1, event.loaded / event.total));
    }
  });
  const asset = response?.data?.asset;
  if (!asset?.assetId || !(asset.src || asset.url)) throw new Error('The upload finished without an image reference.');
  return asset;
};

export const getInitialImageScale = (width, height, viewWidth, viewHeight) => {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(1, (viewWidth * MAX_INITIAL_VIEWPORT_SHARE) / width, (viewHeight * MAX_INITIAL_VIEWPORT_SHARE) / height);
};

const createImagePlaceholder = (fabric, width, height) => {
  const element = fabric.util.createCanvasElement();
  element.width = Math.max(1, Math.round(width || 1));
  element.height = Math.max(1, Math.round(height || 1));
  const ctx = element.getContext('2d');
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, element.width, element.height);
  ctx.fillStyle = '#64748b';
  ctx.font = `${Math.max(12, Math.round(Math.min(element.width, element.height) / 10))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Image unavailable', element.width / 2, element.height / 2);
  return element;
};

export const installImageAssetLoading = (fabric) => {
  const { FabricImage } = fabric;
  if (FabricImage.__skribeImageFallbackInstalled) return;
  FabricImage.__skribeImageFallbackInstalled = true;
  delivery.fabric = fabric;
  const load = FabricImage.fromObject.bind(FabricImage);
  const keepSource = (src) => (image) => {
    image.getSrc = () => src;
    return image;
  };
  const loadAsset = async (object, options, assetId) => {
    const url = await resolveAssetUrl(assetId);
    if (!url) throw new Error('Image delivery is unavailable');
    try {
      return keepSource(object.src)(await load({ ...object, src: url }, options));
    } catch (err) {
      if (options?.signal?.aborted) throw err;
      const fresh = await resolveAssetUrl(assetId, { force: true });
      if (!fresh) throw err;
      return keepSource(object.src)(await load({ ...object, src: fresh }, options));
    }
  };
  FabricImage.fromObject = (object, options) => {
    const assetId = assetIdFromSource(object?.src);
    const isReference = typeof object?.src === 'string' && object.src.startsWith(ASSET_REF_PREFIX);
    const attempt = assetId ? loadAsset(object, options, assetId) : isReference ? Promise.reject(new Error('Invalid asset reference')) : load(object, options);
    return attempt.catch((err) => {
      if (options?.signal?.aborted || typeof object?.src !== 'string' || !object.src) throw err;
      return load({ ...object, src: '' }, options).then((image) => {
        image.setElement(createImagePlaceholder(fabric, object.width, object.height));
        image.getSrc = () => object.src;
        image.getCrossOrigin = () => object.crossOrigin ?? null;
        image.skribeImageUnavailable = true;
        return image;
      });
    });
  };
};
