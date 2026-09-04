import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HIGH_CONFIDENCE,
  validateCleanupPlan,
  assertValidCleanupPlan
} from './cleanupPlanTypes.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { normalizeObject } from './normalizeObjects.js';

test('1. Compatible actions compose safely (attachText + cleanFlowchart + align)', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Node 1', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = normalizeObject({ id: 't2', type: 'text', text: 'Node 2', left: 320, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's2' } });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const cCard1 = normalizeObject({ id: 'cCard1', type: 'rect', left: 600, top: 100, width: 120, height: 60 });
  const cCard2 = normalizeObject({ id: 'cCard2', type: 'rect', left: 750, top: 110, width: 120, height: 60 });

  const scene = {
    groups: [
      { id: 'group_flow', type: 'flowchart', objectIds: ['s1', 's2', 'c1'] },
      { id: 'group_concept', type: 'concept', objectIds: ['cCard1', 'cCard2'] }
    ]
  };

  const model = { board: { objects: [s1, t1, s2, t2, conn, cCard1, cCard2] } };
  const plan = buildCleanupPlan(scene, model);

  assertValidCleanupPlan(plan, model);
  assert.equal(plan.actions.filter((a) => a.type === 'attachText').length, 2);
  assert.equal(plan.actions.filter((a) => a.type === 'cleanFlowchart').length, 1);
  assert.equal(plan.actions.filter((a) => a.type === 'align').length, 1);
});

test('2. Preserve conflicts with modifying actions are detected and handled', () => {
  const plan = {
    version: 1,
    actions: [
      { id: 'a1', type: 'align', axis: 'centerY', objectIds: ['s1', 's2'], confidence: 0.95, reason: 'Align' },
      { id: 'a2', type: 'preserve', objectIds: ['s1'], confidence: 1.0, reason: 'Preserve' }
    ],
    untouchedObjectIds: [],
    diagnostics: {}
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, false, 'Preserve + modify conflict rejected');
});

test('3. Duplicate actions are suppressed by composition engine', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const scene = {
    groups: [
      { id: 'g1', type: 'concept', objectIds: ['s1', 's2'] },
      { id: 'g2', type: 'concept', objectIds: ['s1', 's2'] }
    ]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);

  const alignActions = plan.actions.filter((a) => a.type === 'align');
  assert.equal(alignActions.length, 1, 'Only one align action executed; second suppressed as conflict');
  assert.ok(plan.diagnostics.suppressedActions.length >= 1);
});

test('4. cleanFlowchart owns graph nodes and connectors', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);

  const flow = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flow);
  assert.ok(flow.ownedObjectIds.includes('s1'));
  assert.ok(flow.ownedObjectIds.includes('s2'));
  assert.ok(flow.ownedObjectIds.includes('c1'));
});

test('5. Generic align is suppressed for flowchart graph nodes', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });
  const scene = {
    groups: [
      { id: 'g_flow', type: 'flowchart', objectIds: ['s1', 's2', 'c1'] },
      { id: 'g_concept', type: 'concept', objectIds: ['s1', 's2'] }
    ]
  };

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(scene, model);

  assert.ok(plan.actions.some((a) => a.type === 'cleanFlowchart'));
  assert.equal(plan.actions.find((a) => a.type === 'align'), undefined, 'Generic align subsumed by flowchart');
  assert.ok(plan.diagnostics.suppressedActions.some((id) => id.includes('align')));
});

test('6. Generic equalizeSpacing is suppressed for flowchart graph nodes', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 250, top: 100, width: 100, height: 80 });
  const s3 = normalizeObject({ id: 's3', type: 'rect', left: 450, top: 100, width: 100, height: 80 });
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 50, height: 10 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: 's2', targetShapeId: 's3', left: 350, top: 140, width: 100, height: 10 });
  const scene = {
    groups: [
      { id: 'g_flow', type: 'flowchart', objectIds: ['s1', 's2', 's3', 'c1', 'c2'] },
      { id: 'g_cards', type: 'concept', objectIds: ['s1', 's2', 's3'] }
    ]
  };

  const model = { board: { objects: [s1, s2, s3, c1, c2] } };
  const plan = buildCleanupPlan(scene, model);

  assert.ok(plan.actions.some((a) => a.type === 'cleanFlowchart'));
  assert.equal(plan.actions.find((a) => a.type === 'equalizeSpacing'), undefined, 'Generic spacing subsumed by flowchart');
});

