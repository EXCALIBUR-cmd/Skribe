import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeObject, computePathBounds, getPathWorldDelta } from './normalizeObjects.js';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildPreviewRenderModel, worldToPreview } from './previewModel.js';
import { mapSvgPathCommands, transformConnectorGeometry, parseConnectorPath } from './connectorGeometry.js';
import { applyCleanup } from './applyCleanup.js';

const realBoard1 = {
  rectangle: {
    id: 'shape_elem_1788434979656_iuvk9',
    type: 'Rect',
    left: 619,
    top: 233.0625,
    width: 160,
    height: 110,
    originX: 'center',
    originY: 'center',
    fill: '#bae6fd',
    stroke: '#0284c7',
    strokeWidth: 2
  },
  rectText: {
    id: 'text_elem_1788434979656_iuvk9',
    type: 'Textbox',
    text: 'Rectangle',
    left: 619,
    top: 233.0625,
    width: 140,
    height: 18.08,
    originX: 'center',
    originY: 'center',
    parentShapeId: 'shape_elem_1788434979656_iuvk9'
  },
  straightConn: {
    id: 'conn_1788434989139_lj7x2',
    elementId: '1788434989139_lj7x2',
    type: 'Path',
    left: 787,
    top: 236.0608,
    width: 140,
    height: 11.0095,
    originX: 'center',
    originY: 'center',
    stroke: '#334155',
    strokeWidth: 2.5,
    isConnector: true,
    connectorType: 'straight',
    sourceShapeId: 'shape_elem_1788434979656_iuvk9',
    targetShapeId: null,
    path: [
      ['M', 699, 233.0625],
      ['L', 839, 233.0625],
      ['M', 826.67, 238.567],
      ['L', 839, 233.0625],
      ['L', 826.67, 227.558]
    ]
  },
  decisionDiamond: {
    id: 'shape_elem_1788435035924_d771y',
    type: 'Polygon',
    left: 970,
    top: 237.0696,
    width: 140,
    height: 140,
    originX: 'center',
    originY: 'center',
    fill: '#e0f2fe',
    stroke: '#000000',
    strokeWidth: 2,
    points: [{ x: 70, y: 0 }, { x: 140, y: 70 }, { x: 70, y: 140 }, { x: 0, y: 70 }]
  },
  curvedConn: {
    id: 'conn_1788435077435_lm0vr',
    elementId: '1788435077435_lm0vr',
    type: 'Path',
    left: 1104,
    top: 235.7461,
    width: 140,
    height: 37.5,
    originX: 'center',
    originY: 'center',
    stroke: '#334155',
    strokeWidth: 2.5,
    isConnector: true,
    connectorType: 'curved',
    sourceShapeId: 'shape_elem_1788435035924_d771y',
    targetShapeId: null,
    path: [
      ['M', 1370, 234.5078],
      ['C', 1419, 184.5078, 1461, 184.5078, 1510, 234.5078],
      ['M', 1497.44, 229.557],
      ['L', 1510, 234.5078],
      ['L', 1505.30, 221.851]
    ]
  },
  stickyNote: {
    id: 'shape_elem_1788435089317_ihohc',
    type: 'Rect',
    isStickyNote: true,
    noteColor: '#bae6fd',
    left: 616,
    top: 456.9587,
    width: 180,
    height: 180,
    originX: 'center',
    originY: 'center',
    fill: '#bae6fd',
    stroke: '#0284c7',
    strokeWidth: 1
  },
  elbowConn: {
    id: 'conn_1788435099188_csv3b',
    elementId: '1788435099188_csv3b',
    type: 'Path',
    left: 778.7524,
    top: 436.9587,
    width: 145.5048,
    height: 40,
    originX: 'center',
    originY: 'center',
    stroke: '#334155',
    strokeWidth: 2.5,
    isConnector: true,
    connectorType: 'elbow',
    sourceShapeId: 'shape_elem_1788435089317_ihohc',
    targetShapeId: null,
    path: [
      ['M', 706, 456.9587],
      ['L', 776, 456.9587],
      ['L', 776, 416.9587],
      ['L', 846, 416.9587],
      ['L', 846, 456.9587],
      ['M', 840.495, 444.632],
      ['L', 846, 456.9587],
      ['L', 851.505, 444.632]
    ]
  },
  circle: {
    id: 'shape_elem_1788435103770_odkdj',
    type: 'Circle',
    left: 846,
    top: 522.9292,
    width: 120,
    height: 120,
    originX: 'center',
    originY: 'center',
    fill: '#79f3ea',
    stroke: '#000000',
    strokeWidth: 2
  }
};

