import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import config from '../config/env.js';
import Asset from '../models/Asset.js';
import Board from '../models/Board.js';
import { inspectImage, MAX_IMAGE_BYTES } from '../utils/imageFormat.js';
import { createUploadHandler, limitConcurrentUploads, receiveImageBody } from '../controllers/asset.controller.js';
import {
  ORPHAN_GRACE_MS,
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
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const file = init.body.get('file');
    const fileName = init.body.get('fileName');
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
  assert.equal(await syncBoardReferences(board._id, canvasData), 1);
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
