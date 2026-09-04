import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { normalizeObject } from '../src/features/messCleanup/normalizeObjects.js';
import { buildCleanupPlan } from '../src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../src/features/messCleanup/executeCleanupPlan.js';
import { buildPreviewRenderModel } from '../src/features/messCleanup/previewModel.js';
import { buildCleanupResult } from '../src/features/messCleanup/buildCleanupResult.js';

dotenv.config({ path: '../server/.env' });

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/skribe';
  await mongoose.connect(uri);
  const Board = mongoose.model('Board', new mongoose.Schema({}, { strict: false }));
  const b = await Board.findById('6a7e4c6be2daa50954af00a6');

  const rawObjects = b.canvasData.objects;
  const normalized = rawObjects.map((o, idx) => normalizeObject(o, idx));

  const model = { board: { objects: normalized } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const renderModel = buildPreviewRenderModel(model, proposal);
  const result = buildCleanupResult(plan, proposal, model);

  console.log('=== REAL BOARD 6a7e4c6be2daa50954af00a6 VERIFICATION ===');
  console.log('Total source objects:', normalized.length);
  console.log('Canvas Bounds:', proposal.canvasBounds);

  const renderBounds = renderModel.bounds;
  const previewWidth = 900;
  const previewHeight = 500;
  const padding = 24;
  const scale = Math.min(
    (previewWidth - padding * 2) / Math.max(renderBounds.width, 1),
    (previewHeight - padding * 2) / Math.max(renderBounds.height, 1),
    1
  );
  const contentWidth = Math.max(renderBounds.width * scale + padding * 2, 1);
  const contentHeight = Math.max(renderBounds.height * scale + padding * 2, 1);

  console.log(`Scale: ${scale.toFixed(4)}, Preview Box: ${contentWidth.toFixed(1)}px x ${contentHeight.toFixed(1)}px`);

  console.log('\n--- VISIBLE OBJECTS IN PREVIEW ---');
  let visibleCount = 0;
  renderModel.objects.forEach((obj) => {
    const left = obj.anchor === 'center' ? obj.position.x - obj.size.width / 2 : obj.position.x;
    const top = obj.anchor === 'center' ? obj.position.y - obj.size.height / 2 : obj.position.y;
    const domX = (left - renderBounds.x) * scale + padding;
    const domY = (top - renderBounds.y) * scale + padding;
    const domW = obj.size.width * scale;
    const domH = obj.size.height * scale;

    const isInside = domX >= 0 && domX <= contentWidth && domY >= 0 && domY <= contentHeight;
    if (isInside && domW >= 1 && domH >= 1) visibleCount++;

    console.log(`[${obj.type.padEnd(9)}] ${obj.originalObjectId.padEnd(32)} -> DOM: (${domX.toFixed(1)}px, ${domY.toFixed(1)}px, ${domW.toFixed(1)}x${domH.toFixed(1)}) | inside: ${isInside}`);
  });

  console.log(`\nTotal objects visible & non-zero in preview: ${visibleCount} / ${normalized.length}`);

  await mongoose.disconnect();
}
run().catch(console.error);
