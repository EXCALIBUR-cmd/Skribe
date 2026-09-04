import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HIGH_CONFIDENCE,
  MEDIUM_CONFIDENCE,
  LOW_CONFIDENCE,
  SUPPORTED_ACTION_TYPES,
  validateCleanupPlan,
  assertValidCleanupPlan
} from './cleanupPlanTypes.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { normalizeObject } from './normalizeObjects.js';

test('1. Valid empty plan passes validation', () => {
  const plan = {
    version: 1,
    actions: [],
    untouchedObjectIds: [],
    diagnostics: {
      actionCount: 0,
      highConfidenceActionCount: 0,
      untouchedObjectCount: 0,
      unsupportedActionCount: 0
    }
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, true, 'Empty plan is valid');
  assert.equal(res.errors.length, 0);
});

test('2. Valid attachText action passes validation', () => {
  const workspaceModel = {
    board: {
      objects: [
        { id: 'shape_1', type: 'rect' },
        { id: 'text_1', type: 'text', text: 'Label' }
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      {
        id: 'act_1',
        type: 'attachText',
        objectIds: ['shape_1', 'text_1'],
        confidence: 0.99,
        reason: 'Text is explicitly attached to shape'
      }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const res = validateCleanupPlan(plan, workspaceModel);
  assert.equal(res.valid, true, 'attachText action is valid');
});

test('3. Valid align action passes validation', () => {
  const plan = {
    version: 1,
    actions: [
      {
        id: 'act_align_1',
        type: 'align',
        axis: 'centerY',
        objectIds: ['node_1', 'node_2', 'node_3'],
        confidence: 0.95,
        reason: 'Align nodes horizontally along center Y'
      }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, true, 'align action is valid');
});

test('4. Valid equalizeSpacing action passes validation', () => {
  const plan = {
    version: 1,
    actions: [
      {
        id: 'act_space_1',
        type: 'equalizeSpacing',
        axis: 'x',
        objectIds: ['col_1', 'col_2', 'col_3'],
        confidence: 0.92,
        reason: 'Equalize horizontal spacing between columns'
      }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, true, 'equalizeSpacing action is valid');
});

test('5. Valid arrangeGrid action passes validation', () => {
  const plan = {
    version: 1,
    actions: [
      {
        id: 'act_grid_1',
        type: 'arrangeGrid',
        objectIds: ['sticky_1', 'sticky_2', 'sticky_3', 'sticky_4'],
        confidence: 0.93,
        reason: 'Arrange sticky note brainstorming cluster into grid'
      }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, true, 'arrangeGrid action is valid');
});

test('6. Valid cleanFlowchart action passes validation', () => {
  const plan = {
    version: 1,
    actions: [
      {
        id: 'act_flow_1',
        type: 'cleanFlowchart',
        objectIds: ['step_1', 'step_2', 'decision_1'],
        connectorIds: ['conn_1', 'conn_2'],
        confidence: 0.97,
        reason: 'Clean up flowchart nodes and connector topology'
      }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, true, 'cleanFlowchart action is valid');
});

test('7. Valid normalizeText action passes validation', () => {
  const plan = {
    version: 1,
    actions: [
      {
        id: 'act_norm_1',
        type: 'normalizeText',
        objectIds: ['text_standalone_1'],
        confidence: 0.90,
        reason: 'Normalize rotated standalone text to horizontal orientation'
      }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, true, 'normalizeText action is valid');
});

test('8. Valid preserve action passes validation', () => {
  const plan = {
    version: 1,
    actions: [
      {
        id: 'act_pres_1',
        type: 'preserve',
        objectIds: ['doodle_1', 'doodle_2'],
        confidence: 1.0,
        reason: 'Preserve user freehand artwork untouched'
      }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, true, 'preserve action is valid');
});

test('9. Unknown action type is rejected', () => {
  const plan = {
    version: 1,
    actions: [
      {
        id: 'act_bad_1',
        type: 'redesignEntireBoard',
        objectIds: ['obj_1'],
        confidence: 0.9,
        reason: 'Invalid action type'
      }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 1 }
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, false, 'Unknown action type must be rejected');
  assert.ok(res.errors.some((e) => e.includes('unsupported action type')));
});

test('10. Unknown object ID not found in workspaceModel is rejected', () => {
  const workspaceModel = {
    board: {
      objects: [{ id: 'existing_1' }]
    }
  };

  const plan = {
    version: 1,
    actions: [
      {
        id: 'act_1',
        type: 'normalizeText',
        objectIds: ['non_existent_ghost_id'],
        confidence: 0.9,
        reason: 'Test ghost ID'
      }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const res = validateCleanupPlan(plan, workspaceModel);
  assert.equal(res.valid, false, 'Unknown object ID must be rejected');
  assert.ok(res.errors.some((e) => e.includes('unknown object ID')));
});

test('11. Missing required fields (id, type, confidence, reason, objectIds, axis) are rejected', () => {
  const planMissingFields = {
    version: 1,
    actions: [
      { id: '', type: 'align', objectIds: [], confidence: 'not-a-number', reason: '' }
    ],
    untouchedObjectIds: [],
    diagnostics: {}
  };

  const res = validateCleanupPlan(planMissingFields);
  assert.equal(res.valid, false, 'Missing required fields must fail validation');
  assert.ok(res.errors.length >= 4, 'Multiple missing field errors caught');
});

test('12. Confidence validation rejects values outside 0.0 to 1.0', () => {
  const planHigh = {
    version: 1,
    actions: [{ id: 'a1', type: 'preserve', objectIds: ['o1'], confidence: 1.5, reason: 'Too high' }],
    untouchedObjectIds: [],
    diagnostics: {}
  };
  const planNeg = {
    version: 1,
    actions: [{ id: 'a2', type: 'preserve', objectIds: ['o1'], confidence: -0.1, reason: 'Negative' }],
    untouchedObjectIds: [],
    diagnostics: {}
  };

  assert.equal(validateCleanupPlan(planHigh).valid, false, 'Confidence > 1.0 is rejected');
  assert.equal(validateCleanupPlan(planNeg).valid, false, 'Confidence < 0.0 is rejected');
});

test('13. Duplicate action IDs are rejected', () => {
  const plan = {
    version: 1,
    actions: [
      { id: 'duplicate_id', type: 'preserve', objectIds: ['o1'], confidence: 1.0, reason: 'First' },
      { id: 'duplicate_id', type: 'normalizeText', objectIds: ['o2'], confidence: 0.9, reason: 'Second' }
    ],
    untouchedObjectIds: [],
    diagnostics: {}
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, false, 'Duplicate action ID must be rejected');
  assert.ok(res.errors.some((e) => e.includes('Duplicate action ID')));
});

test('14. Coordinate fields (x, y, left, top, width, height, bounds, path) inside CleanupPlan are rejected', () => {
  const planWithCoords = {
    version: 1,
    actions: [
      {
        id: 'act_illegal_geom',
        type: 'align',
        axis: 'x',
        objectIds: ['o1'],
        confidence: 0.95,
        reason: 'Illegal geometry test',
        x: 150,
        y: 200,
        bounds: { left: 10, top: 10 }
      }
    ],
    untouchedObjectIds: [],
    diagnostics: {}
  };

  const res = validateCleanupPlan(planWithCoords);
  assert.equal(res.valid, false, 'Coordinate fields must be strictly rejected');
  assert.ok(res.errors.some((e) => e.includes('forbidden coordinate field')));
});

test('15. Deterministic output: running buildCleanupPlan multiple times produces identical output', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'shape_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 }),
        normalizeObject({ id: 'text_1', elementId: 'elem_1', type: 'text', text: 'Attached Label', left: 120, top: 140, width: 60, height: 20 }),
        normalizeObject({ id: 'text_rot', type: 'text', text: 'Rotated Standalone', left: 400, top: 400, width: 100, height: 20, angle: 15 }),
        normalizeObject({ id: 'stroke_1', type: 'stroke', isVectorStroke: true, left: 600, top: 100, width: 50, height: 50 })
      ]
    }
  };

  const plan1 = buildCleanupPlan(null, model);
  const plan2 = buildCleanupPlan(null, model);

  assert.deepEqual(plan1, plan2, 'Plan generation must be 100% deterministic');
});

test('16. Immutability: buildCleanupPlan does not mutate the input models', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 50, top: 50, width: 80, height: 80 })
      ]
    }
  };

  const snapshot = JSON.stringify(model);
  buildCleanupPlan(null, model);
  assert.equal(JSON.stringify(model), snapshot, 'Input model remains strictly unmutated');
});

test('17. Conflicting preserve and modifying action on the same object is rejected', () => {
  const plan = {
    version: 1,
    actions: [
      { id: 'a1', type: 'align', axis: 'x', objectIds: ['obj_conflict'], confidence: 0.9, reason: 'Align it' },
      { id: 'a2', type: 'preserve', objectIds: ['obj_conflict'], confidence: 1.0, reason: 'Preserve it' }
    ],
    untouchedObjectIds: [],
    diagnostics: {}
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, false, 'Simultaneous modify and preserve must be rejected');
  assert.ok(res.errors.some((e) => e.includes('Conflict: object') && e.includes('preserve')));
});

test('18. Conflicting align actions on the same axis for the same object are detected', () => {
  const plan = {
    version: 1,
    actions: [
      { id: 'a1', type: 'align', axis: 'centerY', objectIds: ['obj_x', 'obj_y'], confidence: 0.9, reason: 'Align group 1' },
      { id: 'a2', type: 'align', axis: 'centerY', objectIds: ['obj_x', 'obj_z'], confidence: 0.9, reason: 'Align group 2' }
    ],
    untouchedObjectIds: [],
    diagnostics: {}
  };

  const res = validateCleanupPlan(plan);
  assert.equal(res.valid, false, 'Conflicting duplicate alignment on same axis is detected');
  assert.ok(res.errors.some((e) => e.includes('Conflicting duplicate alignment')));
});

test('19. Unsupported / low-confidence objects remain in untouchedObjectIds', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'shape_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 }),
        normalizeObject({ id: 'text_1', elementId: 'elem_1', type: 'text', text: 'Label', left: 120, top: 140, width: 60, height: 20 }),
        normalizeObject({ id: 'unknown_doodle_1', type: 'stroke', isVectorStroke: true, left: 800, top: 800, width: 40, height: 40 })
      ]
    }
  };

  const plan = buildCleanupPlan(null, model);
  assert.ok(plan.untouchedObjectIds.includes('unknown_doodle_1'), 'Unknown doodle remains in untouchedObjectIds');
});

