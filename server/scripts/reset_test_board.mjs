import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: 'c:/Skribe/server/.env' });

await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/skribe');
const db = mongoose.connection.db;

const boardId = new mongoose.Types.ObjectId('6a9c6e3233c10e861b77e4e7');

// All registered users should be members so anyone can access
const users = await db.collection('users').find({}).toArray();
const memberIds = users.map((u) => u._id);

const testBoardData = {
  version: '6.5.1',
  objects: [
    {
      id: 'shape_elem_1788636730345_1ov36',
      elementId: 'elem_1788636730345_1ov36',
      type: 'Rect',
      left: 474,
      top: 132.0897,
      width: 160,
      height: 110,
      fill: '#ff9800',
      stroke: '#000000',
      strokeWidth: 2,
      rx: 16,
      ry: 16,
      originX: 'left',
      originY: 'top',
      shapeType: 'rounded_rect',
      scaleX: 1,
      scaleY: 1,
      angle: 0
    },
    {
      id: 'text_elem_1788636730345_1ov36',
      elementId: 'elem_1788636730345_1ov36',
      parentShapeId: 'shape_elem_1788636730345_1ov36',
      type: 'Textbox',
      left: 484,
      top: 178.0497,
      width: 140,
      height: 18.08,
      text: 'Rectangle',
      fontSize: 16,
      fontFamily: 'Outfit',
      fontWeight: 'bold',
      fill: '#ffffff',
      textAlign: 'center',
      originX: 'left',
      originY: 'top',
      scaleX: 1,
      scaleY: 1,
      angle: 0
    },
    {
      id: 'shape_elem_1788636800955_wkpdm',
      elementId: 'elem_1788636800955_wkpdm',
      type: 'Rect',
      left: 883,
      top: 167.1068,
      width: 160,
      height: 110,
      fill: '#006a65',
      stroke: '#000000',
      strokeWidth: 2,
      rx: 16,
      ry: 16,
      originX: 'left',
      originY: 'top',
      shapeType: 'rounded_rect',
      scaleX: 1,
      scaleY: 1,
      angle: 0
    },
    {
      id: 'text_elem_1788636800955_wkpdm',
      elementId: 'elem_1788636800955_wkpdm',
      parentShapeId: 'shape_elem_1788636800955_wkpdm',
      type: 'Textbox',
      left: 893,
      top: 213.0668,
      width: 140,
      height: 18.08,
      text: 'Rounded Rect',
      fontSize: 16,
      fontFamily: 'Outfit',
      fontWeight: 'bold',
      fill: '#ffffff',
      textAlign: 'center',
      originX: 'left',
      originY: 'top',
      scaleX: 1,
      scaleY: 1,
      angle: 0
    },
    {
      id: 'conn_1788636827219_5wvzi',
      elementId: '1788636827219_5wvzi',
      type: 'Path',
      isConnector: true,
      connectorType: 'straight',
      startArrow: false,
      endArrow: true,
      sourceShapeId: 'shape_elem_1788636730345_1ov36',
      targetShapeId: 'shape_elem_1788636800955_wkpdm',
      path: [
        ['M', 674, 200],
        ['L', 814, 200],
        ['M', 801.67, 205.5],
        ['L', 814, 200],
        ['L', 801.67, 194.5]
      ],
      left: 674,
      top: 194.5,
      width: 140,
      height: 11,
      stroke: '#000000',
      strokeWidth: 3,
      fill: 'transparent',
      originX: 'left',
      originY: 'top',
      scaleX: 1,
      scaleY: 1,
      angle: 0
    },
    {
      id: 'shape_elem_1788778819916_t0ghn',
      elementId: 'elem_1788778819916_t0ghn',
      type: 'Circle',
      left: 688,
      top: 375.9428,
      width: 120,
      height: 120,
      radius: 60,
      fill: '#79f3ea',
      stroke: '#000000',
      strokeWidth: 2,
      originX: 'left',
      originY: 'top',
      shapeType: 'circle',
      scaleX: 1,
      scaleY: 1,
      angle: 0
    },
    {
      id: 'text_elem_1788778819916_t0ghn',
      elementId: 'elem_1788778819916_t0ghn',
      parentShapeId: 'shape_elem_1788778819916_t0ghn',
      type: 'Textbox',
      left: 698,
      top: 426.9028,
      width: 100,
      height: 18.08,
      text: 'Circle',
      fontSize: 16,
      fontFamily: 'Outfit',
      fontWeight: 'bold',
      fill: '#000000',
      textAlign: 'center',
      originX: 'left',
      originY: 'top',
      scaleX: 1,
      scaleY: 1,
      angle: 0
    }
  ]
};

await db.collection('boards').updateOne(
  { _id: boardId },
  {
    $set: {
      title: 'Test board',
      canvasData: testBoardData,
      members: memberIds,
      updatedAt: new Date()
    }
  },
  { upsert: true }
);

console.log('Test board reset to pristine Test 1 before-state with verified connector.');
await mongoose.disconnect();
