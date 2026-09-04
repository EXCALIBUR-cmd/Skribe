import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HIGH_CONFIDENCE,
  MEDIUM_CONFIDENCE,
  LOW_CONFIDENCE,
  validateCleanupPlan,
  assertValidCleanupPlan
} from './cleanupPlanTypes.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { normalizeObject } from './normalizeObjects.js';

test('1. Explicit connector graph produces cleanFlowchart', () => {
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

test('2. Nearby unrelated shapes do NOT produce flowchart', () => {
  const shapeA = normalizeObject({ id: 'shape_A', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const shapeB = normalizeObject({ id: 'shape_B', type: 'rect', left: 220, top: 100, width: 100, height: 80 });

  const model = { board: { objects: [shapeA, shapeB] } };
  const plan = buildCleanupPlan(null, model);

  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.equal(flowAction, undefined, 'No flowchart action for unrelated shapes without connectors');
});

test('3. Explicit source/target topology increases confidence', () => {
  const shapeA = normalizeObject({ id: 'shape_A', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const shapeB = normalizeObject({ id: 'shape_B', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const connExplicit = normalizeObject({
    id: 'conn_AB',
    type: 'path',
    isConnector: true,
    connectorType: 'straight',
    sourceShapeId: 'shape_A',
    targetShapeId: 'shape_B',
    left: 200, top: 140, width: 100, height: 10
  });

  const model = { board: { objects: [shapeA, shapeB, connExplicit] } };
  const plan = buildCleanupPlan(null, model);

  const flowAction = plan.actions.find((a) => a.type === 'cleanFlowchart');
  assert.ok(flowAction);
  assert.equal(flowAction.confidence, 0.96);
});

test('4. Isolated sticky does not produce arrangeGrid', () => {
  const note1 = normalizeObject({ id: 'note_solo', type: 'note', isStickyNote: true, left: 100, top: 100, width: 150, height: 150 });
  const model = { board: { objects: [note1] } };
  const plan = buildCleanupPlan(null, model);

  const gridAction = plan.actions.find((a) => a.type === 'arrangeGrid');
  assert.equal(gridAction, undefined, 'Single isolated note must not produce arrangeGrid');
});

test('5. Shared semantic sticky cluster can produce arrangeGrid', () => {
  const note1 = normalizeObject({ id: 'note_1', type: 'note', isStickyNote: true, left: 100, top: 100, width: 150, height: 150 });
  const note2 = normalizeObject({ id: 'note_2', type: 'note', isStickyNote: true, left: 280, top: 100, width: 150, height: 150 });
  const scene = {
    groups: [
      { id: 'group_brainstorm', type: 'notes', objectIds: ['note_1', 'note_2'], purpose: 'Brainstorming session' }
    ]
  };

  const model = { board: { objects: [note1, note2] } };
  const plan = buildCleanupPlan(scene, model);

  const gridAction = plan.actions.find((a) => a.type === 'arrangeGrid');
  assert.ok(gridAction, 'Explicit brainstorming group produces arrangeGrid');
  assert.deepEqual(gridAction.objectIds, ['note_1', 'note_2']);
  assert.ok(gridAction.evidence.includes('semantic-notes-group'));
});

test('6. Unrelated distant notes do not get grouped', () => {
  const note1 = normalizeObject({ id: 'note_left', type: 'note', isStickyNote: true, left: 100, top: 100, width: 150, height: 150 });
  const note2 = normalizeObject({ id: 'note_right', type: 'note', isStickyNote: true, left: 1500, top: 1200, width: 150, height: 150 });

  const model = { board: { objects: [note1, note2] } };
  const plan = buildCleanupPlan(null, model);

  const gridAction = plan.actions.find((a) => a.type === 'arrangeGrid');
  assert.equal(gridAction, undefined, 'Distant notes without semantic cluster must remain untouched');
});

test('7. Explicit shape group can produce align', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 105, width: 100, height: 80 });
  const scene = {
    groups: [
      { id: 'group_concepts', type: 'concept', objectIds: ['s1', 's2'] }
    ]
  };

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(scene, model);

  const alignAction = plan.actions.find((a) => a.type === 'align');
  assert.ok(alignAction, 'Near-horizontal shapes in concept group produce align');
  assert.equal(alignAction.axis, 'centerY');
  assert.deepEqual(alignAction.objectIds, ['s1', 's2']);
});

test('8. Unrelated distant shapes do not get aligned', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 400, width: 100, height: 80 });

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(null, model);

  const alignAction = plan.actions.find((a) => a.type === 'align');
  assert.equal(alignAction, undefined, 'Non-colinear shapes without grouping do not get aligned');
});

test('9. Standalone text can produce normalizeText', () => {
  const t = normalizeObject({ id: 'text_tilted', type: 'text', text: 'Standalone', left: 400, top: 300, width: 100, height: 24, rotation: 15 });
  const model = { board: { objects: [t] } };
  const plan = buildCleanupPlan(null, model);

  const normAction = plan.actions.find((a) => a.type === 'normalizeText');
  assert.ok(normAction);
  assert.deepEqual(normAction.objectIds, ['text_tilted']);
  assert.ok(normAction.evidence.includes('standalone-text-readability'));
});

test('10. Attached text does not produce standalone normalizeText', () => {
  const s = normalizeObject({ id: 'shape_1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 'text_1' } });
  const t = normalizeObject({ id: 'text_1', type: 'text', text: 'Label', left: 120, top: 130, width: 60, height: 20, rotation: 10, relationshipMetadata: { parentShapeId: 'shape_1' } });

  const model = { board: { objects: [s, t] } };
  const plan = buildCleanupPlan(null, model);

  const normAction = plan.actions.find((a) => a.type === 'normalizeText');
  assert.equal(normAction, undefined, 'Attached text must be handled by attachText, not standalone normalizeText');
  assert.ok(plan.actions.some((a) => a.type === 'attachText'));
});

test('11. Freehand remains preserve by default', () => {
  const stroke = normalizeObject({ id: 'stroke_1', type: 'stroke', isVectorStroke: true, left: 500, top: 500, width: 30, height: 30 });
  const model = { board: { objects: [stroke] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.untouchedObjectIds.includes('stroke_1'), 'Freehand strokes remain untouched by default');
  assert.equal(plan.actions.length, 0);
});

test('12. Ambiguous connector remains preserve', () => {
  const connAmbiguous = normalizeObject({
    id: 'conn_floating',
    type: 'path',
    isConnector: true,
    connectorType: 'curved',
    left: 800, top: 150, width: 120, height: 60
  });

  const model = { board: { objects: [connAmbiguous] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.untouchedObjectIds.includes('conn_floating'), 'Unconnected connector remains untouched');
  assert.equal(plan.actions.length, 0);
});

test('13. High-confidence actions are executable', () => {
  const s = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t = normalizeObject({ id: 't1', type: 'text', text: 'Hi', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });

  const model = { board: { objects: [s, t] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.actions.every((a) => a.confidence >= HIGH_CONFIDENCE));
});

test('14. Medium-confidence actions are not automatically executable and objects remain untouched', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 })
      ]
    }
  };

  const plan = buildCleanupPlan(null, model);
  assertValidCleanupPlan(plan, model);
  assert.ok(plan.actions.every((a) => a.confidence >= HIGH_CONFIDENCE));
});

test('15. Action conflicts remain rejected', () => {
  const plan = {
    version: 1,
    actions: [
      { id: 'a1', type: 'align', axis: 'y', objectIds: ['obj_1'], confidence: 0.95, reason: 'Align 1' },
      { id: 'a2', type: 'preserve', objectIds: ['obj_1'], confidence: 1.0, reason: 'Preserve 1' }
    ],
    untouchedObjectIds: [],
    diagnostics: {}
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, false, 'Simultaneous modifying and preserve action rejected');
});

test('16. Deterministic output across multiple runs', () => {
  const s = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80, relationshipMetadata: { attachedTextId: 't1' } });
  const t = normalizeObject({ id: 't1', type: 'text', text: 'Hi', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s, t] } };

  const p1 = buildCleanupPlan(null, model);
  const p2 = buildCleanupPlan(null, model);
  assert.deepEqual(p1, p2);
});

