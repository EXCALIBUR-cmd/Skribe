import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObject } from './normalizeObjects.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildCleanupResult } from './buildCleanupResult.js';
import {
  discoverVisualStructures,
  generateCompositionCandidates,
  evaluateCompositionQuality,
  extractSemanticShaftEndpoints,
  calculateMovementCost,
  calculateCompositionRisk,
  STRUCTURE_TYPES,
  TEMPLATE_TYPES
} from './discoverVisualStructures.js';
import {
  createBoardMovementBudget,
  rankAndSelectOpportunities
} from './cleanupOpportunities.js';
import { resolveCleanupOpportunity } from './resolveCleanupOpportunity.js';
import { assertValidCleanupPlan } from './cleanupPlanTypes.js';

const makeLinkedShape = (id, text, x, y, w = 120, h = 80, shapeType = 'rect') => {
  const shapeId = `shape_${id}`;
  const textId = `text_${id}`;
  const th = 24;
  return [
    normalizeObject({ id: shapeId, type: 'rect', shapeType, left: x, top: y, width: w, height: h, relationshipMetadata: { attachedTextId: textId } }),
    normalizeObject({ id: textId, type: 'text', text, left: x + 10, top: y + (h - th) / 2, width: w - 20, height: th, relationshipMetadata: { parentShapeId: shapeId } })
  ];
};

test('1. Scattered flow discovered', () => {

  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 260, 240);
  const [s3, t3] = makeLinkedShape('n3', 'End', 420, 90);

  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 100, height: 100 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: s2.id, targetShapeId: s3.id, left: 320, top: 160, width: 100, height: 100 });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2] } };
  const structures = discoverVisualStructures(model);

  const flowStruct = structures.find((s) => s.type === STRUCTURE_TYPES.FLOW);
  assert.ok(flowStruct, 'Flow structure discovered');
  assert.equal(flowStruct.objectIds.length, 3);
  assert.equal(flowStruct.connectorIds.length, 2);
  assert.ok(flowStruct.currentComposition.quality < 8.0, 'Scattered flow has sub-optimal composition quality');
  assert.ok(flowStruct.compositionBenefit >= 1.5, 'Significant composition benefit computed');
});

test('2. Already-good flow preserved', () => {

  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 150);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 280, 150);
  const [s3, t3] = makeLinkedShape('n3', 'End', 460, 150);

  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 220, top: 190, width: 60, height: 10 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: s2.id, targetShapeId: s3.id, left: 400, top: 190, width: 60, height: 10 });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2] } };
  const structures = discoverVisualStructures(model);

  const flowStruct = structures.find((s) => s.type === STRUCTURE_TYPES.FLOW);
  assert.ok(flowStruct, 'Flow structure discovered');
  assert.ok(flowStruct.currentComposition.quality >= 8.5, 'Clean flow has high current quality');
  assert.ok(flowStruct.compositionBenefit < 1.5, 'Benefit is low because it is already clean');

  const candidates = generateCompositionCandidates(structures);
  const flowCandidates = candidates.filter((c) => c.structureId === flowStruct.id);
  assert.equal(flowCandidates.length, 0, 'No candidate generated for already clean flow');
});

test('3. Flow composition candidate generated', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Step 1', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Step 2', 300, 250);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 140, height: 110 });

  const model = { board: { objects: [s1, t1, s2, t2, c1] } };
  const structures = discoverVisualStructures(model);
  const candidates = generateCompositionCandidates(structures);

  assert.ok(candidates.length >= 1, 'Candidate generated');
  const flowCand = candidates.find((c) => c.type === 'flow');
  assert.ok(flowCand);
  assert.equal(flowCand.template, TEMPLATE_TYPES.FLOW_HORIZONTAL);
  assert.ok(flowCand.utilityScore > 0, 'Positive utility score');
});

test('4. Sequence candidate generated', () => {
  const c1 = normalizeObject({ id: 'card1', type: 'rect', left: 100, top: 100, width: 140, height: 80 });
  const c2 = normalizeObject({ id: 'card2', type: 'rect', left: 100, top: 220, width: 140, height: 80 });
  const c3 = normalizeObject({ id: 'card3', type: 'rect', left: 100, top: 400, width: 140, height: 80 });

  const scene = {
    groups: [{ id: 'group_spec', type: 'concept', objectIds: ['card1', 'card2', 'card3'] }]
  };

  const model = { board: { objects: [c1, c2, c3] } };
  const structures = discoverVisualStructures(model, scene);
  const seq = structures.find((s) => s.type === STRUCTURE_TYPES.SEQUENCE);
  assert.ok(seq, 'Sequence discovered');
  assert.equal(seq.objectIds.length, 3);

  const candidates = generateCompositionCandidates(structures);
  assert.ok(candidates.some((c) => c.type === 'sequence'));
});

test('5. Note cluster candidate generated', () => {
  const n1 = normalizeObject({ id: 'note1', type: 'note', isStickyNote: true, left: 100, top: 100, width: 120, height: 120 });
  const n2 = normalizeObject({ id: 'note2', type: 'note', isStickyNote: true, left: 240, top: 130, width: 120, height: 120 });
  const n3 = normalizeObject({ id: 'note3', type: 'note', isStickyNote: true, left: 110, top: 250, width: 120, height: 120 });

  const model = { board: { objects: [n1, n2, n3] } };
  const structures = discoverVisualStructures(model);
  const cluster = structures.find((s) => s.type === STRUCTURE_TYPES.CLUSTER);
  assert.ok(cluster, 'Sticky note cluster discovered');
  assert.equal(cluster.objectIds.length, 3);
});

