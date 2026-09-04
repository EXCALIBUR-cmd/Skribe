import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildPreviewRenderModel } from './previewModel.js';

const createMockCanvas = (objects) => ({
  getObjects: () => objects,
  version: '5.3.0'
});

test('1. Source bounds vs proposal bounds conservation for non-resized objects', () => {
  const objects = [
    { id: 'shape_rect', type: 'rect', left: 100, top: 100, width: 160, height: 140 },
    { id: 'shape_circle', type: 'circle', left: 300, top: 100, width: 120, height: 120 },
    { id: 'shape_triangle', type: 'triangle', left: 500, top: 100, width: 140, height: 120 },
    { id: 'shape_callout', type: 'path', isCalloutNote: true, left: 700, top: 100, width: 180, height: 115 }
  ];
  const wm = extractWorkspaceModel(createMockCanvas(objects));
  const plan = buildCleanupPlan(null, wm);
  const proposal = executeCleanupPlan(plan, wm);

  wm.board.objects.forEach((src) => {
    const pl = proposal.placements.find((p) => p.objectId === src.id);
    assert.ok(pl, `Placement exists for ${src.id}`);
    assert.equal(Math.round(pl.bounds.width), Math.round(src.bounds.width), `Width conserved for ${src.id}`);
    assert.equal(Math.round(pl.bounds.height), Math.round(src.bounds.height), `Height conserved for ${src.id}`);
  });
});

test('2. Important callout retains shapeType callout and speech bubble tail', () => {
  const calloutObj = {
    id: 'shape_callout_1',
    elementId: 'call_1',
    type: 'path',
    isCalloutNote: true,
    left: 200,
    top: 300,
    width: 180,
    height: 115,
    path: [
      ['M', 10, 0],
      ['L', 170, 0],
      ['L', 180, 80],
      ['L', 50, 90],
      ['L', 25, 115],
      ['L', 35, 90],
      ['Z']
    ]
  };
  const wm = extractWorkspaceModel(createMockCanvas([calloutObj]));
  const plan = buildCleanupPlan(null, wm);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const prev = preview.objects.find((o) => o.originalObjectId === 'shape_callout_1');
  assert.ok(prev);
  assert.equal(prev.shapeType, 'callout');
  assert.equal(prev.isCalloutNote, true);
  assert.equal(prev.bounds.width, 180);
  assert.equal(prev.bounds.height, 115);
  const tailVertex = prev.path.find((cmd) => cmd[0] === 'L' && cmd[1] === 25 && cmd[2] === 115);
  assert.ok(tailVertex, 'Speech bubble tail vertex is preserved');
});

test('3. Preview scale calculation: screenSize === worldSize * scale', () => {
  const objects = [
    { id: 's1', type: 'rect', left: 0, top: 0, width: 200, height: 100 },
    { id: 's2', type: 'rect', left: 1000, top: 500, width: 200, height: 100 }
  ];
  const wm = extractWorkspaceModel(createMockCanvas(objects));
  const plan = buildCleanupPlan(null, wm);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const bounds = preview.bounds;
  const expectedScale = Math.min(900 / bounds.width, 500 / bounds.height);

  const obj = preview.objects.find((o) => o.originalObjectId === 's1');
  const screenW = obj.size.width * expectedScale;
  const screenH = obj.size.height * expectedScale;

  assert.equal(Math.round(screenW), Math.round(200 * expectedScale));
  assert.equal(Math.round(screenH), Math.round(100 * expectedScale));
});

test('4. Text label fidelity: content, font, color, weight preserved', () => {
  const textObj = {
    id: 'text_1',
    type: 'textbox',
    text: 'Process Flow',
    fontFamily: 'Quicksand',
    fontSize: 18,
    fontWeight: 'bold',
    fill: '#6b21a8',
    textAlign: 'center',
    left: 100,
    top: 100,
    width: 140,
    height: 30
  };
  const wm = extractWorkspaceModel(createMockCanvas([textObj]));
  const plan = buildCleanupPlan(null, wm);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const prev = preview.objects.find((o) => o.originalObjectId === 'text_1');
  assert.equal(prev.text, 'Process Flow');
  assert.equal(prev.style.fontFamily, 'Quicksand');
  assert.equal(prev.style.fontSize, 18);
  assert.equal(prev.style.fontWeight, 'bold');
  assert.equal(prev.style.color, '#6b21a8');
  assert.equal(prev.style.textAlign, 'center');
});

test('5. Vertical divider geometry strictly conserved', () => {
  const lineObj = {
    id: 'line_divider',
    elementId: 'div_1',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true,
    left: 500,
    top: 100,
    width: 2,
    height: 400,
    path: [['M', 500, 100], ['L', 500, 500]]
  };
  const wm = extractWorkspaceModel(createMockCanvas([lineObj]));
  const plan = buildCleanupPlan(null, wm);
  const proposal = executeCleanupPlan(plan, wm);

  const pl = proposal.placements.find((p) => p.objectId === 'line_divider');
  assert.ok(pl);
  assert.equal(pl.bounds.width, 2);
  assert.equal(pl.bounds.height, 400);
});

test('6. Freehand stroke paths remain atomic and conserved', () => {
  const strokeObj = {
    id: 'stroke_1',
    strokeId: 'stroke_1',
    type: 'path',
    left: 50,
    top: 50,
    width: 30,
    height: 40,
    path: [
      ['M', 50, 50],
      ['Q', 60, 70, 80, 90]
    ]
  };
  const wm = extractWorkspaceModel(createMockCanvas([strokeObj]));
  const plan = buildCleanupPlan(null, wm);
  const proposal = executeCleanupPlan(plan, wm);

  const pl = proposal.placements.find((p) => p.objectId === 'stroke_1');
  assert.ok(pl);
  assert.equal(pl.bounds.width, 30);
  assert.equal(pl.bounds.height, 40);
  assert.deepEqual(pl.path, strokeObj.path);
});

test('7. Connector types straight, elbow, and curved remain unchanged', () => {
  const conns = [
    { id: 'c_str', type: 'path', isConnector: true, connectorType: 'straight', path: [['M', 0, 0], ['L', 100, 0]] },
    { id: 'c_elb', type: 'path', isConnector: true, connectorType: 'elbow', path: [['M', 0, 0], ['L', 50, 0], ['L', 50, 50], ['L', 100, 50]] },
    { id: 'c_cur', type: 'path', isConnector: true, connectorType: 'curved', path: [['M', 0, 0], ['C', 30, 20, 70, 20, 100, 0]] }
  ];
  const wm = extractWorkspaceModel(createMockCanvas(conns));
  const plan = buildCleanupPlan(null, wm);
  const proposal = executeCleanupPlan(plan, wm);
  const preview = buildPreviewRenderModel(wm, proposal);

  const str = preview.objects.find((o) => o.originalObjectId === 'c_str');
  const elb = preview.objects.find((o) => o.originalObjectId === 'c_elb');
  const cur = preview.objects.find((o) => o.originalObjectId === 'c_cur');

  assert.equal(str.connectorType, 'straight');
  assert.equal(elb.connectorType, 'elbow');
  assert.equal(cur.connectorType, 'curved');
});
