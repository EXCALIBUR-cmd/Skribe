import apiClient from '../../api/apiClient.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp';
export const MAX_INITIAL_VIEWPORT_SHARE = 0.6;

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
  if (!asset?.assetId || !asset?.url) throw new Error('The upload finished without an image reference.');
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
  const load = FabricImage.fromObject.bind(FabricImage);
  FabricImage.fromObject = (object, options) => load(object, options).catch((err) => {
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
