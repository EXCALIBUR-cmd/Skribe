import { randomUUID } from 'crypto';
import ImageKit from '@imagekit/nodejs';
import mongoose from 'mongoose';
import config from '../config/env.js';
import Asset from '../models/Asset.js';
import Board from '../models/Board.js';
import boardRepository from '../repositories/board.repository.js';
import boardService from './board.service.js';
import { inspectImage, MAX_IMAGE_BYTES } from '../utils/imageFormat.js';

export const IMAGEKIT_UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';
export const IMAGEKIT_FILES_URL = 'https://api.imagekit.io/v1/files';
export const ASSET_FOLDER = '/skribe/assets';
export const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const STALE_DELETING_MS = 60 * 60 * 1000;
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DELETED_BOARD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const ASSET_REF_PREFIX = 'skribe-asset:';
export const MAX_SIGN_BATCH = 100;
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const UPLOAD_LIMITS = Object.freeze({ global: 4, perUser: 2, timeoutMs: 30000 });
const MAX_REFERENCE_DEPTH = 64;

const httpError = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, code });

export const isImageKitConfigured = () => Boolean(config.imageKitPublicKey && config.imageKitPrivateKey && config.imageKitUrlEndpoint);

const imageKitAuth = () => `Basic ${Buffer.from(`${config.imageKitPrivateKey}:`).toString('base64')}`;

export const uploadToImageKit = async ({ buffer, fileName, mimeType }, { fetch: fetchImpl = fetch } = {}) => {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), fileName);
  form.append('fileName', fileName);
  form.append('folder', ASSET_FOLDER);
  form.append('useUniqueFileName', 'true');
  form.append('isPrivateFile', 'true');
  form.append('responseFields', 'isPrivateFile');
  let response;
  try {
    response = await fetchImpl(IMAGEKIT_UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: imageKitAuth() },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_LIMITS.timeoutMs)
    });
  } catch (err) {
    throw Object.assign(httpError(504, 'Image storage did not respond in time. Please try again.', 'PROVIDER_UNREACHABLE'), { ambiguous: true });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof body?.message === 'string' ? body.message.slice(0, 200) : `HTTP ${response.status}`;
    throw httpError(response.status === 429 ? 429 : 502, `Image storage rejected the upload: ${detail}`, 'PROVIDER_REJECTED');
  }
  return body;
};