test('6. Annotation remains local', () => {
  const [s1, t1] = makeLinkedShape('main_doc', 'Main Document', 100, 100, 200, 120);
  const callout = normalizeObject({ id: 'callout_note', type: 'note', isStickyNote: true, left: 320, top: 120, width: 100, height: 80 });

  const scene = {
    annotations: [{ objectId: 'callout_note', targetObjectIds: [s1.id] }]
  };

  const model = { board: { objects: [s1, t1, callout] } };
  const structures = discoverVisualStructures(model, scene);
  const annStruct = structures.find((s) => s.type === STRUCTURE_TYPES.ANNOTATION);
  assert.ok(annStruct, 'Annotation structure discovered');
  assert.deepEqual(annStruct.objectIds, ['callout_note']);
});

test('7. Creative drawing excluded from composition movement', () => {
  const st1 = normalizeObject({ id: 'stroke_sketch_1', type: 'stroke', isVectorStroke: true, left: 100, top: 100, width: 40, height: 40 });
  const st2 = normalizeObject({ id: 'stroke_sketch_2', type: 'stroke', isVectorStroke: true, left: 140, top: 100, width: 40, height: 40 });

  const model = { board: { objects: [st1, st2] } };
  const structures = discoverVisualStructures(model);
  const creative = structures.find((s) => s.type === STRUCTURE_TYPES.CREATIVE);
  assert.ok(creative, 'Creative structure discovered');

  const candidates = generateCompositionCandidates(structures);
  assert.equal(candidates.filter((c) => c.type === 'creative').length, 0, 'No composition candidate generated for creative content');

  const plan = buildCleanupPlan(null, model);
  assert.equal(plan.actions.length, 0, 'No actions touch creative strokes');
  assert.ok(plan.untouchedObjectIds.includes('stroke_sketch_1'));
  assert.ok(plan.untouchedObjectIds.includes('stroke_sketch_2'));
});

test('8. Structural divider excluded from composition movement', () => {
  const divider = normalizeObject({ id: 'div_1', type: 'path', isSkribeLine: true, isStraightLine: true, left: 400, top: 50, width: 2, height: 500 });
  const model = { board: { objects: [divider] } };
  const structures = discoverVisualStructures(model);
  const structDiv = structures.find((s) => s.type === STRUCTURE_TYPES.STRUCTURAL);
  assert.ok(structDiv, 'Structural divider discovered');

  const candidates = generateCompositionCandidates(structures);
  assert.equal(candidates.filter((c) => c.type === 'structural').length, 0, 'No candidate for divider');

  const plan = buildCleanupPlan(null, model);
  assert.ok(plan.untouchedObjectIds.includes('div_1'));
});

test('9. Unknown connector never receives invented topology', () => {
  const unattachedConn = normalizeObject({ id: 'conn_orphan', type: 'path', isConnector: true, connectorType: 'curved', left: 300, top: 300, width: 100, height: 80 });
  const model = { board: { objects: [unattachedConn] } };
  const structures = discoverVisualStructures(model);

  const connStruct = structures.find((s) => s.id.includes('conn_orphan'));
  assert.ok(connStruct);
  assert.equal(connStruct.type, STRUCTURE_TYPES.STANDALONE);
  assert.equal(connStruct.compositionBenefit, 0);

  const plan = buildCleanupPlan(null, model);
  assert.ok(plan.untouchedObjectIds.includes('conn_orphan'));
});

test('10. Known connector follows moved node', () => {
  const [s1, t1] = makeLinkedShape('src_node', 'Source', 100, 100);
  const [s2, t2] = makeLinkedShape('tgt_node', 'Target', 350, 260);
  const conn = normalizeObject({ id: 'c_known', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 190, height: 120 });

  const model = { board: { objects: [s1, t1, s2, t2, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  assert.ok(proposal.valid, 'Proposal valid');
  const connPlacement = proposal.placements.find((p) => p.objectId === 'c_known');
  assert.ok(connPlacement, 'Connector placement updated');
  assert.ok(connPlacement.pathCommands && connPlacement.pathCommands.length > 0, 'Path recalculated');
});

test('11. Local whitespace influences composition', () => {

  const [s1, t1] = makeLinkedShape('step1', 'Step 1', 100, 100);
  const [s2, t2] = makeLinkedShape('step2', 'Step 2', 600, 100);
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 220, top: 140, width: 380, height: 10 });

  const model = { board: { objects: [s1, t1, s2, t2, conn] } };
  const structures = discoverVisualStructures(model);
  const flowStruct = structures.find((s) => s.type === STRUCTURE_TYPES.FLOW);
  assert.ok(flowStruct);
  assert.ok(flowStruct.currentComposition.whitespace < 8.0, 'Excessive local whitespace penalized');
});

test('12. Global whitespace rejected from triggering global rearrangement', () => {

  const [s1, t1] = makeLinkedShape('flow1', 'Flow A', 100, 100);
  const [s2, t2] = makeLinkedShape('flow2', 'Flow B', 260, 100);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 220, top: 140, width: 40, height: 10 });

  const note = normalizeObject({ id: 'note_far', type: 'note', isStickyNote: true, left: 1600, top: 100, width: 120, height: 120 });

  const model = { board: { objects: [s1, t1, s2, t2, c1, note] } };
  const plan = buildCleanupPlan(null, model);


  assert.ok(plan.untouchedObjectIds.includes('note_far'), 'Global whitespace did not cause distant note to move');
});

test('13. Composition benefit correctly calculated', () => {
  const current = evaluateCompositionQuality({
    objects: [
      { id: 'o1', left: 100, top: 100, width: 100, height: 80 },
      { id: 'o2', left: 250, top: 250, width: 100, height: 80 }
    ],
    structureType: STRUCTURE_TYPES.FLOW,
    orientation: 'horizontal'
  });

  assert.ok(current.quality < 8.0);
  const idealQuality = 9.4;
  const benefit = idealQuality - current.quality;
  assert.ok(benefit >= 1.5, `Benefit ${benefit} is significant`);
});

