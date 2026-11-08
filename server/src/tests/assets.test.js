import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import config from '../config/env.js';
import Asset from '../models/Asset.js';
import Board from '../models/Board.js';
import { inspectImage, MAX_IMAGE_BYTES } from '../utils/imageFormat.js';
import { createUploadHandler, limitConcurrentUploads, receiveImageBody } from '../controllers/asset.controller.js';
import crypto from 'node:crypto';
import {
  DELETED_BOARD_RETENTION_MS,
  MAX_SIGN_BATCH,
  ORPHAN_GRACE_MS,
  signBoardAssets,
  signDeliveryUrl,
  UPLOAD_LIMITS,
  collectAssetReferences,
  reserveUploadSlot,
  runOrphanCleanup,
  syncBoardReferences,
  uploadBoardImage
} from '../services/asset.service.js';

const TEST_DB_NAME = `skribe_assets_test_${process.pid}_${Date.now()}`;
const TEST_MONGO_BASE = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
let mongoAvailable = false;
try {
  await mongoose.connect(`${TEST_MONGO_BASE}/${TEST_DB_NAME}`, { serverSelectionTimeoutMS: 1500 });
  mongoAvailable = true;
} catch {
  mongoAvailable = false;
}
const needsMongo = { skip: mongoAvailable ? false : `MongoDB is not reachable at ${TEST_MONGO_BASE}` };
const originalImageKit = { imageKitPublicKey: config.imageKitPublicKey, imageKitPrivateKey: config.imageKitPrivateKey, imageKitUrlEndpoint: config.imageKitUrlEndpoint };
Object.assign(config, { imageKitPublicKey: 'public_test', imageKitPrivateKey: 'private_test', imageKitUrlEndpoint: 'https://ik.imagekit.io/skribe-test/' });

test.after(async () => {
  Object.assign(config, originalImageKit);
  if (mongoAvailable && mongoose.connection.name === TEST_DB_NAME) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
const webp = () => {
  const buffer = Buffer.alloc(32);
  buffer.write('RIFF', 0, 'latin1');
  buffer.writeUInt32LE(24, 4);
  buffer.write('WEBP', 8, 'latin1');
  buffer.write('VP8L', 12, 'latin1');
  buffer.writeUInt32LE(12, 16);
  buffer[20] = 0x2f;
  buffer.writeUInt32LE((4 - 1) | ((3 - 1) << 14), 21);
  return buffer;
};
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');

test('only real PNG, JPEG and WebP content is accepted, whatever the file is called', () => {
  assert.deepEqual(inspectImage(PNG), { mimeType: 'image/png', extension: 'png', width: 1, height: 1 });
  assert.deepEqual(inspectImage(JPEG), { mimeType: 'image/jpeg', extension: 'jpg', width: 3, height: 2 });
  assert.deepEqual(inspectImage(webp()), { mimeType: 'image/webp', extension: 'webp', width: 4, height: 3 });
  assert.equal(inspectImage(Buffer.alloc(0)), null);
  assert.equal(inspectImage(SVG), null);
  assert.equal(inspectImage(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')), null);
  assert.equal(inspectImage(PNG.subarray(0, PNG.length - 12)), null);
  assert.equal(inspectImage(JPEG.subarray(0, 12)), null);
  const zeroWidth = Buffer.from(PNG);
  zeroWidth.writeUInt32BE(0, 16);
  assert.equal(inspectImage(zeroWidth), null);
  const truncatedWebp = webp();
  truncatedWebp.writeUInt32LE(4000, 4);
  assert.equal(inspectImage(truncatedWebp), null);
});

const mountUpload = (upload) => {
  const app = express();
  app.post('/upload', (req, res, next) => {
    req.user = { id: 'user-1' };
    next();
  }, limitConcurrentUploads, receiveImageBody, createUploadHandler(upload));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
};

test('the server reads at most 5 MiB of an upload and rejects anything larger', async () => {
  const received = [];
  const server = await mountUpload(async ({ buffer }) => {
    received.push(buffer.length);
    return { assetId: 'a' };
  });
  const url = `http://127.0.0.1:${server.address().port}/upload?boardId=x`;
  try {
    const atLimit = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(MAX_IMAGE_BYTES) });
    assert.equal(atLimit.status, 201);
    const tooLarge = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(MAX_IMAGE_BYTES + 1) });
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).errors.code, 'FILE_TOO_LARGE');
    assert.deepEqual(received, [MAX_IMAGE_BYTES]);
  } finally {
    server.close();
  }
});

