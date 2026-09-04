import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObject } from './normalizeObjects.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildPreviewRenderModel } from './previewModel.js';
import { auditCleanupPipeline } from './auditCleanupPipeline.js';

test('1. Composite attachText + align executes atomically', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Label 1', left: 110, top: 110, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = normalizeObject({ id: 't2', type: 'text', text: 'Label 2', left: 310, top: 120, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's2' } });

  const scene = {
    groups: [{ id: 'group_cards', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, t1, s2, t2] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  assert.equal(proposal.valid, true);
  const pS1 = proposal.placements.find((p) => p.objectId === 's1');
  const pT1 = proposal.placements.find((p) => p.objectId === 't1');
  const pS2 = proposal.placements.find((p) => p.objectId === 's2');
  const pT2 = proposal.placements.find((p) => p.objectId === 't2');

  const cy1 = pS1.bounds.y + pS1.bounds.height / 2;
  const cy2 = pS2.bounds.y + pS2.bounds.height / 2;
  assert.ok(Math.abs(cy1 - cy2) < 0.001);

  const expectedT1X = pS1.bounds.x + (pS1.bounds.width - pT1.size.width) / 2;
  const expectedT1Y = pS1.bounds.y + (pS1.bounds.height - pT1.size.height) / 2;
  assert.equal(pT1.position.x, expectedT1X);
  assert.equal(pT1.position.y, expectedT1Y);
});

test('2. Composite attachText + equalizeSpacing executes atomically', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 80, top: 100, width: 200, height: 80, relationshipMetadata: { attachedTextId: 'tc1' } });
  const tc1 = normalizeObject({ id: 'tc1', type: 'text', text: 'Card 1', left: 90, top: 110, width: 100, height: 20, relationshipMetadata: { parentShapeId: 'c1' } });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 80, top: 200, width: 200, height: 80, relationshipMetadata: { attachedTextId: 'tc2' } });
  const tc2 = normalizeObject({ id: 'tc2', type: 'text', text: 'Card 2', left: 90, top: 210, width: 100, height: 20, relationshipMetadata: { parentShapeId: 'c2' } });
  const c3 = normalizeObject({ id: 'c3', type: 'rect', left: 80, top: 340, width: 200, height: 80, relationshipMetadata: { attachedTextId: 'tc3' } });
  const tc3 = normalizeObject({ id: 'tc3', type: 'text', text: 'Card 3', left: 90, top: 350, width: 100, height: 20, relationshipMetadata: { parentShapeId: 'c3' } });

  const scene = {
    groups: [{ id: 'group_spec', type: 'concept', objectIds: ['c1', 'c2', 'c3'] }]
  };

  const model = { board: { objects: [c1, tc1, c2, tc2, c3, tc3] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  assert.equal(proposal.valid, true);
  const pC1 = proposal.placements.find((p) => p.objectId === 'c1');
  const pC2 = proposal.placements.find((p) => p.objectId === 'c2');
  const pC3 = proposal.placements.find((p) => p.objectId === 'c3');

  const gap1 = pC2.bounds.y - (pC1.bounds.y + pC1.bounds.height);
  const gap2 = pC3.bounds.y - (pC2.bounds.y + pC2.bounds.height);
  assert.equal(gap1, gap2);

  const pTC2 = proposal.placements.find((p) => p.objectId === 'tc2');
  assert.equal(pTC2.position.y, pC2.bounds.y + (pC2.bounds.height - pTC2.size.height) / 2);
});

test('3. Composite attachText + arrangeGrid executes atomically', () => {
  const n1 = normalizeObject({ id: 'n1', type: 'note', isStickyNote: true, left: 100, top: 100, width: 150, height: 150, relationshipMetadata: { attachedTextId: 'tn1' } });
  const tn1 = normalizeObject({ id: 'tn1', type: 'text', text: 'Note 1', left: 110, top: 110, width: 100, height: 30, relationshipMetadata: { parentShapeId: 'n1' } });
  const n2 = normalizeObject({ id: 'n2', type: 'note', isStickyNote: true, left: 290, top: 120, width: 150, height: 150, relationshipMetadata: { attachedTextId: 'tn2' } });
  const tn2 = normalizeObject({ id: 'tn2', type: 'text', text: 'Note 2', left: 300, top: 130, width: 100, height: 30, relationshipMetadata: { parentShapeId: 'n2' } });

  const scene = {
    groups: [{ id: 'group_brainstorm', type: 'notes', objectIds: ['n1', 'n2'], purpose: 'Brainstorm' }]
  };

  const model = { board: { objects: [n1, tn1, n2, tn2] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  assert.equal(proposal.valid, true);
  const pN2 = proposal.placements.find((p) => p.objectId === 'n2');
  const pTN2 = proposal.placements.find((p) => p.objectId === 'tn2');

  assert.equal(pTN2.position.x, pN2.bounds.x + (pN2.bounds.width - pTN2.size.width) / 2);
  assert.equal(pTN2.position.y, pN2.bounds.y + (pN2.bounds.height - pTN2.size.height) / 2);
});

test('4. Composite attachText + cleanFlowchart executes atomically', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Start', left: 110, top: 110, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 120, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = normalizeObject({ id: 't2', type: 'text', text: 'End', left: 310, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's2' } });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, t1, s2, t2, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  assert.equal(proposal.valid, true);
  const pS2 = proposal.placements.find((p) => p.objectId === 's2');
  const pT2 = proposal.placements.find((p) => p.objectId === 't2');
  assert.equal(pT2.position.x, pS2.bounds.x + (pS2.bounds.width - pT2.size.width) / 2);
});

test('5. Action ownership prevents duplicate movement on same object', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  const auditS1 = proposal.metadata.movementAudit['s1'];
  assert.equal(auditS1.unexpectedMultiTransform, false);
});