test('20. Object coverage diagnostics accurately report counts', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'shape_1', elementId: 'elem_1', type: 'rect', left: 100, top: 100, width: 100, height: 100 }),
        normalizeObject({ id: 'text_1', elementId: 'elem_1', type: 'text', text: 'Label', left: 120, top: 140, width: 60, height: 20 }),
        normalizeObject({ id: 'doodle_1', type: 'stroke', isVectorStroke: true, left: 500, top: 500, width: 30, height: 30 })
      ]
    }
  };

  const plan = buildCleanupPlan(null, model);
  assert.equal(plan.diagnostics.actionCount, 1, '1 action generated (attachText)');
  assert.equal(plan.diagnostics.highConfidenceActionCount, 1, '1 high-confidence action');
  assert.equal(plan.diagnostics.untouchedObjectCount, 1, '1 untouched object');
  assert.equal(plan.diagnostics.unsupportedActionCount, 0, '0 unsupported actions');
});

test('21. Minimal Movement Invariant: unreferenced objects are explicitly listed in untouchedObjectIds', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', elementId: 'e1', type: 'rect', left: 10, top: 10, width: 100, height: 100 }),
        normalizeObject({ id: 't1', elementId: 'e1', type: 'text', text: 'L1', left: 20, top: 20, width: 50, height: 20 }),
        normalizeObject({ id: 'free_1', type: 'stroke', isVectorStroke: true, left: 300, top: 300, width: 50, height: 50 }),
        normalizeObject({ id: 'free_2', type: 'stroke', isVectorStroke: true, left: 360, top: 300, width: 50, height: 50 }),
        normalizeObject({ id: 'divider_1', type: 'line', isSkribeLine: true, isStraightLine: true, left: 900, top: 100, width: 2, height: 400 })
      ]
    }
  };

  const plan = buildCleanupPlan(null, model);
  assert.ok(plan.untouchedObjectIds.includes('free_1'), 'free_1 is untouched');
  assert.ok(plan.untouchedObjectIds.includes('free_2'), 'free_2 is untouched');
  assert.ok(plan.untouchedObjectIds.includes('divider_1'), 'divider_1 is untouched');
  assert.equal(plan.actions.length, 1, 'Only high-confidence attachText action created');
});