test('concurrent uploads are capped per user and overall', () => {
  const releases = [reserveUploadSlot('u1'), reserveUploadSlot('u1')];
  assert.equal(reserveUploadSlot('u1'), null);
  const others = Array.from({ length: UPLOAD_LIMITS.global - 2 }, (_, index) => reserveUploadSlot(`other-${index}`));
  assert.ok(others.every(Boolean));
  assert.equal(reserveUploadSlot('u9'), null);
  [...releases, ...others].forEach((release) => {
    release();
    release();
  });
  const again = reserveUploadSlot('u1');
  assert.ok(again);
  again();
});

const ownerId = new mongoose.Types.ObjectId();
const strangerId = new mongoose.Types.ObjectId();

const imageKitFetch = (overrides = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (init.method === 'DELETE') {
      calls.push({ url, method: init.method, auth: init.headers.Authorization });
      return new Response(null, { status: 204 });
    }
    const multipart = new Response(init.body);
    const contentType = multipart.headers.get('content-type') || '';
    const form = await multipart.formData();
    const requestedFields = String(form.get('responseFields') || '').split(',').map((field) => field.trim()).filter(Boolean);
    calls.push({ url, method: init.method, auth: init.headers.Authorization, multipart: contentType.startsWith('multipart/form-data'), privateFlag: form.get('isPrivateFile'), responseFields: requestedFields });
    const file = form.get('file');
    const fileName = form.get('fileName');
    if (overrides.status) return new Response(JSON.stringify({ message: overrides.message }), { status: overrides.status });
    const image = inspectImage(Buffer.from(await file.arrayBuffer()));
    return new Response(JSON.stringify({
      fileId: `fid_${calls.length}`,
      name: fileName,
      filePath: `/skribe/assets/${fileName}`,
      url: `https://ik.imagekit.io/skribe-test/skribe/assets/${fileName}`,
      fileType: 'image',
      size: file.size,
      width: image.width,
      height: image.height,
      ...(requestedFields.includes('isPrivateFile') ? { isPrivateFile: form.get('isPrivateFile') === 'true' } : {}),
      ...overrides.body
    }), { status: 200 });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
};

const createBoard = (canvasData = { version: '7.4.0', objects: [] }, extra = {}) => Board.create({ owner: ownerId, title: 'Assets', canvasData, ...extra });

test('a valid upload is stored in ImageKit and tracked as a pending asset with its metadata', needsMongo, async () => {
  const board = await createBoard();
  const fetchImpl = imageKitFetch();
  const asset = await uploadBoardImage({ userId: ownerId, boardId: board._id, buffer: PNG, originalName: '../../etc/My Photo<script>.png' }, { fetch: fetchImpl });
  assert.match(asset.assetId, /^[0-9a-f-]{36}$/);
  assert.equal(asset.url, `https://ik.imagekit.io/skribe-test/skribe/assets/${asset.assetId}.png`);
  assert.equal(asset.mimeType, 'image/png');
  assert.equal(asset.width, 1);
  assert.equal(fetchImpl.calls[0].auth, `Basic ${Buffer.from('private_test:').toString('base64')}`);
  const stored = await Asset.findOne({ assetId: asset.assetId }).lean();
  assert.equal(stored.status, 'pending');
  assert.equal(stored.imageKitFileId, 'fid_1');
  assert.equal(stored.size, PNG.length);
  assert.equal(String(stored.owner), String(ownerId));
  assert.equal(stored.originalName, '....etcMy Photoscript.png');
  assert.ok(stored.uploadedAt && stored.orphanedAt);
  assert.equal(JSON.stringify(asset).includes('private_test'), false);

  for (const [buffer, mimeType] of [[JPEG, 'image/jpeg'], [webp(), 'image/webp']]) {
    assert.equal((await uploadBoardImage({ userId: ownerId, boardId: board._id, buffer }, { fetch: imageKitFetch() })).mimeType, mimeType);
  }
});

