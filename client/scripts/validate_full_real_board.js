import assert from 'node:assert/strict';
import { normalizeObject } from '../src/features/messCleanup/normalizeObjects.js';
import { buildCleanupPlan } from '../src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../src/features/messCleanup/executeCleanupPlan.js';
import { createLayoutProposal } from '../src/features/messCleanup/layoutEngine.js';
import { buildPreviewRenderModel } from '../src/features/messCleanup/previewModel.js';
import { auditCleanupPipeline } from '../src/features/messCleanup/auditCleanupPipeline.js';
import { getSemanticType } from '../src/features/messCleanup/cleanupTypes.js';

console.log('================================================================');
console.log('PHASE 4F.13.5 — FULL REAL-BOARD PRODUCTION VALIDATION');
console.log('================================================================\n');

const makeLinkedShape = (elementId, shapeType, textContent, x, y, w = 120, h = 80, fill = '#e2e8f0') => {
  const shapeId = `shape_${elementId}`;
  const textId = `text_${elementId}`;

  const shapeObj = {
    id: shapeId,
    elementId,
    type: shapeType === 'circle' ? 'circle' : (shapeType === 'rect' ? 'rect' : 'path'),
    shapeType,
    position: { x, y },
    size: { width: w, height: h },
    left: x,
    top: y,
    width: w,
    height: h,
    rotation: 0,
    scale: { x: 1, y: 1 },
    fill,
    zIndex: 1,
    relationshipMetadata: { attachedTextId: textId, parentShapeId: null },
    metadata: { role: 'shape' }
  };

  const textObj = {
    id: textId,
    elementId,
    type: 'text',
    text: textContent,
    position: { x: x + 10, y: y + (h - 24) / 2 },
    size: { width: w - 20, height: 24 },
    left: x + 10,
    top: y + (h - 24) / 2,
    width: w - 20,
    height: 24,
    rotation: 0,
    scale: { x: 1, y: 1 },
    fill: '#1e293b',
    zIndex: 2,
    relationshipMetadata: { attachedTextId: null, parentShapeId: shapeId },
    metadata: { role: 'text' }
  };

  return { shapeObj, textObj };
};

const makeStickyNote = (elementId, textContent, x, y, noteColor = '#fef08a') => {
  const shapeId = `shape_${elementId}`;
  const textId = `text_${elementId}`;

  const shapeObj = {
    id: shapeId,
    elementId,
    type: 'note',
    shapeType: 'rect',
    position: { x, y },
    size: { width: 160, height: 160 },
    left: x,
    top: y,
    width: 160,
    height: 160,
    rotation: 0,
    scale: { x: 1, y: 1 },
    fill: noteColor,
    zIndex: 1,
    relationshipMetadata: { attachedTextId: textId, parentShapeId: null },
    metadata: { role: 'shape', isStickyNote: true }
  };

  const textObj = {
    id: textId,
    elementId,
    type: 'text',
    text: textContent,
    position: { x: x + 15, y: y + 20 },
    size: { width: 130, height: 40 },
    left: x + 15,
    top: y + 20,
    width: 130,
    height: 40,
    rotation: 0,
    scale: { x: 1, y: 1 },
    fill: '#854d0e',
    zIndex: 2,
    relationshipMetadata: { attachedTextId: null, parentShapeId: shapeId },
    metadata: { role: 'text' }
  };

  return { shapeObj, textObj };
};

const processHex = makeLinkedShape('proc_hex', 'hexagon', 'Process', 300, 200, 120, 80, '#dbeafe');
const circle = makeLinkedShape('circle', 'circle', 'Circle', 100, 200, 90, 90, '#f1f5f9');
const triangle = makeLinkedShape('triangle', 'triangle', 'Triangle', 700, 200, 100, 90, '#f1f5f9');
const decision = makeLinkedShape('decision', 'diamond', 'Decision', 550, 200, 100, 90, '#fef3c7');
const blueSticky = makeStickyNote('blue_sticky', 'New Sticky Note', 300, 350, '#bae6fd');
const importantNote = makeStickyNote('important_note', 'Important Note', 550, 350, '#fed7aa');

