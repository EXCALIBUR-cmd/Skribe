import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeWorkspace } from './analyzeWorkspace.js';

const model = (objects) => ({ version: 1, board: { objects } });

const text = (id, x, y, content, style = {}) => ({
  id,
  type: 'text',
  text: content,
  position: { x, y },
  size: { width: 120, height: 24 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  style,
  relationshipMetadata: {},
  relationships: [],
  metadata: {}
});

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

const link = (object, relationships, metadata = {}) => ({
  ...object,
  relationshipMetadata: metadata,
  relationships
});

const sectionContaining = (plan, objectId) => plan.sections.find((section) => section.objectIds.includes(objectId));

test('creates a heading candidate and notes section for nearby text', () => {
  const plan = analyzeWorkspace(model([
    text('heading_1', 100, 100, 'Authentication', { fontSize: 28, fontWeight: 'bold' }),
    text('note_1', 130, 150, 'JWT required', { fontSize: 14 }),
    text('note_2', 170, 180, 'OAuth support', { fontSize: 14 })
  ]));

  assert.equal(plan.textCandidates.find((candidate) => candidate.objectId === 'heading_1')?.role, 'heading');
  const section = sectionContaining(plan, 'note_1');
  assert.ok(['notes', 'heading'].includes(section.type));
  assert.equal(section.titleObjectId, 'heading_1');
});

test('detects a connected diagram without calculating layout coordinates', () => {
  const a = shape('shape_a', 0, 0);
  const b = shape('shape_b', 200, 0);
  const c = shape('shape_c', 400, 0);
  const connectorAB = link({ id: 'connector_ab', type: 'connector', position: { x: 100, y: 0 }, size: { width: 200, height: 10 }, metadata: {} }, [
    { type: 'connects_from', targetId: 'shape_a' },
    { type: 'connects_to', targetId: 'shape_b' }
  ], { sourceShapeId: 'shape_a', targetShapeId: 'shape_b' });
  const connectorBC = link({ id: 'connector_bc', type: 'connector', position: { x: 300, y: 0 }, size: { width: 200, height: 10 }, metadata: {} }, [
    { type: 'connects_from', targetId: 'shape_b' },
    { type: 'connects_to', targetId: 'shape_c' }
  ], { sourceShapeId: 'shape_b', targetShapeId: 'shape_c' });

  const plan = analyzeWorkspace(model([a, b, c, connectorAB, connectorBC]));
  const diagram = sectionContaining(plan, 'connector_ab');

  assert.equal(diagram.type, 'diagram');
  assert.equal(diagram.layoutHint, 'flow');
  assert.deepEqual(diagram.objectIds, ['connector_ab', 'connector_bc', 'shape_a', 'shape_b', 'shape_c']);
  assert.equal(Object.hasOwn(diagram, 'positions'), false);
});

test('keeps linked shape and text in one structural unit', () => {
  const linkedShape = link(shape('shape_1', 100, 100), [
    { type: 'contains_text', targetId: 'text_1' },
    { type: 'shared_element', targetId: 'text_1' }
  ], { attachedTextId: 'text_1' });
  const linkedText = link(text('text_1', 100, 100, 'Login'), [
    { type: 'contained_by', targetId: 'shape_1' },
    { type: 'shared_element', targetId: 'shape_1' }
  ], { parentShapeId: 'shape_1' });

  const plan = analyzeWorkspace(model([linkedShape, linkedText]));
  const unit = plan.structuralUnits.find((candidate) => candidate.objectIds.includes('shape_1'));

  assert.deepEqual(unit.objectIds, ['shape_1', 'text_1']);
  assert.equal(sectionContaining(plan, 'shape_1').objectIds.includes('text_1'), true);
});

test('preserves connector endpoint relationships as structural evidence', () => {
  const connector = link({ id: 'connector_1', type: 'connector', position: { x: 100, y: 0 }, size: { width: 100, height: 10 }, metadata: {} }, [
    { type: 'connects_from', targetId: 'shape_a' },
    { type: 'connects_to', targetId: 'shape_b' }
  ], { sourceShapeId: 'shape_a', targetShapeId: 'shape_b' });
  const plan = analyzeWorkspace(model([shape('shape_a', 0, 0), shape('shape_b', 200, 0), connector]));
  const diagram = sectionContaining(plan, 'connector_1');

  assert.ok(diagram.evidence.includes('connector-chain'));
  assert.equal(diagram.confidence, 'strong');
});

test('creates a medium-confidence sticky-note cluster candidate', () => {
  const notes = ['note_a', 'note_b', 'note_c'].map((id, index) => ({
    ...shape(id, index * 70, 0),
    type: 'note',
    metadata: { isStickyNote: true, noteColor: '#fff3a0' }
  }));
  const plan = analyzeWorkspace(model(notes));
  const notesSection = sectionContaining(plan, 'note_a');

  assert.equal(notesSection.type, 'notes');
  assert.equal(notesSection.confidence, 'medium');
  assert.ok(notesSection.evidence.includes('sticky-note-group'));
});

test('does not automatically group distant objects', () => {
  const plan = analyzeWorkspace(model([
    text('text_a', 0, 0, 'One'),
    text('text_b', 5000, 5000, 'Two')
  ]));

  assert.equal(plan.sections.length, 0);
  assert.deepEqual(plan.unassignedObjectIds, ['text_a', 'text_b']);
});

test('preserves freehand strokes as freeform sections', () => {
  const plan = analyzeWorkspace(model([{
    id: 'stroke_1',
    strokeId: 'stroke_1',
    type: 'stroke',
    position: { x: 50, y: 50 },
    size: { width: 100, height: 80 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    relationships: [],
    relationshipMetadata: {},
    metadata: { isVectorStroke: true }
  }]));

  const section = sectionContaining(plan, 'stroke_1');
  assert.equal(section.type, 'freeform');
  assert.deepEqual(plan.unassignedObjectIds, []);
});

test('accounts for mixed workspace content exactly once', () => {
  const objects = [
    text('heading_1', 0, 0, 'Authentication', { fontSize: 28, fontWeight: 'bold' }),
    { ...shape('note_1', 20, 50), type: 'note', metadata: { isStickyNote: true } },
    { ...shape('stroke_1', 1000, 1000), type: 'stroke' },
    shape('unrelated_1', 4000, 4000)
  ];
  const plan = analyzeWorkspace(model(objects));
  const represented = [
    ...plan.sections.flatMap((section) => section.objectIds),
    ...plan.unassignedObjectIds
  ];

  assert.deepEqual([...represented].sort(), objects.map((object) => object.id).sort());
  assert.equal(new Set(represented).size, objects.length);
});

test('analysis is deterministic and does not mutate the input model', () => {
  const input = model([
    text('text_2', 50, 50, 'B'),
    text('text_1', 0, 0, 'A')
  ]);
  const before = JSON.stringify(input);
  const first = analyzeWorkspace(input);
  const second = analyzeWorkspace(input);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
});
