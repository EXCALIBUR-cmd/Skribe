import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObject } from './normalizeObjects.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildCleanupResult } from './buildCleanupResult.js';
import { validateCleanupResult, assertValidCleanupResult } from './cleanupResultTypes.js';
import { createLayoutProposal } from './layoutEngine.js';

test('1. Valid CleanupResult structure conforming to canonical contract', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Node 1', left: 110, top: 110, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = normalizeObject({ id: 't2', type: 'text', text: 'Node 2', left: 310, top: 120, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's2' } });

  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, t1, s2, t2] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assertValidCleanupResult(result, model);
  assert.equal(result.version, 1);
  assert.ok(result.summary);
  assert.ok(result.actions);
  assert.ok(result.preserved);
  assert.ok(result.safety);
  assert.ok(result.diagnostics);
});

test('2. Deterministic CleanupResult generation across multiple invocations', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const scene = { groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }] };
  const model = { board: { objects: [s1, s2] } };

  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);

  const res1 = buildCleanupResult(plan, proposal, model);
  const res2 = buildCleanupResult(plan, proposal, model);

  assert.deepEqual(res1, res2);
});

test('3. Human-readable action explanations answer what and why', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Node 1', left: 110, top: 110, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s1, t1] } };

  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  const attachAct = result.actions.find((a) => a.type === 'attachText');
  assert.ok(attachAct);
  assert.ok(attachAct.reason.length > 20);
  assert.ok(attachAct.reason.includes('explicitly bound') || attachAct.reason.includes('atomicity'));
});

test('4. Action evidence is explicitly reported', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Node 1', left: 110, top: 110, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s1, t1] } };

  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  const attachAct = result.actions.find((a) => a.type === 'attachText');
  assert.ok(attachAct.evidence.includes('explicit-metadata'));
});

test('5. Impact summary correctly tracks objectsAffected and objectsMoved', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const scene = { groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }] };
  const model = { board: { objects: [s1, s2] } };

  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  const alignAct = result.actions.find((a) => a.type === 'align');
  assert.ok(alignAct);
  assert.equal(alignAct.impact.objectsAffected, 2);
  assert.equal(alignAct.impact.objectsMoved, 2);
});

test('6. Preserved-object summary categorizes untouched items with clear reasons', () => {
  const stroke = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 500, top: 500, width: 30, height: 30 });
  const div = normalizeObject({ id: 'div1', type: 'path', isSkribeLine: true, isStraightLine: true, left: 400, top: 50, width: 2, height: 400 });
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });

  const model = { board: { objects: [stroke, div, s1] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.ok(result.preserved.some((p) => p.category === 'freehand'));
  assert.ok(result.preserved.some((p) => p.category === 'divider'));
});

test('7. Confidence summary tracks highConfidence vs ambiguous preserved objects', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.confidenceSummary.preservedAmbiguousObjects, 1);
  assert.equal(result.confidenceSummary.highConfidenceActions, 0);
});

test('8. Modified object count matches unique modified objects', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Label', left: 110, top: 110, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s1, t1] } };

  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.modifiedObjectCount, 2);
});

test('9. Untouched object count matches strictly preserved elements', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Label', left: 110, top: 110, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const stroke = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 500, top: 500, width: 30, height: 30 });
  const model = { board: { objects: [s1, t1, stroke] } };

  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.untouchedObjectCount, 1);
});

test('10. Atomic unit impact counts parent-child units affected', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Label', left: 110, top: 110, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s1, t1] } };

  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  const act = result.actions[0];
  assert.equal(act.impact.atomicUnitsAffected, 1);
});

test('11. Connector impact records connected connectors count', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  const flow = result.actions.find((a) => a.type === 'cleanFlowchart');
  assert.equal(flow.impact.connectorCount, 1);
});

test('12. Freehand preservation explicitly categorizes sketch strokes', () => {
  const stroke = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 100, top: 100, width: 30, height: 30 });
  const model = { board: { objects: [stroke] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  const pFree = result.preserved.find((p) => p.category === 'freehand');
  assert.ok(pFree);
  assert.ok(pFree.objectIds.includes('st1'));
});

test('13. Missing object diagnostic records 0 for conserved scenes', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.diagnostics.missingObjects.length, 0);
  assert.equal(result.safety.missingCount, 0);
});

test('14. Duplicate object diagnostic records 0 for unique placements', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.diagnostics.duplicateObjects.length, 0);
  assert.equal(result.safety.duplicateCount, 0);
});

test('15. Invariant violation diagnostic records 0 for strict preservation', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.safety.untouchedInvariantMet, true);
});

test('16. Inputs remain immutable during result construction', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1] } };
  const snap = JSON.stringify(model);

  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  buildCleanupResult(plan, proposal, model);

  assert.equal(JSON.stringify(model), snap);
});