const blackTestingPhase = {
  id: 'shape_testing_phase',
  elementId: 'elem_tp',
  type: 'rect',
  shapeType: 'rounded_rect',
  position: { x: 700, y: 350 },
  size: { width: 140, height: 80 },
  left: 700, top: 350, width: 140, height: 80, fill: '#000000',
  rotation: 0, scale: { x: 1, y: 1 }, zIndex: 1,
  relationshipMetadata: { attachedTextId: 'text_tp', parentShapeId: null }
};
const blackTestingPhaseText = {
  id: 'text_tp',
  elementId: 'elem_tp',
  type: 'text',
  text: 'This is a testing phase.',
  position: { x: 710, y: 375 },
  size: { width: 120, height: 30 },
  left: 710, top: 375, width: 120, height: 30, fill: '#ffffff',
  rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2,
  relationshipMetadata: { attachedTextId: null, parentShapeId: 'shape_testing_phase' }
};

const blackTestOver = {
  id: 'shape_test_over',
  elementId: 'elem_to',
  type: 'rect',
  shapeType: 'rounded_rect',
  position: { x: 880, y: 350 },
  size: { width: 120, height: 60 },
  left: 880, top: 350, width: 120, height: 60, fill: '#000000',
  rotation: 0, scale: { x: 1, y: 1 }, zIndex: 1,
  relationshipMetadata: { attachedTextId: 'text_to', parentShapeId: null }
};
const blackTestOverText = {
  id: 'text_to',
  elementId: 'elem_to',
  type: 'text',
  text: 'Test will be over',
  position: { x: 890, y: 365 },
  size: { width: 100, height: 30 },
  left: 890, top: 365, width: 100, height: 30, fill: '#ffffff',
  rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2,
  relationshipMetadata: { attachedTextId: null, parentShapeId: 'shape_test_over' }
};

const helloWorldText = {
  id: 'text_hello_world',
  elementId: 'elem_hw',
  type: 'text',
  text: 'Hello World!',
  position: { x: 450, y: 520 },
  size: { width: 100, height: 24 },
  left: 450, top: 520, width: 100, height: 24,
  rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2,
  relationshipMetadata: { attachedTextId: null, parentShapeId: null }
};

const verticalDivider = {
  id: 'line_divider',
  elementId: 'elem_line_div',
  type: 'path',
  isSkribeLine: true,
  isStraightLine: true,
  position: { x: 950, y: 140 },
  size: { width: 2, height: 500 },
  left: 950, top: 140, width: 2, height: 500,
  rotation: 0, scale: { x: 1, y: 1 }, zIndex: 1,
  relationshipMetadata: {}
};

const straightConn = {
  id: 'conn_process_important',
  elementId: 'elem_conn_pi',
  type: 'path',
  isConnector: true,
  connectorType: 'straight',
  sourceShapeId: processHex.shapeObj.id,
  targetShapeId: decision.shapeObj.id,
  endArrow: true,
  startArrow: false,
  position: { x: 420, y: 240 },
  size: { width: 130, height: 10 },
  left: 420, top: 240, width: 130, height: 10,
  rotation: 0, scale: { x: 1, y: 1 }, zIndex: 3,
  relationshipMetadata: { sourceShapeId: processHex.shapeObj.id, targetShapeId: decision.shapeObj.id }
};

const curvedConn = {
  id: 'conn_curved',
  elementId: 'elem_conn_curved',
  type: 'path',
  isConnector: true,
  connectorType: 'curved',
  endArrow: true,
  startArrow: false,
  position: { x: 800, y: 150 },
  size: { width: 120, height: 60 },
  left: 800, top: 150, width: 120, height: 60,
  path: [['M', 0, 0], ['C', 40, -40, 80, -40, 120, 0]],
  rotation: 0, scale: { x: 1, y: 1 }, zIndex: 3,
  relationshipMetadata: {}
};

const elbowConn = {
  id: 'conn_elbow',
  elementId: 'elem_conn_elbow',
  type: 'path',
  isConnector: true,
  connectorType: 'elbow',
  sourceShapeId: blueSticky.shapeObj.id,
  targetShapeId: null,
  endArrow: true,
  startArrow: false,
  position: { x: 420, y: 370 },
  size: { width: 100, height: 40 },
  left: 420, top: 370, width: 100, height: 40,
  path: [['M', 0, 0], ['L', 50, 0], ['L', 50, 40], ['L', 100, 40]],
  rotation: 0, scale: { x: 1, y: 1 }, zIndex: 3,
  relationshipMetadata: { sourceShapeId: blueSticky.shapeObj.id }
};