test('7. arrangeGrid owns note cluster', () => {
  const n1 = normalizeObject({ id: 'n1', type: 'note', isStickyNote: true, left: 100, top: 100, width: 150, height: 150 });
  const n2 = normalizeObject({ id: 'n2', type: 'note', isStickyNote: true, left: 280, top: 100, width: 150, height: 150 });
  const scene = {
    groups: [{ id: 'group_brainstorm', type: 'notes', objectIds: ['n1', 'n2'], purpose: 'Brainstorm' }]
  };

  const model = { board: { objects: [n1, n2] } };
  const plan = buildCleanupPlan(scene, model);

  const grid = plan.actions.find((a) => a.type === 'arrangeGrid');
  assert.ok(grid);
  assert.deepEqual(grid.ownedObjectIds, ['n1', 'n2']);
});

test('8. Generic align is suppressed for notes in arrangeGrid', () => {
  const n1 = normalizeObject({ id: 'n1', type: 'note', isStickyNote: true, left: 100, top: 100, width: 150, height: 150 });
  const n2 = normalizeObject({ id: 'n2', type: 'note', isStickyNote: true, left: 280, top: 105, width: 150, height: 150 });
  const scene = {
    groups: [
      { id: 'group_brainstorm', type: 'notes', objectIds: ['n1', 'n2'], purpose: 'Brainstorm' },
      { id: 'group_concept', type: 'concept', objectIds: ['n1', 'n2'] }
    ]
  };

  const model = { board: { objects: [n1, n2] } };
  const plan = buildCleanupPlan(scene, model);

  assert.ok(plan.actions.some((a) => a.type === 'arrangeGrid'));
  assert.equal(plan.actions.find((a) => a.type === 'align'), undefined, 'Generic align subsumed by arrangeGrid');
});

test('9. attachText is compatible with parent shape alignment', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'L1', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = normalizeObject({ id: 't2', type: 'text', text: 'L2', left: 320, top: 140, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's2' } });
  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, t1, s2, t2] } };
  const plan = buildCleanupPlan(scene, model);

  assert.equal(plan.actions.filter((a) => a.type === 'attachText').length, 2);
  assert.equal(plan.actions.filter((a) => a.type === 'align').length, 1);
});

test('10. Attached text cannot be independently normalized', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Tilted Label', left: 120, top: 130, width: 60, height: 20, rotation: 15, relationshipMetadata: { parentShapeId: 's1' } });

  const model = { board: { objects: [s1, t1] } };
  const plan = buildCleanupPlan(null, model);

  assert.equal(plan.actions.find((a) => a.type === 'normalizeText'), undefined);
  assert.ok(plan.actions.some((a) => a.type === 'attachText'));
  assert.ok(plan.diagnostics.suppressedActions.some((id) => id.includes('norm_text_t1')));
});

test('11. Atomic unit ownership is expanded to include attached text', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'L1', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, t1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);

  const flow = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flow);
  assert.ok(flow.ownedObjectIds.includes('t1'), 'Flowchart ownedObjectIds includes attached text t1');
});

test('12. Connector ownership is expanded in cleanFlowchart', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);

  const flow = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flow.ownedObjectIds.includes('c1'));
});

test('13. Freehand cannot be claimed by generic actions', () => {
  const stroke = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 100, top: 100, width: 50, height: 50 });
  const model = { board: { objects: [stroke] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.untouchedObjectIds.includes('st1'));
  assert.equal(plan.actions.length, 0);
});

