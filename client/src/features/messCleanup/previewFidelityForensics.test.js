import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObject } from './normalizeObjects.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildPreviewRenderModel, worldToPreview } from './previewModel.js';
import { createLayoutProposal } from './layoutEngine.js';

const makeLinkedShape = (elementId, shapeType = 'rect', textContent = 'Label', x = 100, y = 100, w = 140, h = 90) => {
  const shapeId = `shape_${elementId}`;
  const textId = `text_${elementId}`;

  const shapeObj = {
    id: shapeId,
    elementId,
    type: 'shape',
    shapeType,
    position: { x, y },
    size: { width: w, height: h },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 1,
    relationshipMetadata: { attachedTextId: textId, parentShapeId: null },
    metadata: { role: 'shape' }
  };

  const textObj = {
    id: textId,
    elementId,
    type: 'text',
    text: textContent,
    position: { x, y },
    size: { width: 100, height: 24 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 2,
    relationshipMetadata: { attachedTextId: null, parentShapeId: shapeId },
    metadata: { role: 'text' }
  };

  return { shapeObj, textObj };
};

const makeStickyNote = (elementId, textContent = 'Sticky Content', x = 300, y = 300, size = 180) => {
  const shapeId = `shape_${elementId}`;
  const textId = `text_${elementId}`;

  const shapeObj = {
    id: shapeId,
    elementId,
    type: 'rect',
    isStickyNote: true,
    noteColor: '#fff3a0',
    position: { x, y },
    size: { width: size, height: size },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 1,
    relationshipMetadata: { attachedTextId: textId, parentShapeId: null },
    metadata: { role: 'sticky-note', isStickyNote: true }
  };

  const textObj = {
    id: textId,
    elementId,
    type: 'text',
    text: textContent,
    position: { x: x + 10, y: y + 10 },
    size: { width: size - 20, height: size - 20 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 2,
    relationshipMetadata: { attachedTextId: null, parentShapeId: shapeId },
    metadata: { role: 'text' }
  };

  return { shapeObj, textObj };
};

const buildGoldenBoard = () => {
  const process = makeLinkedShape('elem_process', 'hexagon', 'Process', 300, 200);
  const circle = makeLinkedShape('elem_circle', 'circle', 'Circle', 600, 200);
  const triangle = makeLinkedShape('elem_triangle', 'triangle', 'Triangle', 300, 500);
  const decision = makeLinkedShape('elem_decision', 'diamond', 'Decision', 600, 500);
  const blueSticky = makeStickyNote('elem_blue_sticky', 'New Sticky Note', 300, 350);
  const importantNote = makeStickyNote('elem_important_note', 'Important: Verify database schema before deployment.', 500, 200);

  const blackTestingPhase = {
    id: 'shape_testing_phase',
    elementId: 'elem_tp',
    type: 'rect',
    shapeType: 'rounded_rect',
    left: 700, top: 350, width: 140, height: 80, fill: '#000000',
    relationshipMetadata: { attachedTextId: 'text_tp' }
  };
  const blackTestingPhaseText = {
    id: 'text_tp',
    elementId: 'elem_tp',
    type: 'text',
    text: 'This is a testing phase.',
    left: 710, top: 375, width: 120, height: 30, fill: '#ffffff',
    relationshipMetadata: { parentShapeId: 'shape_testing_phase' }
  };

  const blackTestOver = {
    id: 'shape_test_over',
    elementId: 'elem_to',
    type: 'rect',
    shapeType: 'rounded_rect',
    left: 880, top: 350, width: 120, height: 60, fill: '#000000',
    relationshipMetadata: { attachedTextId: 'text_to' }
  };
  const blackTestOverText = {
    id: 'text_to',
    elementId: 'elem_to',
    type: 'text',
    text: 'Test will be over',
    left: 890, top: 365, width: 100, height: 30, fill: '#ffffff',
    relationshipMetadata: { parentShapeId: 'shape_test_over' }
  };

  const helloWorldText = {
    id: 'text_hello_world',
    type: 'text',
    text: 'Hello World!',
    left: 450, top: 520, width: 100, height: 24, rotation: 0
  };

  const verticalDivider = {
    id: 'line_divider',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true,
    left: 950, top: 200, width: 2, height: 400
  };

  const straightConn = {
    id: 'conn_process_important',
    type: 'path',
    isConnector: true,
    connectorType: 'straight',
    sourceShapeId: process.shapeObj.id,
    targetShapeId: importantNote.shapeObj.id,
    endArrow: true,
    left: 420, top: 230, width: 80, height: 10
  };

  const curvedConn = {
    id: 'conn_curved',
    type: 'path',
    isConnector: true,
    connectorType: 'curved',
    endArrow: true,
    left: 800, top: 150, width: 120, height: 60,
    path: [['M', 0, 0], ['C', 40, -40, 80, -40, 120, 0]]
  };

  const elbowConn = {
    id: 'conn_elbow',
    type: 'path',
    isConnector: true,
    connectorType: 'elbow',
    sourceShapeId: blueSticky.shapeObj.id,
    endArrow: true,
    left: 420, top: 370, width: 100, height: 40,
    path: [['M', 0, 0], ['L', 50, 0], ['L', 50, 40], ['L', 100, 40]]
  };

  const helloStrokes = [
    { id: 'stroke_H', type: 'stroke', isVectorStroke: true, left: 300, top: 450, width: 20, height: 40 },
    { id: 'stroke_e', type: 'stroke', isVectorStroke: true, left: 325, top: 460, width: 15, height: 30 },
    { id: 'stroke_l1', type: 'stroke', isVectorStroke: true, left: 345, top: 450, width: 10, height: 40 },
    { id: 'stroke_l2', type: 'stroke', isVectorStroke: true, left: 360, top: 450, width: 10, height: 40 },
    { id: 'stroke_o', type: 'stroke', isVectorStroke: true, left: 375, top: 460, width: 20, height: 30 }
  ];

  const fourDots = [
    { id: 'dot_1', type: 'stroke', isVectorStroke: true, left: 200, top: 80, width: 6, height: 6 },
    { id: 'dot_2', type: 'stroke', isVectorStroke: true, left: 240, top: 80, width: 6, height: 6 },
    { id: 'dot_3', type: 'stroke', isVectorStroke: true, left: 280, top: 80, width: 6, height: 6 },
    { id: 'dot_4', type: 'stroke', isVectorStroke: true, left: 320, top: 80, width: 6, height: 6 }
  ];

  return [
    process.shapeObj, process.textObj,
    circle.shapeObj, circle.textObj,
    triangle.shapeObj, triangle.textObj,
    decision.shapeObj, decision.textObj,
    blueSticky.shapeObj, blueSticky.textObj,
    importantNote.shapeObj, importantNote.textObj,
    blackTestingPhase, blackTestingPhaseText,
    blackTestOver, blackTestOverText,
    helloWorldText, verticalDivider,
    straightConn, curvedConn, elbowConn,
    ...helloStrokes,
    ...fourDots
  ];
};

test('1. Forensics: Trace objects from World to DOM Screen Space', () => {
  const rawObjects = buildGoldenBoard();
  const model = { board: { objects: rawObjects.map(normalizeObject) } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);

  const renderBounds = renderModel.bounds;
  const previewWidth = 900;
  const previewHeight = 500;
  const padding = 24;
  const scale = Math.min(
    (previewWidth - padding * 2) / Math.max(renderBounds.width, 1),
    (previewHeight - padding * 2) / Math.max(renderBounds.height, 1),
    1
  );

  assert.ok(scale > 0.4 && scale < 1.0, `Scale ${scale} is in optimal readable range`);

  renderModel.objects.forEach((obj) => {
    const left = obj.anchor === 'center' ? obj.position.x - obj.size.width / 2 : obj.position.x;
    const top = obj.anchor === 'center' ? obj.position.y - obj.size.height / 2 : obj.position.y;
    const p = worldToPreview({ x: left, y: top }, renderBounds, scale, padding);

    assert.ok(p.x >= 0 && p.x <= previewWidth, `Object ${obj.originalObjectId} X (${p.x}) is within container`);
    assert.ok(p.y >= 0 && p.y <= previewHeight, `Object ${obj.originalObjectId} Y (${p.y}) is within container`);
  });
});

test('2. Canvas bounds correctly handles negative world coordinates without 0 clamping', () => {
  const obj1 = { id: 'obj1', type: 'rect', left: -500, top: -300, width: 200, height: 100 };
  const obj2 = { id: 'obj2', type: 'rect', left: -200, top: -100, width: 100, height: 80 };

  const model = { board: { objects: [normalizeObject(obj1), normalizeObject(obj2)] } };
  const proposal = createLayoutProposal(null, model);

  assert.equal(proposal.canvasBounds.x, -540);
  assert.equal(proposal.canvasBounds.y, -340);
  assert.equal(proposal.canvasBounds.width, 480);
  assert.equal(proposal.canvasBounds.height, 360);
});

test('3. Sub-pixel stray artifacts (0.1px dots) do not inflate canvas bounds', () => {
  const mainShape = { id: 'main', type: 'rect', left: 100, top: 100, width: 200, height: 100 };
  const strayDot = { id: 'stray', type: 'path', left: 5000, top: 3000, width: 0.1, height: 0.1 };

  const model = { board: { objects: [normalizeObject(mainShape), normalizeObject(strayDot)] } };
  const proposal = createLayoutProposal(null, model);

  assert.equal(proposal.canvasBounds.x, 60);
  assert.equal(proposal.canvasBounds.y, 60);
  assert.equal(proposal.canvasBounds.width, 280);
  assert.equal(proposal.canvasBounds.height, 180);
});

test('4. Case-insensitive Fabric type normalization (Textbox, Polygon, Rect, Path)', () => {
  const t = normalizeObject({ id: 't1', type: 'Textbox', text: 'Hello', left: 100, top: 100, width: 100, height: 30 });
  const p = normalizeObject({ id: 'p1', type: 'Polygon', points: [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}], left: 200, top: 100, width: 100, height: 100 });
  const r = normalizeObject({ id: 'r1', type: 'Rect', left: 300, top: 100, width: 100, height: 100 });

  assert.equal(t.type, 'text');
  assert.equal(p.type, 'shape');
  assert.equal(r.type, 'shape');
});

test('5. Identity warning preservation for un-ID-d objects', () => {
  const o1 = normalizeObject({ type: 'rect', left: 100, top: 100, width: 100, height: 100 }, 0);
  assert.equal(o1.id, undefined);
  assert.equal(o1.identityWarning, 'missing-id');
});

test('6. All Golden Board shapes, labels, connectors, strokes, and divider render with non-zero bounds', () => {
  const rawObjects = buildGoldenBoard();
  const model = { board: { objects: rawObjects.map(normalizeObject) } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);

  const scale = 0.75;
  const padding = 24;
  const bounds = renderModel.bounds;

  let visibleCount = 0;
  renderModel.objects.forEach((obj) => {
    const left = obj.anchor === 'center' ? obj.position.x - obj.size.width / 2 : obj.position.x;
    const top = obj.anchor === 'center' ? obj.position.y - obj.size.height / 2 : obj.position.y;
    const p = worldToPreview({ x: left, y: top }, bounds, scale, padding);
    const w = obj.size.width * scale;
    const h = obj.size.height * scale;

    if (p.x >= 0 && p.y >= 0 && w > 0 && h > 0) {
      visibleCount++;
    }
  });

  assert.equal(visibleCount, rawObjects.length, 'All 30 golden board objects are visible in preview');
});
