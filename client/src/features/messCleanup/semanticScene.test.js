import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSemanticScene, buildSemanticScene } from './semanticSceneAdapter.js';
import {
  SEMANTIC_WORKSPACE_TYPES,
  SEMANTIC_GROUP_TYPES,
  SEMANTIC_OBJECT_ROLES,
  SEMANTIC_RELATIONSHIP_TYPES
} from './semanticSceneTypes.js';

const shape = (id, x = 100, y = 100, extra = {}) => ({
  id,
  type: 'shape',
  shapeType: 'rect',
  position: { x, y },
  size: { width: 120, height: 80 },
  relationshipMetadata: {},
  ...extra
});

const text = (id, val, x = 100, y = 100, extra = {}) => ({
  id,
  type: 'text',
  text: val,
  position: { x, y },
  size: { width: 120, height: 30 },
  relationshipMetadata: {},
  ...extra
});

const note = (id, val, x = 200, y = 200, extra = {}) => ({
  id,
  type: 'note',
  text: val,
  position: { x, y },
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

const stroke = (id, x = 50, y = 50, extra = {}) => ({
  id,
  type: 'stroke',
  position: { x, y },
  size: { width: 30, height: 30 },
  relationshipMetadata: {},
  metadata: { isVectorStroke: true },
  ...extra
});

// TEST 1: Basic mixed workspace produces valid SemanticScene
test('TEST 1: Basic mixed workspace -> valid SemanticScene', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        shape('s1'),
        text('t1', 'Title'),
        note('n1', 'Sticky note')
      ]
    }
  };

  const rawPlan = {
    workspaceType: 'mixed',
    groups: [
      { id: 'g1', type: 'concept', objectIds: ['s1', 't1'] },
      { id: 'g2', type: 'notes', objectIds: ['n1'] }
    ]
  };

  const scene = buildSemanticScene(model, rawPlan);
  const { valid, errors } = validateSemanticScene(scene, model);

  assert.equal(valid, true, `Validation errors: ${errors.join(', ')}`);
  assert.equal(scene.version, 1);
  assert.equal(scene.workspaceType, 'mixed');
  assert.equal(scene.objects.length, 3);
  assert.equal(scene.groups.length, 2);
});

// TEST 2: Shape + attached text remain one semantic unit and in same group
test('TEST 2: Shape + attached text remain in same semantic group', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        shape('s1', 100, 100, { relationshipMetadata: { attachedTextId: 't1' } }),
        text('t1', 'Inside text', 100, 100, { relationshipMetadata: { parentShapeId: 's1' } })
      ]
    }
  };

  // Nemotron incorrectly places them in separate groups
  const rawPlan = {
    groups: [
      { id: 'g_shape', type: 'concept', objectIds: ['s1'] },
      { id: 'g_text', type: 'concept', objectIds: ['t1'] }
    ]
  };

  const scene = buildSemanticScene(model, rawPlan);
  const sObj = scene.objects.find((o) => o.objectId === 's1');
  const tObj = scene.objects.find((o) => o.objectId === 't1');

  assert.ok(sObj && tObj);
  assert.equal(sObj.groupId, tObj.groupId);
  assert.equal(tObj.parentObjectId, 's1');

  const attachedRel = scene.relationships.find((r) => r.type === SEMANTIC_RELATIONSHIP_TYPES.ATTACHED_TEXT);
  assert.ok(attachedRel);
  assert.equal(attachedRel.sourceObjectId, 's1');
  assert.deepEqual(attachedRel.targetObjectIds, ['t1']);
});

// TEST 3: Recreated shape text relationship is preserved
test('TEST 3: Recreated shape text relationship is preserved', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        shape('shape_recreated', 300, 200, { relationshipMetadata: { attachedTextId: 'txt_recreated' } }),
        text('txt_recreated', 'Label', 300, 200, { relationshipMetadata: { parentShapeId: 'shape_recreated' } })
      ]
    }
  };

  const scene = buildSemanticScene(model, {});
  const rel = scene.relationships.find((r) => r.sourceObjectId === 'shape_recreated');
  assert.ok(rel);
  assert.equal(rel.type, 'attached-text');
  assert.deepEqual(rel.targetObjectIds, ['txt_recreated']);
});

// TEST 4: Flowchart nodes + connectors remain connected
test('TEST 4: Flowchart nodes + connectors remain connected', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        shape('nodeA', 100, 100),
        shape('nodeB', 300, 100),
        connector('connAB', 'nodeA', 'nodeB')
      ]
    }
  };

  const rawPlan = {
    workspaceType: 'flowchart',
    groups: [
      { id: 'g_flow', type: 'flowchart', objectIds: ['nodeA', 'nodeB', 'connAB'] }
    ]
  };

  const scene = buildSemanticScene(model, rawPlan);
  const rel = scene.relationships.find((r) => r.type === 'connects-to');
  assert.ok(rel);
  assert.equal(rel.sourceObjectId, 'nodeA');
  assert.deepEqual(rel.targetObjectIds, ['nodeB']);

  const { valid } = validateSemanticScene(scene, model);
  assert.equal(valid, true);
});

