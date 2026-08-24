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

const connector = (id, sourceShapeId, targetShapeId) => ({
  id,
  type: 'connector',
  position: { x: 100, y: 100 },
  size: { width: 120, height: 12 },
  relationshipMetadata: { sourceShapeId, targetShapeId }
});

test('TEST 1: Valid Omni plan passes unchanged', () => {
  const model = workspace([
    text('t1', 'Title'),
    shape('s1'),
    shape('s2')
  ]);
  const rawPlan = {
    version: 1,
    workspaceType: 'notes',
    hierarchy: [{ type: 'document_root', titleObjectId: 't1', sections: ['sec1'] }],
    sections: [{ id: 'sec1', type: 'notes', titleObjectId: 't1', purpose: 'Group', layoutHint: 'grid', objectIds: ['t1', 's1', 's2'] }],
    relationships: [{ sourceObjectId: 't1', targetObjectIds: ['s1', 's2'], type: 'notes-heading', confidence: 0.95 }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.workspaceType, 'notes');
  assert.equal(plan.sections[0].objectIds.length, 3);
  assert.equal(plan.unassignedObjectIds.length, 0);
});

test('TEST 2: Unknown object ID is removed', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    sections: [{ id: 'sec1', type: 'notes', objectIds: ['s1', 'fake_id_999'] }],
    relationships: [{ sourceObjectId: 'fake_source', targetObjectIds: ['s1'], type: 'heading-body' }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.deepEqual(plan.sections[0].objectIds, ['s1']);
  assert.equal(plan.relationships.length, 0);
});

test('TEST 3: Omitted object appears in unassignedObjectIds', () => {
  const model = workspace([shape('s1'), shape('s2')]);
  const rawPlan = {
    sections: [{ id: 'sec1', type: 'notes', objectIds: ['s1'] }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.deepEqual(plan.unassignedObjectIds, ['s2']);
});

test('TEST 4: Linked shape/text cannot be separated into different sections', () => {
  const s1 = shape('s1', { relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = text('t1', 'Inside', { relationshipMetadata: { parentShapeId: 's1' } });
  const model = workspace([s1, t1]);

  const rawPlan = {
    sections: [
      { id: 'secA', type: 'diagram', objectIds: ['s1'] },
      { id: 'secB', type: 'notes', objectIds: ['t1'] }
    ]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  const secA = plan.sections.find((s) => s.id === 'secA');
  const secB = plan.sections.find((s) => s.id === 'secB');

  assert.ok(secA.objectIds.includes('s1') && secA.objectIds.includes('t1'));
  assert.equal(secB.objectIds.includes('t1'), false);
});

test('TEST 5: Stale attachedTextId does not create a false relationship', () => {
  const s1 = shape('s1', { relationshipMetadata: { attachedTextId: 'deleted_t99' } });
  const model = workspace([s1]);
  const rawPlan = {
    sections: [{ id: 'sec1', type: 'mixed', objectIds: ['s1'] }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.deepEqual(plan.sections[0].objectIds, ['s1']);
  assert.equal(plan.unassignedObjectIds.length, 0);
});

test('TEST 6: Valid recreated shape/text relationship remains intact', () => {
  const s1 = shape('s1', { relationshipMetadata: { attachedTextId: 'recreated_t1' } });
  const t1 = text('recreated_t1', 'New Text', { relationshipMetadata: { parentShapeId: 's1' } });
  const model = workspace([s1, t1]);

  const rawPlan = {
    sections: [{ id: 'sec1', type: 'diagram', objectIds: ['s1', 'recreated_t1'] }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.ok(plan.sections[0].objectIds.includes('s1'));
  assert.ok(plan.sections[0].objectIds.includes('recreated_t1'));
});

test('TEST 7: Invalid connector source is rejected', () => {
  const conn = connector('c1', 'fake_source', 's2');
  const s2 = shape('s2');
  const model = workspace([conn, s2]);

  const rawPlan = {
    relationships: [{ sourceObjectId: 'fake_source', targetObjectIds: ['s2'], type: 'connects_to' }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.relationships.length, 0);
});

test('TEST 8: Invalid connector target is rejected', () => {
  const conn = connector('c1', 's1', 'fake_target');
  const s1 = shape('s1');
  const model = workspace([conn, s1]);

  const rawPlan = {
    relationships: [{ sourceObjectId: 's1', targetObjectIds: ['fake_target'], type: 'connects_to' }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.relationships.length, 0);
});

test('TEST 9: Unknown relationship type is removed', () => {
  const model = workspace([shape('s1'), shape('s2')]);
  const rawPlan = {
    relationships: [{ sourceObjectId: 's1', targetObjectIds: ['s2'], type: 'magic_telepathy_link' }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.relationships.length, 0);
});

test('TEST 10: Unknown section type is safely handled', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    sections: [{ id: 'sec1', type: 'quantum_holographic_superposition', objectIds: ['s1'] }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.sections[0].type, 'mixed');
});

test('TEST 11: Invalid titleObjectId is removed', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    hierarchy: [{ type: 'document_root', titleObjectId: 'ghost_title', sections: ['sec1'] }],
    sections: [{ id: 'sec1', type: 'mixed', titleObjectId: 'fake_title', objectIds: ['s1'] }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.document.titleObjectId, null);
  assert.equal(plan.document.sections[0].titleObjectId, null);
});

test('TEST 12: Duplicate object IDs are handled deterministically', () => {
  const model = workspace([shape('s1'), shape('s2')]);
  const rawPlan = {
    sections: [
      { id: 'sec1', type: 'notes', objectIds: ['s1', 's2'] },
      { id: 'sec2', type: 'notes', objectIds: ['s1', 's2'] }
    ]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.deepEqual(plan.document.sections[0].objectIds, ['s1', 's2']);
  assert.deepEqual(plan.document.sections[1].objectIds, []);
});

test('TEST 13: Cyclic hierarchy is repaired/rejected', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = {
    hierarchy: [
      { type: 'document_root', sections: ['sec1'] },
      { type: 'sub_root', sections: ['sec1'] }
    ],
    sections: [{ id: 'sec1', type: 'mixed', objectIds: ['s1'] }]
  };

  const plan = validateOrganizationPlan(model, rawPlan);
  assert.equal(plan.document.sections.length, 1);
  assert.deepEqual(plan.document.sections[0].id, 'sec1');
});

test('TEST 14: Input WorkspaceModel is not mutated', () => {
  const model = workspace([shape('s1'), text('t1', 'Hello')]);
  const before = JSON.stringify(model);
  const rawPlan = { sections: [{ id: 'sec1', type: 'notes', objectIds: ['s1'] }] };

  validateOrganizationPlan(model, rawPlan);
  assert.equal(JSON.stringify(model), before);
});

test('TEST 15: Input Omni plan is not mutated', () => {
  const model = workspace([shape('s1')]);
  const rawPlan = { sections: [{ id: 'sec1', type: 'invalid_type', objectIds: ['s1', 'fake'] }] };
  const before = JSON.stringify(rawPlan);

  validateOrganizationPlan(model, rawPlan);
  assert.equal(JSON.stringify(rawPlan), before);
});

test('TEST 16: Same input produces byte-equivalent JSON output', () => {
  const model = workspace([shape('s2'), shape('s1'), text('t1', 'Sample')]);
  const rawPlan = {
    sections: [
      { id: 'secB', type: 'notes', objectIds: ['s2', 's1'] },
      { id: 'secA', type: 'heading', objectIds: ['t1'] }
    ]
  };

  const first = JSON.stringify(validateOrganizationPlan(model, rawPlan));
  const second = JSON.stringify(validateOrganizationPlan(model, rawPlan));

  assert.equal(first, second);
});
