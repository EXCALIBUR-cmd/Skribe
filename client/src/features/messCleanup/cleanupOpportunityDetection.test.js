
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPPORTUNITY_TYPES,
  OPPORTUNITY_PRIORITY,
  detectCleanupOpportunities,
  detectOverlapOpportunities,
  detectAlignmentOpportunities,
  detectSpacingOpportunities,
  detectBrokenFlowOpportunities,
  detectConnectorCrossingOpportunities,
  detectDetachedTextOpportunities,
  scoreOpportunity,
  rankAndSelectOpportunities
} from './cleanupOpportunities.js';
import {
  resolveCleanupOpportunity,
  resolveCleanupOpportunities
} from './resolveCleanupOpportunity.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { normalizeObject } from './normalizeObjects.js';

test('1. Accidental shape overlap detected', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 120, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 180, top: 110, width: 120, height: 80 });
  const model = { board: { objects: [s1, s2] } };
  const objectMap = new Map([['s1', s1], ['s2', s2]]);
  const ownership = { ownedByOwner: new Map(), ownerByText: new Map() };

  const opps = detectOverlapOpportunities([s1, s2], objectMap, ownership);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].type, OPPORTUNITY_TYPES.OVERLAP);
  assert.deepEqual(opps[0].objectIds.sort(), ['s1', 's2']);
  assert.ok(opps[0].metadata.overlapArea > 0);
  assert.ok(opps[0].confidence >= 0.90);
});

test('2. Intentional containment excluded from overlap detection', () => {
  const note = normalizeObject({ id: 'note1', type: 'note', isStickyNote: true, left: 100, top: 100, width: 150, height: 150 });
  const text = normalizeObject({ id: 'text1', type: 'text', text: 'Sticky content', left: 120, top: 120, width: 100, height: 30 });
  const objectMap = new Map([['note1', note], ['text1', text]]);
  const ownership = {
    ownedByOwner: new Map([['note1', ['text1']]]),
    ownerByText: new Map([['text1', 'note1']])
  };

  const opps = detectOverlapOpportunities([note, text], objectMap, ownership);
  assert.equal(opps.length, 0, 'Intentional child containment must not be flagged as accidental collision');
});

test('3. Overlap does not directly force an action', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 160, top: 120, width: 100, height: 80 });
  const opp = {
    id: 'opp_overlap_s1_s2',
    type: OPPORTUNITY_TYPES.OVERLAP,
    objectIds: ['s1', 's2'],
    confidence: 0.95,
    visualBenefit: 9.0,
    movementCost: 3.0,
    risk: 1.0,
    evidence: ['bounding-box-intersection']
  };

  assert.equal(opp.targetX, undefined);
  assert.equal(opp.targetY, undefined);

  const context = { objectMap: new Map([['s1', s1], ['s2', s2]]), semanticScene: {}, explicitEdges: [] };
  const res = resolveCleanupOpportunity(opp, context);
  assert.equal(res.action, null);
  assert.ok(res.rejectedReason.includes('preserved in place'));
});

test('4. Meaningful alignment detected', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 260, top: 114, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'group_cards', type: 'concept', objectIds: ['s1', 's2'] }]
  };
  const objectMap = new Map([['s1', s1], ['s2', s2]]);

  const opps = detectAlignmentOpportunities([s1, s2], objectMap, scene);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].type, OPPORTUNITY_TYPES.MISALIGNMENT);
  assert.equal(opps[0].axis, 'centerY');
  assert.equal(opps[0].metadata.delta, 14);
});

test('5. Insignificant alignment suppressed (<= 2px ignored, > 35px unrelated)', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 260, top: 101, width: 100, height: 80 });
  const sceneA = { groups: [{ id: 'gA', type: 'concept', objectIds: ['s1', 's2'] }] };
  const mapA = new Map([['s1', s1], ['s2', s2]]);
  const oppsA = detectAlignmentOpportunities([s1, s2], mapA, sceneA);
  assert.equal(oppsA.length, 0, '<= 2px alignment deviation is visually negligible and ignored');

  const s3 = normalizeObject({ id: 's3', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s4 = normalizeObject({ id: 's4', type: 'rect', left: 260, top: 160, width: 100, height: 80 });
  const sceneB = { groups: [{ id: 'gB', type: 'concept', objectIds: ['s3', 's4'] }] };
  const mapB = new Map([['s3', s3], ['s4', s4]]);
  const oppsB = detectAlignmentOpportunities([s3, s4], mapB, sceneB);
  assert.equal(oppsB.length, 0, '> 35px deviation is not an accidental alignment candidate');
});

