import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: 'server/.env' });

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const boards = await db.collection('boards').find({}).toArray();
for (const b of boards) {
  console.log(`Board ${b._id}: title="${b.title}", objCount=${b.canvasData?.objects?.length}`);
}

await mongoose.disconnect();