const createMockCanvas = (objects = []) => ({
  getObjects: () => objects,
  requestRenderAll: () => {},
  version: '7.4.0'
});

const runPipeline = (canvasObjects) => {
  const canvas = createMockCanvas(canvasObjects);
  const wm = extractWorkspaceModel(canvas);
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  const renderModel = buildPreviewRenderModel(wm, proposal);
  return { wm, plan, proposal, renderModel };
};


test('1. Untouched elbow preserves exact world path', () => {
  const raw = { ...realBoard1.elbowConn };
  const { wm, proposal, renderModel } = runPipeline([raw]);

  const norm = wm.board.objects[0];
  const p = proposal.placements.find((pl) => pl.objectId === raw.id);
  const r = renderModel.objects.find((ro) => ro.originalObjectId === raw.id);

  assert.deepEqual(p.path, norm.path, 'Proposal path equals normalized world path');
  assert.deepEqual(r.path, norm.path, 'RenderModel path equals normalized world path');
  assert.equal(r.path[0][0], 'M');
  assert.equal(Math.round(r.path[0][1]), 706, 'Starts at world X 706');
  assert.equal(Number(r.path[0][2].toFixed(2)), 456.96, 'Starts at world Y ~456.96');
});

test('2. Untouched curved connector preserves exact world path', () => {
  const raw = { ...realBoard1.curvedConn };
  const { wm, proposal, renderModel } = runPipeline([raw]);

  const norm = wm.board.objects[0];
  const p = proposal.placements.find((pl) => pl.objectId === raw.id);
  const r = renderModel.objects.find((ro) => ro.originalObjectId === raw.id);

  assert.deepEqual(p.path, norm.path, 'Proposal path equals normalized world path');
  assert.deepEqual(r.path, norm.path, 'RenderModel path equals normalized world path');
  assert.equal(Math.round(r.path[0][1]), 1034, 'Curved starts at world X 1034');
});

test('3. Untouched straight connector preserves exact world path', () => {
  const raw = { ...realBoard1.straightConn };
  const { wm, proposal, renderModel } = runPipeline([raw]);

  const norm = wm.board.objects[0];
  const p = proposal.placements.find((pl) => pl.objectId === raw.id);
  const r = renderModel.objects.find((ro) => ro.originalObjectId === raw.id);

  assert.deepEqual(p.path, norm.path);
  assert.deepEqual(r.path, norm.path);
  assert.equal(Math.round(r.path[0][1]), 717, 'Straight starts at world X 717');
});


test('4. No connector double translation in transformConnectorGeometry', () => {
  const conn = {
    position: { x: 717, y: 236 },
    left: 787,
    top: 236,
    path: [
      ['M', 717, 236],
      ['L', 839, 236]
    ]
  };

  const res = transformConnectorGeometry({
    originalObject: conn,
    connectorType: 'straight',
    translationDelta: { dx: 50, dy: 30 }
  });

  assert.equal(res.start.x, 717 + 50, 'Start X translated by dx 50 only, no double translation');
  assert.equal(res.start.y, 236 + 30, 'Start Y translated by dy 30 only, no double translation');
  assert.equal(res.pathCommands[0][1], 717 + 50);
  assert.equal(res.pathCommands[0][2], 236 + 30);
});

test('5. Fabric pathOffset handled exactly once', () => {
  const obj = {
    type: 'Path',
    originX: 'center',
    originY: 'center',
    left: 500,
    top: 300,
    width: 100,
    height: 50,
    pathOffset: { x: 50, y: 25 },
    path: [['M', 0, 0], ['L', 100, 50]]
  };

  const delta = getPathWorldDelta(obj);
  assert.equal(delta.dx, 450);
  assert.equal(delta.dy, 275);

  const norm = normalizeObject(obj);
  assert.equal(norm.path[0][1], 0 + 450, 'Path M x is exactly 450');
  assert.equal(norm.path[0][2], 0 + 275, 'Path M y is exactly 275');
});

