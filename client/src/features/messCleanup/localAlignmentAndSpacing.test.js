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

test('1. Aligned semantic group produces align action', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'group_concepts', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);

  const alignAction = plan.actions.find((a) => a.type === 'align');
  assert.ok(alignAction, 'align action must be generated');
  assert.equal(alignAction.axis, 'centerY');
  assert.deepEqual(alignAction.objectIds, ['s1', 's2']);
  assert.ok(alignAction.confidence >= HIGH_CONFIDENCE);
});

test('2. Unrelated nearby shapes do NOT produce align action', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(null, model);

  assert.equal(plan.actions.find((a) => a.type === 'align'), undefined, 'Unrelated shapes must not align');
  assert.ok(plan.untouchedObjectIds.includes('s1'));
  assert.ok(plan.untouchedObjectIds.includes('s2'));
});

test('3. Co-linear requirement enforced (delta > 35px does not align)', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 200, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);

  assert.equal(plan.actions.find((a) => a.type === 'align'), undefined, 'Non-colinear objects must not align');
});

test('4. Semantic membership required for alignment', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 105, width: 100, height: 80 });

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(null, model);

  assert.equal(plan.actions.find((a) => a.type === 'align'), undefined);
});

test('5. Spacing inconsistency required for equalizeSpacing', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 200, height: 100 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 100, top: 230, width: 200, height: 100 });
  const c3 = normalizeObject({ id: 'c3', type: 'rect', left: 100, top: 410, width: 200, height: 100 });
  const scene = {
    groups: [{ id: 'group_cards', type: 'concept', objectIds: ['c1', 'c2', 'c3'] }]
  };

  const model = { board: { objects: [c1, c2, c3] } };
  const plan = buildCleanupPlan(scene, model);

  const spaceAction = plan.actions.find((a) => a.type === 'equalizeSpacing');
  assert.ok(spaceAction, 'equalizeSpacing must be generated');
  assert.equal(spaceAction.axis, 'y');
  assert.deepEqual(spaceAction.objectIds, ['c1', 'c2', 'c3']);
  assert.ok(spaceAction.evidence.includes('spacing-inconsistency'));
});

test('6. Negligible spacing differences produce NO equalizeSpacing action', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 200, height: 100 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 100, top: 240, width: 200, height: 100 });
  const c3 = normalizeObject({ id: 'c3', type: 'rect', left: 100, top: 382, width: 200, height: 100 });
  const scene = {
    groups: [{ id: 'group_cards', type: 'concept', objectIds: ['c1', 'c2', 'c3'] }]
  };

  const model = { board: { objects: [c1, c2, c3] } };
  const plan = buildCleanupPlan(scene, model);

  assert.equal(plan.actions.find((a) => a.type === 'equalizeSpacing'), undefined, 'Negligible gap difference must not trigger action');
});

test('7. Order is preserved during equalizeSpacing', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 100, top: 210, width: 100, height: 80 });
  const c3 = normalizeObject({ id: 'c3', type: 'rect', left: 100, top: 370, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'group_cards', type: 'concept', objectIds: ['c1', 'c2', 'c3'] }]
  };

  const model = { board: { objects: [c1, c2, c3] } };
  const plan = buildCleanupPlan(scene, model);
  const prop = executeCleanupPlan(plan, model);

  const p1 = prop.placements.find((p) => p.objectId === 'c1');
  const p2 = prop.placements.find((p) => p.objectId === 'c2');
  const p3 = prop.placements.find((p) => p.objectId === 'c3');

  assert.ok(p1.bounds.y < p2.bounds.y, 'c1 remains before c2');
  assert.ok(p2.bounds.y < p3.bounds.y, 'c2 remains before c3');
});

test('8. Axis X horizontal equalizeSpacing works correctly', () => {
  const h1 = normalizeObject({ id: 'h1', type: 'rect', left: 100, top: 200, width: 100, height: 60 });
  const h2 = normalizeObject({ id: 'h2', type: 'rect', left: 230, top: 200, width: 100, height: 60 });
  const h3 = normalizeObject({ id: 'h3', type: 'rect', left: 410, top: 200, width: 100, height: 60 });
  const scene = {
    groups: [{ id: 'group_h', type: 'concept', objectIds: ['h1', 'h2', 'h3'] }]
  };

  const model = { board: { objects: [h1, h2, h3] } };
  const plan = buildCleanupPlan(scene, model);

  const spaceAction = plan.actions.find((a) => a.type === 'equalizeSpacing');
  assert.ok(spaceAction);
  assert.equal(spaceAction.axis, 'x');

  const prop = executeCleanupPlan(plan, model);
  const p1 = prop.placements.find((p) => p.objectId === 'h1');
  const p2 = prop.placements.find((p) => p.objectId === 'h2');
  const p3 = prop.placements.find((p) => p.objectId === 'h3');

  const gap1 = p2.bounds.x - (p1.bounds.x + p1.bounds.width);
  const gap2 = p3.bounds.x - (p2.bounds.x + p2.bounds.width);
  assert.equal(Math.round(gap1), Math.round(gap2), 'Horizontal gaps equalized');
});