test('6. Uneven spacing detected (>= 3 objects, gap delta >= 10px)', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 230, top: 100, width: 100, height: 80 });
  const s3 = normalizeObject({ id: 's3', type: 'rect', left: 415, top: 100, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'g_seq', type: 'concept', objectIds: ['s1', 's2', 's3'] }]
  };
  const objectMap = new Map([['s1', s1], ['s2', s2], ['s3', s3]]);

  const opps = detectSpacingOpportunities([s1, s2, s3], objectMap, scene);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].type, OPPORTUNITY_TYPES.UNEVEN_SPACING);
  assert.deepEqual(opps[0].metadata.gaps, [30, 85]);
});

test('7. Negligible spacing suppressed (40px vs 42px delta < 10px)', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 240, top: 100, width: 100, height: 80 });
  const s3 = normalizeObject({ id: 's3', type: 'rect', left: 382, top: 100, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'g_seq', type: 'concept', objectIds: ['s1', 's2', 's3'] }]
  };
  const objectMap = new Map([['s1', s1], ['s2', s2], ['s3', s3]]);

  const opps = detectSpacingOpportunities([s1, s2, s3], objectMap, scene);
  assert.equal(opps.length, 0, '2px spacing delta is negligible; no opportunity created');
});

test('8. Flowchart disorder detected only with verified topology', () => {
  const n1 = normalizeObject({ id: 'n1', type: 'rect', left: 300, top: 100, width: 100, height: 60 });
  const n2 = normalizeObject({ id: 'n2', type: 'rect', left: 100, top: 100, width: 100, height: 60 });
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 'n1', targetShapeId: 'n2', left: 200, top: 130, width: 100, height: 10 });
  const scene = {
    groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['n1', 'n2', 'c1'] }]
  };
  const objectMap = new Map([['n1', n1], ['n2', n2], ['c1', c1]]);

  const opps = detectBrokenFlowOpportunities([n1, n2, c1], objectMap, scene);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].type, OPPORTUNITY_TYPES.BROKEN_FLOW);
  assert.ok(opps[0].metadata.hasDisorder);
  assert.ok(opps[0].evidence.includes('backward-edge-disorder'));
});

test('9. Connector crossing detected producing visual clutter', () => {
  const sA = normalizeObject({ id: 'sA', type: 'rect', left: 100, top: 100, width: 60, height: 40 });
  const sB = normalizeObject({ id: 'sB', type: 'rect', left: 400, top: 400, width: 60, height: 40 });
  const sC = normalizeObject({ id: 'sC', type: 'rect', left: 100, top: 400, width: 60, height: 40 });
  const sD = normalizeObject({ id: 'sD', type: 'rect', left: 400, top: 100, width: 60, height: 40 });

  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 'sA', targetShapeId: 'sB', left: 130, top: 120, width: 300, height: 300 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: 'sC', targetShapeId: 'sD', left: 130, top: 120, width: 300, height: 300 });
  const objectMap = new Map([['sA', sA], ['sB', sB], ['sC', sC], ['sD', sD], ['c1', c1], ['c2', c2]]);

  const opps = detectConnectorCrossingOpportunities([sA, sB, sC, sD, c1, c2], objectMap);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].type, OPPORTUNITY_TYPES.CONNECTOR_CROSSING);
  assert.deepEqual(opps[0].connectorIds.sort(), ['c1', 'c2']);
});