test('uploads are refused for strangers, bad content and storage failures without leaving records', needsMongo, async () => {
  const board = await createBoard();
  const before = await Asset.countDocuments();
  const attempt = (input, fetchImpl = imageKitFetch()) => uploadBoardImage({ userId: ownerId, boardId: board._id, buffer: PNG, ...input }, { fetch: fetchImpl });
  await assert.rejects(attempt({ userId: strangerId }), { statusCode: 403 });
  await assert.rejects(attempt({ boardId: 'not-an-id' }), { statusCode: 400 });
  await assert.rejects(attempt({ buffer: Buffer.alloc(0) }), { code: 'EMPTY_FILE' });
  await assert.rejects(attempt({ buffer: Buffer.alloc(MAX_IMAGE_BYTES + 1) }), { code: 'FILE_TOO_LARGE' });
  await assert.rejects(attempt({ buffer: SVG }), { code: 'UNSUPPORTED_IMAGE' });
  await assert.rejects(attempt({}, imageKitFetch({ status: 403, message: 'Storage limit exceeded' })), (err) => err.statusCode === 502 && /Storage limit exceeded/.test(err.message));
  const mismatch = imageKitFetch({ body: { fileType: 'non-image' } });
  await assert.rejects(attempt({}, mismatch), { code: 'PROVIDER_UNVERIFIED' });
  assert.deepEqual(mismatch.calls.map((call) => call.method), ['POST', 'DELETE']);
  assert.equal(await Asset.countDocuments(), before);
  const saved = config.imageKitPrivateKey;
  config.imageKitPrivateKey = '';
  await assert.rejects(attempt({}), { code: 'STORAGE_NOT_CONFIGURED' });
  config.imageKitPrivateKey = saved;
});

