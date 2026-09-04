import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { extractWorkspaceModel } from '../src/features/messCleanup/extractWorkspaceModel.js';
import { hydrateCanvasObjects } from '../src/utils/fabricHydration.js';

dotenv.config({ path: '../server/.env' });

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const board = await db.collection('boards').findOne({
    _id: new mongoose.Types.ObjectId('6a7e4c6be2daa50954af00a6')
  });

  const rawCanvasData = typeof board.canvasData === 'string' ? JSON.parse(board.canvasData) : (board.canvasData || {});
  const rawObjects = rawCanvasData.objects || [];

  console.log(`Loaded Board: "${board.title}" (${board._id}) with ${rawObjects.length} persisted objects.`);

  const fabricObjects = rawObjects.map((raw) => {
    return {
      type: (raw.type || 'rect').toLowerCase(),
      left: raw.left,
      top: raw.top,
      width: raw.width,
      height: raw.height,
      path: raw.path,
      stroke: raw.stroke,
      fill: raw.fill,
      angle: raw.angle,
      text: raw.text,
      set(props) { Object.assign(this, props); },
      setCoords() {}
    };
  });

  const mockCanvas = {
    getObjects: () => fabricObjects
  };

  hydrateCanvasObjects(mockCanvas, rawObjects);

  console.log('\n--- EXECUTING extractWorkspaceModel (MESS CLEANUP TRIGGER) ---');
  const wsModel = extractWorkspaceModel(mockCanvas);

  await mongoose.disconnect();
}

run().catch(console.error);