test('10. Detached text detected when visibly displaced from container', () => {
  const card = normalizeObject({ id: 'card1', type: 'rect', left: 100, top: 100, width: 150, height: 100, relationshipMetadata: { attachedTextId: 'lbl1' } });
  const label = normalizeObject({ id: 'lbl1', type: 'text', text: 'Card Title', left: 270, top: 120, width: 80, height: 20, relationshipMetadata: { parentShapeId: 'card1' } });
  const objectMap = new Map([['card1', card], ['lbl1', label]]);
  const ownership = {
    ownedByOwner: new Map([['card1', ['lbl1']]]),
    ownerByText: new Map([['lbl1', 'card1']])
  };

  const opps = detectDetachedTextOpportunities([card, label], objectMap, ownership);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].type, OPPORTUNITY_TYPES.DETACHED_TEXT);
  assert.ok(opps[0].metadata.isOutsideContainer);
});

test('11. Intentional annotation preserved and not flagged as detached mess', () => {
  const card = normalizeObject({ id: 'card1', type: 'rect', left: 100, top: 100, width: 150, height: 100 });
  const note = normalizeObject({ id: 'note1', type: 'text', text: 'Important note', left: 125, top: 140, width: 100, height: 20, relationshipMetadata: { parentShapeId: 'card1', attachedTextId: 'card1' } });
  const objectMap = new Map([['card1', card], ['note1', note]]);
  const ownership = {
    ownedByOwner: new Map([['card1', ['note1']]]),
    ownerByText: new Map([['note1', 'card1']])
  };

  const opps = detectDetachedTextOpportunities([card, note], objectMap, ownership);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].metadata.isOutsideContainer, false);
});

test('12. Local excessive whitespace detected', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 230, top: 100, width: 100, height: 80 });
  const s3 = normalizeObject({ id: 's3', type: 'rect', left: 730, top: 100, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'g_wide', type: 'concept', objectIds: ['s1', 's2', 's3'] }]
  };
  const objectMap = new Map([['s1', s1], ['s2', s2], ['s3', s3]]);

  const opps = detectSpacingOpportunities([s1, s2, s3], objectMap, scene);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].type, OPPORTUNITY_TYPES.EXCESSIVE_WHITESPACE);
  assert.ok(opps[0].metadata.isAnomaly);
});

test('13. Global page compression rejected', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 1200, top: 800, width: 100, height: 80 });
  const model = { board: { objects: [s1, s2] } };

  const plan = buildCleanupPlan(null, model);
  assert.equal(plan.actions.length, 0, 'No shelf packing or global compression performed');
  assert.deepEqual(plan.untouchedObjectIds.sort(), ['s1', 's2']);
});

test('14. Isolated freehand doodle preserved', () => {
  const stroke = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 100, top: 100, width: 60, height: 60 });
  const model = { board: { objects: [stroke] } };

  const plan = buildCleanupPlan(null, model);
  assert.equal(plan.actions.length, 0);
  assert.deepEqual(plan.untouchedObjectIds, ['st1']);
});

test('15. Ambiguous floating connector preserved', () => {
  const conn = normalizeObject({ id: 'c_float', type: 'path', isConnector: true, left: 500, top: 500, width: 100, height: 10 });
  const model = { board: { objects: [conn] } };

  const plan = buildCleanupPlan(null, model);
  assert.equal(plan.actions.length, 0);
  assert.deepEqual(plan.untouchedObjectIds, ['c_float']);
});

test('16. Movement budget enforced strictly', () => {
  const opps = [
    { id: 'opp1', type: OPPORTUNITY_TYPES.BROKEN_FLOW, objectIds: ['a', 'b'], visualBenefit: 8.5, confidence: 0.95, movementCost: 2.0, risk: 1.0 },
    { id: 'opp2', type: OPPORTUNITY_TYPES.MISALIGNMENT, objectIds: ['c', 'd'], visualBenefit: 6.0, confidence: 0.90, movementCost: 1.5, risk: 1.0 },
    { id: 'opp3', type: OPPORTUNITY_TYPES.UNEVEN_SPACING, objectIds: ['e', 'f', 'g'], visualBenefit: 5.5, confidence: 0.90, movementCost: 1.5, risk: 1.0 },
    { id: 'opp4', type: OPPORTUNITY_TYPES.COSMETIC_TEXT_ISSUE, objectIds: ['h'], visualBenefit: 3.0, confidence: 0.85, movementCost: 0.5, risk: 0.5 }
  ];

  const res = rankAndSelectOpportunities(opps, { maxActions: 2, maxMovedObjects: 10, totalObjectCount: 15 });
  assert.equal(res.selectedOpportunities.length, 2);
  assert.equal(res.selectedOpportunities[0].id, 'opp1');
  assert.equal(res.selectedOpportunities[1].id, 'opp2');
  assert.ok(res.rejectedOpportunities.length >= 2);
  assert.ok(res.budgetReport.selectedActions <= res.budgetReport.maxActions);
});