const helloStrokes = [
  { id: 'stroke_H', elementId: 'elem_st_H', type: 'stroke', isVectorStroke: true, left: 300, top: 450, width: 20, height: 40, position: { x: 300, y: 450 }, size: { width: 20, height: 40 }, path: [['M', 0, 0], ['L', 0, 40]], rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2 },
  { id: 'stroke_e', elementId: 'elem_st_e', type: 'stroke', isVectorStroke: true, left: 325, top: 460, width: 15, height: 30, position: { x: 325, y: 460 }, size: { width: 15, height: 30 }, path: [['M', 0, 15], ['C', 5, 0, 15, 0, 15, 15]], rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2 },
  { id: 'stroke_l1', elementId: 'elem_st_l1', type: 'stroke', isVectorStroke: true, left: 345, top: 450, width: 10, height: 40, position: { x: 345, y: 450 }, size: { width: 10, height: 40 }, path: [['M', 0, 0], ['L', 0, 40]], rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2 },
  { id: 'stroke_l2', elementId: 'elem_st_l2', type: 'stroke', isVectorStroke: true, left: 360, top: 450, width: 10, height: 40, position: { x: 360, y: 450 }, size: { width: 10, height: 40 }, path: [['M', 0, 0], ['L', 0, 40]], rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2 },
  { id: 'stroke_o', elementId: 'elem_st_o', type: 'stroke', isVectorStroke: true, left: 375, top: 460, width: 20, height: 30, position: { x: 375, y: 460 }, size: { width: 20, height: 30 }, path: [['M', 10, 0], ['C', 0, 0, 0, 30, 10, 30], ['C', 20, 30, 20, 0, 10, 0]], rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2 }
];

const fourDots = [
  { id: 'dot_1', elementId: 'elem_dot_1', type: 'stroke', isVectorStroke: true, left: 200, top: 80, width: 6, height: 6, position: { x: 200, y: 80 }, size: { width: 6, height: 6 }, path: [['M', 0, 0], ['L', 1, 1]], rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2 },
  { id: 'dot_2', elementId: 'elem_dot_2', type: 'stroke', isVectorStroke: true, left: 240, top: 80, width: 6, height: 6, position: { x: 240, y: 80 }, size: { width: 6, height: 6 }, path: [['M', 0, 0], ['L', 1, 1]], rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2 },
  { id: 'dot_3', elementId: 'elem_dot_3', type: 'stroke', isVectorStroke: true, left: 280, top: 80, width: 6, height: 6, position: { x: 280, y: 80 }, size: { width: 6, height: 6 }, path: [['M', 0, 0], ['L', 1, 1]], rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2 },
  { id: 'dot_4', elementId: 'elem_dot_4', type: 'stroke', isVectorStroke: true, left: 320, top: 80, width: 6, height: 6, position: { x: 320, y: 80 }, size: { width: 6, height: 6 }, path: [['M', 0, 0], ['L', 1, 1]], rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2 }
];

