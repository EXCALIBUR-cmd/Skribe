import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: 'server/.env' });

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const board = await db.collection('boards').findOne({ _id: new mongoose.Types.ObjectId('6a9c6e3233c10e861b77e4e7') });
console.log('Board Title:', board?.title);
console.log('Objects count:', board?.canvasData?.objects?.length);
console.log('Object IDs:', board?.canvasData?.objects?.map(o => ({ id: o.id, type: o.type, text: o.text })));

await mongoose.disconnect();