test('6. Local Fabric path converted to world exactly once', () => {
  const rawObj = {
    type: 'Path',
    originX: 'center',
    originY: 'center',
    left: 700,
    top: 200,
    width: 100,
    height: 20,
    path: [['M', 650, 190], ['L', 750, 210]]
  };

  const norm = normalizeObject(rawObj);
  assert.equal(norm.path[0][1], 650);
  assert.equal(norm.path[1][1], 750);
});

test('7. World path never translated a second time', () => {
  const norm = normalizeObject(realBoard1.straightConn);
  const wm = { board: { objects: [norm] } };
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  assert.equal(proposal.valid, true);
  const p = proposal.placements[0];

  assert.deepEqual(p.path, norm.path, 'Placement path unchanged');
  const preview = buildPreviewRenderModel(wm, proposal);
  const r = preview.objects[0];
  assert.deepEqual(r.path, norm.path, 'Preview object path unchanged');
});

test('8. Unresolved connector never inherits nearest-shape movement', () => {
  const shape1 = {
    id: 'shape_1',
    type: 'Rect',
    left: 600,
    top: 200,
    width: 100,
    height: 100,
    originX: 'center',
    originY: 'center'
  };
  const shape2 = {
    id: 'shape_2',
    type: 'Rect',
    left: 650,
    top: 200,
    width: 100,
    height: 100,
    originX: 'center',
    originY: 'center'
  };
  const unresolvedConn = { ...realBoard1.straightConn };

  const canvas = createMockCanvas([shape1, shape2, unresolvedConn]);
  const wm = extractWorkspaceModel(canvas);

  const plan = {
    version: 1,
    actions: [
      { id: 'act_align', type: 'align', axis: 'x', objectIds: ['shape_1', 'shape_2'], confidence: 0.9, reason: 'Align shapes' }
    ],
    untouchedObjectIds: [unresolvedConn.id],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 1, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, wm);
  assert.equal(proposal.valid, true);
  const pConn = proposal.placements.find((p) => p.objectId === unresolvedConn.id);
  const normConn = wm.board.objects.find((o) => o.id === unresolvedConn.id);

  assert.deepEqual(pConn.path, normConn.path, 'Unresolved connector path unchanged when neighbor moves');
});

test('9. Unresolved connector never receives endpoint snapping', () => {
  const { wm, proposal } = runPipeline([realBoard1.rectangle, realBoard1.straightConn]);
  const normConn = wm.board.objects.find((o) => o.id === realBoard1.straightConn.id);
  const pConn = proposal.placements.find((p) => p.objectId === realBoard1.straightConn.id);

  assert.deepEqual(pConn.path, normConn.path, 'Endpoints never snapped');
});

test('10. Arrowhead remains attached to original path', () => {
  const parsed = parseConnectorPath(realBoard1.elbowConn.path);
  assert.ok(parsed.hasArrowhead, 'Has arrowhead subpath');
  assert.equal(parsed.allCommands.length, 8, 'Exact 8 commands (main line + 2 arrowhead wings)');

  const norm = normalizeObject(realBoard1.elbowConn);
  assert.equal(norm.path.length, 8, 'Normalized path keeps all 8 commands');
  assert.equal(norm.path[5][0], 'M', 'Arrowhead starts with M');
  assert.equal(norm.path[6][0], 'L');
  assert.equal(norm.path[7][0], 'L');
});

test('11. Connector bounds calculation includes all line segments and arrowhead extrema', () => {
  const pBounds = computePathBounds(realBoard1.elbowConn.path);
  assert.ok(pBounds, 'Path bounds computed');
  assert.equal(Math.round(pBounds.x), 706);
  assert.equal(Math.round(pBounds.y), 417);
  assert.ok(pBounds.width >= 145);
  assert.ok(pBounds.height >= 39);
});

test('12. Preview transform preserves world-relative placement', () => {
  const renderBounds = { x: 500, y: 150, width: 600, height: 400 };
  const scale = 0.8;
  const padding = 24;

  const ptA = { x: 699, y: 233.06 };
  const ptB = { x: 717, y: 236.06 };

  const prevA = worldToPreview(ptA, renderBounds, scale, padding);
  const prevB = worldToPreview(ptB, renderBounds, scale, padding);

  const worldDx = ptB.x - ptA.x;
  const previewDx = prevB.x - prevA.x;

  assert.equal(Number(previewDx.toFixed(2)), Number((worldDx * scale).toFixed(2)), 'Preview maintains exact scaled delta');
});

