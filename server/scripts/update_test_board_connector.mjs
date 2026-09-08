import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: 'c:/Skribe/server/.env' });
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/skribe');
const db = mongoose.connection.db;
const board = await db.collection('boards').findOne({ _id: new mongoose.Types.ObjectId('6a9c6e3233c10e861b77e4e7') });

const updatedObjects = board.canvasData.objects.map(o => {
  if (o.id === 'conn_1788636827219_5wvzi') {
    return {
      ...o,
      sourceShapeId: 'shape_elem_1788636730345_1ov36',
      targetShapeId: 'shape_elem_1788636800955_wkpdm',
      relationshipMetadata: {
        ...(o.relationshipMetadata || {}),
        sourceShapeId: 'shape_elem_1788636730345_1ov36',
        targetShapeId: 'shape_elem_1788636800955_wkpdm'
      }
    };
  }
  return o;
});

await db.collection('boards').updateOne(
  { _id: new mongoose.Types.ObjectId('6a9c6e3233c10e861b77e4e7') },
  { $set: { 'canvasData.objects': updatedObjects } }
);

console.log('Board 6a9c6e3233c10e861b77e4e7 connector updated successfully');
await mongoose.disconnect();
