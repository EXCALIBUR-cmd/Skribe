import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOrganizationPlan } from './validateOrganizationPlan.js';

const workspace = (objects) => ({
  version: 1,
  board: { objects }
});

const shape = (id, extra = {}) => ({
  id,
  type: 'shape',
  position: { x: 100, y: 100 },
  size: { width: 120, height: 80 },
  relationshipMetadata: {},
  ...extra
});

const text = (id, content, extra = {}) => ({
  id,
  type: 'text',
  text: content,
  position: { x: 100, y: 100 },
  size: { width: 180, height: 28 },
  relationshipMetadata: {},
  ...extra
});

const capturedNemotronResponse = {
  workspaceType: 'mixed',
  document: {
    titleObjectId: 't1',
    sections: [
      {
        id: 'section_1',
        type: 'content',
        purpose: 'Main content area',
        objectIds: ['s1', 't1'],
        layoutHint: 'vertical-flow'
      }
    ]
  },
  relationships: [
    {
      sourceObjectId: 't1',
      targetObjectIds: ['s1'],
      type: 'heading-body',
      evidence: ['visual-grouping', 'typography']
    }
  ]
};

test('TEST 1: Actual captured Nemotron response validates cleanly to v2 schema', () => {
  const model = workspace([text('t1', 'Title'), shape('s1')]);
  const plan = validateOrganizationPlan(model, capturedNemotronResponse);

  assert.equal(plan.version, 2);
  assert.equal(plan.source.engine, 'nemotron-omni');
  assert.equal(plan.source.model, 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');
  assert.equal(plan.workspaceType, 'mixed');
  assert.equal(plan.document.titleObjectId, 't1');
  assert.equal(plan.document.sections.length, 1);
  assert.equal(plan.document.sections[0].type, 'content');
  assert.deepEqual(plan.document.sections[0].objectIds, ['s1', 't1']);
  assert.equal(plan.relationships[0].type, 'heading-body');
  assert.deepEqual(plan.relationships[0].evidence, ['visual-grouping', 'typography']);
  assert.equal(plan.unassignedObjectIds.length, 0);
});

test('TEST 2: Valid document validates', () => {
  const model = workspace([text('t1', 'Doc Title'), shape('s1')]);
  const rawPlan = {
    version: 2,
    workspaceType: 'document',
    document: {
      titleObjectId: 't1',
      sections: [{ id: 'sec1', type: 'content', objectIds: ['t1', 's1'] }]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.version, 2);
  assert.equal(plan.workspaceType, 'document');
  assert.equal(plan.document.titleObjectId, 't1');
});

test('TEST 3: Missing document object defaults document safely', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    workspaceType: 'notes'
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.ok(plan.document);
  assert.equal(plan.document.titleObjectId, null);
  assert.equal(Array.isArray(plan.document.sections), true);
  assert.equal(plan.document.sections.length, 0);
});

test('TEST 4: Missing document.sections defaults sections safely', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    document: { titleObjectId: null }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(Array.isArray(plan.document.sections), true);
  assert.deepEqual(plan.unassignedObjectIds, ['s1']);
});

test('TEST 5: Invalid section objectIds are filtered out', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1', 'ghost_id_99'] }]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.deepEqual(plan.document.sections[0].objectIds, ['s1']);
});

test('TEST 6: Invalid relationship object ID is filtered out', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    relationships: [{ sourceObjectId: 'fake_id', targetObjectIds: ['s1'], type: 'heading-body' }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.relationships.length, 0);
});

