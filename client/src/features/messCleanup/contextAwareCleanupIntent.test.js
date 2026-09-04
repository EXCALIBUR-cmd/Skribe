import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HIGH_CONFIDENCE,
  MEDIUM_CONFIDENCE,
  LOW_CONFIDENCE,
  validateCleanupPlan,
  assertValidCleanupPlan
} from './cleanupPlanTypes.js';
import { buildCleanupPlan, ACTION_PRIORITY } from './buildCleanupPlan.js';
import { normalizeObject } from './normalizeObjects.js';

test('1. Explicit graph produces cleanFlowchart', () => {
  const shapeA = normalizeObject({ id: 'shape_A', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const shapeB = normalizeObject({ id: 'shape_B', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({
    id: 'conn_AB',
    type: 'path',
    isConnector: true,
    connectorType: 'straight',
    sourceShapeId: 'shape_A',
    targetShapeId: 'shape_B',
    left: 200, top: 140, width: 100, height: 10,
    endArrow: true
  });

  const model = { board: { objects: [shapeA, shapeB, conn] } };
  const plan = buildCleanupPlan(null, model);

  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flowAction, 'cleanFlowchart action must be generated');
  assert.deepEqual(flowAction.objectIds.sort(), ['shape_A', 'shape_B']);
  assert.deepEqual(flowAction.connectorIds, ['conn_AB']);
  assert.ok(flowAction.confidence >= HIGH_CONFIDENCE);
  assert.ok(flowAction.evidence.includes('explicit-connector-topology'));
});

test('2. Single ambiguous relationship does not produce cleanFlowchart', () => {
  const shapeA = normalizeObject({ id: 'shape_A', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const shapeB = normalizeObject({ id: 'shape_B', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const connAmbiguous = normalizeObject({
    id: 'conn_unconnected',
    type: 'path',
    isConnector: true,
    connectorType: 'curved',
    left: 200, top: 140, width: 100, height: 40
  });

  const model = { board: { objects: [shapeA, shapeB, connAmbiguous] } };
  const plan = buildCleanupPlan(null, model);

  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.equal(flowAction, undefined, 'Ambiguous connector must not trigger cleanFlowchart');
  assert.ok(plan.untouchedObjectIds.includes('conn_unconnected'));
});

test('3. Shape -> sticky note relationship is an annotation/callout and not a flowchart', () => {
  const shapeA = normalizeObject({ id: 'shape_A', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const noteB = normalizeObject({ id: 'note_B', type: 'note', isStickyNote: true, left: 300, top: 100, width: 140, height: 140 });
  const connAnnotation = normalizeObject({
    id: 'conn_annotation',
    type: 'path',
    isConnector: true,
    connectorType: 'elbow',
    sourceShapeId: 'shape_A',
    targetShapeId: 'note_B',
    left: 200, top: 140, width: 100, height: 10
  });

  const model = { board: { objects: [shapeA, noteB, connAnnotation] } };
  const plan = buildCleanupPlan(null, model);

  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.equal(flowAction, undefined, 'Shape-to-note annotation relationship must not be forced into a flowchart action');
  assert.ok(plan.untouchedObjectIds.includes('conn_annotation'));
});

test('4. Multi-node chain produces high confidence (>= 0.98)', () => {
  const shapeA = normalizeObject({ id: 'shape_A', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const shapeB = normalizeObject({ id: 'shape_B', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const shapeC = normalizeObject({ id: 'shape_C', type: 'rect', left: 500, top: 100, width: 100, height: 80 });
  const conn1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 'shape_A', targetShapeId: 'shape_B', left: 200, top: 140, width: 100, height: 10 });
  const conn2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: 'shape_B', targetShapeId: 'shape_C', left: 400, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [shapeA, shapeB, shapeC, conn1, conn2] } };
  const plan = buildCleanupPlan(null, model);

  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flowAction);
  assert.equal(flowAction.confidence, 0.98);
  assert.deepEqual(flowAction.objectIds.sort(), ['shape_A', 'shape_B', 'shape_C']);
  assert.deepEqual(flowAction.connectorIds.sort(), ['c1', 'c2']);
});

test('5. Branching DAG produces high confidence', () => {
  const root = normalizeObject({ id: 'root', type: 'rect', left: 100, top: 200, width: 100, height: 80 });
  const b1 = normalizeObject({ id: 'b1', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const b2 = normalizeObject({ id: 'b2', type: 'rect', left: 300, top: 300, width: 100, height: 80 });
  const conn1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 'root', targetShapeId: 'b1', left: 200, top: 150, width: 100, height: 50 });
  const conn2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: 'root', targetShapeId: 'b2', left: 200, top: 250, width: 100, height: 50 });

  const model = { board: { objects: [root, b1, b2, conn1, conn2] } };
  const plan = buildCleanupPlan(null, model);

  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flowAction);
  assert.equal(flowAction.confidence, 0.98);
  assert.deepEqual(flowAction.objectIds.sort(), ['b1', 'b2', 'root']);
});

test('6. Unknown connector is preserved', () => {
  const unknownConn = normalizeObject({ id: 'conn_orphan', type: 'path', isConnector: true, left: 500, top: 500, width: 80, height: 80 });
  const model = { board: { objects: [unknownConn] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.untouchedObjectIds.includes('conn_orphan'));
  assert.equal(plan.actions.length, 0);
});

test('7. Explicit connector metadata increases confidence', () => {
  const shapeA = normalizeObject({ id: 'shape_A', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const shapeB = normalizeObject({ id: 'shape_B', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({
    id: 'conn_explicit',
    type: 'path',
    isConnector: true,
    sourceShapeId: 'shape_A',
    targetShapeId: 'shape_B',
    left: 200, top: 140, width: 100, height: 10
  });

  const model = { board: { objects: [shapeA, shapeB, conn] } };
  const plan = buildCleanupPlan(null, model);

  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flowAction);
  assert.ok(flowAction.confidence >= 0.96);
});

test('8. Semantic graph context increases confidence', () => {
  const shapeA = normalizeObject({ id: 'shape_A', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const shapeB = normalizeObject({ id: 'shape_B', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'conn_1', type: 'path', isConnector: true, sourceShapeId: 'shape_A', targetShapeId: 'shape_B', left: 200, top: 140, width: 100, height: 10 });
  const scene = {
    groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['shape_A', 'shape_B', 'conn_1'] }]
  };

  const model = { board: { objects: [shapeA, shapeB, conn] } };
  const plan = buildCleanupPlan(scene, model);

  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flowAction);
  assert.ok(flowAction.confidence >= 0.96);
});

test('9. Isolated note does not arrangeGrid', () => {
  const note = normalizeObject({ id: 'note_solo', type: 'note', isStickyNote: true, left: 200, top: 200, width: 160, height: 160 });
  const model = { board: { objects: [note] } };
  const plan = buildCleanupPlan(null, model);

  assert.equal(plan.actions.find((a) => a.type === 'arrangeGrid'), undefined);
  assert.ok(plan.untouchedObjectIds.includes('note_solo'));
});

test('10. Semantically grouped notes can arrangeGrid', () => {
  const note1 = normalizeObject({ id: 'n1', type: 'note', isStickyNote: true, left: 100, top: 100, width: 150, height: 150 });
  const note2 = normalizeObject({ id: 'n2', type: 'note', isStickyNote: true, left: 280, top: 100, width: 150, height: 150 });
  const scene = {
    groups: [{ id: 'group_brainstorm', type: 'notes', objectIds: ['n1', 'n2'], purpose: 'Brainstorm cluster' }]
  };

  const model = { board: { objects: [note1, note2] } };
  const plan = buildCleanupPlan(scene, model);

  const gridAction = plan.actions.find((a) => a.type === 'arrangeGrid');
  assert.ok(gridAction);
  assert.deepEqual(gridAction.objectIds, ['n1', 'n2']);
});

test('11. Unrelated notes remain untouched', () => {
  const note1 = normalizeObject({ id: 'n1', type: 'note', isStickyNote: true, left: 50, top: 50, width: 150, height: 150 });
  const note2 = normalizeObject({ id: 'n2', type: 'note', isStickyNote: true, left: 1200, top: 900, width: 150, height: 150 });

  const model = { board: { objects: [note1, note2] } };
  const plan = buildCleanupPlan(null, model);

  assert.equal(plan.actions.find((a) => a.type === 'arrangeGrid'), undefined);
  assert.ok(plan.untouchedObjectIds.includes('n1'));
  assert.ok(plan.untouchedObjectIds.includes('n2'));
});

test('12. Semantic shape group can align', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 105, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'g_concept', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);

  const alignAction = plan.actions.find((a) => a.type === 'align');
  assert.ok(alignAction);
  assert.equal(alignAction.axis, 'centerY');
});

test('13. Nearby unrelated shapes do not align without semantic grouping', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 400, width: 100, height: 80 });

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(null, model);

  assert.equal(plan.actions.find((a) => a.type === 'align'), undefined);
});

test('14. Explicit text attachment remains 0.99+ confidence', () => {
  const s = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t = normalizeObject({ id: 't1', type: 'text', text: 'Label', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });

  const model = { board: { objects: [s, t] } };
  const plan = buildCleanupPlan(null, model);

  const attachAction = plan.actions.find((a) => a.type === 'attachText');
  assert.ok(attachAction);
  assert.equal(attachAction.confidence, 0.99);
  assert.ok(attachAction.evidence.includes('explicit-metadata'));
});

test('15. Standalone text normalization', () => {
  const t = normalizeObject({ id: 't_tilted', type: 'text', text: 'Tilted Text', left: 400, top: 400, width: 100, height: 24, rotation: 20 });
  const model = { board: { objects: [t] } };
  const plan = buildCleanupPlan(null, model);

  const normAction = plan.actions.find((a) => a.type === 'normalizeText');
  assert.ok(normAction);
  assert.equal(normAction.confidence, 0.90);
});

test('16. Attached text is not normalized separately as standalone text', () => {
  const s = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t = normalizeObject({ id: 't1', type: 'text', text: 'Attached Label', left: 120, top: 130, width: 60, height: 20, rotation: 15, relationshipMetadata: { parentShapeId: 's1' } });

  const model = { board: { objects: [s, t] } };
  const plan = buildCleanupPlan(null, model);

  assert.equal(plan.actions.find((a) => a.type === 'normalizeText'), undefined);
  assert.ok(plan.actions.some((a) => a.type === 'attachText'));
});

test('17. Freehand remains preserve', () => {
  const st1 = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 100, top: 100, width: 20, height: 20 });
  const st2 = normalizeObject({ id: 'st2', type: 'stroke', isVectorStroke: true, left: 130, top: 100, width: 20, height: 20 });

  const model = { board: { objects: [st1, st2] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.untouchedObjectIds.includes('st1'));
  assert.ok(plan.untouchedObjectIds.includes('st2'));
  assert.equal(plan.actions.length, 0);
});

test('18. Action priority is deterministic (attachText -> cleanFlowchart -> align -> arrangeGrid -> normalizeText)', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'L1', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = normalizeObject({ id: 't2', type: 'text', text: 'L2', left: 320, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's2' } });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });
  const tFree = normalizeObject({ id: 't_free', type: 'text', text: 'Free', left: 500, top: 500, width: 60, height: 20, rotation: 10 });

  const model = { board: { objects: [s1, t1, s2, t2, conn, tFree] } };
  const plan = buildCleanupPlan(null, model);

  const types = plan.actions.map((a) => a.type);
  const attachIdx = types.indexOf('attachText');
  const flowIdx = types.indexOf('cleanFlowchart');
  const normIdx = types.indexOf('normalizeText');

  assert.ok(attachIdx !== -1 && flowIdx !== -1 && normIdx !== -1);
  assert.ok(attachIdx < flowIdx, 'attachText comes before cleanFlowchart');
  assert.ok(flowIdx < normIdx, 'cleanFlowchart comes before normalizeText');
});

