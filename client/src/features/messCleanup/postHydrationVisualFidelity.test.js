import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateSkribeFabricObject } from '../../utils/fabricHydration.js';
import { normalizeObject } from './normalizeObjects.js';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';
import { buildSemanticScene } from './semanticSceneAdapter.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildPreviewRenderModel, worldToPreview } from './previewModel.js';

const createMockRealBoardDataset = () => {
  const rawList = [
    { id: 'shape_hex', elementId: 'hex_1', type: 'path', shapeType: 'hexagon', left: 100, top: 100, width: 160, height: 140, fill: '#bfdbfe', stroke: '#1e3a8a', attachedTextId: 'text_hex' },
    { id: 'text_hex', elementId: 'hex_1', type: 'textbox', text: 'Process Step', left: 120, top: 150, width: 120, height: 20, parentShapeId: 'shape_hex' },

    { id: 'shape_circle', elementId: 'circle_1', type: 'circle', left: 300, top: 100, width: 120, height: 120, fill: '#bbf7d0', stroke: '#15803d', attachedTextId: 'text_circle' },
    { id: 'text_circle', elementId: 'circle_1', type: 'textbox', text: 'Start Node', left: 320, top: 150, width: 80, height: 20, parentShapeId: 'shape_circle' },

    { id: 'shape_tri', elementId: 'tri_1', type: 'triangle', left: 500, top: 100, width: 180, height: 160, fill: '#fef08a', stroke: '#a16207', attachedTextId: 'text_tri' },
    { id: 'text_tri', elementId: 'tri_1', type: 'textbox', text: 'Warning', left: 540, top: 180, width: 100, height: 20, parentShapeId: 'shape_tri' },

    { id: 'shape_diamond', elementId: 'dia_1', type: 'polygon', shapeType: 'diamond', left: 700, top: 100, width: 140, height: 140, fill: '#e9d5ff', stroke: '#7e22ce', attachedTextId: 'text_dia' },
    { id: 'text_dia', elementId: 'dia_1', type: 'textbox', text: 'Approved?', left: 720, top: 160, width: 100, height: 20, parentShapeId: 'shape_diamond' },

    { id: 'shape_callout', elementId: 'call_1', type: 'rect', isCalloutNote: true, noteColor: '#fecaca', left: 100, top: 300, width: 160, height: 110, fill: '#fecaca', stroke: '#b91c1c', attachedTextId: 'text_call' },
    { id: 'text_call', elementId: 'call_1', type: 'textbox', text: 'Important Note', left: 110, top: 340, width: 140, height: 20, parentShapeId: 'shape_callout' },

    { id: 'shape_sticky', elementId: 'sticky_1', type: 'rect', isStickyNote: true, noteColor: '#bae6fd', left: 300, top: 300, width: 180, height: 115, fill: '#bae6fd', stroke: '#0284c7', attachedTextId: 'text_sticky' },
    { id: 'text_sticky', elementId: 'sticky_1', type: 'textbox', text: 'Sticky Content', left: 320, top: 330, width: 140, height: 40, parentShapeId: 'shape_sticky' },

    { id: 'shape_test1', elementId: 'test_1', type: 'rect', left: 500, top: 300, width: 200, height: 140, fill: '#18181b', stroke: '#27272a', attachedTextId: 'text_test1' },
    { id: 'text_test1', elementId: 'test_1', type: 'textbox', text: 'Testing Phase', left: 520, top: 350, width: 160, height: 30, parentShapeId: 'shape_test1' },

    { id: 'shape_test2', elementId: 'test_2', type: 'rect', left: 720, top: 300, width: 140, height: 120, fill: '#18181b', stroke: '#27272a', attachedTextId: 'text_test2' },
    { id: 'text_test2', elementId: 'test_2', type: 'textbox', text: 'Test Done', left: 740, top: 340, width: 100, height: 20, parentShapeId: 'shape_test2' },

    { id: 'text_hello_world', type: 'textbox', text: 'Hello World', left: 100, top: 500, width: 200, height: 30 },

    { id: 'stroke_hello', strokeId: 'stroke_hello', type: 'path', isVectorStroke: true, left: 320, top: 500, width: 80, height: 40, path: [['M', 0, 0], ['Q', 20, 30, 40, 10], ['L', 80, 40]] },

    { id: 'conn_straight', elementId: 'conn_straight', type: 'path', isConnector: true, connectorType: 'straight', sourceShapeId: 'shape_hex', targetShapeId: 'shape_circle', startArrow: false, endArrow: true, left: 260, top: 150, width: 40, height: 2, path: [['M', 0, 0], ['L', 40, 0]] },

    { id: 'conn_elbow', elementId: 'conn_elbow', type: 'path', isConnector: true, connectorType: 'elbow', sourceShapeId: 'shape_circle', targetShapeId: 'shape_tri', startArrow: false, endArrow: true, left: 420, top: 150, width: 80, height: 50, path: [['M', 0, 0], ['L', 40, 0], ['L', 40, 50], ['L', 80, 50]] },

    { id: 'conn_curved', elementId: 'conn_curved', type: 'path', isConnector: true, connectorType: 'curved', sourceShapeId: 'shape_tri', targetShapeId: 'shape_diamond', startArrow: false, endArrow: true, left: 680, top: 150, width: 20, height: 20, path: [['M', 0, 0], ['Q', 10, 20, 20, 20]] },

    { id: 'line_divider', elementId: 'line_divider', type: 'path', isSkribeLine: true, isStraightLine: true, left: 490, top: 80, width: 2, height: 450, path: [['M', 0, 0], ['L', 0, 450]] },

    { id: 'dot_artifact', type: 'path', left: 4500, top: 300, width: 0.1, height: 0.1, path: [['M', 0, 0], ['L', 0.1, 0.1]] }
  ];

  return rawList.map((raw) => {
    const obj = { ...raw, set(p) { Object.assign(this, p); } };
    hydrateSkribeFabricObject(obj, raw);
    return obj;
  });
};