test('17. Opportunity ranking is deterministic across runs', () => {
  const opps = [
    { id: 'opp_space_z', type: OPPORTUNITY_TYPES.UNEVEN_SPACING, objectIds: ['z1', 'z2', 'z3'], visualBenefit: 6.0, confidence: 0.90, movementCost: 1.5, risk: 1.0 },
    { id: 'opp_flow_a', type: OPPORTUNITY_TYPES.BROKEN_FLOW, objectIds: ['a1', 'a2'], visualBenefit: 8.5, confidence: 0.95, movementCost: 2.0, risk: 1.0 },
    { id: 'opp_align_b', type: OPPORTUNITY_TYPES.MISALIGNMENT, objectIds: ['b1', 'b2'], visualBenefit: 6.5, confidence: 0.92, movementCost: 1.5, risk: 1.0 }
  ];

  const res1 = rankAndSelectOpportunities(opps, { totalObjectCount: 20 });
  const res2 = rankAndSelectOpportunities(opps, { totalObjectCount: 20 });

  assert.deepEqual(
    res1.selectedOpportunities.map((o) => o.id),
    res2.selectedOpportunities.map((o) => o.id)
  );
  assert.equal(res1.selectedOpportunities[0].id, 'opp_flow_a', 'Broken flow ranks ahead of alignment and spacing');
});

test('18. Higher-value structural opportunity wins conflict over lower-value opportunity', () => {
  const flowOpp = { id: 'opp_flow', type: OPPORTUNITY_TYPES.BROKEN_FLOW, objectIds: ['s1', 's2'], visualBenefit: 9.0, confidence: 0.95, movementCost: 2.0, risk: 1.0 };
  const alignOpp = { id: 'opp_align', type: OPPORTUNITY_TYPES.MISALIGNMENT, objectIds: ['s1', 's2'], visualBenefit: 6.0, confidence: 0.90, movementCost: 1.5, risk: 1.0 };

  const res = rankAndSelectOpportunities([flowOpp, alignOpp], { totalObjectCount: 10 });
  assert.equal(res.selectedOpportunities.length, 1);
  assert.equal(res.selectedOpportunities[0].id, 'opp_flow');
  assert.equal(res.rejectedOpportunities[0].id, 'opp_align');
  assert.ok(res.rejectedOpportunities[0].reason.includes('subsumed by higher-priority action'));
});

test('19. Micro-actions suppressed when structural cleanup exists', () => {
  const flowOpp = { id: 'opp_flow_1', type: OPPORTUNITY_TYPES.BROKEN_FLOW, objectIds: ['s1', 's2'], visualBenefit: 9.0, confidence: 0.95, movementCost: 2.0, risk: 1.0 };
  const cosmetic1 = { id: 'opp_norm_text_t1', type: OPPORTUNITY_TYPES.COSMETIC_TEXT_ISSUE, objectIds: ['t1'], visualBenefit: 3.0, confidence: 0.85, movementCost: 0.2, risk: 0.4 };
  const cosmetic2 = { id: 'opp_norm_text_t2', type: OPPORTUNITY_TYPES.COSMETIC_TEXT_ISSUE, objectIds: ['t2'], visualBenefit: 3.0, confidence: 0.85, movementCost: 0.2, risk: 0.4 };

  const res = rankAndSelectOpportunities([flowOpp, cosmetic1, cosmetic2], { totalObjectCount: 10 });
  const selectedCosmetic = res.selectedOpportunities.filter((o) => o.type === OPPORTUNITY_TYPES.COSMETIC_TEXT_ISSUE);
  assert.ok(selectedCosmetic.length <= 1);
  assert.ok(res.rejectedOpportunities.some((r) => r.reason.includes('suppressed in favor of higher-value structural cleanup')));
});