test('17. Board 1 explainable result reports flowchart + align + untouched counts', () => {
  const proc = normalizeObject({ id: 'shape_proc', type: 'path', shapeType: 'hexagon', left: 300, top: 200, width: 120, height: 80, relationshipMetadata: { attachedTextId: 'text_proc' } });
  const tProc = normalizeObject({ id: 'text_proc', type: 'text', text: 'Process', left: 320, top: 228, width: 100, height: 24, relationshipMetadata: { parentShapeId: 'shape_proc' } });
  const dec = normalizeObject({ id: 'shape_dec', type: 'path', shapeType: 'diamond', left: 550, top: 200, width: 100, height: 90, relationshipMetadata: { attachedTextId: 'text_dec' } });
  const tDec = normalizeObject({ id: 'text_dec', type: 'text', text: 'Decision', left: 560, top: 233, width: 80, height: 24, relationshipMetadata: { parentShapeId: 'shape_dec' } });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 'shape_proc', targetShapeId: 'shape_dec', left: 420, top: 240, width: 130, height: 10 });
  const tp = normalizeObject({ id: 'shape_tp', type: 'rect', shapeType: 'rounded_rect', left: 700, top: 350, width: 140, height: 80 });
  const to = normalizeObject({ id: 'shape_to', type: 'rect', shapeType: 'rounded_rect', left: 880, top: 358, width: 120, height: 60 });
  const stroke = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 100, top: 100, width: 30, height: 30 });

  const scene = {
    groups: [{ id: 'group_test_shapes', type: 'concept', objectIds: ['shape_tp', 'shape_to'] }]
  };

  const model = { board: { objects: [proc, tProc, dec, tDec, conn, tp, to, stroke] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.untouchedObjectCount, 1);
  assert.ok(result.summary.humanSummary.includes('Cleaned 1 flowchart'));
});

test('18. Board 2 explainable result reports 100% diagram cleanup', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.untouchedObjectCount, 0);
  assert.equal(result.summary.modifiedObjectCount, 3);
});

test('19. Board 3 explainable result reports note cluster arrangement', () => {
  const n1 = normalizeObject({ id: 'n1', type: 'note', isStickyNote: true, left: 100, top: 100, width: 150, height: 150 });
  const n2 = normalizeObject({ id: 'n2', type: 'note', isStickyNote: true, left: 280, top: 100, width: 150, height: 150 });
  const nIso = normalizeObject({ id: 'n_iso', type: 'note', isStickyNote: true, left: 800, top: 500, width: 150, height: 150 });

  const scene = {
    groups: [
      { id: 'group_brainstorm', type: 'notes', objectIds: ['n1', 'n2'], purpose: 'Brainstorm' },
      { id: 'group_parking', type: 'notes', objectIds: ['n_iso'], purpose: 'Parking lot' }
    ]
  };

  const model = { board: { objects: [n1, n2, nIso] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.untouchedObjectCount, 1);
  assert.ok(result.summary.humanSummary.includes('Arranged 1 note cluster'));
});

test('20. Board 4 explainable result reports sequence spacing and text normalization', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 80, top: 100, width: 250, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 80, top: 200, width: 250, height: 80 });
  const c3 = normalizeObject({ id: 'c3', type: 'rect', left: 80, top: 340, width: 250, height: 80 });
  const tTilted = normalizeObject({ id: 't_tilted', type: 'text', text: 'Review', left: 450, top: 160, width: 200, height: 24, rotation: -15 });

  const scene = {
    groups: [{ id: 'group_spec', type: 'concept', objectIds: ['c1', 'c2', 'c3'] }]
  };

  const model = { board: { objects: [c1, c2, c3, tTilted] } };
  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.ok(result.summary.humanSummary.includes('Equalized 1 sequence'));
  assert.ok(result.summary.humanSummary.includes('Normalized 1 text'));
});

test('21. Board 5 explainable result reports 100% preservation for sketches', () => {
  const stroke = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 100, top: 100, width: 30, height: 30 });
  const model = { board: { objects: [stroke] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.actionCount, 0);
  assert.ok(result.summary.humanSummary.includes('already well-organized'));
});

test('22. Real-board proposal integration attaches CleanupResult to proposal.metadata', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1] } };

  const proposal = createLayoutProposal(null, model);
  assert.ok(proposal.metadata.cleanupResult);
  assert.equal(proposal.metadata.cleanupResult.version, 1);
});

test('23. Preview metadata integration matches executed layout actions', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const scene = { groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }] };
  const model = { board: { objects: [s1, s2] } };

  const proposal = createLayoutProposal(scene, model);
  const cr = proposal.metadata.cleanupResult;

  assert.equal(cr.actions.length, 1);
  assert.equal(cr.actions[0].type, 'align');
});

test('24. Debug highlighting mapping links object IDs to action IDs', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const scene = { groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }] };
  const model = { board: { objects: [s1, s2] } };

  const plan = buildCleanupPlan(scene, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model, { debug: true });

  assert.ok(result.debug.objectHighlights['s1']);
  assert.ok(result.debug.objectHighlights['s2']);
});

test('25. Deterministic serialization to JSON without coordinate leakage', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  const jsonStr = JSON.stringify(result);
  assert.ok(!jsonStr.includes('"position":'));
  assert.ok(!jsonStr.includes('"pathCommands":'));
});
