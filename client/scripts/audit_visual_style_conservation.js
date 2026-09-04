import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { extractWorkspaceModel } from '../src/features/messCleanup/extractWorkspaceModel.js';
import { buildCleanupPlan } from '../src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../src/features/messCleanup/executeCleanupPlan.js';
import { buildPreviewRenderModel } from '../src/features/messCleanup/previewModel.js';

dotenv.config({ path: '../server/.env' });

async function auditStyles() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const b = await mongoose.connection.db.collection('boards').findOne({ _id: new mongoose.Types.ObjectId('6a7e4c6be2daa50954af00a6') });
  await mongoose.disconnect();
  const canvasData = typeof b.canvasData === 'string' ? JSON.parse(b.canvasData) : b.canvasData;

  const mockCanvas = { getObjects: () => canvasData.objects, version: canvasData.version };
  const wm = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(null, wm);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const targets = [
    { name: 'Rectangle', idPart: '52ts5', type: 'shape' },
    { name: 'Decision', idPart: 'ctm8f', type: 'shape' },
    { name: 'Circle', idPart: 'ascrc', type: 'shape' },
    { name: 'Triangle', idPart: 'mwj4a', type: 'shape' },
    { name: 'Important callout', idPart: 'wzry1', type: 'note' },
    { name: 'Blue sticky', idPart: '2ryyx', type: 'note' },
    { name: 'Testing shape', idPart: 'rg5r1', type: 'shape' },
    { name: 'Test-over shape', idPart: '52ts5', type: 'shape' },
    { name: 'straight connector', idPart: '9ph0k', type: 'connector' },
    { name: 'elbow connector', idPart: '8rw9w', type: 'connector' },
    { name: 'curved connector', idPart: 'q5aq9', type: 'connector' },
    { name: 'freehand Hello', idPart: 'sv34y', type: 'stroke' },
    { name: 'divider', idPart: 'i029o', type: 'line' }
  ];

  console.log('| object | property | source | canonical | proposal | previewModel | preserved? |');
  console.log('|---|---|---|---|---|---|---|');

  for (const t of targets) {
    const raw = canvasData.objects.find(o => (o.id || o.elementId)?.includes(t.idPart) && (t.type !== 'shape' || o.type !== 'textbox'));
    const can = wm.board.objects.find(o => o.id.includes(t.idPart) && (t.type !== 'shape' || o.semanticType !== 'text'));
    const prop = proposal.placements.find(p => p.objectId.includes(t.idPart) && (t.type !== 'shape' || p.type !== 'text'));
    const prev = preview.objects.find(o => o.originalObjectId?.includes(t.idPart) && (t.type !== 'shape' || o.type !== 'text'));

    if (!raw || !can || !prop || !prev) {
      console.log(`| ${t.name} | missing | - | - | - | - | NO |`);
      continue;
    }

    const checkProp = (propName, sVal, cVal, pVal, prVal) => {
      const match = JSON.stringify(cVal) === JSON.stringify(sVal) &&
                    JSON.stringify(pVal) === JSON.stringify(sVal) &&
                    JSON.stringify(prVal) === JSON.stringify(sVal);
      console.log(`| ${t.name} | ${propName} | ${JSON.stringify(sVal)} | ${JSON.stringify(cVal)} | ${JSON.stringify(pVal)} | ${JSON.stringify(prVal)} | ${match ? 'YES' : 'DIFF'} |`);
    };

    checkProp('strokeWidth', raw.strokeWidth ?? null, can.strokeWidth, prop.strokeWidth, prev.strokeWidth);
    checkProp('stroke', raw.stroke ?? null, can.stroke, prop.stroke, prev.stroke);
    checkProp('dash', raw.strokeDashArray ?? null, can.strokeDashArray, prop.strokeDashArray, prev.strokeDashArray);
    checkProp('lineCap', raw.strokeLineCap ?? 'butt', can.strokeLineCap, prop.strokeLineCap, prev.strokeLineCap);
    checkProp('lineJoin', raw.strokeLineJoin ?? 'miter', can.strokeLineJoin, prop.strokeLineJoin, prev.strokeLineJoin);
  }
}

auditStyles();
