import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeWorkspace } from './analyzeWorkspace.js';
import { createLayoutProposal } from './layoutEngine.js';

const workspace = (objects) => ({ version: 1, board: { objects } });

const shape = (id, x, y, extra = {}) => ({
  id,
  type: 'shape',
  shapeType: 'rect',
  text: null,
  position: { x, y },
  size: { width: 120, height: 80 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  relationshipMetadata: {},
  relationships: [],
  metadata: {},
  ...extra
});

const text = (id, x, y, value, extra = {}) => ({
  id,
  type: 'text',
  text: value,
  position: { x, y },
  size: { width: 120, height: 24 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  relationshipMetadata: {},
  relationships: [],
  metadata: {},
  ...extra
});

const connector = (id, sourceShapeId, targetShapeId, x, y) => ({
  id,
  type: 'connector',
  position: { x, y },
  size: { width: 120, height: 12 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  relationshipMetadata: { sourceShapeId, targetShapeId },
  relationships: [
    { type: 'connects_from', targetId: sourceShapeId },
    { type: 'connects_to', targetId: targetShapeId }
  ],
  metadata: {}
});

const createPlan = (objects) => {
  const model = workspace(objects);
  return { model, plan: analyzeWorkspace(model) };
};

const getPlacement = (proposal, objectId) => proposal.placements.find((placement) => placement.objectId === objectId);

const boxesOverlap = (first, second) => (
  first.bounds.x < second.bounds.x + second.bounds.width &&
  first.bounds.x + first.bounds.width > second.bounds.x &&
  first.bounds.y < second.bounds.y + second.bounds.height &&
  first.bounds.y + first.bounds.height > second.bounds.y
);

test('produces a placement for a single unassigned shape', () => {
  const { model, plan } = createPlan([shape('shape_1', 0, 0)]);
  const proposal = createLayoutProposal(plan, model);
  const placement = getPlacement(proposal, 'shape_1');

  assert.ok(placement);
  assert.equal(placement.objectId, 'shape_1');
  assert.equal(proposal.unassignedObjectIds.includes('shape_1'), true);
});

test('places a heading above nearby notes', () => {
  const { model, plan } = createPlan([
    text('heading_1', 0, 0, 'Authentication', { style: { fontSize: 28, fontWeight: 'bold' } }),
    { ...shape('note_1', 20, 80), type: 'note', metadata: { isStickyNote: true } },
    { ...shape('note_2', 100, 80), type: 'note', metadata: { isStickyNote: true } }
  ]);
  const proposal = createLayoutProposal(plan, model);
  const section = proposal.sections.find((candidate) => candidate.titleObjectId === 'heading_1');
  const heading = getPlacement(proposal, 'heading_1');
  const note = getPlacement(proposal, 'note_1');

  assert.ok(section);
  assert.ok(heading.position.y < note.position.y);
});

test('lays a horizontal connected diagram from left to right', () => {
  const objects = [
    shape('shape_a', 0, 0),
    shape('shape_b', 200, 0),
    shape('shape_c', 400, 0),
    connector('connector_ab', 'shape_a', 'shape_b', 100, 0),
    connector('connector_bc', 'shape_b', 'shape_c', 300, 0)
  ];
  const { model, plan } = createPlan(objects);
  const proposal = createLayoutProposal(plan, model);

  assert.equal(proposal.sections.find((section) => section.type === 'diagram')?.graph.direction, 'horizontal');
  assert.ok(getPlacement(proposal, 'shape_a').position.x < getPlacement(proposal, 'shape_b').position.x);
  assert.ok(getPlacement(proposal, 'shape_b').position.x < getPlacement(proposal, 'shape_c').position.x);
  assert.ok(getPlacement(proposal, 'connector_ab'));
});

test('lays a vertical connected diagram from top to bottom', () => {
  const objects = [
    shape('shape_a', 0, 0),
    shape('shape_b', 0, 200),
    shape('shape_c', 0, 400),
    connector('connector_ab', 'shape_a', 'shape_b', 0, 100),
    connector('connector_bc', 'shape_b', 'shape_c', 0, 300)
  ];
  const { model, plan } = createPlan(objects);
  const proposal = createLayoutProposal(plan, model);

  assert.equal(proposal.sections.find((section) => section.type === 'diagram')?.graph.direction, 'vertical');
  assert.ok(getPlacement(proposal, 'shape_a').position.y < getPlacement(proposal, 'shape_b').position.y);
  assert.ok(getPlacement(proposal, 'shape_b').position.y < getPlacement(proposal, 'shape_c').position.y);
});

test('keeps linked shape and text in one layout unit with relative offset', () => {
  const linkedShape = shape('shape_1', 100, 100, {
    elementId: 'element_1',
    relationshipMetadata: { attachedTextId: 'text_1' },
    relationships: [
      { type: 'contains_text', targetId: 'text_1' },
      { type: 'shared_element', targetId: 'text_1' }
    ]
  });
  const linkedText = text('text_1', 100, 100, 'Login', {
    elementId: 'element_1',
    relationshipMetadata: { parentShapeId: 'shape_1' },
    relationships: [
      { type: 'contained_by', targetId: 'shape_1' },
      { type: 'shared_element', targetId: 'shape_1' }
    ]
  });
  const { model, plan } = createPlan([linkedShape, linkedText]);
  const proposal = createLayoutProposal(plan, model);
  const shapePlacement = getPlacement(proposal, 'shape_1');
  const textPlacement = getPlacement(proposal, 'text_1');

  assert.equal(shapePlacement.unitId, textPlacement.unitId);
  assert.deepEqual({
    x: textPlacement.position.x - shapePlacement.position.x,
    y: textPlacement.position.y - shapePlacement.position.y
  }, { x: 0, y: 0 });
});

test('arranges multiple sticky notes in a deterministic grid', () => {
  const objects = ['note_a', 'note_b', 'note_c'].map((id, index) => ({
    ...shape(id, index * 60, 0),
    type: 'note',
    metadata: { isStickyNote: true }
  }));
  const { model, plan } = createPlan(objects);
  const proposal = createLayoutProposal(plan, model);
  const positions = objects.map((object) => getPlacement(proposal, object.id).position);

  assert.notDeepEqual(positions[0], positions[1]);
  assert.notDeepEqual(positions[1], positions[2]);
});

test('keeps mixed sections separate and non-overlapping', () => {
  const { model, plan } = createPlan([
    text('heading_1', 0, 0, 'Planning', { style: { fontSize: 28, fontWeight: 'bold' } }),
    { ...shape('note_1', 60, 60), type: 'note', metadata: { isStickyNote: true } },
    shape('far_shape', 5000, 5000)
  ]);
  const proposal = createLayoutProposal(plan, model);

  for (let firstIndex = 0; firstIndex < proposal.sections.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < proposal.sections.length; secondIndex += 1) {
      assert.equal(boxesOverlap(proposal.sections[firstIndex], proposal.sections[secondIndex]), false);
    }
  }
});

test('gives unassigned objects safe fallback placements', () => {
  const objects = [shape('far_a', 0, 0), shape('far_b', 5000, 5000)];
  const { model, plan } = createPlan(objects);
  const proposal = createLayoutProposal(plan, model);

  assert.deepEqual(proposal.unassignedObjectIds, ['far_a', 'far_b']);
  assert.ok(getPlacement(proposal, 'far_a'));
  assert.ok(getPlacement(proposal, 'far_b'));
});

test('respects large dimensions and preserves rotation', () => {
  const object = shape('large_shape', 0, 0, {
    size: { width: 500, height: 300 },
    rotation: 30
  });
  const { model, plan } = createPlan([object]);
  const proposal = createLayoutProposal(plan, model);
  const placement = getPlacement(proposal, 'large_shape');

  assert.equal(placement.rotation, 30);
  assert.ok(placement.bounds.width > 500);
  assert.ok(placement.bounds.height > 300);
});

test('is deterministic, immutable, and preserves object identity', () => {
  const objects = [shape('shape_b', 200, 0), shape('shape_a', 0, 0)];
  const { model, plan } = createPlan(objects);
  const before = JSON.stringify(plan);
  const first = createLayoutProposal(plan, model);
  const second = createLayoutProposal(plan, model);
  const sourceIds = objects.map((object) => object.id).sort();
  const placementIds = first.placements.map((placement) => placement.objectId).sort();

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(plan), before);
  assert.deepEqual(placementIds, sourceIds);
});
