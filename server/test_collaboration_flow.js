import { io as ioClient } from 'socket.io-client';
import app from './src/app.js';
import initSocketIO from './src/sockets/index.js';
import connectDB from './src/config/db.js';
import User from './src/models/User.js';
import Board from './src/models/Board.js';
import { createServer } from 'http';

const PORT = 5100;
const SERVER_URL = `http://localhost:${PORT}`;
const API_BASE = `${SERVER_URL}/api/v1`;

const runCollaborationVerification = async () => {
  console.log('--- Starting Skribe Board Collaboration & Sharing Foundation Verification ---');
  await connectDB();

  const ownerEmail = 'owner.collab@example.com';
  const collaboratorEmail = 'collaborator.collab@example.com';
  const strangerEmail = 'stranger.collab@example.com';

  const existingUsers = await User.find({ email: { $in: [ownerEmail, collaboratorEmail, strangerEmail] } });
  const existingUserIds = existingUsers.map((u) => u._id);
  await Board.deleteMany({ owner: { $in: existingUserIds } });
  await User.deleteMany({ email: { $in: [ownerEmail, collaboratorEmail, strangerEmail] } });

  const httpServer = createServer(app);
  initSocketIO(httpServer);

  const server = httpServer.listen(PORT, async () => {
    try {
      console.log('\n1. Registering Owner, Collaborator, and Stranger...');

      const regOwner = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Owner User', email: ownerEmail, password: 'Password123!' })
      });
      const cookieOwner = regOwner.headers.get('set-cookie')?.split(';')[0];
      const ownerJson = await regOwner.json();
      const ownerId = ownerJson.data.user.id;

      const regCollab = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Collab User', email: collaboratorEmail, password: 'Password123!' })
      });
      const cookieCollab = regCollab.headers.get('set-cookie')?.split(';')[0];
      const collabJson = await regCollab.json();
      const collabId = collabJson.data.user.id;

      const regStranger = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Stranger User', email: strangerEmail, password: 'Password123!' })
      });
      const cookieStranger = regStranger.headers.get('set-cookie')?.split(';')[0];
      const strangerJson = await regStranger.json();
      const strangerId = strangerJson.data.user.id;

      console.log(`Owner: ${ownerId} | Collaborator: ${collabId} | Stranger: ${strangerId}`);

      console.log('\n2. Creating Board X owned by Owner...');
      const createBoard = await fetch(`${API_BASE}/boards`, {
        method: 'POST',
        headers: { Cookie: cookieOwner, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Shared Whiteboard X' })
      });
      const boardJson = await createBoard.json();
      const boardId = boardJson.data.board.id;
      console.log(`Board X ID: ${boardId}`);

      console.log('\n3. Testing Owner access to Board X...');
      const fetchOwnerBoard = await fetch(`${API_BASE}/boards/${boardId}`, {
        headers: { Cookie: cookieOwner }
      });
      if (fetchOwnerBoard.status !== 200) throw new Error('Owner failed to view own board');
      console.log('✅ Owner can view their board');

      console.log('\n4. Testing Owner adding themselves as collaborator (Expect 400)...');
      const addSelf = await fetch(`${API_BASE}/boards/${boardId}/collaborators`, {
        method: 'POST',
        headers: { Cookie: cookieOwner, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail })
      });
      if (addSelf.status !== 400) throw new Error('Adding owner as collaborator should fail with 400');
      console.log('✅ Owner cannot add themselves as collaborator');

      console.log('\n5. Testing Owner adding Collaborator by email...');
      const addCollab = await fetch(`${API_BASE}/boards/${boardId}/collaborators`, {
        method: 'POST',
        headers: { Cookie: cookieOwner, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: collaboratorEmail })
      });
      if (addCollab.status !== 201) throw new Error('Failed to add collaborator');
      const addCollabJson = await addCollab.json();
      if (addCollabJson.data.collaborator.id !== collabId) throw new Error('Collaborator payload mismatch');
      console.log('✅ Owner can add existing user by email');

      console.log('\n6. Testing adding duplicate collaborator (Expect 400)...');
      const addDup = await fetch(`${API_BASE}/boards/${boardId}/collaborators`, {
        method: 'POST',
        headers: { Cookie: cookieOwner, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: collaboratorEmail })
      });
      if (addDup.status !== 400) throw new Error('Duplicate collaborator addition should fail with 400');
      console.log('✅ Duplicate collaborator is rejected');

      console.log('\n7. Testing Collaborator board listing (GET /api/v1/boards)...');
      const listCollabBoards = await fetch(`${API_BASE}/boards`, {
        headers: { Cookie: cookieCollab }
      });
      const listCollabJson = await listCollabBoards.json();
      const hasBoard = listCollabJson.data.boards.some((b) => b.id === boardId);
      if (!hasBoard) throw new Error('Shared board missing from collaborator board list');
      console.log('✅ Collaborator can see shared board in their accessible boards list');

      console.log('\n8. Testing Collaborator fetching board details (GET /api/v1/boards/:id)...');
      const getCollabBoard = await fetch(`${API_BASE}/boards/${boardId}`, {
        headers: { Cookie: cookieCollab }
      });
      if (getCollabBoard.status !== 200) throw new Error('Collaborator failed to fetch shared board');
      console.log('✅ Collaborator can fetch shared board details');

      console.log('\n9. Testing Stranger access to Board X (Expect 403)...');
      const getStrangerBoard = await fetch(`${API_BASE}/boards/${boardId}`, {
        headers: { Cookie: cookieStranger }
      });
      if (getStrangerBoard.status !== 403) throw new Error('Stranger access should be rejected with 403');
      console.log('✅ Unrelated user receives 403 Forbidden');

      console.log('\n10. Testing Socket.IO connection and room join for Owner & Collaborator...');
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

      const socketOwner = await connectSocket(cookieOwner);
      const socketCollab = await connectSocket(cookieCollab);
      const socketStranger = await connectSocket(cookieStranger);

      const ownerJoinedPromise = new Promise((resolve) => {
        socketOwner.on('board:presence', ({ boardId: id, users }) => {
          if (id === boardId && users.length === 1) resolve(true);
        });
      });
      socketOwner.emit('join-board', { boardId });
      await ownerJoinedPromise;

      const collabPresencePromise = new Promise((resolve) => {
        socketCollab.on('board:presence', ({ boardId: id, users }) => {
          if (id === boardId && users.length === 2) resolve(true);
        });
      });
      socketCollab.emit('join-board', { boardId });
      const collabJoined = await collabPresencePromise;
      if (!collabJoined) throw new Error('Collaborator failed to join room or receive presence');
      console.log('✅ Collaborator can connect to Socket.IO and join room with Owner in Phase 4C presence');

      console.log('\n11. Testing Stranger Socket.IO room join (Expect 403 error)...');
      const strangerErrorPromise = new Promise((resolve) => {
        socketStranger.on('board-error', ({ event, message }) => {
          if (event === 'join-board' && message.includes('permission')) resolve(true);
        });
      });
      socketStranger.emit('join-board', { boardId });
      const strangerRejected = await strangerErrorPromise;
      if (!strangerRejected) throw new Error('Stranger Socket.IO room join was not rejected');
      console.log('✅ Unauthorized Socket.IO user cannot join room');

      socketOwner.disconnect();
      socketCollab.disconnect();
      socketStranger.disconnect();

      console.log('\n12. Testing Removing Collaborator...');
      const removeCollab = await fetch(`${API_BASE}/boards/${boardId}/collaborators/${collabId}`, {
        method: 'DELETE',
        headers: { Cookie: cookieOwner }
      });
      if (removeCollab.status !== 200) throw new Error('Failed to remove collaborator');
      console.log('✅ Owner can remove collaborator');

      console.log('\n13. Testing Removed Collaborator access (Expect 403)...');
      const getRemovedCollabBoard = await fetch(`${API_BASE}/boards/${boardId}`, {
        headers: { Cookie: cookieCollab }
      });
      if (getRemovedCollabBoard.status !== 403) throw new Error('Removed collaborator should receive 403');
      console.log('✅ Removed collaborator receives 403 when attempting access');

      console.log('\n==================================================');
      console.log('✅ ALL 16 COLLABORATION & SHARING VERIFICATION TESTS PASSED!');
      console.log('==================================================\n');
    } catch (err) {
      console.error('\n❌ COLLABORATION VERIFICATION FAILED:', err.message);
      process.exit(1);
    } finally {
      const cleanUsers = await User.find({ email: { $in: [ownerEmail, collaboratorEmail, strangerEmail] } });
      const cleanUserIds = cleanUsers.map((u) => u._id);
      await Board.deleteMany({ owner: { $in: cleanUserIds } });
      await User.deleteMany({ email: { $in: [ownerEmail, collaboratorEmail, strangerEmail] } });
      server.close(() => process.exit(0));
    }
  });
};

runCollaborationVerification();
