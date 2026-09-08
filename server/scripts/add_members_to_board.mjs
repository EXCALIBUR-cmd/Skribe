import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: 'c:/Skribe/server/.env' });
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/skribe');
const db = mongoose.connection.db;

const users = await db.collection('users').find({}).toArray();
console.log('Users in DB:');
users.forEach(u => console.log(u.email, u._id.toString()));

const userIds = users.map(u => u._id);
await db.collection('boards').updateOne(
  { _id: new mongoose.Types.ObjectId('6a9c6e3233c10e861b77e4e7') },
  { $addToSet: { members: { $each: userIds } } }
);

console.log('Added all users to board 6a9c6e3233c10e861b77e4e7 members');
await mongoose.disconnect();
