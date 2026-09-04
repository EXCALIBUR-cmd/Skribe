import { normalizeObject } from '../src/features/messCleanup/normalizeObjects.js';
import { createLayoutProposal } from '../src/features/messCleanup/layoutEngine.js';
import { buildPreviewRenderModel } from '../src/features/messCleanup/previewModel.js';
import { buildCleanupPlan } from '../src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../src/features/messCleanup/executeCleanupPlan.js';

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

const allRawObjects = [
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

const model = { board: { objects: allRawObjects.map(normalizeObject) } };
const cleanupPlan = buildCleanupPlan(null, model);
const proposal = executeCleanupPlan(cleanupPlan, model);
const renderModel = buildPreviewRenderModel(model, proposal);

console.log('=== CANVAS BOUNDS ===');
console.log(proposal.canvasBounds);

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

console.log(`\nScale: ${scale}, ContentWidth: ${contentWidth}, ContentHeight: ${contentHeight}`);

console.log('\n=== FORENSIC COORDINATE TRACE TABLE ===');
console.log('| objectId | type | source (x,y,w,h) | proposal bounds | DOM style (left, top, w, h) |');
console.log('|---|---|---|---|---|');

renderModel.objects.forEach((obj) => {
  const src = model.board.objects.find((o) => o.id === obj.originalObjectId);
  const srcStr = src ? `(${src.bounds.x},${src.bounds.y},${src.bounds.width}x${src.bounds.height})` : 'N/A';
  const propStr = `(${obj.bounds.x},${obj.bounds.y},${obj.bounds.width}x${obj.bounds.height})`;
  
  const left = obj.anchor === 'center' ? obj.position.x - obj.size.width / 2 : obj.position.x;
  const top = obj.anchor === 'center' ? obj.position.y - obj.size.height / 2 : obj.position.y;
  const domLeft = (left - renderBounds.x) * scale + padding;
  const domTop = (top - renderBounds.y) * scale + padding;
  const domW = obj.size.width * scale;
  const domH = obj.size.height * scale;
  const domStr = `(${domLeft.toFixed(1)}px, ${domTop.toFixed(1)}px, ${domW.toFixed(1)}x${domH.toFixed(1)})`;

  console.log(`| ${obj.originalObjectId.padEnd(24)} | ${obj.type.padEnd(10)} | ${srcStr.padEnd(20)} | ${propStr.padEnd(20)} | ${domStr} |`);
});