test('9. Axis Y vertical equalizeSpacing works correctly', () => {
  const v1 = normalizeObject({ id: 'v1', type: 'rect', left: 100, top: 100, width: 150, height: 80 });
  const v2 = normalizeObject({ id: 'v2', type: 'rect', left: 100, top: 200, width: 150, height: 80 });
  const v3 = normalizeObject({ id: 'v3', type: 'rect', left: 100, top: 360, width: 150, height: 80 });
  const scene = {
    groups: [{ id: 'group_v', type: 'concept', objectIds: ['v1', 'v2', 'v3'] }]
  };

  const model = { board: { objects: [v1, v2, v3] } };
  const plan = buildCleanupPlan(scene, model);
  const prop = executeCleanupPlan(plan, model);

  const p1 = prop.placements.find((p) => p.objectId === 'v1');
  const p2 = prop.placements.find((p) => p.objectId === 'v2');
  const p3 = prop.placements.find((p) => p.objectId === 'v3');

  const gap1 = p2.bounds.y - (p1.bounds.y + p1.bounds.height);
  const gap2 = p3.bounds.y - (p2.bounds.y + p2.bounds.height);
  assert.equal(Math.round(gap1), Math.round(gap2), 'Vertical gaps equalized');
});

test('10. Object size is unchanged by align or equalizeSpacing', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 120, height: 85 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 140, height: 95 });
  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);
  const prop = executeCleanupPlan(plan, model);

  const p1 = prop.placements.find((p) => p.objectId === 's1');
  const p2 = prop.placements.find((p) => p.objectId === 's2');

  assert.equal(p1.bounds.width, 120);
  assert.equal(p1.bounds.height, 85);
  assert.equal(p2.bounds.width, 140);
  assert.equal(p2.bounds.height, 95);
});

test('11. Rotation is unchanged by align or equalizeSpacing', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, rotation: 5 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80, rotation: 5 });
  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);
  const prop = executeCleanupPlan(plan, model);

  const p1 = prop.placements.find((p) => p.objectId === 's1');
  assert.equal(p1.rotation, 5);
});

test('12. Shape type is strictly preserved', () => {
  const s1 = normalizeObject({ id: 's1', type: 'path', shapeType: 'hexagon', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'path', shapeType: 'hexagon', left: 300, top: 110, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);
  const prop = executeCleanupPlan(plan, model);

  const p1 = prop.placements.find((p) => p.objectId === 's1');
  assert.equal(p1.shapeType, 'hexagon');
});

test('13. Semantic type is strictly preserved', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);
  const prop = executeCleanupPlan(plan, model);

  const p1 = prop.placements.find((p) => p.objectId === 's1');
  assert.equal(p1.semanticType, 'shape');
});

test('14. Atomic shape+label moves together rigidly during align', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = normalizeObject({ id: 't1', type: 'text', text: 'Label 1', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 120, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = normalizeObject({ id: 't2', type: 'text', text: 'Label 2', left: 320, top: 150, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's2' } });

  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, t1, s2, t2] } };
  const plan = buildCleanupPlan(scene, model);
  const prop = executeCleanupPlan(plan, model);

  const pS1 = prop.placements.find((p) => p.objectId === 's1');
  const pT1 = prop.placements.find((p) => p.objectId === 't1');

  const shapeCenterX = pS1.bounds.x + pS1.bounds.width / 2;
  const shapeCenterY = pS1.bounds.y + pS1.bounds.height / 2;
  const textCenterX = pT1.bounds.x + pT1.bounds.width / 2;
  const textCenterY = pT1.bounds.y + pT1.bounds.height / 2;

  assert.equal(Math.round(shapeCenterX), Math.round(textCenterX));
  assert.equal(Math.round(shapeCenterY), Math.round(textCenterY));
});

test('15. Atomic note+text moves together rigidly during equalizeSpacing', () => {
  const n1 = normalizeObject({ id: 'n1', type: 'note', isStickyNote: true, left: 100, top: 100, width: 120, height: 120, relationshipMetadata: { attachedTextId: 'tn1' } });
  const tn1 = normalizeObject({ id: 'tn1', type: 'text', text: 'N1', left: 110, top: 110, width: 100, height: 30, relationshipMetadata: { parentShapeId: 'n1' } });
  const n2 = normalizeObject({ id: 'n2', type: 'note', isStickyNote: true, left: 100, top: 230, width: 120, height: 120, relationshipMetadata: { attachedTextId: 'tn2' } });
  const tn2 = normalizeObject({ id: 'tn2', type: 'text', text: 'N2', left: 110, top: 240, width: 100, height: 30, relationshipMetadata: { parentShapeId: 'n2' } });
  const n3 = normalizeObject({ id: 'n3', type: 'note', isStickyNote: true, left: 100, top: 400, width: 120, height: 120, relationshipMetadata: { attachedTextId: 'tn3' } });
  const tn3 = normalizeObject({ id: 'tn3', type: 'text', text: 'N3', left: 110, top: 410, width: 100, height: 30, relationshipMetadata: { parentShapeId: 'n3' } });

  const scene = {
    groups: [{ id: 'group_notes', type: 'concept', objectIds: ['n1', 'n2', 'n3'] }]
  };

  const model = { board: { objects: [n1, tn1, n2, tn2, n3, tn3] } };
  const plan = buildCleanupPlan(scene, model);
  const prop = executeCleanupPlan(plan, model);

  const pN2 = prop.placements.find((p) => p.objectId === 'n2');
  const pTN2 = prop.placements.find((p) => p.objectId === 'tn2');

  assert.equal(Math.round(pN2.bounds.x + (pN2.bounds.width - pTN2.size.width) / 2), Math.round(pTN2.bounds.x));
  assert.equal(Math.round(pN2.bounds.y + (pN2.bounds.height - pTN2.size.height) / 2), Math.round(pTN2.bounds.y));
});