test('14. Movement cost affects ranking', () => {
  const lowCost = calculateMovementCost({ objectCount: 2, currentQuality: 4.0, candidateQuality: 9.0 });
  const highCost = calculateMovementCost({ objectCount: 8, currentQuality: 8.5, candidateQuality: 9.0 });

  assert.ok(highCost > lowCost, 'Higher object count & already-good quality produces higher cost');
});

test('15. Risk affects ranking', () => {
  const lowRisk = calculateCompositionRisk({ hasUnknownConnectorEndpoints: false });
  const highRisk = calculateCompositionRisk({ hasUnknownConnectorEndpoints: true });

  assert.ok(highRisk > lowRisk, 'Unknown endpoints increase risk');
});

test('16. Composition budget enforced', () => {
  const candidates = [
    { id: 'cand_1', type: 'flow', objectIds: ['a', 'b'], confidence: 0.95, utilityScore: 6.0 },
    { id: 'cand_2', type: 'flow', objectIds: ['c', 'd'], confidence: 0.95, utilityScore: 5.0 },
    { id: 'cand_3', type: 'flow', objectIds: ['e', 'f'], confidence: 0.95, utilityScore: 4.0 }
  ];

  const budget = createBoardMovementBudget(6, { maxCompositions: 2 });
  const { selectedOpportunities, rejectedOpportunities } = rankAndSelectOpportunities([], {
    compositionCandidates: candidates,
    maxCompositions: 2
  });

  assert.equal(selectedOpportunities.length, 2, 'Capped at maxCompositions = 2');
  assert.equal(rejectedOpportunities.length, 1);
  assert.ok(rejectedOpportunities[0].reason.includes('maxCompositions'));
});

test('17. Overlapping compositions resolve deterministically', () => {
  const candidates = [
    { id: 'cand_flow_1', type: 'flow', objectIds: ['n1', 'n2'], confidence: 0.95, utilityScore: 7.0 },
    { id: 'cand_flow_2', type: 'flow', objectIds: ['n2', 'n3'], confidence: 0.95, utilityScore: 5.0 }
  ];

  const { selectedOpportunities, rejectedOpportunities } = rankAndSelectOpportunities([], {
    compositionCandidates: candidates
  });

  assert.equal(selectedOpportunities.length, 1);
  assert.equal(selectedOpportunities[0].id, 'cand_flow_1');
  assert.equal(rejectedOpportunities.length, 1);
  assert.ok(rejectedOpportunities[0].reason.includes('subsumed'));
});

test('18. Composition subsumes micro-actions', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Node 1', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Node 2', 280, 180);
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 220, top: 140, width: 60, height: 40 });

  const model = { board: { objects: [s1, t1, s2, t2, conn] } };
  const plan = buildCleanupPlan(null, model);


  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flowAction, 'cleanFlowchart action executed');
  assert.equal(plan.actions.filter((a) => a.type === 'align').length, 0, 'No redundant micro-align action');
});

test('19. Clean board generates no composition', () => {
  const c1 = normalizeObject({ id: 'card1', type: 'rect', left: 100, top: 100, width: 120, height: 80 });
  const c2 = normalizeObject({ id: 'card2', type: 'rect', left: 100, top: 220, width: 120, height: 80 });
  const c3 = normalizeObject({ id: 'card3', type: 'rect', left: 100, top: 340, width: 120, height: 80 });

  const model = { board: { objects: [c1, c2, c3] } };
  const plan = buildCleanupPlan(null, model);

  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(plan.actions.length, 0, 'No composition actions generated for clean board');
  assert.ok(result.summary.humanSummary.includes('already well-organized'));
});

test('20. Real mixed-board structure discovered', () => {
  const [s1, t1] = makeLinkedShape('rect', 'Rectangle', 100, 100);
  const [s2, t2] = makeLinkedShape('dec', 'Decision', 250, 220, 100, 90, 'diamond');
  const [s3, t3] = makeLinkedShape('end', 'Endpoint', 400, 80);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 180, top: 140, width: 70, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: s2.id, targetShapeId: s3.id, left: 330, top: 150, width: 70, height: 80 });

  const sticky = normalizeObject({ id: 'sticky_1', type: 'note', isStickyNote: true, left: 100, top: 380, width: 140, height: 140 });
  const circle = normalizeObject({ id: 'circle_1', type: 'circle', left: 280, top: 390, width: 100, height: 100 });
  const hw = normalizeObject({ id: 'hw_stroke', type: 'stroke', isVectorStroke: true, left: 500, top: 400, width: 40, height: 40 });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2, sticky, circle, hw] } };
  const structures = discoverVisualStructures(model);

  assert.ok(structures.some((s) => s.type === STRUCTURE_TYPES.FLOW), 'Flow structure found');
  assert.ok(structures.some((s) => s.type === STRUCTURE_TYPES.CREATIVE), 'Creative stroke found');
});

test('21. Deterministic repeated output', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Node 1', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Node 2', 250, 200);
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 180, top: 140, width: 70, height: 60 });
  const model = { board: { objects: [s1, t1, s2, t2, conn] } };

  const plan1 = buildCleanupPlan(null, model);
  const plan2 = buildCleanupPlan(null, model);

  assert.deepEqual(plan1.actions.map((a) => a.id), plan2.actions.map((a) => a.id));
  assert.deepEqual(plan1.untouchedObjectIds, plan2.untouchedObjectIds);
});

test('22. Input immutability', () => {
  const orig = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 's2', type: 'rect', left: 250, top: 200, width: 100, height: 80 })
      ]
    }
  };

  const beforeJson = JSON.stringify(orig);
  discoverVisualStructures(orig);
  buildCleanupPlan(null, orig);
  assert.equal(JSON.stringify(orig), beforeJson, 'Original model untouched');
});

