import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { extractWorkspaceModel } from '../client/src/features/messCleanup/extractWorkspaceModel.js';
import { buildMultimodalPayload } from './src/services/nemotronService.js';
dotenv.config({ path: './.env' });

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const b = await mongoose.connection.db.collection('boards').findOne({
    _id: new mongoose.Types.ObjectId('6a7e4c6be2daa50954af00a6')
  });
  await mongoose.disconnect();

  const canvasData = typeof b.canvasData === 'string' ? JSON.parse(b.canvasData) : b.canvasData;
  const workspaceModel = extractWorkspaceModel(canvasData);

  const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const payload = buildMultimodalPayload(workspaceModel, testImage);
  console.log('Payload size:', JSON.stringify(payload).length, 'bytes');

  const key = process.env.NVIDIA_API_KEY;
  const start = Date.now();
  console.log('Sending Board 1 payload to NVIDIA API...');

  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  console.log('Status:', res.status, 'in', Date.now() - start, 'ms');
  const data = await res.json();
  if (res.status !== 200) {
    console.log('Error data:', data);
  } else {
    console.log('Response content sample:', data.choices?.[0]?.message?.content?.substring(0, 300));
  }
}
run().catch(console.error);
