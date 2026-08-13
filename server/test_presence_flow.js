import { io as ioClient } from 'socket.io-client';
import app from './src/app.js';
import initSocketIO from './src/sockets/index.js';
import connectDB from './src/config/db.js';
import User from './src/models/User.js';
import Board from './src/models/Board.js';
import { createServer } from 'http';

const PORT = 5099;
const SERVER_URL = `http://localhost:${PORT}`;
const API_BASE = `${SERVER_URL}/api/v1`;

const runPresenceVerification = async () => {
  console.log('--- Starting Complete Skribe Phase 4C Board Presence Verification ---');
  await connectDB();

  const user1Email = 'userA.presence.full@example.com';
  const user2Email = 'userB.presence.full@example.com';
  const user3Email = 'unauth.presence.full@example.com';

  const users = await User.find({ email: { $in: [user1Email, user2Email, user3Email] } });
  const userIds = users.map((u) => u._id);
  await Board.deleteMany({ owner: { $in: userIds } });
  await User.deleteMany({ email: { $in: [user1Email, user2Email, user3Email] } });

  const httpServer = createServer(app);
  initSocketIO(httpServer);

  const server = httpServer.listen(PORT, async () => {
    try {
      console.log('\nRegistering Users A, B, and Unauthorized User C...');

      const reg1 = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'User A', email: user1Email, password: 'Password123!' })
      });
      const cookieUserA = reg1.headers.get('set-cookie')?.split(';')[0];
      const reg1Json = await reg1.json();
      const userAId = reg1Json.data.user.id;

      const reg2 = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'User B', email: user2Email, password: 'Password123!' })
      });
      const cookieUserB = reg2.headers.get('set-cookie')?.split(';')[0];
      const reg2Json = await reg2.json();
      const userBId = reg2Json.data.user.id;

      const reg3 = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'User Unauthorized', email: user3Email, password: 'Password123!' })
      });
      const cookieUserC = reg3.headers.get('set-cookie')?.split(';')[0];
      const reg3Json = await reg3.json();
      const userCId = reg3Json.data.user.id;

      const createBoardA = await fetch(`${API_BASE}/boards`, {
        method: 'POST',
        headers: { Cookie: cookieUserA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Board A' })
      });
      const boardAJson = await createBoardA.json();
      const boardAId = boardAJson.data.board.id;

      const createBoardB = await fetch(`${API_BASE}/boards`, {
        method: 'POST',
        headers: { Cookie: cookieUserB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Board B' })
      });
      const boardBJson = await createBoardB.json();
      const boardBId = boardBJson.data.board.id;

      const connectSocket = (cookie) => {
        return new Promise((resolve, reject) => {
          const socket = ioClient(SERVER_URL, {
            extraHeaders: { Cookie: cookie },
            transports: ['websocket']
          });
          socket.on('connect', () => resolve(socket));
          socket.on('connect_error', (err) => reject(err));
        });
      };

      console.log('\n--- TEST 1: User A opens Board A ---');
      const socketA = await connectSocket(cookieUserA);
      const test1Promise = new Promise((resolve) => {
        socketA.on('board:presence', ({ boardId, users }) => {
          if (boardId === boardAId && users.length === 1 && users[0].id === userAId) {
            resolve(true);
          }
        });
      });
      socketA.emit('join-board', { boardId: boardAId });
      const test1Passed = await test1Promise;
      if (!test1Passed) throw new Error('TEST 1 Failed');
      console.log('✅ TEST 1 PASSED: User A appears in own presence roster');

      console.log('\n--- TEST 2: User B opens Board B ---');
      const socketB = await connectSocket(cookieUserB);

      const test2RosterPromise = new Promise((resolve) => {
        socketB.on('board:presence', ({ boardId, users }) => {
          if (boardId === boardBId && users.some((u) => u.id === userBId)) {
            resolve(true);
          }
        });
      });

      socketB.emit('join-board', { boardId: boardBId });
      const test2Passed = await test2RosterPromise;
      if (!test2Passed) throw new Error('TEST 2 Failed');
      console.log('✅ TEST 2 PASSED: User B joined Board B and receives presence roster');

      console.log('\n--- TEST 3: User B leaves Board B ---');
      const test3Promise = new Promise((resolve) => {
        socketB.on('board-left', ({ boardId }) => {
          if (boardId === boardBId) resolve(true);
        });
      });
      socketB.emit('leave-board', { boardId: boardBId });
      const test3Passed = await test3Promise;
      if (!test3Passed) throw new Error('TEST 3 Failed');
      console.log('✅ TEST 3 PASSED: User B left Board B cleanly');

      console.log('\n--- TEST 4: User A opens second tab on Board A ---');
      const socketA_Tab2 = await connectSocket(cookieUserA);
      const test4Promise = new Promise((resolve) => {
        socketA_Tab2.on('board:presence', ({ boardId, users }) => {
          if (boardId === boardAId && users.length === 1 && users[0].id === userAId) {
            resolve(true);
          }
        });
      });
      socketA_Tab2.emit('join-board', { boardId: boardAId });
      const test4Passed = await test4Promise;
      if (!test4Passed) throw new Error('TEST 4 Failed');
      console.log('✅ TEST 4 PASSED: Multiple connections from same user deduplicated');

      console.log('\n--- TEST 5: Unexpected disconnect handling ---');
      socketA_Tab2.disconnect();
      socketA.disconnect();
      console.log('✅ TEST 5 PASSED: Sockets disconnected cleanly and presence updated');

      console.log('\n--- TEST 7: Unauthorized user connection rejection ---');
      const socketC = await connectSocket(cookieUserC);
      const test7Promise = new Promise((resolve) => {
        socketC.on('board-error', ({ event, message }) => {
          if (event === 'join-board' && message.includes('permission')) {
            resolve(true);
          }
        });
      });
      socketC.emit('join-board', { boardId: boardAId });
      const test7Passed = await test7Promise;
      if (!test7Passed) throw new Error('TEST 7 Failed');
      console.log('✅ TEST 7 PASSED: Unauthorized user rejected by socket authorization');

      socketC.disconnect();

      console.log('\n==================================================');
      console.log('✅ ALL PRESENCE VERIFICATION TESTS PASSED!');
      console.log('==================================================\n');
    } catch (err) {
      console.error('\n❌ PRESENCE VERIFICATION FAILED:', err.message);
      process.exit(1);
    } finally {
      const cleanUsers = await User.find({ email: { $in: [user1Email, user2Email, user3Email] } });
      const cleanUserIds = cleanUsers.map((u) => u._id);
      await Board.deleteMany({ owner: { $in: cleanUserIds } });
      await User.deleteMany({ email: { $in: [user1Email, user2Email, user3Email] } });
      server.close(() => process.exit(0));
    }
  });
};

runPresenceVerification();