test('19. Human-readable reasons are generated explaining what, why trust, why useful', () => {
  const s = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t = normalizeObject({ id: 't1', type: 'text', text: 'Label', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });

  const model = { board: { objects: [s, t] } };
  const plan = buildCleanupPlan(null, model);

  const act = plan.actions[0];
  assert.ok(act.reason.length > 20, 'Reason must be detailed and human readable');
  assert.ok(act.reason.includes('explicitly bound') || act.reason.includes('centering'));
});

test('20. Real-board plan matches expected conservative intent', () => {
  const sProc = normalizeObject({ id: 'shape_proc', type: 'path', shapeType: 'hexagon', left: 300, top: 200, width: 120, height: 80, relationshipMetadata: { attachedTextId: 'text_proc' } });
  const tProc = normalizeObject({ id: 'text_proc', type: 'text', text: 'Process', left: 320, top: 228, width: 100, height: 24, relationshipMetadata: { parentShapeId: 'shape_proc' } });
  const sDec = normalizeObject({ id: 'shape_dec', type: 'path', shapeType: 'diamond', left: 550, top: 200, width: 100, height: 90, relationshipMetadata: { attachedTextId: 'text_dec' } });
  const tDec = normalizeObject({ id: 'text_dec', type: 'text', text: 'Decision', left: 560, top: 233, width: 80, height: 24, relationshipMetadata: { parentShapeId: 'shape_dec' } });
  const conn = normalizeObject({ id: 'conn_1', type: 'path', isConnector: true, connectorType: 'straight', sourceShapeId: 'shape_proc', targetShapeId: 'shape_dec', left: 420, top: 240, width: 130, height: 10, endArrow: true });
  const note1 = normalizeObject({ id: 'note_1', type: 'note', isStickyNote: true, left: 300, top: 350, width: 160, height: 160 });
  const stroke1 = normalizeObject({ id: 'stroke_1', type: 'stroke', isVectorStroke: true, left: 300, top: 450, width: 20, height: 40 });

  const model = { board: { objects: [sProc, tProc, sDec, tDec, conn, note1, stroke1] } };
  const plan = buildCleanupPlan(null, model);

  assert.equal(plan.actions.filter((a) => a.type === 'attachText').length, 2);
  assert.equal(plan.actions.filter((a) => a.type === 'cleanFlowchart').length, 1);
  assert.ok(plan.untouchedObjectIds.includes('note_1'));
  assert.ok(plan.untouchedObjectIds.includes('stroke_1'));
});
