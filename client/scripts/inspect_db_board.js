import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: '../server/.env' });

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const board = await db.collection('boards').findOne({ _id: new mongoose.Types.ObjectId('6a7e4c6be2daa50954af00a6') });

  const rawCanvasData = typeof board.canvasData === 'string' ? JSON.parse(board.canvasData) : (board.canvasData || {});
  const rawObjects = rawCanvasData.objects || [];

  console.log(`Total objects in board 6a7e4c6be2daa50954af00a6: ${rawObjects.length}`);
  rawObjects.forEach((o, i) => {
    console.log(`[${i}] type: ${o.type} | id: ${o.id} | elementId: ${o.elementId} | strokeId: ${o.strokeId} | isConn: ${o.isConnector} | isLine: ${o.isSkribeLine} | text: ${o.text ? o.text.substring(0, 20) : undefined}`);
  });

  await mongoose.disconnect();
}

run().catch(console.error);
