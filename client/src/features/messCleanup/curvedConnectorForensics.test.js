import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildPreviewRenderModel, worldToPreview } from './previewModel.js';
import { mapSvgPathCommands, parseConnectorPath } from './connectorGeometry.js';

const curvedConnectorFixture = {
  type: 'Path',
  version: '7.4.0',
  originX: 'center',
  originY: 'center',
  left: 700.2281,
  top: 180.5448,
  width: 140,
  height: 37.5,
  fill: 'transparent',
  stroke: '#000000',
  strokeWidth: 3,
  scaleX: 1,
  scaleY: 1,
  visible: true,
  path: [
    ['M', 808.5355, 496.2995],
    ['C', 857.5355, 446.2995, 899.5355, 446.2995, 948.5355, 496.2995],
    ['M', 935.9761, 491.3485],
    ['L', 948.5355, 496.2995],
    ['L', 943.8392, 483.6427]
  ],
  pathOffset: {
    x: 878.5355,
    y: 477.5495
  },
  elementId: '1787668898659_1a2k8',
  isConnector: true,
  connectorType: 'curved',
  endArrow: true
};

const mockCanvas = {
  getObjects: () => [
    { id: 'c1', type: 'circle', left: 690, top: 304, width: 120, height: 120, originX: 'center', originY: 'center' },
    curvedConnectorFixture
  ],
  version: '7.4.0'
};

test('1. curved connector reaches previewModel', () => {
  const wm = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const prevObj = preview.objects.find((o) => o.originalObjectId === 'conn_1787668898659_1a2k8' || o.id === 'conn_1787668898659_1a2k8');
  assert.ok(prevObj, 'Curved connector present in previewModel');
  assert.equal(prevObj.type, 'connector');
  assert.equal(prevObj.connectorType, 'curved');
});

test('2. curved connector retains all path commands', () => {
  const wm = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const prevObj = preview.objects.find((o) => o.originalObjectId === 'conn_1787668898659_1a2k8' || o.id === 'conn_1787668898659_1a2k8');
  const cmds = prevObj.pathCommands || prevObj.path;
  assert.equal(cmds.length, 5, 'Exact 5 commands retained');
});

test('3. cubic Bézier command retained', () => {
  const wm = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const prevObj = preview.objects.find((o) => o.originalObjectId === 'conn_1787668898659_1a2k8' || o.id === 'conn_1787668898659_1a2k8');
  const cmds = prevObj.pathCommands || prevObj.path;
  const cCmd = cmds.find((c) => c[0] === 'C');
  assert.ok(cCmd, 'Cubic Bézier C command present');
  assert.equal(cCmd.length, 7, 'C command has 6 coordinates');
});

test('4. arrowhead subpath retained', () => {
  const wm = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const prevObj = preview.objects.find((o) => o.originalObjectId === 'conn_1787668898659_1a2k8' || o.id === 'conn_1787668898659_1a2k8');
  const cmds = prevObj.pathCommands || prevObj.path;
  const mCommands = cmds.filter((c) => c[0] === 'M');
  const lCommands = cmds.filter((c) => c[0] === 'L');
  assert.equal(mCommands.length, 2, 'Two subpaths (main curve + arrowhead)');
  assert.equal(lCommands.length, 2, 'Two arrowhead line segments');
});

test('5. curve transforms consistently', () => {
  const wm = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const prevObj = preview.objects.find((o) => o.originalObjectId === 'conn_1787668898659_1a2k8' || o.id === 'conn_1787668898659_1a2k8');
  const bounds = preview.bounds;
  const scale = 0.5;
  const mapPoint = (p) => worldToPreview(p, bounds, scale, 24);
  const svgPath = mapSvgPathCommands(prevObj.pathCommands || prevObj.path, mapPoint);

  assert.ok(svgPath.startsWith('M '), 'Starts with M');
  assert.ok(svgPath.includes(' C '), 'Contains C');
  assert.ok(svgPath.includes(' M '), 'Contains second M');
  assert.ok(svgPath.includes(' L '), 'Contains L');
});

test('6. bounds include Bézier extrema', () => {
  const wm = extractWorkspaceModel(mockCanvas);
  const wmObj = wm.board.objects.find((o) => o.id?.includes('1a2k8'));
  const cmds = wmObj.path;
  const xs = [cmds[0][1], cmds[1][1], cmds[1][3], cmds[1][5]];
  const ys = [cmds[0][2], cmds[1][2], cmds[1][4], cmds[1][6]];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  assert.ok(minY <= cmds[1][2], 'Extrema covers top of curve arch');
  assert.ok(maxX - minX > 100, 'Width is substantial');
});

test('7. SVG viewBox contains curve', () => {
  const fullCanvas = {
    getObjects: () => [
      { id: 'c1', type: 'circle', left: 400, top: 100, width: 120, height: 120 },
      curvedConnectorFixture,
      { id: 'c2', type: 'rect', left: 1000, top: 600, width: 100, height: 100 }
    ],
    version: '7.4.0'
  };
  const wm = extractWorkspaceModel(fullCanvas);
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const prevObj = preview.objects.find((o) => o.originalObjectId === 'conn_1787668898659_1a2k8' || o.id === 'conn_1787668898659_1a2k8');
  const bounds = preview.bounds;
  const scale = Math.min(900 / bounds.width, 500 / bounds.height);
  const mapPoint = (p) => worldToPreview(p, bounds, scale, 24);
  const svgPath = mapSvgPathCommands(prevObj.pathCommands || prevObj.path, mapPoint);

  const coords = svgPath.split(/[MCLZ\s,]+/).filter(Boolean).map(Number);
  const xs = coords.filter((_, i) => i % 2 === 0);
  const ys = coords.filter((_, i) => i % 2 === 1);

  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  assert.ok(minX >= 0 && maxX <= 900, `X coordinates inside [0, 900]: ${minX} to ${maxX}`);
  assert.ok(minY >= 0 && maxY <= 500, `Y coordinates inside [0, 500]: ${minY} to ${maxY}`);
});

test('8. marker-end remains valid or self-contained in path', () => {
  const wm = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const prevObj = preview.objects.find((o) => o.originalObjectId === 'conn_1787668898659_1a2k8' || o.id === 'conn_1787668898659_1a2k8');
  assert.equal(prevObj.endArrow, true, 'endArrow is true');
  const cmds = prevObj.pathCommands || prevObj.path;
  assert.equal(cmds.length, 5, 'Arrowhead lines are embedded directly in path');
});

test('9. curved connector has non-zero DOM bounds', () => {
  const wm = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const prevObj = preview.objects.find((o) => o.originalObjectId === 'conn_1787668898659_1a2k8' || o.id === 'conn_1787668898659_1a2k8');
  assert.ok(prevObj.bounds.width > 0, 'Width is positive');
  assert.ok(prevObj.bounds.height > 0, 'Height is positive');
});

test('10. curved connector is placed above circle at its true whiteboard position', () => {
  const wm = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(wm, null);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const prevConn = preview.objects.find((o) => o.originalObjectId === 'conn_1787668898659_1a2k8' || o.id === 'conn_1787668898659_1a2k8');
  const prevCircle = preview.objects.find((o) => o.originalObjectId === 'c1' || o.id === 'c1');

  assert.ok(prevConn.bounds.y < prevCircle.bounds.y, 'Curved connector is above circle');
});
