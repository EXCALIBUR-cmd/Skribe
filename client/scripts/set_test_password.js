import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: '../server/.env' });

async function run() {
  const hash = await bcrypt.hash('password123', 10);
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const u = await mongoose.connection.db.collection('users').findOne({ email: 'test@example.com' });
  await mongoose.connection.db.collection('boards').updateOne(
    { _id: new mongoose.Types.ObjectId('6a8b86c96783556e56bb7477') },
    { $set: { owner: u._id } }
  );
  await mongoose.connection.db.collection('boards').updateOne(
    { _id: new mongoose.Types.ObjectId('6a7e4c6be2daa50954af00a6') },
    { $set: { owner: u._id } }
  );
  console.log('Ownership ensured for Board 1 and Board test A');
  await mongoose.disconnect();
}
run().catch(console.error);
