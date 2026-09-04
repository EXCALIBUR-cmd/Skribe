import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { extractWorkspaceModel } from '../src/features/messCleanup/extractWorkspaceModel.js';
import { buildCleanupPlan } from '../src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../src/features/messCleanup/executeCleanupPlan.js';
import { buildPreviewRenderModel } from '../src/features/messCleanup/previewModel.js';

dotenv.config({ path: '../server/.env' });

async function checkTextAlignment(boardId, name) {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const b = await mongoose.connection.db.collection('boards').findOne({ _id: new mongoose.Types.ObjectId(boardId) });
  await mongoose.disconnect();
  const canvasData = typeof b.canvasData === 'string' ? JSON.parse(b.canvasData) : b.canvasData;
  const mockCanvas = { getObjects: () => canvasData.objects, version: canvasData.version };
  const wm = extractWorkspaceModel(mockCanvas);

  console.log(`\n================================================================================`);
  console.log(`TEXT STYLES & ALIGNMENT FOR: ${name}`);
  console.log(`================================================================================`);

  const rows = [];
  wm.board.objects.forEach((o) => {
    if (o.semanticType === 'text') {
      rows.push({
        id: o.id,
        text: (o.text || '').replace(/\n/g, ' ').slice(0, 25),
        align: o.style?.textAlign || 'default',
        fontFamily: o.style?.fontFamily || 'Nunito Sans',
        fontSize: o.style?.fontSize || 16,
        fontWeight: o.style?.fontWeight || 'normal',
        color: o.style?.color || '#000'
      });
    }
  });

  console.table(rows);
}

async function run() {
  await checkTextAlignment('6a7e4c6be2daa50954af00a6', 'Board 1');
  await checkTextAlignment('6a8b86c96783556e56bb7477', 'Board test A');
}
run();
