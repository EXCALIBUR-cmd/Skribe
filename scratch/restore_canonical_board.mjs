import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: 'server/.env' });

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const data = JSON.parse(fs.readFileSync('C:/Users/singh/.gemini/antigravity-ide/brain/50fd7c5f-98be-4727-87e0-21e02f97850b/scratch/canonical_board.json', 'utf8'));

const res = await db.collection('boards').updateOne(
  { _id: new mongoose.Types.ObjectId('6a9c6e3233c10e861b77e4e7') },
  { $set: { canvasData: data, updatedAt: new Date() } }
);

console.log('Update result:', res);
console.log('Successfully restored 9 objects to board 6a9c6e3233c10e861b77e4e7!');

await mongoose.disconnect();