test('16. Freehand strokes remain untouched', () => {
  const stroke = normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 500, top: 500, width: 30, height: 30 });
  const model = { board: { objects: [stroke] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.untouchedObjectIds.includes('st1'));
  assert.equal(plan.actions.length, 0);
});

test('17. Structural divider remains untouched', () => {
  const div = normalizeObject({ id: 'line_div', type: 'path', isSkribeLine: true, isStraightLine: true, left: 400, top: 100, width: 2, height: 500 });
  const model = { board: { objects: [div] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.untouchedObjectIds.includes('line_div'));
  assert.equal(plan.actions.length, 0);
});

test('18. Connector dependency detected in flowchart', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);

  const flow = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flow);
  assert.deepEqual(flow.connectorIds, ['c1']);
});

test('19. Unsafe connector movement rejected (ambiguous connector stays untouched)', () => {
  const connFloating = normalizeObject({ id: 'conn_f', type: 'path', isConnector: true, connectorType: 'curved', left: 700, top: 200, width: 100, height: 50 });
  const model = { board: { objects: [connFloating] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.untouchedObjectIds.includes('conn_f'));
  assert.equal(plan.actions.length, 0);
});

test('20. Flowchart action does not conflict with generic align', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 105, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'c1', type: 'path', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2', left: 200, top: 140, width: 100, height: 10 });

  const scene = {
    groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['s1', 's2', 'c1'] }]
  };

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(scene, model);

  assert.ok(plan.actions.some((a) => a.type === 'cleanFlowchart'));
  assert.equal(plan.actions.find((a) => a.type === 'align'), undefined);
});

test('21. Duplicate action suppression prevents multiple actions modifying same axis', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 110, width: 100, height: 80 });
  const scene = {
    groups: [{ id: 'group_c', type: 'concept', objectIds: ['s1', 's2'] }]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);

  const alignActions = plan.actions.filter((a) => a.type === 'align');
  assert.equal(alignActions.length, 1);
});

test('22. Deterministic output across multiple runs', () => {
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

test('23. Input models remain immutable', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s1] } };
  const snap = JSON.stringify(model);

  buildCleanupPlan(null, model);
  assert.equal(JSON.stringify(model), snap);
});

test('24. Real-board section-card vertical spacing (Board 4)', () => {
  const sec1 = normalizeObject({ id: 'sec1_card', type: 'rect', left: 80, top: 130, width: 300, height: 100 });
  const sec2 = normalizeObject({ id: 'sec2_card', type: 'rect', left: 80, top: 250, width: 300, height: 100 });
  const sec3 = normalizeObject({ id: 'sec3_card', type: 'rect', left: 80, top: 410, width: 300, height: 100 });
  const scene = {
    groups: [{ id: 'group_spec_cards', type: 'concept', objectIds: ['sec1_card', 'sec2_card', 'sec3_card'] }]
  };

  const model = { board: { objects: [sec1, sec2, sec3] } };
  const plan = buildCleanupPlan(scene, model);

  const spaceAction = plan.actions.find((a) => a.type === 'equalizeSpacing');
  assert.ok(spaceAction, 'Section cards with 20px and 60px gaps produce equalizeSpacing action');
  assert.equal(spaceAction.axis, 'y');
  assert.deepEqual(spaceAction.objectIds, ['sec1_card', 'sec2_card', 'sec3_card']);
});

test('25. Real-board mixed-board alignment (Board 1)', () => {
  const tp = normalizeObject({ id: 'shape_tp', type: 'rect', shapeType: 'rounded_rect', left: 700, top: 350, width: 140, height: 80 });
  const to = normalizeObject({ id: 'shape_to', type: 'rect', shapeType: 'rounded_rect', left: 880, top: 358, width: 120, height: 60 });
  const scene = {
    groups: [{ id: 'group_testing', type: 'concept', objectIds: ['shape_tp', 'shape_to'] }]
  };

  const model = { board: { objects: [tp, to] } };
  const plan = buildCleanupPlan(scene, model);

  const alignAction = plan.actions.find((a) => a.type === 'align');
  assert.ok(alignAction, 'Slightly offset testing shapes produce align action');
  assert.equal(alignAction.axis, 'centerY');
});