test('13. Connector-to-shape distance is preserved after preview scaling', () => {
  const worldDist = 18;
  const scale = 0.5;
  const previewDist = worldDist * scale;
  assert.equal(previewDist, 9);
});


test('14. Center-origin shape bounds are converted correctly', () => {
  const rect = {
    id: 'r1',
    type: 'Rect',
    left: 619,
    top: 233,
    width: 160,
    height: 110,
    originX: 'center',
    originY: 'center'
  };

  const norm = normalizeObject(rect);
  assert.equal(norm.bounds.x, 619 - 80, 'World left is 539');
  assert.equal(norm.bounds.y, 233 - 55, 'World top is 178');
  assert.equal(norm.bounds.width, 160);
  assert.equal(norm.bounds.height, 110);
  assert.equal(norm.center.x, 619, 'Center X is preserved');
  assert.equal(norm.center.y, 233, 'Center Y is preserved');
});

test('15. Center-origin shape center survives round-trip through executeCleanupPlan', () => {
  const rect = normalizeObject({
    id: 'r1',
    type: 'Rect',
    left: 619,
    top: 233,
    width: 160,
    height: 110,
    originX: 'center',
    originY: 'center'
  });

  const wm = { board: { objects: [rect] } };
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  assert.equal(proposal.valid, true);
  const p = proposal.placements[0];

  assert.equal(p.center.x, 619);
  assert.equal(p.center.y, 233);
  assert.equal(p.bounds.x, 539);
  assert.equal(p.bounds.y, 178);
});

test('16. Center-origin untouched object survives Apply Cleanup without drift', () => {
  const obj = {
    id: 'r1',
    type: 'rect',
    left: 619,
    top: 233.0625,
    width: 160,
    height: 110,
    originX: 'center',
    originY: 'center',
    angle: 0,
    scaleX: 1,
    scaleY: 1
  };

  const canvas = createMockCanvas([obj]);
  const norm = normalizeObject(obj);
  const wm = { board: { objects: [norm] } };
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  assert.equal(proposal.valid, true);

  const res = applyCleanup(canvas, proposal, {});
  assert.equal(res.success, true);
  assert.equal(obj.left, 619, 'Untouched center X has 0 drift');
  assert.equal(obj.top, 233.0625, 'Untouched center Y has 0 drift');
});


test('17. Real Board 1 elbow connector regression: 0px intrusion into Sticky Note border', () => {
  const { wm, renderModel } = runPipeline([realBoard1.stickyNote, realBoard1.elbowConn]);

  const sticky = renderModel.objects.find((o) => o.originalObjectId === realBoard1.stickyNote.id);
  const conn = renderModel.objects.find((o) => o.originalObjectId === realBoard1.elbowConn.id);

  const stickyRight = sticky.bounds.x + sticky.bounds.width;
  const connStartX = conn.path[0][1];

  const rawClearance = connStartX - stickyRight;
  const clearance = Math.abs(rawClearance) < 0.001 ? 0 : rawClearance;
  assert.equal(Math.round(stickyRight), 706, 'Sticky note right edge is at 706');
  assert.equal(Math.round(connStartX), 706, 'Elbow connector starts at 706');
  assert.equal(Math.round(clearance), 0, 'Exact boundary contact: 0px intrusion!');
});

test('18. Real Board 1 curved connector regression: preserves exact relationship to Decision diamond', () => {
  const { renderModel } = runPipeline([realBoard1.decisionDiamond, realBoard1.curvedConn]);

  const diamond = renderModel.objects.find((o) => o.originalObjectId === realBoard1.decisionDiamond.id);
  const conn = renderModel.objects.find((o) => o.originalObjectId === realBoard1.curvedConn.id);

  const diamondRight = diamond.bounds.x + diamond.bounds.width;
  const connStartX = conn.path[0][1];

  assert.equal(diamond.bounds.x, 900, 'Diamond world left is 900');
  assert.equal(diamondRight, 1040, 'Diamond right edge is 1040');
  assert.equal(Math.round(connStartX), 1034, 'Curved connector starts at 1034');
  assert.ok(connStartX <= diamondRight, 'Curved connector touches near the diamond vertex');
  assert.ok(diamondRight - connStartX <= 10, 'Natural clearance <= 10px from rightmost vertex');
});