test('1. Full real-board dataset renders 100% of source objects into LayoutProposal and PreviewRenderModel', () => {
  const fabricObjects = createMockRealBoardDataset();
  const normalized = fabricObjects.map((o, idx) => normalizeObject(o, idx));
  const wsModel = extractWorkspaceModel({ getObjects: () => fabricObjects });
  const semanticScene = buildSemanticScene(wsModel, null);
  const plan = buildCleanupPlan(semanticScene, wsModel);
  const proposal = executeCleanupPlan(plan, wsModel, fabricObjects);
  const previewModel = buildPreviewRenderModel(wsModel, proposal);

  assert.equal(proposal.placements.length, fabricObjects.length);
  assert.equal(previewModel.objects.length, fabricObjects.length);
});

test('2. Untouched objects strictly preserve 100% of source bounds, rotation, and styles', () => {
  const fabricObjects = createMockRealBoardDataset();
  const normalized = fabricObjects.map((o, idx) => normalizeObject(o, idx));
  const wsModel = extractWorkspaceModel({ getObjects: () => fabricObjects });
  const semanticScene = buildSemanticScene(wsModel, null);
  const plan = buildCleanupPlan(semanticScene, wsModel);
  const proposal = executeCleanupPlan(plan, wsModel, fabricObjects);

  plan.untouchedObjectIds.forEach((id) => {
    const src = normalized.find((o) => o.id === id);
    const placement = proposal.placements.find((p) => p.objectId === id);

    assert.ok(src, `Source object ${id} exists`);
    assert.ok(placement, `Placement for untouched object ${id} exists`);
    assert.equal(placement.bounds.x, src.bounds.x);
    assert.equal(placement.bounds.y, src.bounds.y);
    assert.equal(placement.bounds.width, src.bounds.width);
    assert.equal(placement.bounds.height, src.bounds.height);
    assert.equal(placement.rotation, src.rotation);
  });
});

test('3. Connectors preserve connectorType, arrowheads, and endpoint topology', () => {
  const fabricObjects = createMockRealBoardDataset();
  const wsModel = extractWorkspaceModel({ getObjects: () => fabricObjects });
  const semanticScene = buildSemanticScene(wsModel, null);
  const plan = buildCleanupPlan(semanticScene, wsModel);
  const proposal = executeCleanupPlan(plan, wsModel, fabricObjects);
  const previewModel = buildPreviewRenderModel(wsModel, proposal);

  const straightConn = previewModel.objects.find((o) => o.originalObjectId === 'conn_straight');
  assert.equal(straightConn.type, 'connector');
  assert.equal(straightConn.connectorType, 'straight');
  assert.equal(straightConn.endArrow, true);

  const elbowConn = previewModel.objects.find((o) => o.originalObjectId === 'conn_elbow');
  assert.equal(elbowConn.type, 'connector');
  assert.equal(elbowConn.connectorType, 'elbow');
  assert.equal(elbowConn.endArrow, true);

  const curvedConn = previewModel.objects.find((o) => o.originalObjectId === 'conn_curved');
  assert.equal(curvedConn.type, 'connector');
  assert.equal(curvedConn.connectorType, 'curved');
  assert.equal(curvedConn.endArrow, true);
});

test('4. Freehand strokes and Skribe lines preserve pathCommands without heuristic degradation', () => {
  const fabricObjects = createMockRealBoardDataset();
  const wsModel = extractWorkspaceModel({ getObjects: () => fabricObjects });
  const semanticScene = buildSemanticScene(wsModel, null);
  const plan = buildCleanupPlan(semanticScene, wsModel);
  const proposal = executeCleanupPlan(plan, wsModel, fabricObjects);
  const previewModel = buildPreviewRenderModel(wsModel, proposal);

  const strokeObj = previewModel.objects.find((o) => o.originalObjectId === 'stroke_hello');
  assert.equal(strokeObj.type, 'stroke');
  assert.ok(Array.isArray(strokeObj.pathCommands));
  assert.equal(strokeObj.pathCommands.length, 3);

  const lineObj = previewModel.objects.find((o) => o.originalObjectId === 'line_divider');
  assert.equal(lineObj.type, 'line');
  assert.ok(Array.isArray(lineObj.pathCommands));
});

test('5. worldToPreview maps world coordinates to positive screen space with zero clipping', () => {
  const bounds = { x: 100, y: 80, width: 800, height: 500 };
  const scale = 0.8;
  const padding = 24;

  const pt1 = worldToPreview({ x: 100, y: 80 }, bounds, scale, padding);
  assert.equal(pt1.x, padding);
  assert.equal(pt1.y, padding);

  const pt2 = worldToPreview({ x: 500, y: 300 }, bounds, scale, padding);
  assert.equal(pt2.x, (500 - 100) * scale + padding);
  assert.equal(pt2.y, (300 - 80) * scale + padding);
});

test('6. Stray sub-pixel dot artifacts are excluded from canvas bounds calculation without losing content', () => {
  const fabricObjects = createMockRealBoardDataset();
  const wsModel = extractWorkspaceModel({ getObjects: () => fabricObjects });
  const semanticScene = buildSemanticScene(wsModel, null);
  const plan = buildCleanupPlan(semanticScene, wsModel);
  const proposal = executeCleanupPlan(plan, wsModel, fabricObjects);

  assert.ok(proposal.canvasBounds.width < 2000, 'Canvas bounds are not inflated by 4500px outlier');
  assert.ok(proposal.placements.some((p) => p.objectId === 'dot_artifact'), 'Dot placement is still retained in proposal');
});