test('references are found in nested groups, by asset id or by delivery URL, and ignore data URLs', () => {
  const refs = collectAssetReferences({
    objects: [
      { type: 'Group', objects: [{ type: 'Image', src: 'https://cdn/x.png', metadata: { assetId: 'nested' } }] },
      { type: 'Image', src: 'data:image/png;base64,AAAA' },
      { type: 'Image', src: 'https://cdn/only-url.png' }
    ]
  });
  assert.deepEqual([...refs.assetIds], ['nested']);
  assert.deepEqual([...refs.urls].sort(), ['https://cdn/only-url.png', 'https://cdn/x.png']);
  let deep = {};
  const root = deep;
  for (let i = 0; i < 80; i += 1) deep = deep.child = {};
  assert.throws(() => collectAssetReferences(root), /nested too deeply/);
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-01T03:00:00Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY);
const imageObject = (assetId, url) => ({ type: 'Image', src: url || `https://ik.imagekit.io/skribe-test/skribe/assets/${assetId}.png`, metadata: { assetId } });

const seedAsset = (assetId, fields = {}) => Asset.create({
  assetId,
  owner: ownerId,
  board: new mongoose.Types.ObjectId(),
  status: 'orphaned',
  imageKitFileId: `fid_${assetId}`,
  url: `https://ik.imagekit.io/skribe-test/skribe/assets/${assetId}.png`,
  size: 100,
  uploadedAt: daysAgo(30),
  orphanedAt: daysAgo(8),
  ...fields
});

const statusOf = async (assetId) => (await Asset.findOne({ assetId }).lean()).status;

test('cleanup deletes only unreferenced assets past the seven-day grace period', needsMongo, async () => {
  await Board.deleteMany({});
  await Asset.deleteMany({});
  await createBoard({ objects: [{ type: 'Group', objects: [imageObject('in-group')] }] });
  await createBoard({ objects: [imageObject('shared')] });
  await createBoard({ objects: [imageObject('shared')] });
  await createBoard({ objects: [{ type: 'Image', src: 'https://ik.imagekit.io/skribe-test/skribe/assets/url-only.png' }] });
  await createBoard({ objects: [imageObject('on-deleted-board')] }, { isDeleted: true });

  await seedAsset('in-group');
  await seedAsset('shared');
  await seedAsset('url-only');
  await seedAsset('on-deleted-board');
  await seedAsset('young-pending', { status: 'pending', orphanedAt: daysAgo(6.9) });
  await seedAsset('old-pending', { status: 'pending', orphanedAt: daysAgo(7) });
  await seedAsset('old-orphan', { orphanedAt: daysAgo(20) });
  await seedAsset('removed-today', { status: 'attached', attachedAt: daysAgo(10), orphanedAt: null });
  await seedAsset('no-file-id', { status: 'pending', imageKitFileId: null });
  await Asset.collection.updateOne({ assetId: 'no-file-id' }, { $set: { createdAt: daysAgo(9) } });

  const deleted = [];
  const summary = await runOrphanCleanup({ now: NOW, deleteFile: async (fileId) => { deleted.push(fileId); return 'deleted'; }, logger: {} });

  assert.deepEqual(deleted.sort(), ['fid_old-orphan', 'fid_old-pending']);
  assert.equal(summary.deleted, 2);
  assert.equal(summary.preserved, 4);
  assert.equal(summary.skipped.still_referenced, 4);
  assert.equal(summary.skipped.missing_file_id, 1);
  assert.equal(summary.newlyOrphaned, 1);
  for (const id of ['in-group', 'shared', 'url-only', 'on-deleted-board']) assert.equal(await statusOf(id), 'attached', id);
  assert.equal(await statusOf('young-pending'), 'pending');
  assert.equal(await statusOf('old-pending'), 'deleted');
  assert.equal(await statusOf('no-file-id'), 'pending');
  const removed = await Asset.findOne({ assetId: 'removed-today' }).lean();
  assert.equal(removed.status, 'orphaned');
  assert.equal(removed.orphanedAt.getTime(), NOW.getTime());

  const second = await runOrphanCleanup({ now: NOW, deleteFile: async (fileId) => { deleted.push(fileId); return 'deleted'; }, logger: {} });
  assert.equal(second.deleted, 0);
  assert.equal(deleted.length, 2);

  const later = await runOrphanCleanup({ now: new Date(NOW.getTime() + ORPHAN_GRACE_MS), deleteFile: async (fileId) => { deleted.push(fileId); return 'deleted'; }, logger: {} });
  assert.equal(later.deleted, 2);
  assert.deepEqual(deleted.slice(2).sort(), ['fid_removed-today', 'fid_young-pending']);
});

test('removing an image from one board keeps it while another board still shows it', needsMongo, async () => {
  await Board.deleteMany({});
  await Asset.deleteMany({});
  const first = await createBoard({ objects: [imageObject('two-boards')] });
  await createBoard({ objects: [imageObject('two-boards')] });
  await seedAsset('two-boards', { status: 'attached', orphanedAt: null });
  await Board.updateOne({ _id: first._id }, { $set: { canvasData: { objects: [] } } });
  const summary = await runOrphanCleanup({ now: NOW, deleteFile: async () => assert.fail('must not delete'), logger: {} });
  assert.equal(summary.newlyOrphaned, 0);
  assert.equal(await statusOf('two-boards'), 'attached');
});

test('an asset placed on a board during the grace period is protected by the save hook', needsMongo, async () => {
  await Board.deleteMany({});
  await Asset.deleteMany({});
  const board = await createBoard();
  await seedAsset('placed', { status: 'pending', orphanedAt: daysAgo(6) });
  const canvasData = { objects: [imageObject('placed')] };
  await Board.updateOne({ _id: board._id }, { $set: { canvasData } });
  assert.equal(await syncBoardReferences(board._id, canvasData, ownerId), 1);
  const stored = await Asset.findOne({ assetId: 'placed' }).lean();
  assert.equal(stored.status, 'attached');
  assert.equal(stored.orphanedAt, null);
  assert.deepEqual(stored.boards.map(String), [String(board._id)]);
  const summary = await runOrphanCleanup({ now: new Date(NOW.getTime() + 30 * DAY), deleteFile: async () => assert.fail('must not delete'), logger: {} });
  assert.equal(summary.examined, 0);
  assert.equal(await statusOf('placed'), 'attached');
});

test('failed remote deletes are retried, missing remote files are accepted and a failed reference check deletes nothing', needsMongo, async () => {
  await Board.deleteMany({});
  await Asset.deleteMany({});
  await seedAsset('flaky');
  await seedAsset('gone');
  const failing = await runOrphanCleanup({
    now: NOW,
    deleteFile: async (fileId) => {
      if (fileId === 'fid_flaky') throw new Error('ImageKit delete failed with HTTP 500');
      return 'missing';
    },
    logger: {}
  });
  assert.equal(failing.failed, 1);
  assert.equal(failing.alreadyMissing, 1);
  const flaky = await Asset.findOne({ assetId: 'flaky' }).lean();
  assert.equal(flaky.status, 'orphaned');
  assert.equal(flaky.imageKitFileId, 'fid_flaky');
  assert.match(flaky.lastCleanupError, /HTTP 500/);
  assert.equal(await statusOf('gone'), 'deleted');

  const blind = await runOrphanCleanup({ now: NOW, scanReferences: async () => { throw new Error('db down'); }, deleteFile: async () => assert.fail('must not delete'), logger: {} });
  assert.equal(blind.aborted, 'reference_check_failed');
  assert.equal(await statusOf('flaky'), 'orphaned');

  const retried = await runOrphanCleanup({ now: NOW, deleteFile: async () => 'deleted', logger: {} });
  assert.equal(retried.deleted, 1);
  assert.equal((await Asset.findOne({ assetId: 'flaky' }).lean()).cleanupAttempts, 2);
});

test('a run interrupted mid-delete is picked up again after a restart', needsMongo, async () => {
  await Board.deleteMany({});
  await Asset.deleteMany({});
  await seedAsset('interrupted', { status: 'deleting', deletingAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000), cleanupRunId: 'crashed-run' });
  await seedAsset('in-flight', { status: 'deleting', deletingAt: new Date(NOW.getTime() - 60 * 1000), cleanupRunId: 'other-live-run' });
  const deleted = [];
  await runOrphanCleanup({ now: NOW, deleteFile: async (fileId) => { deleted.push(fileId); return 'deleted'; }, logger: {} });
  assert.deepEqual(deleted, ['fid_interrupted']);
  assert.equal(await statusOf('in-flight'), 'deleting');
});

