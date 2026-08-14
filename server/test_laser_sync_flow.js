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

async function request(path, options = {}) {
  const url = new URL(path, baseUrl);
  const bodyData = options.body ? JSON.stringify(options.body) : null;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: options.method || 'GET',
        headers
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let data;
          try {
            data = JSON.parse(raw);
          } catch (e) {
            data = raw;
          }
          const setCookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0] : null;
          resolve({ status: res.statusCode, data, setCookie });
        });
      }
    );

    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function runLaserSyncVerification() {
  console.log('--- Starting Skribe Phase 4D Laser Synchronization Verification ---');
  await connectDB();

  server = http.createServer(app);
  initSockets(server);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const ts = Date.now();
  const ownerReg = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { name: 'Laser Owner', email: `laser_owner_${ts}@test.com`, password: 'Password123!' }
  });
  const ownerCookie = ownerReg.setCookie.split(';')[0];
  const ownerUser = ownerReg.data.data.user;

  const collabReg = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { name: 'Laser Collab', email: `laser_collab_${ts}@test.com`, password: 'Password123!' }
  });
  const collabCookie = collabReg.setCookie.split(';')[0];
  const collabUser = collabReg.data.data.user;

  const strangerReg = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { name: 'Laser Stranger', email: `laser_stranger_${ts}@test.com`, password: 'Password123!' }
  });
  const strangerCookie = strangerReg.setCookie.split(';')[0];

  const boardRes = await request('/api/v1/boards', {
    method: 'POST',
    cookie: ownerCookie,
    body: { title: 'Laser Verification Board' }
  });
  const boardId = boardRes.data.data.board.id;

  await request(`/api/v1/boards/${boardId}/collaborators`, {
    method: 'POST',
    cookie: ownerCookie,
    body: { email: collabUser.email }
  });

  const ownerSocket = Client(baseUrl, {
    extraHeaders: { cookie: ownerCookie }
  });

  const collabSocket = Client(baseUrl, {
    extraHeaders: { cookie: collabCookie }
  });

  const strangerSocket = Client(baseUrl, {
    extraHeaders: { cookie: strangerCookie }
  });

  await Promise.all([
    new Promise((res) => ownerSocket.on('connect', res)),
    new Promise((res) => collabSocket.on('connect', res)),
    new Promise((res) => strangerSocket.on('connect', res))
  ]);

  console.log('✅ TEST 1 PASSED: Sockets connected');

  const ownerJoinedPromise = new Promise((res) => ownerSocket.once('board-joined', res));
  const collabJoinedPromise = new Promise((res) => collabSocket.once('board-joined', res));

  ownerSocket.emit('join-board', { boardId });
  collabSocket.emit('join-board', { boardId });

  await Promise.all([ownerJoinedPromise, collabJoinedPromise]);
  console.log('✅ TEST 2 PASSED: Owner and Collaborator joined board room');

  let receivedLaserMove = null;
  collabSocket.on('laser:move', (payload) => {
    receivedLaserMove = payload;
  });

  ownerSocket.emit('laser:move', {
    boardId,
    sceneX: 250,
    sceneY: 450,
    color: '#ef4444',
    width: 8
  });

  await new Promise((r) => setTimeout(r, 200));

  if (!receivedLaserMove || receivedLaserMove.sceneX !== 250 || receivedLaserMove.sceneY !== 450) {
    throw new Error('TEST 3 FAILED: Collaborator did not receive laser:move');
  }
  console.log('✅ TEST 3 PASSED: Collaborator received real-time laser:move');

  let receivedLaserHide = null;
  collabSocket.on('laser:hide', (payload) => {
    receivedLaserHide = payload;
  });

  ownerSocket.emit('laser:hide', { boardId });

  await new Promise((r) => setTimeout(r, 200));

  if (!receivedLaserHide || receivedLaserHide.boardId !== boardId) {
    throw new Error('TEST 4 FAILED: Collaborator did not receive laser:hide');
  }
  console.log('✅ TEST 4 PASSED: Collaborator received real-time laser:hide');

  let strangerLaserReceived = false;
  ownerSocket.on('laser:move', (payload) => {
    if (payload.sceneX === 9999) {
      strangerLaserReceived = true;
    }
  });

  strangerSocket.emit('laser:move', {
    boardId,
    sceneX: 9999,
    sceneY: 9999,
    color: '#00ff00',
    width: 8
  });

  await new Promise((r) => setTimeout(r, 200));

  if (strangerLaserReceived) {
    throw new Error('TEST 5 FAILED: Stranger laser event was illegally broadcast!');
  }
  console.log('✅ TEST 5 PASSED: Unauthorized user laser event rejected by server authorization');

  ownerSocket.disconnect();
  collabSocket.disconnect();
  strangerSocket.disconnect();

  await User.deleteMany({ email: { $in: [`laser_owner_${ts}@test.com`, `laser_collab_${ts}@test.com`, `laser_stranger_${ts}@test.com`] } });
  await Board.deleteOne({ _id: boardId });

  server.close();
  await mongoose.disconnect();

  console.log('\n==================================================');
  console.log('✅ ALL 5 LASER SYNCHRONIZATION VERIFICATION TESTS PASSED!');
  console.log('==================================================\n');
  process.exit(0);
}

runLaserSyncVerification().catch((err) => {
  console.error('\n❌ LASER SYNCHRONIZATION VERIFICATION FAILED:', err);
  if (server) server.close();
  mongoose.disconnect();
  process.exit(1);
});