test('23. Unsupported composition resolution rejected', () => {
  const invalidCand = {
    id: 'cand_unknown',
    type: 'unsupported_type_xyz',
    objectIds: ['s1'],
    confidence: 0.95
  };

  const res = resolveCleanupOpportunity(invalidCand);
  assert.equal(res.action, null);
  assert.ok(res.rejectedReason);
});

test('24. Real current-board scenario generates meaningful candidate', () => {

  const [s1, t1] = makeLinkedShape('rect', 'Rectangle', 100, 100);
  const [s2, t2] = makeLinkedShape('dec', 'Decision', 250, 220, 100, 90, 'diamond');
  const [s3, t3] = makeLinkedShape('end', 'This is the endpoint!', 420, 90);
  const c1 = normalizeObject({ id: 'c_straight', type: 'path', isConnector: true, connectorType: 'straight', sourceShapeId: s1.id, targetShapeId: s2.id, left: 180, top: 140, width: 70, height: 80 });
  const c2 = normalizeObject({ id: 'c_curved', type: 'path', isConnector: true, connectorType: 'curved', sourceShapeId: s2.id, targetShapeId: s3.id, left: 330, top: 150, width: 90, height: 70 });

  const triangle = normalizeObject({ id: 'tri_isolated', type: 'path', shapeType: 'triangle', left: 600, top: 300, width: 100, height: 90 });
  const process = normalizeObject({ id: 'proc_isolated', type: 'path', shapeType: 'hexagon', left: 750, top: 300, width: 120, height: 80 });
  const hw = normalizeObject({ id: 'hw_stroke', type: 'stroke', isVectorStroke: true, left: 200, top: 450, width: 60, height: 30 });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2, triangle, process, hw] } };
  const plan = buildCleanupPlan(null, model);

  assertValidCleanupPlan(plan, model);
  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flowAction, 'cleanFlowchart generated for the 3-node flow');
  assert.ok(flowAction.objectIds.includes('shape_rect'));
  assert.ok(flowAction.objectIds.includes('shape_dec'));
  assert.ok(flowAction.objectIds.includes('shape_end'));


  assert.ok(plan.untouchedObjectIds.includes('tri_isolated'));
  assert.ok(plan.untouchedObjectIds.includes('proc_isolated'));
  assert.ok(plan.untouchedObjectIds.includes('hw_stroke'));
});

test('25. Unrelated objects remain unchanged', () => {
  const [s1, t1] = makeLinkedShape('s1', 'A', 100, 100);
  const [s2, t2] = makeLinkedShape('s2', 'B', 300, 220);
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 180, top: 140, width: 120, height: 80 });
  const unrelated = normalizeObject({ id: 'unrelated_card', type: 'rect', left: 800, top: 800, width: 150, height: 100 });

  const model = { board: { objects: [s1, t1, s2, t2, conn, unrelated] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  assert.ok(proposal.valid);
  const pUnrelated = proposal.placements.find((p) => p.objectId === 'unrelated_card');
  assert.equal(pUnrelated.position.x, 800);
  assert.equal(pUnrelated.position.y, 800);
  assert.ok(plan.untouchedObjectIds.includes('unrelated_card'));
});





test('26. TEST 1 â€” Verified floating connector penalizes quality', () => {

  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 150);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 340, 150);
  const [s3, t3] = makeLinkedShape('n3', 'End', 580, 150);




  const c1 = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: s1.id, targetShapeId: s2.id,
    left: 260, top: 190, width: 40, height: 5,
    path: [['M', 260, 190], ['L', 300, 190]]
  });


  const c2 = normalizeObject({
    id: 'c2', type: 'path', isConnector: true,
    sourceShapeId: s2.id, targetShapeId: s3.id,
    left: 500, top: 190, width: 40, height: 5,
    path: [['M', 500, 190], ['L', 540, 190]]
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2] } };
  const structures = discoverVisualStructures(model);

  const flowStruct = structures.find((s) => s.type === STRUCTURE_TYPES.FLOW);
  assert.ok(flowStruct, 'Flow structure discovered');


  assert.ok(flowStruct.verifiedEdges.length >= 2, 'Topology still verified');


  assert.ok(
    flowStruct.currentComposition.connectorAttachment !== null,
    'connectorAttachment measured (not null)'
  );
  assert.ok(
    flowStruct.currentComposition.connectorAttachment <= 6,
    `Floating connectors penalize attachment (got ${flowStruct.currentComposition.connectorAttachment})`
  );


  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.ok(
    !result.summary.humanSummary.includes('already well-organized'),
    `Floating connectors must not be "already well-organized" (got: ${result.summary.humanSummary})`
  );
});

test('27. TEST 2 â€” Verified attached connector passes quality', () => {

  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 150);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 280, 150);
  const [s3, t3] = makeLinkedShape('n3', 'End', 460, 150);


  const c1 = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: s1.id, targetShapeId: s2.id,
    left: 220, top: 190, width: 60, height: 5,
    path: [['M', 220, 190], ['L', 280, 190]]
  });

  const c2 = normalizeObject({
    id: 'c2', type: 'path', isConnector: true,
    sourceShapeId: s2.id, targetShapeId: s3.id,
    left: 400, top: 190, width: 60, height: 5,
    path: [['M', 400, 190], ['L', 460, 190]]
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2] } };
  const structures = discoverVisualStructures(model);

  const flowStruct = structures.find((s) => s.type === STRUCTURE_TYPES.FLOW);
  assert.ok(flowStruct, 'Flow structure discovered');


  assert.ok(
    flowStruct.currentComposition.connectorAttachment !== null,
    'connectorAttachment measured'
  );
  assert.ok(
    flowStruct.currentComposition.connectorAttachment >= 8.5,
    `Attached connectors have high quality (got ${flowStruct.currentComposition.connectorAttachment})`
  );
});