const memberId = new mongoose.Types.ObjectId();

test('new uploads are sent to ImageKit as private files, recorded as private and returned with a stable reference and a short-lived preview URL', needsMongo, async () => {
  const board = await createBoard();
  const fetchImpl = imageKitFetch();
  const before = Math.floor(Date.now() / 1000);
  const asset = await uploadBoardImage({ userId: ownerId, boardId: board._id, buffer: PNG, originalName: 'private.png' }, { fetch: fetchImpl });
  assert.equal(fetchImpl.calls[0].multipart, true);
  assert.equal(fetchImpl.calls[0].privateFlag, 'true');
  assert.deepEqual(fetchImpl.calls[0].responseFields, ['isPrivateFile']);
  assert.equal(asset.privacy, 'private');
  assert.equal(asset.src, `skribe-asset:${asset.assetId}`);
  const stored = await Asset.findOne({ assetId: asset.assetId }).lean();
  assert.equal(stored.privacy, 'private');
  assert.equal(stored.filePath, `/skribe/assets/${asset.assetId}.png`);
  const delivery = new URL(asset.delivery.url);
  assert.equal(delivery.pathname, `/skribe-test/skribe/assets/${asset.assetId}.png`);
  const expiry = Number(delivery.searchParams.get('ik-t'));
  assert.ok(expiry >= before + config.imageKitSignedUrlTtlSeconds && expiry <= before + config.imageKitSignedUrlTtlSeconds + 5);
  assert.equal(asset.delivery.expiresAt, expiry * 1000);
  assert.equal(JSON.stringify(asset).includes('private_test'), false);
  assert.equal(JSON.stringify(stored).includes('ik-s'), false);

  const publicResponse = imageKitFetch({ body: { isPrivateFile: false } });
  await assert.rejects(uploadBoardImage({ userId: ownerId, boardId: board._id, buffer: PNG }, { fetch: publicResponse }), (err) => err.code === 'PROVIDER_UNVERIFIED');
  assert.deepEqual(publicResponse.calls.map((call) => call.method), ['POST', 'DELETE']);
  assert.equal(await Asset.countDocuments({ assetId: { $ne: asset.assetId }, owner: ownerId, board: board._id, privacy: { $exists: false }, status: 'pending' }), 0);

  const fake = imageKitFetch();
  const withoutResponseFields = async (url, init) => {
    if (init.method !== 'POST') return fake(url, init);
    const stripped = new FormData();
    for (const [key, value] of init.body.entries()) if (key !== 'responseFields') stripped.append(key, value);
    const response = await fake(url, { ...init, body: stripped });
    const body = await response.clone().json();
    assert.equal('isPrivateFile' in body, false);
    return response;
  };
  const recordsBefore = await Asset.countDocuments({});
  await assert.rejects(uploadBoardImage({ userId: ownerId, boardId: board._id, buffer: PNG }, { fetch: withoutResponseFields }), (err) => err.code === 'PROVIDER_UNVERIFIED' && err.statusCode === 502);
  assert.deepEqual(fake.calls.map((call) => call.method), ['POST', 'DELETE']);
  assert.deepEqual(fake.calls[0].responseFields, []);
  assert.equal(await Asset.countDocuments({}), recordsBefore);
});