// TEST 5: Sticky notes form semantic note groups
test('TEST 5: Sticky notes form semantic note groups', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        note('n1', 'Idea 1'),
        note('n2', 'Idea 2'),
        note('n3', 'Idea 3')
      ]
    }
  };

  const rawPlan = {
    workspaceType: 'notes',
    groups: [
      { id: 'g_brainstorm', type: 'notes', objectIds: ['n1', 'n2', 'n3'] }
    ]
  };

  const scene = buildSemanticScene(model, rawPlan);
  const noteGroup = scene.groups.find((g) => g.id === 'g_brainstorm');
  assert.ok(noteGroup);
  assert.equal(noteGroup.type, 'notes');
  assert.equal(noteGroup.objectIds.length, 3);
});

// TEST 6: Multiple sticky-note groups remain separate
test('TEST 6: Multiple sticky-note groups remain separate', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        note('n1', 'Pros 1'), note('n2', 'Pros 2'),
        note('n3', 'Cons 1'), note('n4', 'Cons 2')
      ]
    }
  };

  const rawPlan = {
    workspaceType: 'notes',
    groups: [
      { id: 'g_pros', type: 'notes', objectIds: ['n1', 'n2'], purpose: 'Pros' },
      { id: 'g_cons', type: 'notes', objectIds: ['n3', 'n4'], purpose: 'Cons' }
    ]
  };

  const scene = buildSemanticScene(model, rawPlan);
  assert.equal(scene.groups.length, 2);
  assert.deepEqual(scene.groups[0].objectIds, ['n1', 'n2']);
  assert.deepEqual(scene.groups[1].objectIds, ['n3', 'n4']);
});

// TEST 7: Multi-stroke freehand drawing becomes one freeform group
test('TEST 7: Multi-stroke freehand drawing becomes one freeform group', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        stroke('st1', 100, 100),
        stroke('st2', 120, 100),
        stroke('st3', 140, 100)
      ]
    }
  };

  const rawPlan = {
    workspaceType: 'freeform',
    groups: [
      { id: 'g_hello', type: 'freeform', objectIds: ['st1', 'st2', 'st3'] }
    ]
  };

  const scene = buildSemanticScene(model, rawPlan);
  const freeformGrp = scene.groups.find((g) => g.type === 'freeform');
  assert.ok(freeformGrp);
  assert.equal(freeformGrp.objectIds.length, 3);
});

// TEST 8: Freehand annotation attaches to correct semantic target
test('TEST 8: Freehand annotation attaches to correct semantic target', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        shape('card_1'),
        stroke('circle_stroke')
      ]
    }
  };

  const rawPlan = {
    annotations: [
      { objectId: 'circle_stroke', targetObjectIds: ['card_1'], type: 'freehand-annotation' }
    ]
  };

  const scene = buildSemanticScene(model, rawPlan);
  assert.equal(scene.annotations.length, 1);
  assert.equal(scene.annotations[0].objectId, 'circle_stroke');
  assert.deepEqual(scene.annotations[0].targetObjectIds, ['card_1']);
});

// TEST 9: Heading + body relationship is preserved
test('TEST 9: Heading + body relationship is preserved', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        text('h1', 'Architecture', 0, 0, { metadata: { isHeading: true } }),
        text('b1', 'The system consists of...', 0, 50)
      ]
    }
  };

  const rawPlan = {
    relationships: [
      { sourceObjectId: 'h1', targetObjectIds: ['b1'], type: 'heading-body' }
    ]
  };

  const scene = buildSemanticScene(model, rawPlan);
  const rel = scene.relationships.find((r) => r.type === 'heading-body');
  assert.ok(rel);
  assert.equal(rel.sourceObjectId, 'h1');
  assert.deepEqual(rel.targetObjectIds, ['b1']);
});

// TEST 10: Diagram + explanatory text relationship is preserved
test('TEST 10: Diagram + explanatory text relationship is preserved', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        shape('diag_box'),
        text('txt_explain', 'This diagram illustrates the pipeline')
      ]
    }
  };

  const rawPlan = {
    relationships: [
      { sourceObjectId: 'diag_box', targetObjectIds: ['txt_explain'], type: 'concept-explanation' }
    ]
  };

  const scene = buildSemanticScene(model, rawPlan);
  const rel = scene.relationships.find((r) => r.type === 'concept-explanation');
  assert.ok(rel);
  assert.equal(rel.sourceObjectId, 'diag_box');
  assert.deepEqual(rel.targetObjectIds, ['txt_explain']);
});