test('6. Graph nodes are not generically aligned twice', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });
  const scene = {
    groups: [
      { id: 'g_flow', type: 'flowchart', objectIds: ['s1', 's2', 'c1'] },
      { id: 'g_align', type: 'concept', objectIds: ['s1', 's2'] }
    ]
  };

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  const auditS1 = proposal.metadata.movementAudit['s1'];
  assert.equal(auditS1.owningActions.length, 1);
  assert.ok(auditS1.owningActions[0].includes('flowchart'));
});

test('7. Note grid is not generically re-spaced', () => {
  const n1 = normalizeObject({ id: 'n1', type: 'note', isStickyNote: true, left: 100, top: 100, width: 150, height: 150 });
  const n2 = normalizeObject({ id: 'n2', type: 'note', isStickyNote: true, left: 280, top: 100, width: 150, height: 150 });
  const n3 = normalizeObject({ id: 'n3', type: 'note', isStickyNote: true, left: 500, top: 100, width: 150, height: 150 });

  const scene = {
    groups: [
      { id: 'group_brainstorm', type: 'notes', objectIds: ['n1', 'n2', 'n3'], purpose: 'Brainstorm' },
      { id: 'group_concept', type: 'concept', objectIds: ['n1', 'n2', 'n3'] }
    ]
  };

  const model = { board: { objects: [n1, n2, n3] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  const auditN1 = proposal.metadata.movementAudit['n1'];
  assert.equal(auditN1.owningActions.length, 1);
  assert.ok(auditN1.owningActions[0].includes('grid'));
});

test('8. Attached labels do not move independently', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Label', left: 110, top: 110, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 120, width: 100, height: 80 });

  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, t1, s2] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  const pS1 = proposal.placements.find((p) => p.objectId === 's1');
  const pT1 = proposal.placements.find((p) => p.objectId === 't1');

  assert.equal(pT1.position.x, pS1.bounds.x + (pS1.bounds.width - pT1.size.width) / 2);
  assert.equal(pT1.position.y, pS1.bounds.y + (pS1.bounds.height - pT1.size.height) / 2);
});

test('9. Standalone text normalization is isolated and does not affect surrounding objects', () => {
  const tFree = normalizeObject({ id: 'tFree', type: 'text', text: 'Comment', left: 500, top: 500, width: 100, height: 24, rotation: -20 });
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });

  const model = { board: { objects: [tFree, s1] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  const pTFree = proposal.placements.find((p) => p.objectId === 'tFree');
  const pS1 = proposal.placements.find((p) => p.objectId === 's1');

  assert.equal(pTFree.rotation, 0);
  assert.equal(pS1.position.x, 100);
  assert.equal(pS1.position.y, 100);
});

test('10. Untouched objects remain unchanged across all properties', () => {
  const div = normalizeObject({ id: 'div1', type: 'path', isSkribeLine: true, isStraightLine: true, left: 400, top: 100, width: 2, height: 300 });
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 250, top: 108, width: 100, height: 80 });

  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [div, s1, s2] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  const pDiv = proposal.placements.find((p) => p.objectId === 'div1');
  assert.equal(pDiv.position.x, 400);
  assert.equal(pDiv.position.y, 100);
  assert.equal(pDiv.bounds.width, 2);
  assert.equal(pDiv.bounds.height, 300);
});

test('11. Freehand strokes are untouched and preserve vector points', () => {
  const stroke = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 600, top: 200, width: 50, height: 40 });
  const model = { board: { objects: [stroke] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  const pSt = proposal.placements.find((p) => p.objectId === 'st1');
  assert.equal(pSt.position.x, 600);
  assert.equal(pSt.position.y, 200);
});

