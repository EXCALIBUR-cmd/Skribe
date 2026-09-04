import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: '../server/.env' });

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const board = await mongoose.connection.db.collection('boards').findOne({
    _id: new mongoose.Types.ObjectId('6a7e4c6be2daa50954af00a6')
  });

  const rawCanvasData = typeof board.canvasData === 'string' ? JSON.parse(board.canvasData) : (board.canvasData || {});
  const rawObjects = rawCanvasData.objects || [];

  const strokes = rawObjects.filter((o) => o.strokeId || (o.elementId && o.elementId.startsWith('stroke_')));
  console.log(`Total strokes found on Board 1: ${strokes.length}`);
  strokes.forEach((s, i) => {
    console.log(`[${i + 1}] elemId: ${s.elementId} | strokeId: ${s.strokeId} | left: ${s.left} | top: ${s.top} | w: ${s.width} | h: ${s.height} | pathCmds: ${s.path?.length}`);
    if (s.path && s.path.length > 0) {
      console.log('     First command:', s.path[0], 'Second:', s.path[1]);
    }
  });

  await mongoose.disconnect();
}
run().catch(console.error);
