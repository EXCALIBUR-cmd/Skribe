import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { hashPassword } from '../src/utils/password.js';

dotenv.config();

await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/skribe');
const db = mongoose.connection.db;

const email = 'browser_test@example.com';
const password = 'Password123!';
const hashedPassword = await hashPassword(password);

let user = await db.collection('users').findOne({ email });
if (!user) {
  const result = await db.collection('users').insertOne({
    name: 'Browser Tester',
    email,
    password: hashedPassword,
    provider: 'local',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  user = { _id: result.insertedId, email };
} else {
  await db.collection('users').updateOne({ _id: user._id }, { $set: { password: hashedPassword } });
}

console.log('Test user ready:', user.email, 'ID:', user._id);

// 1. Board for reported scenario (meaningfully improved expected)
const reportedBoardId = new mongoose.Types.ObjectId('6a9999999999999999999901');
const reportedCanvasData = {
  version: '6.5.1',
  objects: [
    {
      id: 'shape_orange_rect',
      type: 'rect',
      left: 80,
      top: 200,
      width: 160,
      height: 80,
      fill: '#f97316',
      stroke: '#ea580c',
      strokeWidth: 2,
      originX: 'left',
      originY: 'top',
      shapeType: 'rect'
    },
    {
      id: 'shape_teal_rect',
      type: 'rect',
      left: 600,
      top: 180,
      width: 180,
      height: 100,
      fill: '#0d9488',
      stroke: '#0f766e',
      strokeWidth: 2,
      originX: 'left',
      originY: 'top',
      shapeType: 'rect',
      rx: 12,
      ry: 12
    },
    {
      id: 'conn_floating_arrow',
      type: 'path',
      isConnector: true,
      path: [
        ['M', 240, 240],
        ['L', 600, 230]
      ],
      left: 240,
      top: 230,
      width: 360,
      height: 10,
      stroke: '#64748b',
      strokeWidth: 3,
      fill: '',
      originX: 'left',
      originY: 'top',
      endArrow: true,
      sourceShapeId: 'shape_orange_rect',
      targetShapeId: 'shape_teal_rect',
      relationshipMetadata: {
        sourceShapeId: 'shape_orange_rect',
        targetShapeId: 'shape_teal_rect'
      }
    },
    {
      id: 'text_orange_label',
      type: 'textbox',
      text: 'Start',
      left: 120,
      top: 165,
      width: 80,
      height: 24,
      fontSize: 16,
      fill: '#1e293b'
    },
    {
      id: 'text_teal_label',
      type: 'textbox',
      text: 'Process',
      left: 645,
      top: 148,
      width: 90,
      height: 24,
      fontSize: 16,
      fill: '#1e293b'
    }
  ]
};

await db.collection('boards').updateOne(
  { _id: reportedBoardId },
  {
    $set: {
      title: 'Phase 4F.19 Reported Scenario (Needs Improvement)',
      owner: user._id,
      members: [],
      isDeleted: false,
      canvasData: reportedCanvasData,
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: new Date()
    },
    $setOnInsert: {
      createdAt: new Date()
    }
  },
  { upsert: true }
);

console.log('Reported scenario board ready: ID =', reportedBoardId.toString());

// 2. Board for already well-organized scenario (effectively unchanged expected)
const wellOrganizedBoardId = new mongoose.Types.ObjectId('6a9999999999999999999902');
const wellOrganizedCanvasData = {
  version: '6.5.1',
  objects: [
    {
      id: 'shape_a',
      type: 'rect',
      left: 80,
      top: 200,
      width: 160,
      height: 80,
      fill: '#3b82f6',
      originX: 'left',
      originY: 'top',
      shapeType: 'rect'
    },
    {
      id: 'shape_b',
      type: 'rect',
      left: 320,
      top: 200,
      width: 160,
      height: 80,
      fill: '#8b5cf6',
      originX: 'left',
      originY: 'top',
      shapeType: 'rect'
    },
    {
      id: 'conn_ab',
      type: 'path',
      isConnector: true,
      path: [
        ['M', 240, 240],
        ['L', 320, 240]
      ],
      left: 240,
      top: 240,
      width: 80,
      height: 10,
      stroke: '#64748b',
      strokeWidth: 3,
      fill: '',
      originX: 'left',
      originY: 'top',
      relationshipMetadata: { sourceShapeId: 'shape_a', targetShapeId: 'shape_b' }
    }
  ]
};

await db.collection('boards').updateOne(
  { _id: wellOrganizedBoardId },
  {
    $set: {
      title: 'Phase 4F.19 Well-Organized Scenario (No Movement Expected)',
      owner: user._id,
      members: [],
      isDeleted: false,
      canvasData: wellOrganizedCanvasData,
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: new Date()
    },
    $setOnInsert: {
      createdAt: new Date()
    }
  },
  { upsert: true }
);

console.log('Well-organized scenario board ready: ID =', wellOrganizedBoardId.toString());

await mongoose.disconnect();
console.log('Done!');