test('14. Divider cannot be claimed by generic actions', () => {
  const div = normalizeObject({ id: 'div1', type: 'path', isSkribeLine: true, isStraightLine: true, left: 500, top: 100, width: 2, height: 400 });
  const model = { board: { objects: [div] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.untouchedObjectIds.includes('div1'));
  assert.equal(plan.actions.length, 0);
});

test('15. Deterministic action ordering (attachText -> cleanFlowchart -> arrangeGrid -> align -> equalizeSpacing -> normalizeText)', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'L1', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });
  const n1 = normalizeObject({ id: 'n1', type: 'note', isStickyNote: true, left: 100, top: 300, width: 150, height: 150 });
  const n2 = normalizeObject({ id: 'n2', type: 'note', isStickyNote: true, left: 280, top: 300, width: 150, height: 150 });
  const tFree = normalizeObject({ id: 'tFree', type: 'text', text: 'Standalone', left: 600, top: 600, width: 100, height: 24, rotation: 10 });

  const scene = {
    groups: [
      { id: 'g_notes', type: 'notes', objectIds: ['n1', 'n2'], purpose: 'Brainstorm' }
    ]
  };

  const model = { board: { objects: [s1, t1, s2, conn, n1, n2, tFree] } };
  const plan = buildCleanupPlan(scene, model);

  const types = plan.actions.map((a) => a.type);
  assert.equal(types[0], 'attachText');
  assert.equal(types[1], 'cleanFlowchart');
  assert.equal(types[2], 'arrangeGrid');
  assert.equal(types[3], 'normalizeText');
});

test('16. Action order does not alter output geometry', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'L1', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = normalizeObject({ id: 't2', type: 'text', text: 'L2', left: 320, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's2' } });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, t1, s2, t2, conn] } };
  const plan1 = buildCleanupPlan(null, model);
  const plan2 = buildCleanupPlan(null, model);

  const res1 = executeCleanupPlan(plan1, model);
  const res2 = executeCleanupPlan(plan2, model);

  assert.deepEqual(res1.placements, res2.placements);
});

test('17. Suppressed action diagnostics record detailed reasons', () => {
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

  assert.ok(plan.diagnostics.suppressionReasons.length >= 1);
  assert.ok(plan.diagnostics.suppressionReasons[0].reason.includes('subsumed by higher-priority action'));
});

test('18. Ownership map correctly reflects action owners', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'L1', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s1, t1] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.diagnostics.ownershipByObject['s1']);
  assert.ok(plan.diagnostics.ownershipByObject['t1']);
});

test('19. Modified object set correctness', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'L1', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const st1 = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 600, top: 600, width: 20, height: 20 });

  const model = { board: { objects: [s1, t1, st1] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(!plan.untouchedObjectIds.includes('s1'));
  assert.ok(!plan.untouchedObjectIds.includes('t1'));
  assert.ok(plan.untouchedObjectIds.includes('st1'));
});

test('20. Untouched object set has zero overlap with modified objects', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'L1', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const st1 = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 600, top: 600, width: 20, height: 20 });

  const model = { board: { objects: [s1, t1, st1] } };
  const plan = buildCleanupPlan(null, model);

  const modifiedIds = new Set(plan.actions.flatMap((a) => a.ownedObjectIds || a.objectIds));
  plan.untouchedObjectIds.forEach((id) => {
    assert.ok(!modifiedIds.has(id), `Untouched ID ${id} must not be in modified set`);
  });
});

