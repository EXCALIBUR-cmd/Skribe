import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { hydrateSkribeFabricObject, hydrateCanvasObjects } from '../src/utils/fabricHydration.js';
import { extractWorkspaceModel } from '../src/features/messCleanup/extractWorkspaceModel.js';
import { normalizeObject } from '../src/features/messCleanup/normalizeObjects.js';
import { getSemanticType } from '../src/features/messCleanup/cleanupTypes.js';

dotenv.config({ path: '../server/.env' });

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  console.log('================================================================================');
  console.log('CONNECTOR METADATA FORENSIC AUDIT ACROSS ALL MONGODB BOARDS');
  console.log('================================================================================');

  const boards = await db.collection('boards').find({}).toArray();

  for (const board of boards) {
    const rawCanvasData = typeof board.canvasData === 'string' ? JSON.parse(board.canvasData) : (board.canvasData || {});
    const rawObjects = rawCanvasData.objects || [];

    const connectorCandidates = rawObjects.filter(o => {
      const isPath = o.type === 'Path' || o.type === 'path';
      const hasConnId = (o.id && o.id.includes('conn')) || (o.elementId && o.elementId.includes('conn'));
      const hasConnFlag = o.isConnector || o.connectorType;
      const hasArrowhead = isPath && Array.isArray(o.path) && o.path.length >= 3 &&
        o.path.some((cmd, idx) => idx > 0 && cmd[0] === 'M');

      return hasConnId || hasConnFlag || (hasArrowhead && !o.strokeId && !(o.elementId && o.elementId.startsWith('stroke_')));
    });

    if (connectorCandidates.length > 0) {
      console.log(`\nBoard: ${board._id} ("${board.title}") — ${connectorCandidates.length} connector candidate(s)`);

      for (const raw of connectorCandidates) {
        console.log('--------------------------------------------------------------------------------');
        console.log('PERSISTED DATA IN MONGODB:');
        console.log('  id:', raw.id);
        console.log('  elementId:', raw.elementId);
        console.log('  type:', raw.type);
        console.log('  isConnector:', raw.isConnector);
        console.log('  connectorType:', raw.connectorType);
        console.log('  startArrow:', raw.startArrow);
        console.log('  endArrow:', raw.endArrow);
        console.log('  sourceShapeId:', raw.sourceShapeId);
        console.log('  targetShapeId:', raw.targetShapeId);
        console.log('  path command count:', Array.isArray(raw.path) ? raw.path.length : 0);

        const mockFabricObj = {
          type: 'path',
          path: raw.path,
          left: raw.left,
          top: raw.top,
          width: raw.width,
          height: raw.height,
          set(p) { Object.assign(this, p); },
          setCoords() {}
        };

        hydrateSkribeFabricObject(mockFabricObj, raw);
        console.log('\nAFTER HYDRATION:');
        console.log('  id:', mockFabricObj.id);
        console.log('  elementId:', mockFabricObj.elementId);
        console.log('  isConnector:', mockFabricObj.isConnector);
        console.log('  connectorType:', mockFabricObj.connectorType);
        console.log('  startArrow:', mockFabricObj.startArrow);
        console.log('  endArrow:', mockFabricObj.endArrow);
        console.log('  sourceShapeId:', mockFabricObj.sourceShapeId);
        console.log('  targetShapeId:', mockFabricObj.targetShapeId);

        const canvas = { getObjects: () => [mockFabricObj] };
        const wsModel = extractWorkspaceModel(canvas);
        const extracted = wsModel.board.objects[0];

        console.log('\nEXTRACTED & NORMALIZED:');
        console.log('  id:', extracted.id);
        console.log('  type (semanticType):', extracted.type);
        console.log('  isConnector:', extracted.isConnector);
        console.log('  connector:', extracted.connector);
      }
    }
  }

  await mongoose.disconnect();
}

run().catch(console.error);