test('TEST 7: Exact object IDs are preserved', () => {
  const model = workspace([shape('s1'), text('t1', 'Hello')]);
  const rawPlan = {
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1', 't1'] }]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.ok(plan.document.sections[0].objectIds.includes('s1'));
  assert.ok(plan.document.sections[0].objectIds.includes('t1'));
});

test('TEST 8: Title object ID is preserved', () => {
  const model = workspace([text('t1', 'Header')]);
  const rawPlan = {
    document: {
      titleObjectId: 't1',
      sections: [{ id: 'sec1', type: 'heading', objectIds: ['t1'] }]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.document.titleObjectId, 't1');
});

test('TEST 9: Section membership is deterministic', () => {
  const model = workspace([shape('s2'), shape('s1')]);
  const rawPlan = {
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s2', 's1'] }]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.deepEqual(plan.document.sections[0].objectIds, ['s1', 's2']);
});

test('TEST 10: Relationships are preserved with evidence', () => {
  const model = workspace([shape('s1'), shape('s2')]);
  const rawPlan = {
    relationships: [{
      sourceObjectId: 's1',
      targetObjectIds: ['s2'],
      type: 'connects_to',
      confidence: 0.95,
      evidence: ['connector-chain', 'visual-proximity']
    }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.relationships.length, 1);
  assert.equal(plan.relationships[0].sourceObjectId, 's1');
  assert.deepEqual(plan.relationships[0].targetObjectIds, ['s2']);
  assert.equal(plan.relationships[0].type, 'connects_to');
  assert.equal(plan.relationships[0].confidence, 0.95);
  assert.deepEqual(plan.relationships[0].evidence, ['connector-chain', 'visual-proximity']);
});

test('TEST 11: Annotations are preserved', () => {
  const model = workspace([shape('s1'), shape('stroke1')]);
  const rawPlan = {
    annotations: [{ objectId: 'stroke1', targetObjectIds: ['s1'], type: 'freehand-annotation', confidence: 0.88 }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.annotations.length, 1);
  assert.equal(plan.annotations[0].objectId, 'stroke1');
  assert.deepEqual(plan.annotations[0].targetObjectIds, ['s1']);
});

test('TEST 12: Unassigned objects are correctly calculated', () => {
  const model = workspace([shape('s1'), shape('s2'), shape('s3')]);
  const rawPlan = {
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1'] }]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.deepEqual(plan.unassignedObjectIds, ['s2', 's3']);
});

test('TEST 13: Linked shape/text identities remain intact and bound to same section', () => {
  const s1 = shape('s1', { relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = text('t1', 'Inside Shape', { relationshipMetadata: { parentShapeId: 's1' } });
  const model = workspace([s1, t1]);

  const rawPlan = {
    document: {
      sections: [
        { id: 'secA', type: 'diagram', objectIds: ['s1'] },
        { id: 'secB', type: 'notes', objectIds: ['t1'] }
      ]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  const secA = plan.document.sections.find((s) => s.id === 'secA');
  const secB = plan.document.sections.find((s) => s.id === 'secB');

  assert.ok(secA.objectIds.includes('s1') && secA.objectIds.includes('t1'));
  assert.equal(secB.objectIds.includes('t1'), false);
});

test('TEST 14: Unknown section type defaults safely to mixed', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    document: {
      sections: [{ id: 'sec1', type: 'unsupported_magic_type', objectIds: ['s1'] }]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.document.sections[0].type, 'mixed');
});

test('TEST 15: No coordinates exist anywhere in OrganizationPlan v2', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1'] }]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  const jsonStr = JSON.stringify(plan);
  assert.equal(jsonStr.includes('"position"'), false);
  assert.equal(jsonStr.includes('"left"'), false);
  assert.equal(jsonStr.includes('"top"'), false);
  assert.equal(jsonStr.includes('"x"'), false);
  assert.equal(jsonStr.includes('"y"'), false);
});

test('TEST 16: No Fabric objects/functions exist in the plan', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1'] }]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  for (const key of Object.keys(plan)) {
    assert.notEqual(typeof plan[key], 'function');
  }
});

test('TEST 17: JSON.stringify/JSON.parse round trip succeeds', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1'] }]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  const serialized = JSON.stringify(plan);
  const deserialized = JSON.parse(serialized);

  assert.deepEqual(plan, deserialized);
});

test('TEST 18: Input model is not mutated', () => {
  const model = workspace([shape('s1'), text('t1', 'Hello')]);
  const modelBefore = JSON.stringify(model);
  const rawPlan = { document: { sections: [{ id: 'sec1', type: 'content', objectIds: ['s1'] }] } };

  validateOrganizationPlan(model, rawPlan);
  assert.equal(JSON.stringify(model), modelBefore);
});

test('TEST 19: Same model + same AI response produces identical plan', () => {
  const model = workspace([shape('s2'), shape('s1')]);
  const rawPlan = {
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s2', 's1'] }]
    }
  };

  const first = JSON.stringify(validateOrganizationPlan(model, rawPlan));
  const second = JSON.stringify(validateOrganizationPlan(model, rawPlan));

  assert.equal(first, second);
});

test('TEST 20: Existing legacy top-level sections response is normalized cleanly', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    workspaceType: 'notes',
    sections: [{ id: 'sec1', type: 'notes', objectIds: ['s1'] }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.version, 2);
  assert.equal(plan.document.sections.length, 1);
  assert.equal(plan.document.sections[0].id, 'sec1');
});

// --- Additional v2 contract tests ---

test('TEST 21: Relationship evidence defaults to empty array when not provided', () => {
  const model = workspace([shape('s1'), shape('s2')]);
  const rawPlan = {
    relationships: [{
      sourceObjectId: 's1',
      targetObjectIds: ['s2'],
      type: 'heading-body'
    }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.deepEqual(plan.relationships[0].evidence, []);
});

test('TEST 22: Relationship confidence defaults to null when not provided', () => {
  const model = workspace([shape('s1'), shape('s2')]);
  const rawPlan = {
    relationships: [{
      sourceObjectId: 's1',
      targetObjectIds: ['s2'],
      type: 'heading-body'
    }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.relationships[0].confidence, null);
});

test('TEST 23: New relationship types from v2 registry are accepted', () => {
  const model = workspace([shape('s1'), shape('s2')]);
  const rawPlan = {
    relationships: [
      { sourceObjectId: 's1', targetObjectIds: ['s2'], type: 'connector-link' },
      { sourceObjectId: 's1', targetObjectIds: ['s2'], type: 'parent-child' },
      { sourceObjectId: 's1', targetObjectIds: ['s2'], type: 'note-group' },
      { sourceObjectId: 's1', targetObjectIds: ['s2'], type: 'label-of' },
      { sourceObjectId: 's1', targetObjectIds: ['s2'], type: 'related-content' }
    ]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.relationships.length, 5);
  const types = plan.relationships.map((r) => r.type);
  assert.ok(types.includes('connector-link'));
  assert.ok(types.includes('parent-child'));
  assert.ok(types.includes('note-group'));
  assert.ok(types.includes('label-of'));
  assert.ok(types.includes('related-content'));
});

test('TEST 24: Invalid relationship type is rejected', () => {
  const model = workspace([shape('s1'), shape('s2')]);
  const rawPlan = {
    relationships: [{ sourceObjectId: 's1', targetObjectIds: ['s2'], type: 'invented-nonsense-type' }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.relationships.length, 0);
});

test('TEST 25: Bridge field sections matches document.sections', () => {
  const model = workspace([shape('s1'), shape('s2')]);
  const rawPlan = {
    document: {
      sections: [
        { id: 'sec1', type: 'content', objectIds: ['s1'] },
        { id: 'sec2', type: 'notes', objectIds: ['s2'] }
      ]
    }
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  // Bridge field (deprecated) must match document.sections for layout engine compat
  assert.strictEqual(plan.sections, plan.document.sections);
});