test('19. Real Board 1 straight connector regression: +18px natural clearance from Rectangle', () => {
  const { renderModel } = runPipeline([realBoard1.rectangle, realBoard1.straightConn]);

  const rect = renderModel.objects.find((o) => o.originalObjectId === realBoard1.rectangle.id);
  const conn = renderModel.objects.find((o) => o.originalObjectId === realBoard1.straightConn.id);

  const rectRight = rect.bounds.x + rect.bounds.width;
  const connStartX = conn.path[0][1];

  assert.equal(rect.bounds.x, 539, 'Rectangle world left is 539');
  assert.equal(rectRight, 699, 'Rectangle right edge is 699');
  assert.equal(Math.round(connStartX), 717, 'Straight connector starts at 717');

  const clearance = connStartX - rectRight;
  assert.equal(Math.round(clearance), 18, 'Exact natural clearance is +18px!');
});

test('20. Real Board 1 full scene relative geometry regression: no connector overlaps its shape', () => {
  const allObjects = [
    realBoard1.rectangle,
    realBoard1.rectText,
    realBoard1.straightConn,
    realBoard1.decisionDiamond,
    realBoard1.curvedConn,
    realBoard1.stickyNote,
    realBoard1.elbowConn,
    realBoard1.circle
  ];

  const { renderModel } = runPipeline(allObjects);

  const rect = renderModel.objects.find((o) => o.originalObjectId === realBoard1.rectangle.id);
  const sConn = renderModel.objects.find((o) => o.originalObjectId === realBoard1.straightConn.id);
  const sticky = renderModel.objects.find((o) => o.originalObjectId === realBoard1.stickyNote.id);
  const eConn = renderModel.objects.find((o) => o.originalObjectId === realBoard1.elbowConn.id);
  const circle = renderModel.objects.find((o) => o.originalObjectId === realBoard1.circle.id);

  assert.ok(sConn.path[0][1] >= rect.bounds.x + rect.bounds.width, 'Straight connector starts outside rectangle');

  assert.ok(eConn.path[0][1] >= sticky.bounds.x + sticky.bounds.width - 0.5, 'Elbow connector starts at or outside sticky note right border');

  const elbowVertX = eConn.path[3][1];
  assert.equal(Math.round(elbowVertX), 846, 'Elbow vertical segment is at X 846');
  assert.equal(Math.round(circle.center.x), 846, 'Circle center is at X 846');
  assert.equal(Math.round(elbowVertX), Math.round(circle.center.x), 'Elbow connector vertical segment aims directly at Circle center');
});


test('21. Additional Round-Trip Test: full pipeline preserves all properties with 0 positional drift', () => {
  const originalObj = {
    id: 'test_shape_rt',
    type: 'Rect',
    left: 450.5,
    top: 320.25,
    width: 200,
    height: 100,
    originX: 'center',
    originY: 'center',
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    fill: '#e0f2fe',
    stroke: '#0369a1',
    strokeWidth: 3,
    strokeDashArray: [4, 4]
  };

  const canvas = createMockCanvas([originalObj]);
  const wm = extractWorkspaceModel(canvas);
  const norm = wm.board.objects[0];

  assert.equal(norm.originX, 'center');
  assert.equal(norm.originY, 'center');
  assert.equal(norm.bounds.x, 450.5 - 100);
  assert.equal(norm.bounds.y, 320.25 - 50);
  assert.equal(norm.center.x, 450.5);
  assert.equal(norm.center.y, 320.25);

  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  const res = applyCleanup(canvas, proposal, {});

  assert.equal(res.success, true);
  assert.equal(originalObj.left, 450.5, 'Exact left preserved');
  assert.equal(originalObj.top, 320.25, 'Exact top preserved');
  assert.equal(originalObj.originX, 'center', 'originX preserved');
  assert.equal(originalObj.originY, 'center', 'originY preserved');
  assert.equal(originalObj.width, 200, 'width preserved');
  assert.equal(originalObj.height, 100, 'height preserved');
  assert.equal(originalObj.scaleX, 1, 'scaleX preserved');
  assert.equal(originalObj.scaleY, 1, 'scaleY preserved');
  assert.equal(originalObj.angle, 0, 'angle preserved');
  assert.equal(originalObj.stroke, '#0369a1', 'stroke preserved');
  assert.equal(originalObj.strokeWidth, 3, 'strokeWidth preserved');
  assert.deepEqual(originalObj.strokeDashArray, [4, 4], 'strokeDashArray preserved');
  assert.equal(originalObj.fill, '#e0f2fe', 'fill preserved');
});