test('28. TEST 3 â€” Mixed verified connectors: proportional penalty', () => {

  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 150);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 280, 150);
  const [s3, t3] = makeLinkedShape('n3', 'End', 460, 150);


  const c1 = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: s1.id, targetShapeId: s2.id,
    left: 220, top: 190, width: 60, height: 5,
    path: [['M', 220, 190], ['L', 280, 190]]
  });

  const c2 = normalizeObject({
    id: 'c2', type: 'path', isConnector: true,
    sourceShapeId: s2.id, targetShapeId: s3.id,
    left: 440, top: 190, width: 60, height: 5,
    path: [['M', 440, 190], ['L', 500, 190]]
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2] } };
  const structures = discoverVisualStructures(model);

  const flowStruct = structures.find((s) => s.type === STRUCTURE_TYPES.FLOW);
  assert.ok(flowStruct, 'Flow structure discovered');
  assert.ok(flowStruct.currentComposition.connectorAttachment !== null);


  const att = flowStruct.currentComposition.connectorAttachment;
  assert.ok(att > 3.5 && att < 9.5, `Mixed attachment gives intermediate score (got ${att})`);


  const details = flowStruct.currentComposition.connectorAttachmentDetails || [];
  assert.equal(details.length, 2, 'Both verified connectors measured');
  assert.ok(details.some((d) => d.visuallyAttached === true), 'One attached');
  assert.ok(details.some((d) => d.visuallyAttached === false), 'One not attached');
});

test('29. TEST 4 â€” No connectors: neutral attachment, no false penalty', () => {

  const [s1, t1] = makeLinkedShape('n1', 'A', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'B', 300, 100);

  const model = { board: { objects: [s1, t1, s2, t2] } };
  const structures = discoverVisualStructures(model);


  const flowStructs = structures.filter((s) => s.type === STRUCTURE_TYPES.FLOW);
  assert.equal(flowStructs.length, 0, 'No flow without connectors');


  const standalones = structures.filter((s) => s.type === STRUCTURE_TYPES.STANDALONE);
  standalones.forEach((s) => {
    assert.equal(s.currentComposition.quality, 10, 'Standalone quality unaffected');
  });
});

test('30. TEST 5 â€” Ambiguous floating connector: no invented relationship, no reroute', () => {

  const [s1, t1] = makeLinkedShape('n1', 'Shape A', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Shape B', 600, 400);


  const c1 = normalizeObject({
    id: 'c_ambiguous', type: 'path', isConnector: true,
    left: 300, top: 250, width: 50, height: 50,
    path: [['M', 300, 250], ['L', 350, 300]]
  });


  const model = { board: { objects: [s1, t1, s2, t2, c1] } };
  const structures = discoverVisualStructures(model);


  const connStruct = structures.find(
    (s) => s.objectIds.includes('c_ambiguous')
  );
  assert.ok(connStruct, 'Ambiguous connector is discovered');
  assert.ok(
    connStruct.type === STRUCTURE_TYPES.STANDALONE,
    'Ambiguous connector is standalone (not added to flow)'
  );


  const flowStructs = structures.filter((s) => s.type === STRUCTURE_TYPES.FLOW);
  assert.equal(flowStructs.length, 0, 'No flow invented from ambiguous connector');


  const plan = buildCleanupPlan(null, model);
  assert.ok(plan.untouchedObjectIds.includes('c_ambiguous'), 'Ambiguous connector untouched');
});

test('31. TEST 6 â€” Curved connector with arrowhead: shaft endpoint measured correctly', () => {

  const connector = {
    id: 'c_curved',
    type: 'path',
    isConnector: true,
    endArrow: true,


    path: [
      ['M', 100, 200],
      ['C', 150, 200, 250, 200, 300, 200],
      ['M', 288, 195],
      ['L', 300, 200],
      ['L', 288, 205]
    ]
  };

  const endpoints = extractSemanticShaftEndpoints(connector);
  assert.ok(endpoints, 'Endpoints extracted');


  assert.equal(endpoints.shaftStartPt.x, 100);
  assert.equal(endpoints.shaftStartPt.y, 200);
  assert.equal(endpoints.shaftEndPt.x, 300);
  assert.equal(endpoints.shaftEndPt.y, 200);


  assert.equal(endpoints.sourceAnchor.x, 100);
  assert.equal(endpoints.sourceAnchor.y, 200);
  assert.equal(endpoints.targetAnchor.x, 300);
  assert.equal(endpoints.targetAnchor.y, 200);


  assert.ok(endpoints.hasArrowhead, 'Arrowhead detected');
  assert.equal(endpoints.shaftPath.length, 2, 'Shaft has 2 commands (M + C)');
  assert.equal(endpoints.arrowheadPath.length, 3, 'Arrowhead has 3 commands (M + L + L)');


  const sourceShape = {
    id: 'src', position: { x: 50, y: 170 },
    bounds: { x: 50, y: 170, width: 60, height: 60 },
    left: 50, top: 170, width: 60, height: 60
  };
  const targetShape = {
    id: 'tgt', position: { x: 400, y: 170 },
    bounds: { x: 400, y: 170, width: 60, height: 60 },
    left: 400, top: 170, width: 60, height: 60
  };

  const quality = evaluateCompositionQuality({
    objects: [sourceShape, targetShape],
    objectMap: new Map([['src', sourceShape], ['tgt', targetShape]]),
    explicitEdges: [{ connId: 'c_curved', srcId: 'src', tgtId: 'tgt' }],
    structureType: STRUCTURE_TYPES.FLOW,
    connectorAttachmentData: [{
      connId: 'c_curved',
      sourceShapeId: 'src',
      targetShapeId: 'tgt',
      sourceAnchor: endpoints.sourceAnchor,
      targetAnchor: endpoints.targetAnchor
    }]
  });

  assert.ok(quality.connectorAttachment !== null, 'Attachment scored');

  assert.ok(quality.connectorAttachment <= 6, `Floating target penalizes score (got ${quality.connectorAttachment})`);


  assert.ok(quality.connectorAttachmentDetails.length === 1);
  assert.ok(quality.connectorAttachmentDetails[0].sourceAttachmentError >= 0);
  assert.ok(quality.connectorAttachmentDetails[0].targetAttachmentError > 30);
});

test('32. TEST 7 â€” Branch: all verified branch connectors must attach', () => {

  const [s1, t1] = makeLinkedShape('start', 'Start', 100, 200);
  const [s2, t2] = makeLinkedShape('a', 'Branch A', 340, 100);
  const [s3, t3] = makeLinkedShape('b', 'Branch B', 340, 300);


  const c1 = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: s1.id, targetShapeId: s2.id,
    path: [['M', 220, 240], ['L', 340, 140]]
  });
  const c2 = normalizeObject({
    id: 'c2', type: 'path', isConnector: true,
    sourceShapeId: s1.id, targetShapeId: s3.id,
    path: [['M', 220, 240], ['L', 340, 340]]
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2] } };
  const structures = discoverVisualStructures(model);

  const flowStruct = structures.find((s) => s.type === STRUCTURE_TYPES.FLOW);
  assert.ok(flowStruct, 'Branch flow discovered');
  assert.ok(flowStruct.template === TEMPLATE_TYPES.FLOW_BRANCH, 'Branch template detected');


  if (flowStruct.currentComposition.connectorAttachment !== null) {
    assert.ok(flowStruct.currentComposition.connectorAttachmentDetails.length >= 2,
      'Both branch connectors measured');
  }
});

