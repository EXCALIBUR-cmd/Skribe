import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { extractWorkspaceModel } from '../src/features/messCleanup/extractWorkspaceModel.js';
import { buildCleanupPlan } from '../src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../src/features/messCleanup/executeCleanupPlan.js';
import { buildPreviewRenderModel } from '../src/features/messCleanup/previewModel.js';

dotenv.config({ path: '../server/.env' });

async function getBoardAudit(boardId, boardName) {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const b = await mongoose.connection.db.collection('boards').findOne({ _id: new mongoose.Types.ObjectId(boardId) });
  await mongoose.disconnect();
  const canvasData = typeof b.canvasData === 'string' ? JSON.parse(b.canvasData) : b.canvasData;
  const mockCanvas = { getObjects: () => canvasData.objects, version: canvasData.version };
  const wm = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(null, wm);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const previewScale = Math.min(900 / preview.bounds.width, 500 / preview.bounds.height);

  return { wm, plan, proposal, preview, previewScale, boardName, boardId };
}

async function run() {
  const b1 = await getBoardAudit('6a7e4c6be2daa50954af00a6', 'Board 1');
  const bA = await getBoardAudit('6a8b86c96783556e56bb7477', 'Board test A');

  const majorItems = [
    { name: 'Process', audit: b1, find: wm => wm.board.objects.find(o => o.text === 'Process' || o.id === 'shape_elem_1787517764099_fdiup') },
    { name: 'Circle 1', audit: b1, find: wm => wm.board.objects.find(o => o.id === 'shape_obj_1787517698229_ascrc') },
    { name: 'Circle 2', audit: bA, find: wm => wm.board.objects.find(o => o.id === 'shape_elem_1787567585467_cv5dr') },
    { name: 'Triangle', audit: b1, find: wm => wm.board.objects.find(o => o.id === 'shape_obj_1787517698229_mwj4a') },
    { name: 'Decision', audit: b1, find: wm => wm.board.objects.find(o => o.id === 'shape_elem_1787519517198_ctm8f') },
    { name: 'Important callout', audit: b1, find: wm => wm.board.objects.find(o => o.id === 'shape_elem_1787519509160_wzry1') },
    { name: 'Blue sticky', audit: b1, find: wm => wm.board.objects.find(o => o.id === 'shape_obj_1787517698229_2ryyx') },
    { name: 'Testing shape', audit: b1, find: wm => wm.board.objects.find(o => o.id === 'shape_obj_1787517698229_rg5r1' || o.id === 'text_obj_1787517712296_0a1tv') },
    { name: 'Test-over shape', audit: b1, find: wm => wm.board.objects.find(o => o.id === 'shape_elem_1787517726096_52ts5') },
    { name: 'Hello World', audit: b1, find: wm => wm.board.objects.find(o => o.id === 'text_obj_1787517712296_zh02k') },
    { name: 'divider', audit: b1, find: wm => wm.board.objects.find(o => o.id === 'line_1787519528340_i029o') }
  ];

  console.log('========================================================================================================================');
  console.log('FINAL VISUAL CONSERVATION MATRIX');
  console.log('========================================================================================================================');

  const matrix = [];
  const detailedReport = [];

  majorItems.forEach(({ name, audit, find }) => {
    const src = find(audit.wm);
    if (!src) {
      matrix.push({ object: name, sourceSize: 'NOT FOUND', proposalSize: '-', screenSize: '-', previewScale: '-', actualMutation: '-' });
      return;
    }

    const pl = audit.proposal.placements.find(p => p.objectId === src.id);
    const scale = audit.previewScale;

    const srcW = src.bounds.width;
    const srcH = src.bounds.height;
    const propW = pl ? pl.bounds.width : srcW;
    const propH = pl ? pl.bounds.height : srcH;

    const screenW = propW * scale;
    const screenH = propH * scale;

    const isMutated = Math.abs(propW - srcW) > 0.1 || Math.abs(propH - srcH) > 0.1;

    matrix.push({
      object: name,
      sourceSize: `${srcW.toFixed(1)} x ${srcH.toFixed(1)}`,
      proposalSize: `${propW.toFixed(1)} x ${propH.toFixed(1)}`,
      previewScreenSize: `${screenW.toFixed(1)} x ${screenH.toFixed(1)}`,
      previewScale: scale.toFixed(4),
      actualMutation: isMutated ? 'YES' : 'NO'
    });

    detailedReport.push({
      object: name,
      id: src.id,
      board: audit.boardName,
      source: {
        x: Number(src.bounds.x.toFixed(1)),
        y: Number(src.bounds.y.toFixed(1)),
        width: Number(srcW.toFixed(1)),
        height: Number(srcH.toFixed(1)),
        rotation: src.rotation || 0,
        scaleX: src.scale?.x || 1,
        scaleY: src.scale?.y || 1
      },
      proposal: pl ? {
        x: Number(pl.bounds.x.toFixed(1)),
        y: Number(pl.bounds.y.toFixed(1)),
        width: Number(propW.toFixed(1)),
        height: Number(propH.toFixed(1)),
        rotation: pl.rotation || 0,
        scaleX: pl.scale?.x || 1,
        scaleY: pl.scale?.y || 1
      } : 'UNTOUCHED',
      scaleApplied: scale.toFixed(4)
    });
  });

  console.table(matrix);

  console.log('\n========================================================================================================================');
  console.log('DETAILED BOUNDS & ROTATION COMPARISON (Source vs Proposal)');
  console.log('========================================================================================================================');
  detailedReport.forEach(item => {
    console.log(`\nOBJECT: ${item.object} [${item.id}] on ${item.board}`);
    console.log('  Source:   ', JSON.stringify(item.source));
    console.log('  Proposal: ', JSON.stringify(item.proposal));
  });
}

run();