test('delivery URLs are signed with the documented ImageKit algorithm over the path and expiry', () => {
  const issued = signDeliveryUrl('/skribe/assets/abc.png', { ttlSeconds: 60 });
  const url = new URL(issued.url);
  const expiry = url.searchParams.get('ik-t');
  const unsigned = `${url.origin}${url.pathname}`;
  const stringToSign = unsigned.replace('https://ik.imagekit.io/skribe-test/', '') + expiry;
  assert.equal(url.searchParams.get('ik-s'), crypto.createHmac('sha1', 'private_test').update(stringToSign).digest('hex'));
  assert.ok(Math.abs(Number(expiry) - (Math.floor(Date.now() / 1000) + 60)) <= 2);
  assert.equal(issued.expiresAt, Number(expiry) * 1000);
  assert.equal(issued.url.includes('private_test'), false);
});

test('signed URLs are issued only to board members, only for private assets attached to that board, in bounded batches', needsMongo, async () => {
  await Asset.deleteMany({});
  const board = await createBoard({ objects: [] }, { members: [memberId] });
  const other = await createBoard();
  const make = (assetId, fields) => Asset.create({ assetId, owner: ownerId, board: board._id, status: 'attached', imageKitFileId: `fid_${assetId}`, filePath: `/skribe/assets/${assetId}.png`, url: `https://ik.imagekit.io/skribe-test/skribe/assets/${assetId}.png`, privacy: 'private', ...fields });
  await make('mine-private', {});
  await make('reused', { board: other._id, boards: [other._id, board._id] });
  await make('legacy-public', { privacy: undefined });
  await make('other-board', { board: other._id, boards: [other._id] });
  await make('gone', { status: 'deleted' });
  await make('foreign', { owner: strangerId, board: other._id, boards: [other._id] });
  const ask = (userId, assetIds, boardId = board._id) => signBoardAssets({ boardId: String(boardId), userId, assetIds });
  for (const userId of [ownerId, memberId]) {
    const result = await ask(userId, ['mine-private', 'reused', 'legacy-public', 'other-board', 'gone', 'foreign', 'unknown', 'mine-private']);
    assert.deepEqual(Object.keys(result.urls).sort(), ['mine-private', 'reused']);
    assert.match(result.urls['mine-private'].url, /\/skribe\/assets\/mine-private\.png\?ik-t=\d+&ik-s=[0-9a-f]{40}$/);
    assert.deepEqual(result.publicAssets, ['legacy-public']);
    assert.deepEqual(result.rejected.sort(), ['foreign', 'gone', 'other-board', 'unknown']);
  }
  await assert.rejects(ask(strangerId, ['mine-private']), (err) => err.statusCode === 403);
  assert.deepEqual(Object.keys((await ask(ownerId, ['other-board', 'reused', 'mine-private'], other._id)).urls).sort(), ['other-board', 'reused']);
  for (const bad of [[], 'mine-private', [''], ['../x'], [{}], Array.from({ length: MAX_SIGN_BATCH + 1 }, (_, i) => `a${i}`)]) {
    await assert.rejects(ask(ownerId, bad), (err) => err.statusCode === 400 && err.code === 'INVALID_ASSET_IDS');
  }
  await Board.updateOne({ _id: board._id }, { $set: { members: [] } });
  await assert.rejects(ask(memberId, ['mine-private']), (err) => err.statusCode === 403);
});