export const deleteFromImageKit = async (fileId, { fetch: fetchImpl = fetch } = {}) => {
  const response = await fetchImpl(`${IMAGEKIT_FILES_URL}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: imageKitAuth() },
    signal: AbortSignal.timeout(UPLOAD_LIMITS.timeoutMs)
  });
  if (response.status === 204 || response.status === 200) return 'deleted';
  if (response.status === 404) return 'missing';
  throw new Error(`ImageKit delete failed with HTTP ${response.status}`);
};

const activeUploads = { total: 0, byUser: new Map() };

export const reserveUploadSlot = (userId) => {
  const key = String(userId);
  const mine = activeUploads.byUser.get(key) || 0;
  if (activeUploads.total >= UPLOAD_LIMITS.global || mine >= UPLOAD_LIMITS.perUser) return null;
  activeUploads.total += 1;
  activeUploads.byUser.set(key, mine + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeUploads.total -= 1;
    const left = (activeUploads.byUser.get(key) || 1) - 1;
    if (left > 0) activeUploads.byUser.set(key, left);
    else activeUploads.byUser.delete(key);
  };
};

let imageKitClient = null;
let imageKitClientKey = null;

const signingClient = () => {
  if (!imageKitClient || imageKitClientKey !== config.imageKitPrivateKey) {
    imageKitClient = new ImageKit({ privateKey: config.imageKitPrivateKey });
    imageKitClientKey = config.imageKitPrivateKey;
  }
  return imageKitClient;
};

export const signDeliveryUrl = (filePath, { ttlSeconds = config.imageKitSignedUrlTtlSeconds } = {}) => {
  if (!isImageKitConfigured()) throw httpError(503, 'Image storage is not configured on this server', 'STORAGE_NOT_CONFIGURED');
  const url = signingClient().helper.buildSrc({ urlEndpoint: config.imageKitUrlEndpoint, src: filePath, signed: true, expiresIn: ttlSeconds });
  const expiresAt = Number(new URL(url).searchParams.get('ik-t')) * 1000;
  return { url, expiresAt };
};

export const assetSource = (asset) => (asset.privacy === 'private' ? `${ASSET_REF_PREFIX}${asset.assetId}` : asset.url);

export const toPublicAsset = (asset) => ({
  assetId: asset.assetId,
  url: asset.url,
  src: assetSource(asset),
  privacy: asset.privacy === 'private' ? 'private' : 'public',
  width: asset.width,
  height: asset.height,
  mimeType: asset.mimeType,
  size: asset.size,
  originalName: asset.originalName,
  status: asset.status,
  uploadedAt: asset.uploadedAt
});

const cleanFileName = (name) => String(name || '').replace(/[^\w .()-]/g, '').trim().slice(0, 120) || 'image';

export const uploadBoardImage = async ({ userId, boardId, buffer, originalName }, { fetch: fetchImpl = fetch, AssetModel = Asset, findBoard = (id) => boardRepository.findBoardAccess(id) } = {}) => {
  if (!mongoose.isValidObjectId(boardId)) throw httpError(400, 'A valid board is required for uploads', 'INVALID_BOARD');
  boardService._verifyAccess(await findBoard(boardId), userId);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, 'The selected file is empty', 'EMPTY_FILE');
  if (buffer.length > MAX_IMAGE_BYTES) throw httpError(413, 'Images must be 5 MB or smaller', 'FILE_TOO_LARGE');
  const image = inspectImage(buffer);
  if (!image) throw httpError(415, 'Only valid PNG, JPG and WebP images can be uploaded', 'UNSUPPORTED_IMAGE');
  if (!isImageKitConfigured()) throw httpError(503, 'Image storage is not configured on this server', 'STORAGE_NOT_CONFIGURED');

  const assetId = randomUUID();
  const fileName = `${assetId}.${image.extension}`;
  const asset = await AssetModel.create({
    assetId,
    owner: userId,
    board: boardId,
    boards: [],
    status: 'pending',
    originalName: cleanFileName(originalName),
    mimeType: image.mimeType,
    size: buffer.length,
    width: image.width,
    height: image.height
  });

  let stored;
  try {
    stored = await uploadToImageKit({ buffer, fileName, mimeType: image.mimeType }, { fetch: fetchImpl });
  } catch (err) {
    if (err.ambiguous) await AssetModel.updateOne({ _id: asset._id }, { $set: { lastCleanupError: 'upload outcome unknown', orphanedAt: new Date() } });
    else await AssetModel.deleteOne({ _id: asset._id });
    throw err;
  }

  const verified = stored && typeof stored.fileId === 'string' && typeof stored.filePath === 'string'
    && stored.fileType === 'image' && stored.isPrivateFile === true && Number(stored.size) === buffer.length && Number(stored.width) > 0 && Number(stored.height) > 0;
  if (!verified) {
    if (typeof stored?.fileId === 'string') await deleteFromImageKit(stored.fileId, { fetch: fetchImpl }).catch(() => null);
    await AssetModel.deleteOne({ _id: asset._id });
    throw httpError(502, 'Image storage returned an unexpected result. Please try again.', 'PROVIDER_UNVERIFIED');
  }

  const uploadedAt = new Date();
  const saved = await AssetModel.findOneAndUpdate(
    { _id: asset._id },
    {
      $set: {
        imageKitFileId: stored.fileId,
        filePath: stored.filePath,
        url: `${config.imageKitUrlEndpoint.replace(/\/+$/, '')}${stored.filePath}`,
        privacy: 'private',
        width: Number(stored.width),
        height: Number(stored.height),
        uploadedAt,
        orphanedAt: uploadedAt
      }
    },
    { new: true }
  );
  let delivery = null;
  try {
    delivery = signDeliveryUrl(saved.filePath);
  } catch {
    delivery = null;
  }
  return { ...toPublicAsset(saved), delivery };
};

const isRemoteUrl = (value) => typeof value === 'string' && value.length <= 2048 && /^https?:\/\//i.test(value);

export const collectAssetReferences = (value, refs = { assetIds: new Set(), urls: new Set() }, depth = 0) => {
  if (value === null || typeof value !== 'object') return refs;
  if (depth > MAX_REFERENCE_DEPTH) throw new Error('Board data is nested too deeply to verify asset references');
  if (Array.isArray(value)) {
    for (const item of value) collectAssetReferences(item, refs, depth + 1);
    return refs;
  }
  if (typeof value.assetId === 'string' && value.assetId) refs.assetIds.add(value.assetId);
  if (typeof value.src === 'string' && value.src.startsWith(ASSET_REF_PREFIX) && value.src.length > ASSET_REF_PREFIX.length) refs.assetIds.add(value.src.slice(ASSET_REF_PREFIX.length));
  if (isRemoteUrl(value.src)) refs.urls.add(value.src);
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child !== null && typeof child === 'object') collectAssetReferences(child, refs, depth + 1);
  }
  return refs;
};

const referenceFilter = (refs) => ({ $or: [{ assetId: { $in: [...refs.assetIds] } }, { url: { $in: [...refs.urls] } }] });

const attachUpdate = (now, boardId) => [{
  $set: {
    status: 'attached',
    orphanedAt: null,
    cleanupRunId: null,
    attachedAt: { $ifNull: ['$attachedAt', now] },
    ...(boardId ? { boards: { $setUnion: [{ $ifNull: ['$boards', []] }, [new mongoose.Types.ObjectId(String(boardId))]] } } : {})
  }
}];

const linkedBoardIds = (asset) => [asset.board, ...(asset.boards || [])].filter(Boolean).map(String);

export const syncBoardReferences = async (boardId, canvasData, userId, { AssetModel = Asset, BoardModel = Board, now = new Date() } = {}) => {
  try {
    const refs = collectAssetReferences(canvasData);
    if (refs.assetIds.size === 0 && refs.urls.size === 0) return 0;
    const target = String(boardId);
    const candidates = await AssetModel.find({ ...referenceFilter(refs), status: { $ne: 'deleted' } }, { _id: 1, owner: 1, board: 1, boards: 1 }).lean();
    if (candidates.length === 0) return 0;
    const user = userId ? String(userId) : null;
    const elsewhere = [...new Set(candidates.flatMap(linkedBoardIds))].filter((id) => id !== target && mongoose.isValidObjectId(id));
    const reachable = user && elsewhere.length > 0
      ? new Set((await BoardModel.find({ _id: { $in: elsewhere }, isDeleted: { $ne: true }, $or: [{ owner: user }, { members: user }] }, { _id: 1 }).lean()).map((board) => String(board._id)))
      : new Set();
    const allowed = candidates.filter((asset) => (user && String(asset.owner) === user) || linkedBoardIds(asset).some((id) => id === target || reachable.has(id)));
    if (allowed.length === 0) return 0;
    const result = await AssetModel.updateMany({ _id: { $in: allowed.map((asset) => asset._id) }, status: { $ne: 'deleted' } }, attachUpdate(now, boardId));
    return result.modifiedCount || 0;
  } catch (err) {
    console.error('[AssetService] Failed to record board image references:', err.message);
    return 0;
  }
};

export const retainedBoardFilter = (now = new Date()) => {
  const keepAfter = new Date(now.getTime() - DELETED_BOARD_RETENTION_MS);
  return { $or: [{ isDeleted: { $ne: true } }, { deletedAt: { $gt: keepAfter } }, { deletedAt: null, updatedAt: { $gt: keepAfter } }] };
};

export const scanBoardReferences = async ({ BoardModel = Board, now = new Date() } = {}) => {
  const refs = { assetIds: new Set(), urls: new Set() };
  for await (const board of BoardModel.find(retainedBoardFilter(now), { canvasData: 1 }).lean().cursor()) {
    collectAssetReferences(board.canvasData, refs);
  }
  return refs;
};

const isReferenced = (asset, refs) => refs.assetIds.has(asset.assetId) || (asset.url && refs.urls.has(asset.url));

export const runOrphanCleanup = async ({
  now = new Date(),
  AssetModel = Asset,
  scanReferences = scanBoardReferences,
  deleteFile = deleteFromImageKit,
  logger = console
} = {}) => {
  const runId = randomUUID();
  const cutoff = new Date(now.getTime() - ORPHAN_GRACE_MS);
  const staleDeleting = new Date(now.getTime() - STALE_DELETING_MS);
  const summary = { runId, examined: 0, preserved: 0, deleted: 0, alreadyMissing: 0, failed: 0, newlyOrphaned: 0, skipped: {}, storageBytes: 0, aborted: null };
  const skip = (reason, count = 1) => {
    if (count > 0) summary.skipped[reason] = (summary.skipped[reason] || 0) + count;
  };

  await AssetModel.updateMany(
    {
      imageKitFileId: { $ne: null },
      $or: [
        { status: { $in: ['pending', 'orphaned'] }, orphanedAt: { $ne: null, $lte: cutoff } },
        { status: 'deleting', deletingAt: { $lte: staleDeleting } }
      ]
    },
    { $set: { status: 'deleting', deletingAt: now, cleanupRunId: runId } }
  );
  skip('missing_file_id', await AssetModel.countDocuments({ status: 'pending', imageKitFileId: null, createdAt: { $lte: cutoff } }));
  const claimed = await AssetModel.find({ status: 'deleting', cleanupRunId: runId }).lean();
  summary.examined = claimed.length;

  let refs;
  try {
    refs = await scanReferences({ now });
  } catch (err) {
    await AssetModel.updateMany({ status: 'deleting', cleanupRunId: runId }, { $set: { status: 'orphaned', cleanupRunId: null, lastCleanupError: 'reference check failed' } });
    summary.aborted = 'reference_check_failed';
    skip('reference_check_failed', claimed.length);
    logger.error?.(`[AssetCleanup] ${JSON.stringify(summary)}`);
    return summary;
  }

  if (refs.assetIds.size > 0 || refs.urls.size > 0) {
    await AssetModel.updateMany({ ...referenceFilter(refs), status: { $ne: 'deleted' } }, attachUpdate(now));
  }
  const orphaned = await AssetModel.updateMany(
    { status: 'attached', assetId: { $nin: [...refs.assetIds] }, url: { $nin: [...refs.urls] } },
    { $set: { status: 'orphaned', orphanedAt: now } }
  );
  summary.newlyOrphaned = orphaned.modifiedCount || 0;

  for (const asset of claimed) {
    if (isReferenced(asset, refs)) {
      summary.preserved += 1;
      skip('still_referenced');
      continue;
    }
    const current = await AssetModel.findOneAndUpdate(
      { _id: asset._id, status: 'deleting', cleanupRunId: runId },
      { $inc: { cleanupAttempts: 1 } },
      { new: true }
    );
    if (!current) {
      summary.preserved += 1;
      skip('state_changed');
      continue;
    }
    try {
      const outcome = await deleteFile(current.imageKitFileId);
      await AssetModel.updateOne(
        { _id: asset._id, status: 'deleting', cleanupRunId: runId },
        { $set: { status: 'deleted', deletedAt: now, cleanupRunId: null, lastCleanupError: null } }
      );
      if (outcome === 'missing') summary.alreadyMissing += 1;
      else summary.deleted += 1;
    } catch (err) {
      summary.failed += 1;
      await AssetModel.updateOne(
        { _id: asset._id, status: 'deleting', cleanupRunId: runId },
        { $set: { status: 'orphaned', cleanupRunId: null, lastCleanupError: String(err.message).slice(0, 200) } }
      );
    }
  }

  const [usage] = await AssetModel.aggregate([{ $match: { status: { $ne: 'deleted' } } }, { $group: { _id: null, bytes: { $sum: '$size' } } }]);
  summary.storageBytes = usage?.bytes || 0;
  logger.log?.(`[AssetCleanup] ${JSON.stringify(summary)}`);
  return summary;
};

export const getStorageUsage = async (userId, { AssetModel = Asset } = {}) => {
  const rows = await AssetModel.aggregate([
    { $match: { owner: new mongoose.Types.ObjectId(String(userId)), status: { $ne: 'deleted' } } },
    { $group: { _id: '$status', count: { $sum: 1 }, bytes: { $sum: '$size' } } }
  ]);
  const byStatus = Object.fromEntries(rows.map((row) => [row._id, { count: row.count, bytes: row.bytes }]));
  return { totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0), totalCount: rows.reduce((sum, row) => sum + row.count, 0), byStatus, maxUploadBytes: MAX_IMAGE_BYTES };
};

export const signBoardAssets = async ({ boardId, userId, assetIds }, { AssetModel = Asset, findBoard = (id) => boardRepository.findBoardAccess(id), sign = signDeliveryUrl } = {}) => {
  if (!mongoose.isValidObjectId(boardId)) throw httpError(400, 'A valid board is required', 'INVALID_BOARD');
  if (!Array.isArray(assetIds) || assetIds.length === 0 || assetIds.length > MAX_SIGN_BATCH || !assetIds.every((id) => typeof id === 'string' && ASSET_ID_PATTERN.test(id))) {
    throw httpError(400, `Provide between 1 and ${MAX_SIGN_BATCH} valid asset ids`, 'INVALID_ASSET_IDS');
  }
  boardService._verifyAccess(await findBoard(boardId), userId);
  const wanted = [...new Set(assetIds)];
  const board = new mongoose.Types.ObjectId(String(boardId));
  const assets = await AssetModel.find(
    { assetId: { $in: wanted }, status: { $nin: ['deleted', 'deleting'] }, $or: [{ board }, { boards: board }] },
    { assetId: 1, privacy: 1, filePath: 1 }
  ).lean();
  const urls = {};
  const publicAssets = [];
  for (const asset of assets) {
    if (asset.privacy === 'private' && typeof asset.filePath === 'string' && asset.filePath) urls[asset.assetId] = sign(asset.filePath);
    else if (asset.privacy !== 'private') publicAssets.push(asset.assetId);
  }
  const answered = new Set([...Object.keys(urls), ...publicAssets]);
  return { urls, publicAssets, rejected: wanted.filter((id) => !answered.has(id)) };
};

export const startAssetCleanupSchedule = ({ intervalMs = CLEANUP_INTERVAL_MS, firstRunDelayMs = 60 * 1000 } = {}) => {
  let running = false;
  const run = async () => {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try {
      await runOrphanCleanup();
    } catch (err) {
      console.error('[AssetCleanup] Run failed:', err.message);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, firstRunDelayMs);
  const timer = setInterval(run, intervalMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
};

export default { uploadBoardImage, syncBoardReferences, runOrphanCleanup, getStorageUsage, startAssetCleanupSchedule, signBoardAssets };