test('21. Real-board Board 1 composite plan is conflict-free', () => {
  const proc = normalizeObject({ id: 'shape_proc', type: 'path', shapeType: 'hexagon', left: 300, top: 200, width: 120, height: 80, relationshipMetadata: { attachedTextId: 'text_proc' } });
  const tProc = normalizeObject({ id: 'text_proc', type: 'text', text: 'Process', left: 320, top: 228, width: 100, height: 24, relationshipMetadata: { parentShapeId: 'shape_proc' } });
  const dec = normalizeObject({ id: 'shape_dec', type: 'path', shapeType: 'diamond', left: 550, top: 200, width: 100, height: 90, relationshipMetadata: { attachedTextId: 'text_dec' } });
  const tDec = normalizeObject({ id: 'text_dec', type: 'text', text: 'Decision', left: 560, top: 233, width: 80, height: 24, relationshipMetadata: { parentShapeId: 'shape_dec' } });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 'shape_proc', targetShapeId: 'shape_dec', left: 420, top: 240, width: 130, height: 10 });
  const tp = normalizeObject({ id: 'shape_tp', type: 'rect', shapeType: 'rounded_rect', left: 700, top: 350, width: 140, height: 80 });
  const to = normalizeObject({ id: 'shape_to', type: 'rect', shapeType: 'rounded_rect', left: 880, top: 358, width: 120, height: 60 });
  const scene = {
    groups: [
      { id: 'group_test_shapes', type: 'concept', objectIds: ['shape_tp', 'shape_to'] }
    ]
  };

  const model = { board: { objects: [proc, tProc, dec, tDec, conn, tp, to] } };
  const plan = buildCleanupPlan(scene, model);

  assertValidCleanupPlan(plan, model);
  assert.equal(plan.actions.filter((a) => a.type === 'cleanFlowchart').length, 1);
  assert.equal(plan.actions.filter((a) => a.type === 'align').length, 1);
});

test('22. Real-board Board 3 composite plan does not drag isolated note into grid', () => {
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

  const grid = plan.actions.find((a) => a.type === 'arrangeGrid');
  assert.ok(grid);
  assert.deepEqual(grid.objectIds, ['n1', 'n2']);
  assert.ok(!grid.objectIds.includes('n_iso'));
});

test('23. Real-board Board 4 composite plan composes attachText, equalizeSpacing, and normalizeText', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 80, top: 130, width: 300, height: 100, relationshipMetadata: { attachedTextId: 'tc1' } });
  const tc1 = normalizeObject({ id: 'tc1', type: 'text', text: 'Card 1', left: 90, top: 140, width: 200, height: 24, relationshipMetadata: { parentShapeId: 'c1' } });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 80, top: 250, width: 300, height: 100, relationshipMetadata: { attachedTextId: 'tc2' } });
  const tc2 = normalizeObject({ id: 'tc2', type: 'text', text: 'Card 2', left: 90, top: 260, width: 200, height: 24, relationshipMetadata: { parentShapeId: 'c2' } });
  const c3 = normalizeObject({ id: 'c3', type: 'rect', left: 80, top: 410, width: 300, height: 100, relationshipMetadata: { attachedTextId: 'tc3' } });
  const tc3 = normalizeObject({ id: 'tc3', type: 'text', text: 'Card 3', left: 90, top: 420, width: 200, height: 24, relationshipMetadata: { parentShapeId: 'c3' } });
  const tTilted = normalizeObject({ id: 't_tilted', type: 'text', text: 'Review', left: 450, top: 160, width: 200, height: 24, rotation: -15 });

  const scene = {
    groups: [
      { id: 'group_cards', type: 'concept', objectIds: ['c1', 'c2', 'c3'] }
    ]
  };

  const model = { board: { objects: [c1, tc1, c2, tc2, c3, tc3, tTilted] } };
  const plan = buildCleanupPlan(scene, model);

  assertValidCleanupPlan(plan, model);
  assert.equal(plan.actions.filter((a) => a.type === 'attachText').length, 3);
  assert.equal(plan.actions.filter((a) => a.type === 'equalizeSpacing').length, 1);
  assert.equal(plan.actions.filter((a) => a.type === 'normalizeText').length, 1);
});

test('24. Input models remain immutable during composition and conflict resolution', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1] } };
  const snap = JSON.stringify(model);

  buildCleanupPlan(null, model);
  assert.equal(JSON.stringify(model), snap);
});

test('25. Deterministic composite plan output across multiple invocations', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, s2] } };
  const p1 = buildCleanupPlan(scene, model);
  const p2 = buildCleanupPlan(scene, model);

  assert.deepEqual(p1, p2);
});