test('a board save can link only assets its author owns or can already reach, never another user\'s asset by URL, id or reference', needsMongo, async () => {
  await Asset.deleteMany({});
  const victimBoard = await createBoard({ objects: [] }, { members: [memberId] });
  const strangerBoard = await Board.create({ owner: strangerId, title: 'Stranger', canvasData: { objects: [] } });
  const memberBoard = await Board.create({ owner: memberId, title: 'Member', canvasData: { objects: [] } });
  await seedAsset('victim', { status: 'attached', board: victimBoard._id, boards: [victimBoard._id], orphanedAt: null });
  const boardsOf = async (assetId) => (await Asset.findOne({ assetId }).lean()).boards.map(String).sort();
  const victimUrl = 'https://ik.imagekit.io/skribe-test/skribe/assets/victim.png';
  for (const object of [{ type: 'Image', src: victimUrl }, imageObject('victim'), { type: 'Image', src: 'skribe-asset:victim' }]) {
    assert.equal(await syncBoardReferences(strangerBoard._id, { objects: [object] }, strangerId), 0);
  }
  assert.deepEqual(await boardsOf('victim'), [String(victimBoard._id)]);
  assert.equal(await syncBoardReferences(strangerBoard._id, { objects: [imageObject('victim')] }), 0);
  assert.equal(await syncBoardReferences(victimBoard._id, { objects: [imageObject('victim')] }, memberId), 1);
  assert.equal(await syncBoardReferences(memberBoard._id, { objects: [{ type: 'Image', src: 'skribe-asset:victim' }] }, memberId), 1);
  assert.deepEqual(await boardsOf('victim'), [String(victimBoard._id), String(memberBoard._id)].sort());
  await seedAsset('own', { status: 'pending', board: new mongoose.Types.ObjectId() });
  assert.equal(await syncBoardReferences(strangerBoard._id, { objects: [imageObject('own')] }, ownerId), 1);
  await Board.updateOne({ _id: victimBoard._id }, { $set: { members: [] } });
  const outsider = await Board.create({ owner: memberId, title: 'Later', canvasData: { objects: [] } });
  assert.equal(await syncBoardReferences(outsider._id, { objects: [imageObject('victim')] }, memberId), 1);
  assert.equal((await boardsOf('victim')).includes(String(outsider._id)), true);
});

test('deleted boards protect their images for the 30-day retention period, then their images follow the seven-day orphan grace period', needsMongo, async () => {
  await Board.deleteMany({});
  await Asset.deleteMany({});
  await createBoard({ objects: [imageObject('active')] });
  await createBoard({ objects: [imageObject('recoverable')] }, { isDeleted: true, deletedAt: daysAgo(5) });
  await createBoard({ objects: [imageObject('expired')] }, { isDeleted: true, deletedAt: daysAgo(31) });
  const legacy = await createBoard({ objects: [imageObject('legacy-deleted')] }, { isDeleted: true });
  await Board.collection.updateOne({ _id: legacy._id }, { $set: { updatedAt: daysAgo(40) }, $unset: { deletedAt: '' } });
  const gone = await createBoard({ objects: [imageObject('hard-deleted')] });
  await Board.deleteOne({ _id: gone._id });
  for (const id of ['active', 'recoverable', 'expired', 'legacy-deleted', 'hard-deleted']) await seedAsset(id, { status: 'attached', orphanedAt: null, attachedAt: daysAgo(60) });
  const deleted = [];
  const deleteFile = async (fileId) => { deleted.push(fileId); return 'deleted'; };
  const first = await runOrphanCleanup({ now: NOW, deleteFile, logger: {} });
  assert.equal(first.deleted, 0);
  for (const id of ['active', 'recoverable']) assert.equal(await statusOf(id), 'attached', id);
  for (const id of ['expired', 'legacy-deleted', 'hard-deleted']) assert.equal(await statusOf(id), 'orphaned', id);
  const withinGrace = await runOrphanCleanup({ now: new Date(NOW.getTime() + ORPHAN_GRACE_MS - 1000), deleteFile, logger: {} });
  assert.equal(withinGrace.deleted, 0);
  const afterGrace = await runOrphanCleanup({ now: new Date(NOW.getTime() + ORPHAN_GRACE_MS), deleteFile, logger: {} });
  assert.deepEqual(deleted.sort(), ['fid_expired', 'fid_hard-deleted', 'fid_legacy-deleted']);
  assert.equal(afterGrace.deleted, 3);
  assert.equal(await statusOf('recoverable'), 'attached');
  const afterRetention = await runOrphanCleanup({ now: new Date(daysAgo(5).getTime() + DELETED_BOARD_RETENTION_MS + 1000), deleteFile, logger: {} });
  assert.equal(afterRetention.newlyOrphaned, 1);
  assert.equal(await statusOf('recoverable'), 'orphaned');
  assert.equal(await statusOf('active'), 'attached');
});

test('soft-deleting a board records when it was deleted', needsMongo, async () => {
  const board = await createBoard();
  const { default: boardRepository } = await import('../repositories/board.repository.js');
  await boardRepository.softDeleteBoard(board._id);
  const stored = await Board.findById(board._id).lean();
  assert.equal(stored.isDeleted, true);
  assert.ok(stored.deletedAt instanceof Date && Date.now() - stored.deletedAt.getTime() < 60000);
});