const allRawObjects = [
  processHex.shapeObj, processHex.textObj,
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

const realBoardBeforeCleanup = allRawObjects.map(normalizeObject);
const workspaceModel = { board: { objects: realBoardBeforeCleanup } };

console.log(`STEP 1: Full Source Inventory Captured (${realBoardBeforeCleanup.length} objects)`);
realBoardBeforeCleanup.forEach((obj, idx) => {
  const sem = getSemanticType(obj);
  console.log(`  [${String(idx + 1).padStart(2, '0')}] ${obj.id.padEnd(26)} type: ${obj.type.padEnd(10)} sem: ${sem.padEnd(10)} pos: (${obj.position.x}, ${obj.position.y}) size: ${obj.size.width}x${obj.size.height}`);
});

console.log('\nSTEP 2: Building Conservative Cleanup Plan...');
const cleanupPlan = buildCleanupPlan(null, workspaceModel);

console.log(`  CleanupPlan Version: ${cleanupPlan.version}`);
console.log(`  Target Scene Objects: ${cleanupPlan.targetScene?.objectCount}`);
console.log(`  Actions Generated: ${cleanupPlan.actions.length}`);
cleanupPlan.actions.forEach((act, idx) => {
  console.log(`    Action ${idx + 1}: type='${act.type}' conf=${act.confidence} reason='${act.reason}' objects=[${act.objectIds.join(', ')}]`);
});
console.log(`  Untouched Objects Count: ${cleanupPlan.untouchedObjectIds.length}`);
console.log(`  Untouched Object IDs: [${cleanupPlan.untouchedObjectIds.join(', ')}]`);

console.log('\nSTEP 3: Executing Cleanup Plan...');
const layoutProposal = executeCleanupPlan(cleanupPlan, workspaceModel);
const realBoardAfterExecutor = layoutProposal.placements;

console.log(`  LayoutProposal Valid: ${layoutProposal.valid}`);
console.log(`  Execution Engine: ${layoutProposal.metadata.cleanupExecutionEngine || 'conservative'}`);
console.log(`  Canvas Bounds: (${layoutProposal.canvasBounds.x}, ${layoutProposal.canvasBounds.y}, ${layoutProposal.canvasBounds.width}x${layoutProposal.canvasBounds.height})`);
console.log(`  Total Placements: ${realBoardAfterExecutor.length}`);

console.log('\nSTEP 4: Verifying Hard Untouched Invariant...');
const untouchedViolations = [];
const sourceMap = new Map(realBoardBeforeCleanup.map((o) => [o.id, o]));
const placementMap = new Map(realBoardAfterExecutor.map((p) => [p.objectId, p]));

cleanupPlan.untouchedObjectIds.forEach((id) => {
  const src = sourceMap.get(id);
  const place = placementMap.get(id);
  assert.ok(src && place, `Untouched object ${id} must exist in both source and placements`);

  const srcX = Math.round(src.bounds?.x ?? src.position.x);
  const srcY = Math.round(src.bounds?.y ?? src.position.y);
  const srcW = Math.round(src.bounds?.width ?? src.size.width);
  const srcH = Math.round(src.bounds?.height ?? src.size.height);
  const srcRot = Math.round(src.rotation ?? 0);

  const placeX = Math.round(place.bounds?.x ?? place.position.x);
  const placeY = Math.round(place.bounds?.y ?? place.position.y);
  const placeW = Math.round(place.bounds?.width ?? place.size.width);
  const placeH = Math.round(place.bounds?.height ?? place.size.height);
  const placeRot = Math.round(place.rotation ?? 0);

  if (srcX !== placeX || srcY !== placeY) {
    untouchedViolations.push({ id, error: `Position changed from (${srcX}, ${srcY}) to (${placeX}, ${placeY})` });
  }
  if (srcW !== placeW || srcH !== placeH) {
    untouchedViolations.push({ id, error: `Size changed from ${srcW}x${srcH} to ${placeW}x${placeH}` });
  }
  if (srcRot !== placeRot) {
    untouchedViolations.push({ id, error: `Rotation changed from ${srcRot} to ${placeRot}` });
  }
  if (src.connectorType && src.connectorType !== place.connectorType) {
    untouchedViolations.push({ id, error: `ConnectorType changed from ${src.connectorType} to ${place.connectorType}` });
  }
});

if (untouchedViolations.length === 0) {
  console.log(`  ✓ 100% of ${cleanupPlan.untouchedObjectIds.length} untouched objects satisfied the Hard Untouched Invariant.`);
} else {
  console.error('  ✖ Untouched invariant violations detected:', untouchedViolations);
  process.exit(1);
}

console.log('\nSTEP 5 & 6: Verifying Preview Model & Real Object Conservation...');
const previewRenderModel = buildPreviewRenderModel(workspaceModel, layoutProposal);

assert.equal(previewRenderModel.objects.length, realBoardBeforeCleanup.length, 'Every source object has 1 preview object');

const audit = auditCleanupPipeline(workspaceModel, cleanupPlan, layoutProposal, previewRenderModel);
console.log(`  Total Source Objects:       ${audit.totalSourceObjects}`);
console.log(`  Total Placements:           ${audit.totalPlacements}`);
console.log(`  Total Preview Objects:      ${audit.totalPreviewObjects}`);
console.log(`  Missing Object IDs:         [${audit.missingObjectIds.join(', ')}]`);
console.log(`  Duplicate Object IDs:       [${audit.duplicateObjectIds.join(', ')}]`);
console.log(`  Unexpected Object IDs:      [${audit.unexpectedObjectIds.join(', ')}]`);
console.log(`  Untouched Violations Count: ${audit.untouchedObjectViolations.length}`);
console.log(`  Connector Changes Count:    ${audit.connectorChanges.length}`);
console.log(`  Freehand Changes Count:     ${audit.freehandChanges.length}`);
console.log(`  Preview Clipping Issues:    ${audit.previewClippingIssues.length}`);
console.log(`  Is Fully Conserved:         ${audit.isFullyConserved}`);
console.log(`  Is Untouched Invariant Met: ${audit.isUntouchedInvariantSatisfied}`);
console.log(`  Is Clipping Free:           ${audit.isClippingFree}`);

assert.equal(audit.missingObjectIds.length, 0, 'missingObjectIds must be empty');
assert.equal(audit.duplicateObjectIds.length, 0, 'duplicateObjectIds must be empty');
assert.equal(audit.unexpectedObjectIds.length, 0, 'unexpectedObjectIds must be empty');
assert.equal(audit.untouchedObjectViolations.length, 0, 'untouchedObjectViolations must be empty');
assert.equal(audit.previewClippingIssues.length, 0, 'previewClippingIssues must be empty');

console.log('\nSTEP 7: Verifying Full Connector Inventory...');
const connectors = realBoardBeforeCleanup.filter((o) => getSemanticType(o) === 'connector');
assert.equal(connectors.length, 3, 'Exactly 3 connectors in source inventory');

connectors.forEach((conn) => {
  const p = placementMap.get(conn.id);
  assert.ok(p, `Connector ${conn.id} placed`);
  assert.equal(p.connectorType, conn.connectorType, `Connector ${conn.id} type preserved (${p.connectorType})`);
  assert.equal(p.endArrow, conn.endArrow, `Connector ${conn.id} endArrow preserved`);
  assert.equal(p.relationshipMetadata?.sourceShapeId || null, conn.relationshipMetadata?.sourceShapeId || null, `Connector ${conn.id} source shape preserved`);
  console.log(`  ✓ Connector ${conn.id.padEnd(25)} type: ${p.connectorType.padEnd(10)} src: ${String(p.relationshipMetadata?.sourceShapeId).padEnd(20)} endArrow: ${p.endArrow}`);
});

console.log('\nSTEP 8: Verifying Full Freehand Inventory...');
const strokes = realBoardBeforeCleanup.filter((o) => getSemanticType(o) === 'stroke');
assert.equal(strokes.length, 9, 'All 9 freehand strokes in source inventory');

strokes.forEach((st) => {
  const p = placementMap.get(st.id);
  assert.ok(p, `Stroke ${st.id} placed`);
  assert.equal(p.bounds.x, st.position.x, `Stroke ${st.id} position x strictly preserved`);
  assert.equal(p.bounds.y, st.position.y, `Stroke ${st.id} position y strictly preserved`);
  console.log(`  ✓ Stroke ${st.id.padEnd(15)} bounds: (${p.bounds.x}, ${p.bounds.y}, ${p.bounds.width}x${p.bounds.height})`);
});

console.log('\nSTEP 9: Verifying Shape Geometry...');
const shapes = realBoardBeforeCleanup.filter((o) => getSemanticType(o) === 'shape' || getSemanticType(o) === 'note');
shapes.forEach((s) => {
  const p = placementMap.get(s.id);
  assert.ok(p, `Shape ${s.id} placed`);
  assert.equal(p.size.width, s.size.width, `Shape ${s.id} width preserved`);
  assert.equal(p.size.height, s.size.height, `Shape ${s.id} height preserved`);
  assert.equal(p.shapeType, s.shapeType, `Shape ${s.id} shapeType preserved`);
  console.log(`  ✓ Shape ${s.id.padEnd(25)} type: ${p.shapeType.padEnd(14)} size: ${p.size.width}x${p.size.height}`);
});

console.log('\nSTEP 10: Verifying Preview Canvas Bounds & Clipping...');
const cb = layoutProposal.canvasBounds;
console.log(`  Canvas Bounds: (${cb.x}, ${cb.y}, ${cb.width}x${cb.height})`);
layoutProposal.placements.forEach((p) => {
  const b = p.bounds;
  assert.ok(b.x >= cb.x, `Placement ${p.objectId} inside left`);
  assert.ok(b.y >= cb.y, `Placement ${p.objectId} inside top`);
  assert.ok(b.x + b.width <= cb.x + cb.width, `Placement ${p.objectId} inside right`);
  assert.ok(b.y + b.height <= cb.y + cb.height, `Placement ${p.objectId} inside bottom`);
});
console.log(`  ✓ All ${layoutProposal.placements.length} placements are safely within canvas bounds without clipping.`);

console.log('\n================================================================');
console.log('PHASE 4F.13.5 — FULL REAL-BOARD PRODUCTION VALIDATION: PASSED ✓');
console.log('================================================================');