test('20. Clean board generates no unnecessary opportunities', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 240, top: 100, width: 100, height: 80 });
  const s3 = normalizeObject({ id: 's3', type: 'rect', left: 380, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1, s2, s3] } };

  const plan = buildCleanupPlan(null, model);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.untouchedObjectIds.length, 3);
});

test('21. Opportunity converts to correct Action type during resolution', () => {
  const oppFlow = { id: 'opp_f', type: OPPORTUNITY_TYPES.BROKEN_FLOW, objectIds: ['s1', 's2'], connectorIds: ['c1'], confidence: 0.95 };
  const oppAlign = { id: 'opp_a', type: OPPORTUNITY_TYPES.MISALIGNMENT, objectIds: ['s1', 's2'], axis: 'centerY', confidence: 0.92 };
  const oppSpace = { id: 'opp_s', type: OPPORTUNITY_TYPES.UNEVEN_SPACING, objectIds: ['s1', 's2', 's3'], axis: 'x', confidence: 0.93 };

  const actFlow = resolveCleanupOpportunity(oppFlow, {}).action;
  assert.equal(actFlow.type, 'cleanFlowchart');

  const actAlign = resolveCleanupOpportunity(oppAlign, {}).action;
  assert.equal(actAlign.type, 'align');

  const actSpace = resolveCleanupOpportunity(oppSpace, {}).action;
  assert.equal(actSpace.type, 'equalizeSpacing');
});

test('22. Unsupported resolution remains untouched without synthetic action', () => {
  const oppUnknown = { id: 'opp_u', type: 'unknownDisorderType', objectIds: ['x1'], confidence: 0.90 };
  const res = resolveCleanupOpportunity(oppUnknown, {});
  assert.equal(res.action, null);
  assert.ok(res.rejectedReason.includes('Unsupported opportunity type'));
});

test('23. Real-board mixed whiteboard opportunity detection', () => {
  const f1 = normalizeObject({ id: 'f1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const f2 = normalizeObject({ id: 'f2', type: 'rect', left: 300, top: 120, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 'f1', targetShapeId: 'f2', left: 200, top: 140, width: 100, height: 10 });
  const n1 = normalizeObject({ id: 'n1', type: 'note', isStickyNote: true, left: 100, top: 400, width: 150, height: 150 });
  const n2 = normalizeObject({ id: 'n2', type: 'note', isStickyNote: true, left: 280, top: 400, width: 150, height: 150 });
  const stroke = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 600, top: 600, width: 50, height: 50 });

  const scene = {
    groups: [
      { id: 'g_flow', type: 'flowchart', objectIds: ['f1', 'f2', 'c1'] },
      { id: 'g_notes', type: 'notes', objectIds: ['n1', 'n2'], purpose: 'Brainstorm' }
    ]
  };

  const model = { board: { objects: [f1, f2, conn, n1, n2, stroke] } };
  const plan = buildCleanupPlan(scene, model);

  assert.ok(plan.untouchedObjectIds.includes('st1'));
  assert.ok(plan.actions.some((a) => a.type === 'cleanFlowchart'));
  assert.ok(plan.actions.some((a) => a.type === 'arrangeGrid'));
});

test('24. Deterministic output across repeated plan builds', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 115, width: 100, height: 80 });
  const scene = { groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 's2'] }] };
  const model = { board: { objects: [s1, s2] } };

  const plan1 = buildCleanupPlan(scene, model);
  const plan2 = buildCleanupPlan(scene, model);

  assert.deepEqual(plan1.actions, plan2.actions);
  assert.deepEqual(plan1.untouchedObjectIds, plan2.untouchedObjectIds);
});

test('25. Input models remain immutable', () => {
  const s1 = Object.freeze(normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 }));
  const s2 = Object.freeze(normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 }));
  const scene = Object.freeze({
    groups: Object.freeze([{ id: 'g1', type: 'concept', objectIds: Object.freeze(['s1', 's2']) }])
  });
  const model = Object.freeze({ board: Object.freeze({ objects: Object.freeze([s1, s2]) }) });

  const plan = buildCleanupPlan(scene, model);
  assert.ok(plan);
  const res = executeCleanupPlan(plan, model);
  assert.ok(res);
});
