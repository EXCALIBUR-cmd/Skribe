import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCompositionPlan, validateCompositionPlan } from './buildCompositionPlan.js';
import { buildSemanticScene } from './semanticSceneAdapter.js';
import {
  COMPOSITION_ROLES,
  COMPOSITION_STRATEGIES
} from './compositionPlanTypes.js';

const shape = (id, extra = {}) => ({
  id,
  type: 'shape',
  position: { x: 100, y: 100 },
  size: { width: 120, height: 80 },
  relationshipMetadata: {},
  ...extra
});

const text = (id, val, extra = {}) => ({
  id,
  type: 'text',
  text: val,
  position: { x: 100, y: 100 },
  size: { width: 120, height: 30 },
  relationshipMetadata: {},
  ...extra
});

const note = (id, val, extra = {}) => ({
  id,
  type: 'note',
  text: val,
  position: { x: 200, y: 200 },
  size: { width: 150, height: 150 },
  relationshipMetadata: {},
  metadata: { isStickyNote: true },
  ...extra
});

const connector = (id, src, tgt, extra = {}) => ({
  id,
  type: 'connector',
  position: { x: 150, y: 100 },
  size: { width: 100, height: 10 },
  relationshipMetadata: { sourceShapeId: src, targetShapeId: tgt },
  ...extra
});

const stroke = (id, extra = {}) => ({
  id,
  type: 'stroke',
  position: { x: 50, y: 50 },
  size: { width: 30, height: 30 },
  relationshipMetadata: {},
  metadata: { isVectorStroke: true },
  ...extra
});

