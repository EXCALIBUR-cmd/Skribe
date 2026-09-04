import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: '../server/.env' });

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);

  const centeredViewport = {
    x: 6498,
    y: -11378,
    zoom: 0.65
  };

  await mongoose.connection.db.collection('boards').updateOne(
    { _id: new mongoose.Types.ObjectId('6a7e4c6be2daa50954af00a6') },
    {
      $set: {
        viewportStates: [
          {
            userId: new mongoose.Types.ObjectId('6a96b317d0901fee2be6e5aa'),
            viewport: centeredViewport
          },
          {
            userId: new mongoose.Types.ObjectId('6a7ccf0ab9e67160ad86596f'),
            viewport: centeredViewport
          }
        ]
      }
    }
  );

  console.log('Board 1 viewport updated to centered coordinates:', centeredViewport);
  await mongoose.disconnect();
}
run().catch(console.error);