test('17. Immutability of input objects', () => {
  const s = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const model = { board: { objects: [s] } };
  const snapshot = JSON.stringify(model);

  buildCleanupPlan(null, model);
  assert.equal(JSON.stringify(model), snapshot);
});

test('18. Real-board CleanupPlan generation matches intent', () => {
  const sProc = normalizeObject({ id: 'shape_proc', type: 'path', shapeType: 'hexagon', left: 300, top: 200, width: 120, height: 80, relationshipMetadata: { attachedTextId: 'text_proc' } });
  const tProc = normalizeObject({ id: 'text_proc', type: 'text', text: 'Process', left: 320, top: 228, width: 100, height: 24, relationshipMetadata: { parentShapeId: 'shape_proc' } });
  const sDec = normalizeObject({ id: 'shape_dec', type: 'path', shapeType: 'diamond', left: 550, top: 200, width: 100, height: 90, relationshipMetadata: { attachedTextId: 'text_dec' } });
  const tDec = normalizeObject({ id: 'text_dec', type: 'text', text: 'Decision', left: 560, top: 233, width: 80, height: 24, relationshipMetadata: { parentShapeId: 'shape_dec' } });
  const conn = normalizeObject({ id: 'conn_1', type: 'path', isConnector: true, connectorType: 'straight', sourceShapeId: 'shape_proc', targetShapeId: 'shape_dec', left: 420, top: 240, width: 130, height: 10, endArrow: true });

  const model = { board: { objects: [sProc, tProc, sDec, tDec, conn] } };
  const plan = buildCleanupPlan(null, model);

  assert.ok(plan.actions.some((a) => a.type === 'cleanFlowchart'));
  assert.equal(plan.actions.filter((a) => a.type === 'attachText').length, 2);
});

test('19. Object coverage accounts for 100% of workspace objects', () => {
  const objects = [
    normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 }),
    normalizeObject({ id: 't1', type: 'text', text: 'T1', left: 400, top: 400, width: 50, height: 20 }),
    normalizeObject({ id: 'st1', type: 'stroke', isVectorStroke: true, left: 600, top: 600, width: 20, height: 20 })
  ];
  const model = { board: { objects } };
  const plan = buildCleanupPlan(null, model);

  const allCoveredIds = new Set([
    ...plan.actions.flatMap((a) => a.objectIds),
    ...plan.actions.flatMap((a) => a.connectorIds || []),
    ...plan.untouchedObjectIds
  ]);

  objects.forEach((o) => {
    assert.ok(allCoveredIds.has(o.id), `Object ${o.id} must be covered in plan or untouched`);
  });
});

test('20. No unnecessary actions generated', () => {
  const objects = [
    normalizeObject({ id: 'divider', type: 'path', isSkribeLine: true, isStraightLine: true, left: 950, top: 100, width: 2, height: 400 }),
    normalizeObject({ id: 'doodle', type: 'stroke', isVectorStroke: true, left: 200, top: 200, width: 30, height: 30 })
  ];
  const model = { board: { objects } };
  const plan = buildCleanupPlan(null, model);

  assert.equal(plan.actions.length, 0, 'No actions for divider and doodle');
  assert.equal(plan.untouchedObjectIds.length, 2);
});
