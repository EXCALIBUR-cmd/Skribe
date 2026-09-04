import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { extractWorkspaceModel } from '../src/features/messCleanup/extractWorkspaceModel.js';
import { hydrateCanvasObjects } from '../src/utils/fabricHydration.js';
import { buildCleanupPlan } from '../src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../src/features/messCleanup/executeCleanupPlan.js';
import { buildPreviewRenderModel } from '../src/features/messCleanup/previewModel.js';
import { mapSvgPathCommands } from '../src/features/messCleanup/connectorGeometry.js';

dotenv.config({ path: '../server/.env' });

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);
  const boardId = '6a7e4c6be2daa50954af00a6';
  const board = await mongoose.connection.db.collection('boards').findOne({
    _id: new mongoose.Types.ObjectId(boardId)
  });

  const rawCanvasData = typeof board.canvasData === 'string' ? JSON.parse(board.canvasData) : (board.canvasData || {});
  const rawObjects = rawCanvasData.objects || [];

  const fabricObjects = rawObjects.map((raw) => ({
    type: (raw.type || 'rect').toLowerCase(),
    left: raw.left,
    top: raw.top,
    width: raw.width,
    height: raw.height,
    path: raw.path,
    stroke: raw.stroke,
    strokeWidth: raw.strokeWidth,
    fill: raw.fill,
    angle: raw.angle,
    text: raw.text,
    set(props) { Object.assign(this, props); },
    setCoords() {}
  }));

  const mockCanvas = { getObjects: () => fabricObjects };
  hydrateCanvasObjects(mockCanvas, rawObjects);
  const wsModel = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(wsModel);
  const proposal = executeCleanupPlan(plan, wsModel);
  const renderModel = buildPreviewRenderModel(wsModel, proposal);

  const renderBounds = renderModel.bounds;
  const previewWidth = 900;
  const previewHeight = 500;
  const padding = 24;
  const scale = Math.min(
    (previewWidth - padding * 2) / Math.max(renderBounds.width, 1),
    (previewHeight - padding * 2) / Math.max(renderBounds.height, 1),
    1
  );
  const contentWidth = Math.max(renderBounds.width * scale + padding * 2, 1);
  const contentHeight = Math.max(renderBounds.height * scale + padding * 2, 1);

  const mapPoint = (point) => ({
    x: (point.x - renderBounds.x) * scale + padding,
    y: (point.y - renderBounds.y) * scale + padding
  });

  console.log('BOARD 1: renderBounds:', renderBounds);
  console.log('scale:', scale, 'dimensions:', { contentWidth, contentHeight });

  const connectors = renderModel.objects.filter((o) => o.type === 'connector');
  console.log('Connectors count in renderModel:', connectors.length);
  connectors.forEach((c, i) => {
    const pathSource = c.pathCommands || c.pathData || c.path;
    const svgPath = mapSvgPathCommands(pathSource, mapPoint, null);
    const firstM = svgPath ? svgPath.match(/M\s+([-\d.]+)\s+([-\d.]+)/) : null;
    console.log(`Connector ${i + 1}: ${c.originalObjectId} | type: ${c.connectorType} | screen start: (${firstM ? firstM[1] : 'none'}, ${firstM ? firstM[2] : 'none'})`);
    console.log('SVG path:', svgPath);
  });

  const callout = renderModel.objects.find((o) => (o.elementId && o.elementId.includes('wzry1')));
  console.log('\nImportant Callout in renderModel:');
  console.log('ID:', callout?.originalObjectId, '| type:', callout?.type, '| shapeType:', callout?.shapeType);
  console.log('Bounds:', callout?.bounds);
  console.log('Fill:', callout?.fill, '| stroke:', callout?.stroke);
  console.log('Path commands present?:', Array.isArray(callout?.path));

  const calloutText = renderModel.objects.find((o) => o.text && o.text.includes('Important'));
  console.log('\nImportant Callout text:');
  console.log('ID:', calloutText?.originalObjectId, '| text:', calloutText?.text);
  console.log('Bounds:', calloutText?.bounds);

  const decision = renderModel.objects.find((o) => (o.elementId && o.elementId.includes('ctm8f')));
  console.log('\nDecision Diamond:');
  console.log('ID:', decision?.originalObjectId, '| type:', decision?.type, '| shapeType:', decision?.shapeType);

  const triangle = renderModel.objects.find((o) => o.shapeType === 'triangle' || (o.elementId && o.elementId.includes('tsq6f')));
  console.log('\nTriangle:');
  console.log('ID:', triangle?.originalObjectId, '| type:', triangle?.type, '| shapeType:', triangle?.shapeType);

  await mongoose.disconnect();
}
run().catch(console.error);
