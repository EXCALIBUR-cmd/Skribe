import app from './src/app.js';
import connectDB from './src/config/db.js';
import User from './src/models/User.js';
import Board from './src/models/Board.js';

const PORT = 5096;
const API_BASE = `http://localhost:${PORT}/api/v1`;

const runBoardVerification = async () => {
  console.log('--- Starting Skribe Phase 3 Board Management Verification ---');
  await connectDB();

  const user1Email = 'user1.board.test@example.com';
  const user2Email = 'user2.board.test@example.com';

  const users = await User.find({ email: { $in: [user1Email, user2Email] } });
  const userIds = users.map((u) => u._id);
  await Board.deleteMany({ owner: { $in: userIds } });
  await User.deleteMany({ email: { $in: [user1Email, user2Email] } });

  const server = app.listen(PORT, async () => {
    try {
      let cookieUser1 = null;
      let cookieUser2 = null;

      console.log('\n1. Registering User 1 & User 2...');
      const reg1 = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'User One', email: user1Email, password: 'Password123!' })
      });
      cookieUser1 = reg1.headers.get('set-cookie')?.split(';')[0];
      const reg1Json = await reg1.json();
      const user1Id = reg1Json.data.user.id;

      const reg2 = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'User Two', email: user2Email, password: 'Password123!' })
      });
      cookieUser2 = reg2.headers.get('set-cookie')?.split(';')[0];
      const reg2Json = await reg2.json();
      const user2Id = reg2Json.data.user.id;

      console.log(`User 1 ID: ${user1Id} | User 2 ID: ${user2Id}`);

      console.log('\n2. Testing POST /api/v1/boards (Create Board)...');
      const create1Res = await fetch(`${API_BASE}/boards`, {
        method: 'POST',
        headers: { Cookie: cookieUser1, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const create1Json = await create1Res.json();
      console.log(`Create Board 1 Status: ${create1Res.status}`);
      console.log('Response:', JSON.stringify(create1Json, null, 2));

      if (create1Res.status !== 201 || create1Json.data.board.title !== 'Untitled Board') {
        throw new Error('Default board creation failed!');
      }

      const board1Id = create1Json.data.board.id;

      const create2Res = await fetch(`${API_BASE}/boards`, {
        method: 'POST',
        headers: { Cookie: cookieUser1, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Product Roadmap 2026' })
      });
      const create2Json = await create2Res.json();
      const board2Id = create2Json.data.board.id;
      console.log(`Board 2 Created: ID=${board2Id}, Title="${create2Json.data.board.title}"`);

      console.log('\n3. Testing GET /api/v1/boards (List Boards)...');
      const list1Res = await fetch(`${API_BASE}/boards`, {
        method: 'GET',
        headers: { Cookie: cookieUser1 }
      });
      const list1Json = await list1Res.json();
      console.log(`User 1 Board Count: ${list1Json.data.count}`);
      if (list1Json.data.count !== 2) {
        throw new Error('List boards count failed for User 1!');
      }

      const list2Res = await fetch(`${API_BASE}/boards`, {
        method: 'GET',
        headers: { Cookie: cookieUser2 }
      });
      const list2Json = await list2Res.json();
      console.log(`User 2 Board Count (Expect 0): ${list2Json.data.count}`);
      if (list2Json.data.count !== 0) {
        throw new Error('User 2 should not see User 1 boards!');
      }

      console.log('\n4. Testing GET /api/v1/boards/:id (Ownership Check)...');
      const getOwnRes = await fetch(`${API_BASE}/boards/${board1Id}`, {
        method: 'GET',
        headers: { Cookie: cookieUser1 }
      });
      console.log(`User 1 Fetch Own Board Status: ${getOwnRes.status}`);

      const getCrossRes = await fetch(`${API_BASE}/boards/${board1Id}`, {
        method: 'GET',
        headers: { Cookie: cookieUser2 }
      });
      const getCrossJson = await getCrossRes.json();
      console.log(`User 2 Fetch User 1 Board Status (Expect 403): ${getCrossRes.status}`);
      console.log('Cross Access Error:', getCrossJson.message);

      if (getCrossRes.status !== 403) {
        throw new Error('Cross-user board read protection failed!');
      }

      console.log('\n5. Testing PATCH /api/v1/boards/:id (Update & Fabric JSON Autosave)...');
      const fabricPayload = {
        version: '6.5.1',
        objects: [
          { type: 'rect', left: 100, top: 100, width: 200, height: 150, fill: '#ef4444' },
          { type: 'textbox', text: 'Skribe Architecture Canvas', fontSize: 24 }
        ]
      };

      const updateRes = await fetch(`${API_BASE}/boards/${board1Id}`, {
        method: 'PATCH',
        headers: { Cookie: cookieUser1, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Architecture & System Design',
          canvasData: fabricPayload,
          owner: user2Id
        })
      });
      const updateJson = await updateRes.json();
      console.log(`Update Status: ${updateRes.status}`);
      console.log('Updated Title:', updateJson.data.board.title);
      console.log('Updated Owner:', updateJson.data.board.owner);
      console.log('Canvas Objects Saved:', updateJson.data.board.canvasData.objects.length);

      if (updateJson.data.board.owner === user2Id) {
        throw new Error('Owner field immutability check failed!');
      }

      const updateCrossRes = await fetch(`${API_BASE}/boards/${board1Id}`, {
        method: 'PATCH',
        headers: { Cookie: cookieUser2, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Hacked Title' })
      });
      console.log(`User 2 Update User 1 Board Status (Expect 403): ${updateCrossRes.status}`);
      if (updateCrossRes.status !== 403) {
        throw new Error('Cross-user board update protection failed!');
      }

      console.log('\n6. Testing DELETE /api/v1/boards/:id (Soft Delete)...');
      const delCrossRes = await fetch(`${API_BASE}/boards/${board1Id}`, {
        method: 'DELETE',
        headers: { Cookie: cookieUser2 }
      });
      console.log(`User 2 Delete User 1 Board Status (Expect 403): ${delCrossRes.status}`);
      if (delCrossRes.status !== 403) {
        throw new Error('Cross-user board delete protection failed!');
      }

      const delRes = await fetch(`${API_BASE}/boards/${board1Id}`, {
        method: 'DELETE',
        headers: { Cookie: cookieUser1 }
      });
      const delJson = await delRes.json();
      console.log(`User 1 Delete Board Status: ${delRes.status}`);
      console.log('Response:', JSON.stringify(delJson, null, 2));

      const listAfterDelRes = await fetch(`${API_BASE}/boards`, {
        method: 'GET',
        headers: { Cookie: cookieUser1 }
      });
      const listAfterDelJson = await listAfterDelRes.json();
      console.log(`Active Boards Count After Soft Delete: ${listAfterDelJson.data.count}`);
      if (listAfterDelJson.data.count !== 1) {
        throw new Error('Soft delete filtering in list query failed!');
      }

      console.log('\n7. Testing Invalid Board ObjectId (Expect 400)...');
      const invalidIdRes = await fetch(`${API_BASE}/boards/invalid-id-12345`, {
        method: 'GET',
        headers: { Cookie: cookieUser1 }
      });
      const invalidIdJson = await invalidIdRes.json();
      console.log(`Invalid ID Status: ${invalidIdRes.status}`);
      console.log('Response:', JSON.stringify(invalidIdJson, null, 2));
      if (invalidIdRes.status !== 400) {
        throw new Error('Invalid ObjectId validation failed!');
      }

      console.log('\n8. Testing Unauthenticated Request (Expect 401)...');
      const unauthRes = await fetch(`${API_BASE}/boards`, { method: 'GET' });
      console.log(`Unauthenticated Status: ${unauthRes.status}`);
      if (unauthRes.status !== 401) {
        throw new Error('Unauthenticated endpoint protection failed!');
      }

      console.log('\n==================================================');
      console.log('✅ ALL BOARD MANAGEMENT TESTS PASSED SUCCESSFULLY!');
      console.log('==================================================\n');

    } catch (err) {
      console.error('\n❌ BOARD VERIFICATION FAILED:', err.message);
      process.exit(1);
    } finally {
      const cleanUsers = await User.find({ email: { $in: [user1Email, user2Email] } });
      const cleanUserIds = cleanUsers.map((u) => u._id);
      await Board.deleteMany({ owner: { $in: cleanUserIds } });
      await User.deleteMany({ email: { $in: [user1Email, user2Email] } });
      server.close(() => process.exit(0));
    }
  });
};

runBoardVerification();
