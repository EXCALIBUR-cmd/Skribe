import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSemanticScene, buildSemanticScene, normalizeRelationshipType } from './semanticSceneAdapter.js';

const shape = (id, extra = {}) => ({
  id,
  type: 'shape',
  position: { x: 100, y: 100 },
  size: { width: 100, height: 100 },
  relationshipMetadata: {},
  ...extra
});

const text = (id, val, extra = {}) => ({
  id,
  type: 'text',
  text: val,
  position: { x: 100, y: 100 },
  size: { width: 100, height: 30 },
  relationshipMetadata: {},
  ...extra
});

const note = (id, extra = {}) => ({
  id,
  type: 'note',
  position: { x: 200, y: 200 },
  size: { width: 150, height: 150 },
  relationshipMetadata: {},
  metadata: { isStickyNote: true },
  ...extra
});

test('TEST 11: Reading order is deterministic', () => {
  const model = {
    version: 1,
    board: {
      objects: [shape('s1'), note('n1'), text('t1', 'Title')]
    }
  };

  const rawPlan = {
    groups: [
      { id: 'g_notes', type: 'notes', objectIds: ['n1'] },
      { id: 'g_concept', type: 'concept', objectIds: ['s1', 't1'] }
    ]
  };

  const scene1 = buildSemanticScene(model, rawPlan);
  const scene2 = buildSemanticScene(model, rawPlan);

  assert.deepEqual(scene1.readingOrder, scene2.readingOrder);
  assert.equal(scene1.readingOrder[0], 'g_concept');
});

test('TEST 12: Unknown AI object IDs are filtered safely and flagged in validation', () => {
  const model = {
    version: 1,
    board: {
      objects: [shape('valid_1'), text('valid_2', 'Hello')]
    }
  };

  const rawPlanWithHallucinations = {
    groups: [
      { id: 'g1', type: 'concept', objectIds: ['valid_1', 'hallucinated_obj_999'] }
    ],
    relationships: [
      { sourceObjectId: 'valid_1', targetObjectIds: ['hallucinated_target'], type: 'heading-body' }
    ]
  };

  const scene = buildSemanticScene(model, rawPlanWithHallucinations);

  const g1 = scene.groups.find((g) => g.id === 'g1');
  assert.deepEqual(g1.objectIds, ['valid_1']);

  const { valid, errors } = validateSemanticScene(scene, model);
  assert.equal(valid, true, `Errors: ${errors.join(', ')}`);

  const malformedScene = {
    ...scene,
    objects: [...scene.objects, { objectId: 'hallucinated_obj_999', semanticRole: 'body' }]
  };
  const malformedValidation = validateSemanticScene(malformedScene, model);
  assert.equal(malformedValidation.valid, false);
  assert.ok(malformedValidation.errors.some((e) => e.includes('does not exist in WorkspaceModel')));
});

test('TEST 13: AI cannot overwrite explicit Fabric relationships', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        shape('s_parent', { relationshipMetadata: { attachedTextId: 't_child' } }),
        text('t_child', 'Child text', { relationshipMetadata: { parentShapeId: 's_parent' } })
      ]
    }
  };

  const rawPlan = {
    relationships: [
      { sourceObjectId: 's_parent', targetObjectIds: ['s_parent'], type: 'concept-explanation' }
    ]
  };

  const scene = buildSemanticScene(model, rawPlan);
  const attachedRel = scene.relationships.find((r) => r.type === 'attached-text');
  assert.ok(attachedRel, 'Explicit attached-text relationship must be preserved');
  assert.equal(attachedRel.sourceObjectId, 's_parent');
  assert.deepEqual(attachedRel.targetObjectIds, ['t_child']);
});

test('TEST 14: WorkspaceModel remains completely immutable', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        shape('s1', { relationshipMetadata: { attachedTextId: 't1' } }),
        text('t1', 'Test', { relationshipMetadata: { parentShapeId: 's1' } })
      ]
    }
  };

  const modelSnapshot = JSON.stringify(model);
  const rawPlan = { groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 't1'] }] };
  const rawPlanSnapshot = JSON.stringify(rawPlan);

  buildSemanticScene(model, rawPlan);

  assert.equal(JSON.stringify(model), modelSnapshot);
  assert.equal(JSON.stringify(rawPlan), rawPlanSnapshot);
});

