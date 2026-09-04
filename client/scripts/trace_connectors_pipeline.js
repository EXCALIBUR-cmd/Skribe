import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { extractWorkspaceModel } from '../src/features/messCleanup/extractWorkspaceModel.js';
import { hydrateCanvasObjects } from '../src/utils/fabricHydration.js';
import { buildCleanupPlan } from '../src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../src/features/messCleanup/executeCleanupPlan.js';
import { buildPreviewRenderModel, worldToPreview } from '../src/features/messCleanup/previewModel.js';
import { parseConnectorPath, mapSvgPathCommands } from '../src/features/messCleanup/connectorGeometry.js';

dotenv.config({ path: '../server/.env' });

async function auditBoard(boardId, boardName) {
  console.log(`\n================================================================================`);
  console.log(`AUDITING VISUAL FIDELITY PIPELINE FOR BOARD: "${boardName}" (${boardId})`);
  console.log(`================================================================================`);

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
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

  console.log('\n--- PREVIEW COORDINATE CONTEXT ---');
  console.log('renderBounds (canvasBounds):', renderBounds);
  console.log('scale:', scale.toFixed(4));
  console.log('content dimensions:', { contentWidth: Math.round(contentWidth), contentHeight: Math.round(contentHeight) });

  const connectors = renderModel.objects.filter((o) => o.type === 'connector');
  console.log(`\nFound ${connectors.length} connectors in renderModel:`);

  connectors.forEach((conn, idx) => {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`CONNECTOR #${idx + 1}: ${conn.originalObjectId} (${conn.connectorType})`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log('1. WorkspaceModel object:');
    const wsObj = wsModel.board.objects.find((o) => o.id === conn.originalObjectId);
    console.log('   id:', wsObj?.id, '| elementId:', wsObj?.elementId, '| type:', wsObj?.type);
    console.log('   connectorType:', wsObj?.connector?.connectorType, '| startArrow:', wsObj?.connector?.startArrow, '| endArrow:', wsObj?.connector?.endArrow);
    console.log('   path command count:', Array.isArray(wsObj?.connector?.path) ? wsObj.connector.path.length : 0);

    console.log('\n2. CleanupPlan action:');
    const affectedAction = plan.actions?.find((a) => (a.objectIds || []).includes(conn.originalObjectId));
    console.log('   Action:', affectedAction ? affectedAction.type : '(Untouched / Preserved)');

    console.log('\n3. LayoutProposal placement:');
    const placement = proposal.placements.find((p) => p.objectId === conn.originalObjectId);
    console.log('   placement bounds:', placement?.bounds);
    console.log('   placement position:', placement?.position);
    console.log('   pathCommands count:', Array.isArray(placement?.pathCommands) ? placement.pathCommands.length : 0);

    console.log('\n4. Preview Render Model:');
    console.log('   type:', conn.type, '| connectorType:', conn.connectorType);
    console.log('   stroke:', conn.stroke, '| strokeWidth:', conn.strokeWidth);
    console.log('   startArrow:', conn.startArrow, '| endArrow:', conn.endArrow);
    console.log('   pathData length:', conn.pathData?.length);

    console.log('\n5. SVG DOM Render Simulation:');
    const pathSource = conn.pathCommands || conn.pathData || conn.path;
    const parsed = parseConnectorPath(pathSource);
    const isLocal = parsed && parsed.startPt && (Math.abs(parsed.startPt.x) < 50 && Math.abs(parsed.startPt.y) < 50) && (Math.abs(conn.position.x) > 100 || Math.abs(conn.position.y) > 100);
    const delta = isLocal ? { dx: conn.position.x, dy: conn.position.y } : { dx: 0, dy: 0 };
    const svgPath = mapSvgPathCommands(pathSource, mapPoint, delta);

    console.log('   isLocal heuristic triggered?:', Boolean(isLocal));
    console.log('   delta applied:', delta);
    console.log('   Final SVG "d":', svgPath ? svgPath.substring(0, 100) + '...' : '(EMPTY)');

    const firstM = svgPath ? svgPath.match(/M\s+([-\d.]+)\s+([-\d.]+)/) : null;
    if (firstM) {
      const sx = parseFloat(firstM[1]);
      const sy = parseFloat(firstM[2]);
      const isInside = sx >= 0 && sx <= contentWidth && sy >= 0 && sy <= contentHeight;
      console.log(`   Screen Start Point: (${sx.toFixed(1)}, ${sy.toFixed(1)}) | Inside [0..${Math.round(contentWidth)}, 0..${Math.round(contentHeight)}]: ${isInside ? 'YES (VISIBLE)' : 'NO (CLIPPED/OUTSIDE)'}`);
    }
  });

  console.log('\n--------------------------------------------------------------------------------');
  console.log('LINE DIVIDER TRACE:');
  console.log('--------------------------------------------------------------------------------');
  const lines = renderModel.objects.filter((o) => o.type === 'line');
  lines.forEach((l) => {
    console.log('id:', l.originalObjectId, '| isSkribeLine:', l.isSkribeLine, '| bounds:', l.bounds);
    const isVertical = (l.bounds?.height || 0) > (l.bounds?.width || 0) * 2;
    const start = isVertical
      ? mapPoint({ x: l.bounds.x + l.bounds.width / 2, y: l.bounds.y })
      : mapPoint({ x: l.bounds.x, y: l.bounds.y + l.bounds.height / 2 });
    const end = isVertical
      ? mapPoint({ x: l.bounds.x + l.bounds.width / 2, y: l.bounds.y + l.bounds.height })
      : mapPoint({ x: l.bounds.x + l.bounds.width, y: l.bounds.y + l.bounds.height / 2 });
    console.log(`Screen Line: from (${start.x.toFixed(1)}, ${start.y.toFixed(1)}) to (${end.x.toFixed(1)}, ${end.y.toFixed(1)})`);
  });

  console.log('\n--------------------------------------------------------------------------------');
  console.log('IMPORTANT CALLOUT TRACE:');
  console.log('--------------------------------------------------------------------------------');
  const callout = renderModel.objects.find((o) => (o.elementId && o.elementId.includes('wzry1')) || o.shapeType === 'callout' || (o.text && o.text.includes('Important')));
  if (callout) {
    console.log('Found Callout:', callout.originalObjectId, '| type:', callout.type, '| shapeType:', callout.shapeType);
    console.log('Bounds:', callout.bounds, '| text:', callout.text);
  } else {
    console.log('Callout object not found by specific selector, checking all shapes:');
    renderModel.objects.filter(o => o.type === 'shape').forEach(s => console.log('Shape:', s.originalObjectId, s.shapeType));
  }
}

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skribe';
  await mongoose.connect(uri);

  await auditBoard('6a7e4c6be2daa50954af00a6', 'Board 1');

  await auditBoard('6a8b86c96783556e56bb7477', 'test A');

  await mongoose.disconnect();
}

run().catch(console.error);
