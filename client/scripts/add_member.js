import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: '../server/.env' });

async function addMember() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const res = await mongoose.connection.db.collection('boards').updateOne(
    { _id: new mongoose.Types.ObjectId('6a995a0d162705471c8f64b0') },
    { $addToSet: { members: new mongoose.Types.ObjectId('6a96b317d0901fee2be6e5aa') } }
  );
  await mongoose.disconnect();
  console.log('Added member result:', res);
}
addMember();