test('22. Real Board Fixture: buildCleanupPlan generates clean, coordinate-free plan with high-confidence actions', () => {
  const processShape = normalizeObject({ id: 'shape_process', elementId: 'elem_proc', type: 'path', shapeType: 'hexagon', left: 300, top: 200, width: 100, height: 100, relationshipMetadata: { attachedTextId: 'text_proc' } });
  const processText = normalizeObject({ id: 'text_proc', elementId: 'elem_proc', type: 'text', text: 'Process', left: 320, top: 240, width: 60, height: 20, relationshipMetadata: { parentShapeId: 'shape_process' } });

  const stickyNote = normalizeObject({ id: 'note_blue', elementId: 'elem_blue', type: 'rect', isStickyNote: true, left: 300, top: 350, width: 140, height: 140, relationshipMetadata: { attachedTextId: 'text_blue' } });
  const stickyText = normalizeObject({ id: 'text_blue', elementId: 'elem_blue', type: 'text', text: 'New Sticky Note', left: 310, top: 360, width: 120, height: 120, relationshipMetadata: { parentShapeId: 'note_blue' } });

  const helloText = normalizeObject({ id: 'text_hello', type: 'text', text: 'Hello World!', left: 450, top: 520, width: 100, height: 24, rotation: -12 });
  const dividerLine = normalizeObject({ id: 'line_divider', type: 'path', isSkribeLine: true, isStraightLine: true, left: 950, top: 200, width: 2, height: 400 });
  const freehandStroke = normalizeObject({ id: 'stroke_H', type: 'stroke', isVectorStroke: true, left: 300, top: 450, width: 20, height: 40 });

  const model = {
    board: {
      objects: [processShape, processText, stickyNote, stickyText, helloText, dividerLine, freehandStroke]
    }
  };

  const plan = buildCleanupPlan(null, model);
  assertValidCleanupPlan(plan, model);

  const attachActions = plan.actions.filter((a) => a.type === 'attachText');
  assert.equal(attachActions.length, 2, '2 attachText actions for process and sticky note');

  const normTextActions = plan.actions.filter((a) => a.type === 'normalizeText');
  assert.equal(normTextActions.length, 1, '1 normalizeText action for tilted Hello World');

  assert.ok(plan.untouchedObjectIds.includes('line_divider'), 'Vertical divider remains untouched');
  assert.ok(plan.untouchedObjectIds.includes('stroke_H'), 'Freehand stroke remains untouched');
});