test('TEST 15: SemanticScene is JSON serializable', () => {
  const model = {
    version: 1,
    board: {
      objects: [shape('s1'), text('t1', 'Hi')]
    }
  };

  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 't1'] }]
  });

  const jsonStr = JSON.stringify(scene);
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.groups.length, 1);
});

test('TEST 16: Same input produces deterministic normalized output', () => {
  const model = {
    version: 1,
    board: {
      objects: [shape('sA'), shape('sB'), note('n1')]
    }
  };

  const rawPlan = {
    groups: [
      { id: 'g2', type: 'notes', objectIds: ['n1'] },
      { id: 'g1', type: 'concept', objectIds: ['sB', 'sA'] }
    ]
  };

  const scene1 = buildSemanticScene(model, rawPlan);
  const scene2 = buildSemanticScene(model, rawPlan);

  assert.equal(JSON.stringify(scene1), JSON.stringify(scene2));
});

test('TEST 17: Nemotron response with document.sections converts correctly', () => {
  const model = {
    version: 1,
    board: {
      objects: [shape('s1'), text('t1', 'Doc Title')]
    }
  };

  const v2StylePlan = {
    workspaceType: 'document',
    document: {
      titleObjectId: 't1',
      sections: [
        { id: 'sec_1', type: 'content', titleObjectId: 't1', objectIds: ['s1', 't1'], layoutHint: 'vertical-flow' }
      ]
    }
  };

  const scene = buildSemanticScene(model, v2StylePlan);
  assert.equal(scene.workspaceType, 'document');
  assert.equal(scene.groups.length, 1);
  assert.equal(scene.groups[0].id, 'sec_1');
  assert.equal(scene.hierarchy.rootTitleObjectId, 't1');
});

test('TEST 18: Nemotron response with hierarchy converts correctly', () => {
  const model = {
    version: 1,
    board: {
      objects: [shape('s1'), text('t_root', 'Root Title')]
    }
  };

  const planWithHierarchy = {
    hierarchy: {
      rootTitleObjectId: 't_root'
    },
    groups: [
      { id: 'g_main', type: 'concept', objectIds: ['s1', 't_root'] }
    ]
  };

  const scene = buildSemanticScene(model, planWithHierarchy);
  assert.equal(scene.hierarchy.rootTitleObjectId, 't_root');
  assert.deepEqual(scene.hierarchy.mainConceptIds, ['g_main']);
});

test('TEST 19: Unknown/unsupported semantic relationship is safely ignored', () => {
  assert.equal(normalizeRelationshipType('completely-invented-type'), null);
  assert.equal(normalizeRelationshipType('heading_body'), 'heading-body');
  assert.equal(normalizeRelationshipType('contains_text'), 'attached-text');

  const model = {
    version: 1,
    board: {
      objects: [shape('s1'), shape('s2')]
    }
  };

  const planWithBadRel = {
    relationships: [
      { sourceObjectId: 's1', targetObjectIds: ['s2'], type: 'hallucinated-bogus-rel' }
    ]
  };

  const scene = buildSemanticScene(model, planWithBadRel);
  assert.equal(scene.relationships.length, 0);
});

test('TEST 20: SemanticScene contains NO physical coordinate properties', () => {
  const model = {
    version: 1,
    board: {
      objects: [shape('s1', { position: { x: 450, y: 350 }, size: { width: 200, height: 100 } })]
    }
  };

  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1'] }]
  });

  const { valid, errors } = validateSemanticScene(scene, model);
  assert.equal(valid, true, `Errors: ${errors.join(', ')}`);

  const jsonStr = JSON.stringify(scene);
  const parsed = JSON.parse(jsonStr);

  const checkKeys = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    const forbidden = ['x', 'y', 'left', 'top', 'width', 'height', 'margin', 'gap', 'row', 'column', 'bounds', 'position'];
    forbidden.forEach((k) => {
      assert.equal(k in obj, false, `Forbidden key "${k}" found in SemanticScene`);
    });
    Object.values(obj).forEach((v) => {
      if (typeof v === 'object' && v !== null) checkKeys(v);
    });
  };

  checkKeys(parsed);
});