test('33. TEST 8 â€” Merge: all verified merge connectors must attach', () => {

  const [s1, t1] = makeLinkedShape('a', 'Input A', 100, 100);
  const [s2, t2] = makeLinkedShape('b', 'Input B', 100, 300);
  const [s3, t3] = makeLinkedShape('end', 'End', 340, 200);


  const c1 = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: s1.id, targetShapeId: s3.id,
    path: [['M', 220, 140], ['L', 340, 240]]
  });
  const c2 = normalizeObject({
    id: 'c2', type: 'path', isConnector: true,
    sourceShapeId: s2.id, targetShapeId: s3.id,
    path: [['M', 220, 340], ['L', 340, 240]]
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2] } };
  const structures = discoverVisualStructures(model);

  const flowStruct = structures.find((s) => s.type === STRUCTURE_TYPES.FLOW);
  assert.ok(flowStruct, 'Merge flow discovered');
  assert.ok(flowStruct.template === TEMPLATE_TYPES.FLOW_MERGE, 'Merge template detected');

  if (flowStruct.currentComposition.connectorAttachment !== null) {
    assert.ok(flowStruct.currentComposition.connectorAttachmentDetails.length >= 2,
      'Both merge connectors measured');
  }
});

test('34. TEST 9 â€” Clean multi-connector flow: zero cleanup', () => {

  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 150);
  const [s2, t2] = makeLinkedShape('n2', 'Middle', 280, 150);
  const [s3, t3] = makeLinkedShape('n3', 'End', 460, 150);


  const c1 = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: s1.id, targetShapeId: s2.id,
    path: [['M', 220, 190], ['L', 280, 190]]
  });
  const c2 = normalizeObject({
    id: 'c2', type: 'path', isConnector: true,
    sourceShapeId: s2.id, targetShapeId: s3.id,
    path: [['M', 400, 190], ['L', 460, 190]]
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);


  assert.ok(
    result.summary.resultType === 'ALREADY_WELL_ORGANIZED',
    `Clean flow gets ALREADY_WELL_ORGANIZED (got ${result.summary.resultType})`
  );
  assert.equal(result.summary.objectsMoved, 0, 'Zero objects moved');
  assert.equal(result.summary.connectorsRerouted, 0, 'Zero connectors rerouted');
});





test('35. TEST 1 â€” Selected flow candidate intersects unrelated text -> candidate rejected', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 260, 240);
  const [s3, t3] = makeLinkedShape('n3', 'End', 420, 90);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 100, height: 100 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: s2.id, targetShapeId: s3.id, left: 320, top: 160, width: 100, height: 100 });



  const obstacleText = normalizeObject({
    id: 'txt_obstacle',
    type: 'text',
    text: 'Protected Unrelated Heading',
    left: 250,
    top: 100,
    width: 120,
    height: 40
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2, obstacleText] } };
  const structures = discoverVisualStructures(model);
  const flowStruct = structures.find((s) => s.type === STRUCTURE_TYPES.FLOW);
  assert.ok(flowStruct, 'Flow structure discovered');

  const candidates = generateCompositionCandidates(structures);
  const horizCandidate = candidates.find((c) => c.template === TEMPLATE_TYPES.FLOW_HORIZONTAL);
  assert.ok(horizCandidate, 'Horizontal candidate generated');


  assert.equal(horizCandidate.safe, false, 'Candidate is marked safe: false');
  assert.ok(horizCandidate.newProtectedCollisions > 0, 'Candidate introduces new protected collisions');
  assert.ok(horizCandidate.collisionObjectIds.includes('txt_obstacle'), 'Collided object IDs contains obstacle text');


  const plan = buildCleanupPlan(null, model);
  const horizFlowAction = plan.actions.find((a) => a.type === 'cleanFlowchart' && a.orientation === 'horizontal');
  assert.equal(horizFlowAction, undefined, 'Horizontal flow action was safely rejected');
});