// TEST 1: Concept group -> notebook-stack
test('TEST 1: Concept group -> notebook-stack', () => {
  const model = { board: { objects: [shape('s1'), text('t1', 'Process text')] } };
  const scene = {
    version: 1,
    workspaceType: 'mixed',
    groups: [{ id: 'g_concept', type: 'concept', objectIds: ['s1', 't1'] }],
    relationships: [],
    annotations: [],
    readingOrder: ['g_concept'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g_concept'] }
  };

  const plan = buildCompositionPlan(scene, model);
  assert.equal(plan.blocks.length, 1);
  assert.equal(plan.blocks[0].role, COMPOSITION_ROLES.CONCEPT);
  assert.equal(plan.blocks[0].strategy, COMPOSITION_STRATEGIES.NOTEBOOK_STACK);
});

// TEST 2: Flowchart -> flowchart strategy
test('TEST 2: Flowchart -> flowchart strategy', () => {
  const model = {
    board: {
      objects: [shape('b1'), shape('b2'), connector('c1', 'b1', 'b2')]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'flowchart',
    groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }],
    relationships: [{ sourceObjectId: 'b1', targetObjectIds: ['b2'], type: 'connects-to' }],
    annotations: [],
    readingOrder: ['g_flow'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g_flow'] }
  };

  const plan = buildCompositionPlan(scene, model);
  assert.equal(plan.blocks.length, 1);
  assert.equal(plan.blocks[0].role, COMPOSITION_ROLES.FLOWCHART);
  assert.equal(plan.blocks[0].strategy, COMPOSITION_STRATEGIES.FLOWCHART);
});

// TEST 3: Diagram -> diagram-explanation
test('TEST 3: Diagram -> diagram-explanation', () => {
  const model = {
    board: {
      objects: [shape('d1'), text('exp1', 'Diagram caption')]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'diagram',
    groups: [{ id: 'g_diag', type: 'diagram', objectIds: ['d1', 'exp1'] }],
    relationships: [{ sourceObjectId: 'd1', targetObjectIds: ['exp1'], type: 'concept-explanation' }],
    annotations: [],
    readingOrder: ['g_diag'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g_diag'] }
  };

  const plan = buildCompositionPlan(scene, model);
  assert.equal(plan.blocks.length, 1);
  assert.equal(plan.blocks[0].role, COMPOSITION_ROLES.DIAGRAM);
  assert.equal(plan.blocks[0].strategy, COMPOSITION_STRATEGIES.DIAGRAM_EXPLANATION);
});

// TEST 4: Sticky notes -> note-grid
test('TEST 4: Sticky notes -> note-grid', () => {
  const model = {
    board: {
      objects: [note('n1', 'Task 1'), note('n2', 'Task 2'), note('n3', 'Task 3')]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'notes',
    groups: [{ id: 'g_notes', type: 'notes', objectIds: ['n1', 'n2', 'n3'] }],
    relationships: [],
    annotations: [],
    readingOrder: ['g_notes'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: [] }
  };

  const plan = buildCompositionPlan(scene, model);
  assert.equal(plan.blocks.length, 1);
  assert.equal(plan.blocks[0].role, COMPOSITION_ROLES.NOTES);
  assert.equal(plan.blocks[0].strategy, COMPOSITION_STRATEGIES.NOTE_GRID);
  assert.equal(plan.blocks[0].objectIds.length, 3);
});

// TEST 5: Freeform strokes remain atomic
test('TEST 5: Freeform strokes remain atomic (freeform-group)', () => {
  const model = {
    board: {
      objects: [stroke('st1'), stroke('st2'), stroke('st3'), stroke('st4')]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'freeform',
    groups: [{ id: 'g_freeform', type: 'freeform', objectIds: ['st1', 'st2', 'st3', 'st4'] }],
    relationships: [],
    annotations: [],
    readingOrder: ['g_freeform'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: [] }
  };

  const plan = buildCompositionPlan(scene, model);
  assert.equal(plan.blocks.length, 1);
  assert.equal(plan.blocks[0].role, COMPOSITION_ROLES.FREEFORM);
  assert.equal(plan.blocks[0].strategy, COMPOSITION_STRATEGIES.FREEFORM_GROUP);
  assert.equal(plan.blocks[0].objectIds.length, 4);
});

// TEST 6: Independent text -> text-block
test('TEST 6: Independent text -> text-block', () => {
  const model = {
    board: {
      objects: [shape('s1'), text('txt_standalone', 'Standalone memo')]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'mixed',
    groups: [
      { id: 'g_concept', type: 'concept', objectIds: ['s1'] },
      { id: 'g_memo', type: 'concept', objectIds: ['txt_standalone'] }
    ],
    relationships: [],
    annotations: [],
    readingOrder: ['g_concept', 'g_memo'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g_concept'] }
  };

  const plan = buildCompositionPlan(scene, model);
  const memoBlock = plan.blocks.find((b) => b.objectIds.includes('txt_standalone'));
  assert.ok(memoBlock);
  assert.equal(memoBlock.role, COMPOSITION_ROLES.TEXT);
  assert.equal(memoBlock.strategy, COMPOSITION_STRATEGIES.TEXT_BLOCK);
});

// TEST 7: Shape + attached text remain in one block
test('TEST 7: Shape + attached text remain in one block', () => {
  const model = {
    board: {
      objects: [
        shape('s1', { relationshipMetadata: { attachedTextId: 't1' } }),
        text('t1', 'Attached Label', { relationshipMetadata: { parentShapeId: 's1' } })
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 't1'] }]
  });

  const plan = buildCompositionPlan(scene, model);
  assert.equal(plan.blocks.length, 1);
  assert.deepEqual(plan.blocks[0].objectIds.sort(), ['s1', 't1']);
});

// TEST 8: Flowchart connectors remain in same block
test('TEST 8: Flowchart connectors remain in same block', () => {
  const model = {
    board: {
      objects: [
        shape('b1'), shape('b2'), connector('conn1', 'b1', 'b2')
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'flowchart',
    groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'conn1'] }]
  });

  const plan = buildCompositionPlan(scene, model);
  const flowBlock = plan.blocks.find((b) => b.strategy === 'flowchart');
  assert.ok(flowBlock);
  assert.ok(flowBlock.objectIds.includes('conn1'));
  assert.ok(flowBlock.objectIds.includes('b1'));
  assert.ok(flowBlock.objectIds.includes('b2'));
});

// TEST 9: Semantic relationships preserved
test('TEST 9: Semantic relationships preserved in CompositionPlan', () => {
  const model = {
    board: {
      objects: [shape('s1'), text('t1', 'Heading'), text('b1', 'Body')]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'mixed',
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 't1', 'b1'] }],
    relationships: [
      { sourceObjectId: 't1', targetObjectIds: ['b1'], type: 'heading-body', confidence: 0.9, evidence: [] }
    ],
    annotations: [],
    readingOrder: ['g1'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g1'] }
  };

  const plan = buildCompositionPlan(scene, model);
  assert.equal(plan.relationships.length, 1);
  assert.equal(plan.relationships[0].type, 'heading-body');
  assert.equal(plan.relationships[0].sourceObjectId, 't1');
  assert.deepEqual(plan.relationships[0].targetObjectIds, ['b1']);
});

// TEST 10: Reading order preserved
test('TEST 10: Reading order preserved in CompositionPlan', () => {
  const model = {
    board: {
      objects: [shape('s1'), note('n1'), stroke('st1')]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'mixed',
    groups: [
      { id: 'g_concept', type: 'concept', objectIds: ['s1'] },
      { id: 'g_notes', type: 'notes', objectIds: ['n1'] },
      { id: 'g_freeform', type: 'freeform', objectIds: ['st1'] }
    ],
    relationships: [],
    annotations: [],
    readingOrder: ['g_concept', 'g_notes', 'g_freeform'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g_concept'] }
  };

  const plan = buildCompositionPlan(scene, model);
  assert.deepEqual(plan.readingOrder, ['block_g_concept', 'block_g_notes', 'block_g_freeform']);
  assert.equal(plan.blocks[0].id, 'block_g_concept');
  assert.equal(plan.blocks[1].id, 'block_g_notes');
  assert.equal(plan.blocks[2].id, 'block_g_freeform');
});

// TEST 11: Every WorkspaceModel object is accounted for
test('TEST 11: Every WorkspaceModel object is accounted for (unresolvedObjectIds empty)', () => {
  const objects = [shape('s1'), shape('s2'), text('t1', 'Hi'), note('n1'), stroke('st1')];
  const model = { board: { objects } };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g1', type: 'concept', objectIds: ['s1', 't1'] },
      { id: 'g2', type: 'notes', objectIds: ['n1'] }
    ]
  });

  const plan = buildCompositionPlan(scene, model);
  assert.deepEqual(plan.diagnostics.unresolvedObjectIds, []);
  const allPlanIds = plan.blocks.flatMap((b) => b.objectIds);
  assert.equal(allPlanIds.length, objects.length);
});

// TEST 12: Unknown object IDs are rejected/filtered safely
test('TEST 12: Unknown object IDs are rejected/filtered safely', () => {
  const model = { board: { objects: [shape('s1')] } };
  const scene = {
    version: 1,
    workspaceType: 'mixed',
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 'hallucinated_id_999'] }],
    relationships: [{ sourceObjectId: 's1', targetObjectIds: ['non_existent_target'], type: 'connects-to' }],
    annotations: [],
    readingOrder: ['g1'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g1'] }
  };

  const plan = buildCompositionPlan(scene, model);
  assert.deepEqual(plan.blocks[0].objectIds, ['s1']);
  assert.equal(plan.diagnostics.unresolvedRelationships.length, 1);
});

