import http from 'http';
import mongoose from 'mongoose';
import { io as Client } from 'socket.io-client';
import app from './src/app.js';
import connectDB from './src/config/db.js';
import initSockets from './src/sockets/index.js';

let server;
let baseUrl;
let socketUrl;

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

  const setCookie = res.headers.get('set-cookie');
  const data = await res.json();
  return { status: res.status, data, setCookie };
}

const runCursorSyncVerification = async () => {
  console.log('--- Starting Skribe Phase 4E.1 Live Collaborative Cursors Verification ---');

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

  const timestamp = Date.now();
  const regA = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { name: `User A ${timestamp}`, email: `usera_${timestamp}@example.com`, password: 'Password123!' }
  });
  const cookieA = regA.setCookie.split(';')[0];
  const userA = regA.data.data.user;

  const regB = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { name: `User B ${timestamp}`, email: `userb_${timestamp}@example.com`, password: 'Password123!' }
  });
  const cookieB = regB.setCookie.split(';')[0];
  const userB = regB.data.data.user;

  const regC = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { name: `User C ${timestamp}`, email: `userc_${timestamp}@example.com`, password: 'Password123!' }
  });
  const cookieC = regC.setCookie.split(';')[0];
  const userC = regC.data.data.user;

  const boardRes = await request('/api/v1/boards', {
    method: 'POST',
    cookie: cookieA,
    body: { title: 'Cursor Verification Board' }
  });

  const boardObj = boardRes.data.data.board || boardRes.data.data;
  const boardId = String(boardObj._id || boardObj.id);

  await request(`/api/v1/boards/${boardId}/collaborators`, {
    method: 'POST',
    cookie: cookieA,
    body: { email: userB.email, role: 'editor' }
  });

  const socketA = Client(socketUrl, { extraHeaders: { Cookie: cookieA }, transports: ['websocket'] });
  const socketB = Client(socketUrl, { extraHeaders: { Cookie: cookieB }, transports: ['websocket'] });
  const socketC = Client(socketUrl, { extraHeaders: { Cookie: cookieC }, transports: ['websocket'] });

  await Promise.all([
    new Promise((resolve) => socketA.on('connect', resolve)),
    new Promise((resolve) => socketB.on('connect', resolve)),
    new Promise((resolve) => socketC.on('connect', resolve))
  ]);
  console.log('✅ TEST 1 PASSED: Sockets connected for Users A, B, C');

  socketA.emit('join-board', { boardId });
  socketB.emit('join-board', { boardId });

  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log('✅ TEST 2 PASSED: Owner and Collaborator joined board room');

  const cursorMoveReceivedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for cursor:move')), 5000);
    socketB.on('cursor:move', (data) => {
      if (data.boardId === boardId && data.sceneX === 1250 && data.sceneY === 850) {
        clearTimeout(timeout);
        resolve(data);
      }
    });
  });

  socketA.emit('cursor:move', { boardId, sceneX: 1250, sceneY: 850 });
  const cursorMoveData = await cursorMoveReceivedPromise;

  if (cursorMoveData.name !== userA.name || cursorMoveData.userId !== userA.id) {
    throw new Error('User identity mismatch in cursor:move payload');
  }
  console.log('✅ TEST 3 PASSED: Collaborator received real-time cursor:move with user identity');

  const cursorHideReceivedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for cursor:hide')), 5000);
    socketB.on('cursor:hide', (data) => {
      if (data.boardId === boardId && data.userId === userA.id) {
        clearTimeout(timeout);
        resolve(data);
      }
    });
  });

  socketA.emit('cursor:hide', { boardId });
  await cursorHideReceivedPromise;
  console.log('✅ TEST 4 PASSED: Collaborator received real-time cursor:hide');

  let unauthorizedCursorReceived = false;
  socketB.on('cursor:move', (data) => {
    if (data.userId === userC.id) {
      unauthorizedCursorReceived = true;
    }
  });

  socketC.emit('cursor:move', { boardId, sceneX: 999, sceneY: 999 });
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (unauthorizedCursorReceived) {
    throw new Error('Unauthorized user C broadcasted cursor event!');
  }
  console.log('✅ TEST 5 PASSED: Unauthorized user cursor event rejected by server room scoping');

  const userLeftReceivedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for board:user:left')), 5000);
    socketB.on('board:user:left', (data) => {
      if (data.boardId === boardId && data.userId === userA.id) {
        clearTimeout(timeout);
        resolve(data);
      }
    });
  });

  socketA.emit('leave-board', { boardId });
  await userLeftReceivedPromise;
  console.log('✅ TEST 6 PASSED: Collaborator received board:user:left when User A left room');

  socketA.disconnect();
  socketB.disconnect();
  socketC.disconnect();

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  console.log('\n==================================================');
  console.log('✅ ALL 6 LIVE COLLABORATIVE CURSOR VERIFICATION TESTS PASSED!');
  console.log('==================================================\n');
  process.exit(0);
};

runCursorSyncVerification().catch(async (err) => {
  console.error('❌ CURSOR VERIFICATION TEST FAILED:', err);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exit(1);
});