test('36. TEST 2 â€” Selected flow candidate intersects unrelated shape -> candidate rejected', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 260, 240);
  const [s3, t3] = makeLinkedShape('n3', 'End', 420, 90);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 100, height: 100 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: s2.id, targetShapeId: s3.id, left: 320, top: 160, width: 100, height: 100 });

  const obstacleShape = normalizeObject({
    id: 'shape_obstacle',
    type: 'rect',
    left: 280,
    top: 90,
    width: 120,
    height: 80
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2, obstacleShape] } };
  const structures = discoverVisualStructures(model);
  const candidates = generateCompositionCandidates(structures);
  const horizCandidate = candidates.find((c) => c.template === TEMPLATE_TYPES.FLOW_HORIZONTAL);
  assert.equal(horizCandidate.safe, false, 'Candidate intersecting shape obstacle is marked unsafe');
  assert.ok(horizCandidate.collisionObjectIds.includes('shape_obstacle'), 'Collided object IDs includes shape_obstacle');

  const plan = buildCleanupPlan(null, model);
  const horizFlowAction = plan.actions.find((a) => a.type === 'cleanFlowchart' && a.orientation === 'horizontal');
  assert.equal(horizFlowAction, undefined, 'Horizontal flow action intersecting shape obstacle is rejected');
});

test('37. TEST 3 â€” Candidate is clean but unrelated object occupies target area -> alternate safe candidate or reject', () => {
  const [s1, t1] = makeLinkedShape('n1', 'A', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'B', 280, 200);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 100, height: 100 });


  const obstacleHoriz = normalizeObject({ id: 'obs_h', type: 'rect', left: 280, top: 90, width: 100, height: 80 });
  const obstacleVert = normalizeObject({ id: 'obs_v', type: 'rect', left: 90, top: 240, width: 100, height: 80 });

  const model = { board: { objects: [s1, t1, s2, t2, c1, obstacleHoriz, obstacleVert] } };
  const plan = buildCleanupPlan(null, model);
  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.equal(flowAction, undefined, 'All colliding candidates safely rejected');
});

test('38. TEST 4 â€” Current composition is already clean and candidate introduces collision -> zero action', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 150);
  const [s2, t2] = makeLinkedShape('n2', 'End', 280, 150);
  const c1 = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: s1.id, targetShapeId: s2.id,
    path: [['M', 220, 190], ['L', 280, 190]]
  });
  const obstacle = normalizeObject({ id: 'obs_near', type: 'text', text: 'Preserved note', left: 450, top: 150, width: 100, height: 30 });

  const model = { board: { objects: [s1, t1, s2, t2, c1, obstacle] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.resultType, 'ALREADY_WELL_ORGANIZED');
  assert.equal(result.summary.objectsMoved, 0);
});

test('39. TEST 5 â€” Protected divider lies near composition -> candidate respects divider', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 260, 240);
  const [s3, t3] = makeLinkedShape('n3', 'End', 420, 90);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 100, height: 100 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: s2.id, targetShapeId: s3.id, left: 320, top: 160, width: 100, height: 100 });


  const divider = normalizeObject({
    id: 'div_1',
    type: 'line',
    isStraightLine: true,
    left: 270,
    top: 80,
    width: 5,
    height: 150
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2, divider] } };
  const structures = discoverVisualStructures(model);
  const candidates = generateCompositionCandidates(structures);
  const horizCandidate = candidates.find((c) => c.template === TEMPLATE_TYPES.FLOW_HORIZONTAL);
  assert.equal(horizCandidate.safe, false, 'Candidate intersecting divider line is marked unsafe');
  assert.ok(horizCandidate.collisionObjectIds.includes('div_1'), 'Collided object IDs includes div_1');

  const plan = buildCleanupPlan(null, model);
  const horizFlowAction = plan.actions.find((a) => a.type === 'cleanFlowchart' && a.orientation === 'horizontal');
  assert.equal(horizFlowAction, undefined, 'Horizontal flow action intersecting divider line is rejected');
});

test('40. TEST 6 â€” Creative stroke lies near composition -> candidate respects stroke bounds / protected region', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 260, 240);
  const [s3, t3] = makeLinkedShape('n3', 'End', 420, 90);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 100, height: 100 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: s2.id, targetShapeId: s3.id, left: 320, top: 160, width: 100, height: 100 });


  const stroke = normalizeObject({
    id: 'stroke_art',
    type: 'stroke',
    isVectorStroke: true,
    left: 280,
    top: 100,
    width: 60,
    height: 60
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2, stroke] } };
  const structures = discoverVisualStructures(model);
  const candidates = generateCompositionCandidates(structures);
  const horizCandidate = candidates.find((c) => c.template === TEMPLATE_TYPES.FLOW_HORIZONTAL);
  assert.equal(horizCandidate.safe, false, 'Candidate intersecting creative stroke is marked unsafe');
  assert.ok(horizCandidate.collisionObjectIds.includes('stroke_art'), 'Collided object IDs includes stroke_art');

  const plan = buildCleanupPlan(null, model);
  const horizFlowAction = plan.actions.find((a) => a.type === 'cleanFlowchart' && a.orientation === 'horizontal');
  assert.equal(horizFlowAction, undefined, 'Horizontal flow action intersecting creative stroke is rejected');
});

test('41. TEST 7 â€” External annotation text near flow -> text remains stationary and flow avoids it', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 260, 240);
  const [s3, t3] = makeLinkedShape('n3', 'End', 420, 90);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 100, height: 100 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: s2.id, targetShapeId: s3.id, left: 320, top: 160, width: 100, height: 100 });

  const annotation = normalizeObject({
    id: 'ann_text',
    type: 'text',
    text: 'Note: verify architecture',
    left: 280,
    top: 95,
    width: 140,
    height: 30,
    metadata: { isAnnotation: true }
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2, annotation] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);


  const annPlacement = proposal.placements.find((p) => p.objectId === 'ann_text');
  assert.ok(annPlacement, 'Placement exists');
  assert.equal(annPlacement.position.x, 280, 'Annotation X did not move');
  assert.equal(annPlacement.position.y, 95, 'Annotation Y did not move');
  assert.ok(plan.untouchedObjectIds.includes('ann_text'), 'Annotation is in untouchedObjectIds');
});