// TEST 13: CompositionPlan contains no physical coordinates
test('TEST 13: CompositionPlan contains no physical coordinates', () => {
  const model = {
    board: {
      objects: [shape('s1', { position: { x: 500, y: 300 }, size: { width: 200, height: 100 } })]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1'] }]
  });

  const plan = buildCompositionPlan(scene, model);
  const { valid, errors } = validateCompositionPlan(plan, model);
  assert.equal(valid, true, `Validation errors: ${errors.join(', ')}`);

  const jsonStr = JSON.stringify(plan);
  const parsed = JSON.parse(jsonStr);

  const checkKeys = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    const forbidden = ['x', 'y', 'left', 'top', 'width', 'height', 'margin', 'gap', 'row', 'column', 'bounds', 'position', 'canvasWidth', 'canvasHeight'];
    forbidden.forEach((k) => {
      assert.equal(k in obj, false, `Forbidden key "${k}" found in CompositionPlan`);
    });
    Object.values(obj).forEach((v) => {
      if (typeof v === 'object' && v !== null) checkKeys(v);
    });
  };

  checkKeys(parsed);
});

// TEST 14: Input SemanticScene remains immutable
test('TEST 14: Input SemanticScene remains immutable', () => {
  const model = { board: { objects: [shape('s1')] } };
  const scene = {
    version: 1,
    workspaceType: 'mixed',
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1'] }],
    relationships: [],
    annotations: [],
    readingOrder: ['g1'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g1'] }
  };

  const sceneSnapshot = JSON.stringify(scene);
  buildCompositionPlan(scene, model);
  assert.equal(JSON.stringify(scene), sceneSnapshot);
});

// TEST 15: Input WorkspaceModel remains immutable
test('TEST 15: Input WorkspaceModel remains immutable', () => {
  const model = { board: { objects: [shape('s1', { relationshipMetadata: { attachedTextId: 't1' } })] } };
  const scene = {
    version: 1,
    workspaceType: 'mixed',
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1'] }],
    relationships: [],
    annotations: [],
    readingOrder: ['g1'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g1'] }
  };

  const modelSnapshot = JSON.stringify(model);
  buildCompositionPlan(scene, model);
  assert.equal(JSON.stringify(model), modelSnapshot);
});

// TEST 16: Same input produces identical JSON
test('TEST 16: Same input produces identical JSON', () => {
  const model = {
    board: {
      objects: [shape('sB'), shape('sA'), note('n1')]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g2', type: 'notes', objectIds: ['n1'] },
      { id: 'g1', type: 'concept', objectIds: ['sB', 'sA'] }
    ]
  });

  const plan1 = buildCompositionPlan(scene, model);
  const plan2 = buildCompositionPlan(scene, model);
  assert.equal(JSON.stringify(plan1), JSON.stringify(plan2));
});

// TEST 17: Nested concept/explanation relationships preserved
test('TEST 17: Nested concept/explanation relationships preserved', () => {
  const model = {
    board: {
      objects: [shape('s_concept'), text('t_exp', 'Explanation paragraph')]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'mixed',
    groups: [{ id: 'g_concept_full', type: 'concept', objectIds: ['s_concept', 't_exp'] }],
    relationships: [{ sourceObjectId: 's_concept', targetObjectIds: ['t_exp'], type: 'concept-explanation' }],
    annotations: [],
    readingOrder: ['g_concept_full'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g_concept_full'] }
  };

  const plan = buildCompositionPlan(scene, model);
  assert.equal(plan.blocks[0].strategy, 'notebook-stack');
  assert.equal(plan.blocks[0].relationships.length, 1);
  assert.equal(plan.blocks[0].relationships[0].type, 'concept-explanation');
});

// TEST 18: Multiple independent concepts remain independent blocks
test('TEST 18: Multiple independent concepts remain independent blocks', () => {
  const model = {
    board: {
      objects: [shape('s_c1'), shape('s_c2')]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'mixed',
    groups: [
      { id: 'g_c1', type: 'concept', objectIds: ['s_c1'] },
      { id: 'g_c2', type: 'concept', objectIds: ['s_c2'] }
    ],
    relationships: [],
    annotations: [],
    readingOrder: ['g_c1', 'g_c2'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g_c1', 'g_c2'] }
  };

  const plan = buildCompositionPlan(scene, model);
  assert.equal(plan.blocks.length, 2);
  assert.equal(plan.blocks[0].id, 'block_g_c1');
  assert.equal(plan.blocks[1].id, 'block_g_c2');
});

// TEST 19: Unrelated sticky notes are not artificially merged
test('TEST 19: Unrelated sticky notes are not artificially merged', () => {
  const model = {
    board: {
      objects: [note('n_topicA_1'), note('n_topicA_2'), note('n_topicB_1')]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'notes',
    groups: [
      { id: 'g_topicA', type: 'notes', objectIds: ['n_topicA_1', 'n_topicA_2'] },
      { id: 'g_topicB', type: 'notes', objectIds: ['n_topicB_1'] }
    ],
    relationships: [],
    annotations: [],
    readingOrder: ['g_topicA', 'g_topicB'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: [] }
  };

  const plan = buildCompositionPlan(scene, model);
  assert.equal(plan.blocks.length, 2);
  assert.deepEqual(plan.blocks[0].objectIds, ['n_topicA_1', 'n_topicA_2']);
  assert.deepEqual(plan.blocks[1].objectIds, ['n_topicB_1']);
});

// TEST 20: Validation check passes on clean plan and catches invalid input
test('TEST 20: Validation check passes on clean plan and catches invalid input', () => {
  const model = { board: { objects: [shape('s1')] } };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1'] }]
  });

  const plan = buildCompositionPlan(scene, model);
  const cleanValidation = validateCompositionPlan(plan, model);
  assert.equal(cleanValidation.valid, true);

  // Invalid plan with forbidden coordinate
  const badPlan = { ...plan, blocks: [{ ...plan.blocks[0], bounds: { x: 10, y: 10 } }] };
  const badValidation = validateCompositionPlan(badPlan, model);
  assert.equal(badValidation.valid, false);
  assert.ok(badValidation.errors.some((e) => e.includes('bounds')));
});
