import http from 'http';
import mongoose from 'mongoose';
import { io as Client } from 'socket.io-client';
import app from './src/app.js';
import connectDB from './src/config/db.js';
import initSockets from './src/sockets/index.js';
import User from './src/models/User.js';
import Board from './src/models/Board.js';

let server;
let baseUrl;
let socketUrl;

let ownerCookie;
let collaboratorCookie;
let strangerCookie;

let ownerUser;
let collaboratorUser;
let strangerUser;

let boardA;

let ownerSocket;
let collaboratorSocket;
let strangerSocket;

async function request(path, options = {}) {
  const url = new URL(path, baseUrl);
  const headers = { ...options.headers };

  if (options.cookie) {
    headers['Cookie'] = options.cookie;
  }
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const getCookieHeader = res.headers.get('set-cookie');
  const responseData = await res.json();
  return { status: res.status, headers: res.headers, setCookie: getCookieHeader, data: responseData };
}

async function runCanvasSyncVerification() {
  console.log('--- Starting Skribe Phase 4D Real-Time Canvas Sync Verification ---');

  await connectDB();

  server = http.createServer(app);
  initSockets(server);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      socketUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const ts = Date.now();
  const ownerReg = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { name: 'Owner 4D', email: `owner_4d_${ts}@test.com`, password: 'Password123!' }
  });
  ownerCookie = ownerReg.setCookie.split(';')[0];
  ownerUser = ownerReg.data.data.user;

  const collabReg = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { name: 'Collaborator 4D', email: `collab_4d_${ts}@test.com`, password: 'Password123!' }
  });
  collaboratorCookie = collabReg.setCookie.split(';')[0];
  collaboratorUser = collabReg.data.data.user;

  const strangerReg = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { name: 'Stranger 4D', email: `stranger_4d_${ts}@test.com`, password: 'Password123!' }
  });
  strangerCookie = strangerReg.setCookie.split(';')[0];
  strangerUser = strangerReg.data.data.user;

  const boardRes = await request('/api/v1/boards', {
    method: 'POST',
    cookie: ownerCookie,
    body: { title: 'Sync Test Board' }
  });
  boardA = boardRes.data.data.board;

  await request(`/api/v1/boards/${boardA.id}/collaborators`, {
    method: 'POST',
    cookie: ownerCookie,
    body: { email: collaboratorUser.email }
  });

  ownerSocket = Client(socketUrl, { extraHeaders: { cookie: ownerCookie } });
  collaboratorSocket = Client(socketUrl, { extraHeaders: { cookie: collaboratorCookie } });
  strangerSocket = Client(socketUrl, { extraHeaders: { cookie: strangerCookie } });

  await Promise.all([
    new Promise((res) => ownerSocket.on('connect', res)),
    new Promise((res) => collaboratorSocket.on('connect', res)),
    new Promise((res) => strangerSocket.on('connect', res))
  ]);
  console.log('✅ TEST 1 PASSED: Sockets connected');

  const ownerJoinedPromise = new Promise((res) => ownerSocket.once('board-joined', res));
  const collabJoinedPromise = new Promise((res) => collaboratorSocket.once('board-joined', res));

  ownerSocket.emit('join-board', { boardId: boardA.id });
  collaboratorSocket.emit('join-board', { boardId: boardA.id });

  await Promise.all([ownerJoinedPromise, collabJoinedPromise]);
  console.log('✅ TEST 2 PASSED: Owner and Collaborator joined board room');

  const shapeData = { type: 'rect', left: 100, top: 100, width: 50, height: 50, fill: '#ff0000', id: 'shape_123' };

  let receivedObjectAdded = null;
  collaboratorSocket.on('canvas:object-added', (payload) => {
    receivedObjectAdded = payload;
  });

  ownerSocket.emit('canvas:object-added', {
    boardId: boardA.id,
    objectId: 'shape_123',
    objectData: shapeData
  });

  await new Promise((r) => setTimeout(r, 200));

  if (!receivedObjectAdded || receivedObjectAdded.objectId !== 'shape_123') {
    throw new Error('TEST 3 FAILED: Collaborator did not receive canvas:object-added');
  }
  console.log('✅ TEST 3 PASSED: Collaborator received real-time canvas:object-added');

  const strokeData = { type: 'path', path: [['M', 0, 0], ['L', 10, 10]], stroke: '#00ff00', id: 'path_456' };

  let receivedPathCreated = null;
  ownerSocket.on('canvas:path-created', (payload) => {
    receivedPathCreated = payload;
  });

  collaboratorSocket.emit('canvas:path-created', {
    boardId: boardA.id,
    objectId: 'path_456',
    objectData: strokeData
  });

  await new Promise((r) => setTimeout(r, 200));

  if (!receivedPathCreated || receivedPathCreated.objectId !== 'path_456') {
    throw new Error('TEST 4 FAILED: Owner did not receive canvas:path-created');
  }
  console.log('✅ TEST 4 PASSED: Owner received real-time canvas:path-created');

  const modifiedData = { type: 'rect', left: 200, top: 200, width: 100, height: 100, fill: '#ff0000', id: 'shape_123' };

  let receivedObjectModified = null;
  collaboratorSocket.on('canvas:object-modified', (payload) => {
    receivedObjectModified = payload;
  });

  ownerSocket.emit('canvas:object-modified', {
    boardId: boardA.id,
    objectId: 'shape_123',
    objectData: modifiedData
  });

  await new Promise((r) => setTimeout(r, 200));

  if (!receivedObjectModified || receivedObjectModified.objectId !== 'shape_123') {
    throw new Error('TEST 5 FAILED: Collaborator did not receive canvas:object-modified');
  }
  console.log('✅ TEST 5 PASSED: Collaborator received real-time canvas:object-modified');

  let receivedObjectRemoved = null;
  ownerSocket.on('canvas:object-removed', (payload) => {
    receivedObjectRemoved = payload;
  });

  collaboratorSocket.emit('canvas:object-removed', {
    boardId: boardA.id,
    objectId: 'shape_123',
    objectIds: ['shape_123']
  });

  await new Promise((r) => setTimeout(r, 200));

  if (!receivedObjectRemoved || receivedObjectRemoved.objectId !== 'shape_123') {
    throw new Error('TEST 6 FAILED: Owner did not receive canvas:object-removed');
  }
  console.log('✅ TEST 6 PASSED: Owner received real-time canvas:object-removed');

  let strangerBroadcastReceived = false;
  ownerSocket.on('canvas:object-added', (payload) => {
    if (payload.objectId === 'stranger_hacked') {
      strangerBroadcastReceived = true;
    }
  });

  strangerSocket.emit('canvas:object-added', {
    boardId: boardA.id,
    objectId: 'stranger_hacked',
    objectData: { type: 'rect' }
  });

  await new Promise((r) => setTimeout(r, 200));

  if (strangerBroadcastReceived) {
    throw new Error('TEST 7 FAILED: Unauthorized user successfully broadcasted to board room!');
  }
  console.log('✅ TEST 7 PASSED: Unauthorized user broadcast rejected by server authorization');

  ownerSocket.disconnect();
  collaboratorSocket.disconnect();
  strangerSocket.disconnect();

  await User.deleteMany({ email: { $in: [`owner_4d_${ts}@test.com`, `collab_4d_${ts}@test.com`, `stranger_4d_${ts}@test.com`] } });
  await Board.deleteOne({ _id: boardA.id });

  server.close();
  await mongoose.disconnect();

  console.log('\n==================================================');
  console.log('✅ ALL 7 REAL-TIME CANVAS SYNC VERIFICATION TESTS PASSED!');
  console.log('==================================================\n');
  process.exit(0);
}

runCanvasSyncVerification().catch((err) => {
  console.error('\n❌ REAL-TIME CANVAS SYNC VERIFICATION FAILED:', err);
  if (server) server.close();
  mongoose.disconnect();
  process.exit(1);
});