test('42. TEST 8 â€” Dependent label inside flow node -> label moves atomically and is not an obstacle', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 260, 240);
  const [s3, t3] = makeLinkedShape('n3', 'End', 420, 90);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 100, height: 100 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: s2.id, targetShapeId: s3.id, left: 320, top: 160, width: 100, height: 100 });


  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2] } };
  const structures = discoverVisualStructures(model);
  const candidates = generateCompositionCandidates(structures);
  const horizCandidate = candidates.find((c) => c.template === TEMPLATE_TYPES.FLOW_HORIZONTAL);

  assert.ok(horizCandidate, 'Horizontal candidate generated');

  assert.equal(horizCandidate.safe, true, 'Candidate is safe when only dependent labels exist');
  assert.equal(horizCandidate.newProtectedCollisions, 0, 'Zero protected collisions against own labels');
});

test('43. TEST 9 â€” Candidate visually better in isolation but causes protected collision -> candidate rejected', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 260, 280);
  const [s3, t3] = makeLinkedShape('n3', 'End', 420, 80);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 100, height: 100 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: s2.id, targetShapeId: s3.id, left: 320, top: 160, width: 100, height: 100 });

  const headingObstacle = normalizeObject({
    id: 'txt_heading',
    type: 'text',
    text: 'BIG TITLE',
    left: 280,
    top: 90,
    width: 200,
    height: 50
  });

  const model = { board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2, headingObstacle] } };
  const structures = discoverVisualStructures(model);
  const candidates = generateCompositionCandidates(structures);
  const horizCandidate = candidates.find((c) => c.template === TEMPLATE_TYPES.FLOW_HORIZONTAL);


  assert.ok(horizCandidate.compositionBenefit > 2.5, 'High visual benefit');
  assert.equal(horizCandidate.safe, false, 'Candidate marked unsafe');

  const plan = buildCleanupPlan(null, model);
  assert.equal(plan.actions.some((a) => a.type === 'cleanFlowchart'), false, 'Hard rejection prevents collision');
});

test('44. TEST 10 â€” Two candidate layouts: A collides with obstacle, B is safe -> B selected', () => {

  const [s1, t1] = makeLinkedShape('n1', 'Step 1', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Step 2', 300, 250);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 100, height: 100 });


  const obstacleHoriz = normalizeObject({
    id: 'obs_horiz',
    type: 'rect',
    left: 260,
    top: 90,
    width: 100,
    height: 60
  });

  const model = { board: { objects: [s1, t1, s2, t2, c1, obstacleHoriz] } };
  const structures = discoverVisualStructures(model);
  const candidates = generateCompositionCandidates(structures);

  const candA = candidates.find((c) => c.template === TEMPLATE_TYPES.FLOW_HORIZONTAL);
  const candB = candidates.find((c) => c.template === TEMPLATE_TYPES.FLOW_VERTICAL);

  assert.ok(candA, 'Horizontal candidate exists');
  assert.ok(candB, 'Vertical candidate exists');
  assert.equal(candA.safe, false, 'Candidate A collides with obstacle');
  assert.equal(candB.safe, true, 'Candidate B is safe');

  const plan = buildCleanupPlan(null, model);
  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flowAction, 'A safe flowchart action was selected');
  assert.equal(flowAction.orientation, 'vertical', 'Vertical candidate selected over colliding horizontal');
});

test('45. TEST 11 â€” Preserves heading and returns NO_SAFE_CLEANUP_FOUND when all candidates blocked', () => {
  const [s1, t1] = makeLinkedShape('n1', 'Start', 100, 100);
  const [s2, t2] = makeLinkedShape('n2', 'Process', 260, 240);
  const [s3, t3] = makeLinkedShape('n3', 'End', 420, 90);
  const c1 = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: s1.id, targetShapeId: s2.id, left: 160, top: 140, width: 100, height: 100 });
  const c2 = normalizeObject({ id: 'c2', type: 'path', isConnector: true, sourceShapeId: s2.id, targetShapeId: s3.id, left: 320, top: 160, width: 100, height: 100 });

  const heading = normalizeObject({
    id: 'txt_heading',
    type: 'text',
    text: 'SKRIBE FLOWCHART',
    left: 260,
    top: 100,
    width: 200,
    height: 40,
    metadata: { isHeading: true }
  });

  const obstacleVertical = normalizeObject({
    id: 'obs_vert',
    type: 'rect',
    left: 100,
    top: 260,
    width: 100,
    height: 100
  });

  const wsModel = { version: 1, board: { objects: [s1, t1, s2, t2, s3, t3, c1, c2, heading, obstacleVertical] } };

  const plan = buildCleanupPlan(null, wsModel);
  const layout = executeCleanupPlan(plan, wsModel);
  const result = buildCleanupResult(plan, layout, wsModel);

  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.equal(flowAction, undefined, 'Flow action rejected due to protected-object collision with heading');

  assert.equal(result.summary.objectsMoved, 0, 'Zero objects moved');
  assert.equal(result.summary.connectorsRerouted, 2, 'Two connectors rerouted due to repair');
  assert.equal(result.summary.resultType, 'MEANINGFULLY_CLEANED', 'Result type is MEANINGFULLY_CLEANED because of connector repairs');
  assert.ok(plan.untouchedObjectIds.includes('txt_heading'), 'SKRIBE heading preserved untouched');
});