test('12. Divider is untouched and preserves vertical coordinates', () => {
  const div = normalizeObject({ id: 'div_margin', type: 'path', isSkribeLine: true, isStraightLine: true, left: 450, top: 80, width: 2, height: 500 });
  const model = { board: { objects: [div] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  const pDiv = proposal.placements.find((p) => p.objectId === 'div_margin');
  assert.equal(pDiv.position.x, 450);
  assert.equal(pDiv.position.y, 80);
});

test('13. Connector is updated exactly once during flowchart layout', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  const auditC1 = proposal.metadata.movementAudit['c1'];
  assert.equal(auditC1.unexpectedMultiTransform, false);
});

test('14. Connector topology is preserved', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  const pConn = proposal.placements.find((p) => p.objectId === 'c1');
  assert.equal(pConn.relationshipMetadata.sourceShapeId, 's1');
  assert.equal(pConn.relationshipMetadata.targetShapeId, 's2');
});

test('15. Connector type is preserved (straight vs elbow)', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, connectorType: 'elbow', sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  const pConn = proposal.placements.find((p) => p.objectId === 'c1');
  assert.equal(pConn.connectorType, 'elbow');
});

test('16. Arrow direction is preserved on re-routed connectors', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, endArrow: true, startArrow: false, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  const pConn = proposal.placements.find((p) => p.objectId === 'c1');
  assert.equal(pConn.endArrow, true);
  assert.equal(pConn.startArrow, false);
});

test('17. Deterministic composite output across multiple executions', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Node 1', left: 110, top: 110, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = normalizeObject({ id: 't2', type: 'text', text: 'Node 2', left: 310, top: 110, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's2' } });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, t1, s2, t2, conn] } };
  const plan = buildCleanupPlan(null, model);

  const res1 = executeCleanupPlan(plan, model);
  const res2 = executeCleanupPlan(plan, model);

  assert.deepEqual(res1.placements, res2.placements);
});

test('18. Input WorkspaceModel is immutable', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1] } };
  const snapshot = JSON.stringify(model);

  const plan = buildCleanupPlan(null, model);
  executeCleanupPlan(plan, model);

  assert.equal(JSON.stringify(model), snapshot);
});

test('19. Failed action causes transactional rejection without partial corruption', () => {
  const plan = {
    version: 1,
    actions: [
      { id: 'f1', type: 'cleanFlowchart', objectIds: ['non_existent_node'], connectorIds: [], confidence: 0.95, reason: 'Bad' }
    ],
    untouchedObjectIds: [],
    diagnostics: {}
  };

  const model = { board: { objects: [{ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 }] } };
  const proposal = executeCleanupPlan(plan, model);

  assert.equal(proposal.valid, false);
});

test('20. Board 1 composite execution preserves untouched objects and routes graph', () => {
  const proc = normalizeObject({ id: 'shape_proc', type: 'path', shapeType: 'hexagon', left: 300, top: 200, width: 120, height: 80, relationshipMetadata: { attachedTextId: 'text_proc' } });
  const tProc = normalizeObject({ id: 'text_proc', type: 'text', text: 'Process', left: 320, top: 228, width: 100, height: 24, relationshipMetadata: { parentShapeId: 'shape_proc' } });
  const dec = normalizeObject({ id: 'shape_dec', type: 'path', shapeType: 'diamond', left: 550, top: 200, width: 100, height: 90, relationshipMetadata: { attachedTextId: 'text_dec' } });
  const tDec = normalizeObject({ id: 'text_dec', type: 'text', text: 'Decision', left: 560, top: 233, width: 80, height: 24, relationshipMetadata: { parentShapeId: 'shape_dec' } });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 'shape_proc', targetShapeId: 'shape_dec', left: 420, top: 240, width: 130, height: 10 });
  const tp = normalizeObject({ id: 'shape_tp', type: 'rect', shapeType: 'rounded_rect', left: 700, top: 350, width: 140, height: 80 });
  const to = normalizeObject({ id: 'shape_to', type: 'rect', shapeType: 'rounded_rect', left: 880, top: 358, width: 120, height: 60 });
  const stroke = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 100, top: 100, width: 30, height: 30 });

  const scene = {
    groups: [
      { id: 'group_test_shapes', type: 'concept', objectIds: ['shape_tp', 'shape_to'] }
    ]
  };

  const model = { board: { objects: [proc, tProc, dec, tDec, conn, tp, to, stroke] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  assert.equal(proposal.valid, true);
  const pSt = proposal.placements.find((p) => p.objectId === 'st1');
  assert.equal(pSt.position.x, 100);
  assert.equal(pSt.position.y, 100);
});

