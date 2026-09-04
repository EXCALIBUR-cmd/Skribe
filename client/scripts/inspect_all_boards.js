import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: '../server/.env' });

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const boards = await db.collection('boards').find({}).toArray();

  for (const b of boards) {
    const rawData = typeof b.canvasData === 'string' ? JSON.parse(b.canvasData) : (b.canvasData || {});
    const objs = rawData.objects || [];
    console.log(`\n=== BOARD: ${b._id} ("${b.title}") | Total Objects: ${objs.length} ===`);
    objs.forEach((o, i) => {
      const txt = o.text ? `"${o.text.substring(0, 15)}"` : '';
      console.log(`[${i+1}] type:${o.type} | id:${o.id} | elemId:${o.elementId} | strokeId:${o.strokeId} | text:${txt} | left:${Math.round(o.left)} | top:${Math.round(o.top)} | w:${Math.round(o.width)} | h:${Math.round(o.height)}`);
    });
  }
  await mongoose.disconnect();
}
run();