test('21. Board 3 composite execution preserves isolated note location', () => {
  const n1 = normalizeObject({ id: 'n1', type: 'note', isStickyNote: true, left: 150, top: 150, width: 150, height: 150, relationshipMetadata: { attachedTextId: 'tn1' } });
  const tn1 = normalizeObject({ id: 'tn1', type: 'text', text: 'N1', left: 160, top: 160, width: 130, height: 30, relationshipMetadata: { parentShapeId: 'n1' } });
  const n2 = normalizeObject({ id: 'n2', type: 'note', isStickyNote: true, left: 320, top: 150, width: 150, height: 150, relationshipMetadata: { attachedTextId: 'tn2' } });
  const tn2 = normalizeObject({ id: 'tn2', type: 'text', text: 'N2', left: 330, top: 160, width: 130, height: 30, relationshipMetadata: { parentShapeId: 'n2' } });
  const nIso = normalizeObject({ id: 'n_iso', type: 'note', isStickyNote: true, left: 900, top: 600, width: 150, height: 150, relationshipMetadata: { attachedTextId: 'tn_iso' } });
  const tnIso = normalizeObject({ id: 'tn_iso', type: 'text', text: 'Iso', left: 910, top: 610, width: 130, height: 30, relationshipMetadata: { parentShapeId: 'n_iso' } });

  const scene = {
    groups: [
      { id: 'group_brainstorm', type: 'notes', objectIds: ['n1', 'n2'], purpose: 'Brainstorm' },
      { id: 'group_parking', type: 'notes', objectIds: ['n_iso'], purpose: 'Parking lot' }
    ]
  };

  const model = { board: { objects: [n1, tn1, n2, tn2, nIso, tnIso] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  assert.equal(proposal.valid, true);
  const pNIso = proposal.placements.find((p) => p.objectId === 'n_iso');
  assert.equal(pNIso.position.x, 900);
  assert.equal(pNIso.position.y, 600);
});

test('22. Board 4 composite execution preserves margin divider and title', () => {
  const title = normalizeObject({ id: 'title1', type: 'text', text: 'Architecture Spec', left: 80, top: 40, width: 300, height: 30 });
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 80, top: 100, width: 250, height: 80, relationshipMetadata: { attachedTextId: 'tc1' } });
  const tc1 = normalizeObject({ id: 'tc1', type: 'text', text: 'Section 1', left: 90, top: 110, width: 100, height: 20, relationshipMetadata: { parentShapeId: 'c1' } });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 80, top: 200, width: 250, height: 80, relationshipMetadata: { attachedTextId: 'tc2' } });
  const tc2 = normalizeObject({ id: 'tc2', type: 'text', text: 'Section 2', left: 90, top: 210, width: 100, height: 20, relationshipMetadata: { parentShapeId: 'c2' } });
  const c3 = normalizeObject({ id: 'c3', type: 'rect', left: 80, top: 340, width: 250, height: 80, relationshipMetadata: { attachedTextId: 'tc3' } });
  const tc3 = normalizeObject({ id: 'tc3', type: 'text', text: 'Section 3', left: 90, top: 350, width: 100, height: 20, relationshipMetadata: { parentShapeId: 'c3' } });
  const div = normalizeObject({ id: 'div1', type: 'path', isSkribeLine: true, isStraightLine: true, left: 380, top: 80, width: 2, height: 400 });

  const scene = {
    groups: [{ id: 'group_spec', type: 'concept', objectIds: ['c1', 'c2', 'c3'] }]
  };

  const model = { board: { objects: [title, c1, tc1, c2, tc2, c3, tc3, div] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  assert.equal(proposal.valid, true);
  const pTitle = proposal.placements.find((p) => p.objectId === 'title1');
  const pDiv = proposal.placements.find((p) => p.objectId === 'div1');

  assert.equal(pTitle.position.x, 80);
  assert.equal(pTitle.position.y, 40);
  assert.equal(pDiv.position.x, 380);
  assert.equal(pDiv.position.y, 80);
});

test('23. Movement audit accurately calculates net translations', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  const audit = proposal.metadata.movementAudit;
  assert.ok(audit['s1']);
  assert.ok(audit['s2']);
  assert.equal(audit['s1'].originalPosition.x, 100);
  assert.equal(audit['s1'].originalPosition.y, 100);
});

test('24. Double-movement detection flags unexpected multi-transformations', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  const audit = proposal.metadata.movementAudit['s1'];
  assert.equal(audit.unexpectedMultiTransform, false);
});

test('25. Real-board LayoutProposal verification pipeline passes end-to-end audit', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const preview = buildPreviewRenderModel(model, proposal);

  const audit = auditCleanupPipeline(model, plan, proposal, preview);
  assert.equal(audit.missingObjectIds.length, 0);
  assert.equal(audit.duplicateObjectIds.length, 0);
  assert.equal(audit.untouchedObjectViolations.length, 0);
});
