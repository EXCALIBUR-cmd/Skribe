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

const text = (id, x, y, value, style = {}, extra = {}) => ({
  id,
  type: 'text',
  text: value,
  position: { x, y },
  size: { width: 180, height: 28 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  style: { fontSize: 16, ...style },
  relationshipMetadata: {},
  relationships: [],
  metadata: {},
  ...extra
});

const note = (id, x, y, color = '#fff3a0', extra = {}) => ({
  ...shape(id, x, y, extra),
  type: 'note',
  metadata: { isStickyNote: true, noteColor: color, ...extra.metadata }
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

const stroke = (id, x, y, extra = {}) => ({
  id,
  strokeId: id,
  type: 'stroke',
  position: { x, y },
  size: { width: 40, height: 40 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  vector: { color: '#000000', width: 2, opacity: 1, style: 'solid' },
  relationshipMetadata: {},
  relationships: [],
  metadata: { isVectorStroke: true },
  ...extra
});

const createPlan = (objects) => {
  const model = workspace(objects);
  const plan = analyzeWorkspace(model);
  const proposal = createLayoutProposal(plan, model);
  return { model, plan, proposal };
};

const getPlacement = (proposal, id) => proposal.placements.find((p) => p.objectId === id);

const boxesOverlap = (a, b) => (
  a.bounds.x < b.bounds.x + b.bounds.width &&
  a.bounds.x + a.bounds.width > b.bounds.x &&
  a.bounds.y < b.bounds.y + b.bounds.height &&
  a.bounds.y + a.bounds.height > b.bounds.y
);

test('FIXTURE 1: Lecture notes - title, headings, paragraphs', () => {
  const objects = [
    text('t1', 100, 50, 'Computer Science 101', { fontSize: 32, fontWeight: 'bold' }),
    text('h1', 100, 150, 'Data Structures', { fontSize: 24, fontWeight: 'bold' }),
    text('p1', 100, 200, 'Arrays store elements in contiguous memory.', { fontSize: 16 }),
    text('p2', 100, 240, 'Linked lists use node pointers.', { fontSize: 16 }),
    text('h2', 100, 400, 'Algorithms', { fontSize: 24, fontWeight: 'bold' }),
    text('p3', 100, 450, 'Binary search runs in logarithmic time.', { fontSize: 16 })
  ];

  const { proposal } = createPlan(objects);
  const pTitle = getPlacement(proposal, 't1');
  const pH1 = getPlacement(proposal, 'h1');
  const pP1 = getPlacement(proposal, 'p1');
  const pH2 = getPlacement(proposal, 'h2');
  const pP3 = getPlacement(proposal, 'p3');

  assert.ok(pTitle.position.y < pH1.position.y);
  assert.ok(pH1.position.y < pP1.position.y);
  assert.ok(pP1.position.y < pH2.position.y);
  assert.ok(pH2.position.y < pP3.position.y);
});

test('FIXTURE 2: Meeting notes - title, sections, sticky notes', () => {
  const objects = [
    text('t1', 100, 50, 'Sprint Planning Notes', { fontSize: 32, fontWeight: 'bold' }),
    text('h1', 100, 150, 'Action Items', { fontSize: 24, fontWeight: 'bold' }),
    note('n1', 100, 220),
    note('n2', 240, 220),
    note('n3', 380, 220)
  ];

  const { proposal } = createPlan(objects);
  const pH1 = getPlacement(proposal, 'h1');
  const pN1 = getPlacement(proposal, 'n1');
  const pN2 = getPlacement(proposal, 'n2');

  assert.ok(pH1.position.y < pN1.position.y);
  assert.ok(pH1.position.y < pN2.position.y);
});

test('FIXTURE 3: Brainstorm - heading, notes, freehand annotations', () => {
  const objects = [
    text('h1', 100, 50, 'Feature Ideas', { fontSize: 24, fontWeight: 'bold' }),
    note('n1', 100, 120),
    stroke('s1', 120, 130)
  ];

  const { proposal } = createPlan(objects);
  const pN1 = getPlacement(proposal, 'n1');
  const pS1 = getPlacement(proposal, 's1');

  assert.ok(pN1);
  assert.ok(pS1);
  assert.ok(pS1.unitId);
});

test('FIXTURE 4: Flowchart - nodes, connectors, diagram title', () => {
  const objects = [
    text('dt1', 100, 50, 'Authentication Flow', { fontSize: 26, fontWeight: 'bold' }),
    shape('n1', 100, 150),
    shape('n2', 300, 150),
    shape('n3', 500, 150),
    connector('c1', 'n1', 'n2', 200, 150),
    connector('c2', 'n2', 'n3', 400, 150)
  ];

  const { proposal } = createPlan(objects);
  const pN1 = getPlacement(proposal, 'n1');
  const pN2 = getPlacement(proposal, 'n2');
  const pN3 = getPlacement(proposal, 'n3');
  const diagSection = proposal.sections.find((s) => s.type === 'diagram');

  assert.ok(diagSection);
  assert.ok(pN1.position.x < pN2.position.x);
  assert.ok(pN2.position.x < pN3.position.x);
});

test('FIXTURE 5: System architecture - connected shapes, labels', () => {
  const objects = [
    shape('client', 0, 0),
    shape('api', 200, 0),
    shape('db', 400, 0),
    connector('conn1', 'client', 'api', 100, 0),
    connector('conn2', 'api', 'db', 300, 0)
  ];

  const { proposal } = createPlan(objects);
  const pClient = getPlacement(proposal, 'client');
  const pApi = getPlacement(proposal, 'api');
  const pDb = getPlacement(proposal, 'db');

  assert.ok(pClient.position.x < pApi.position.x);
  assert.ok(pApi.position.x < pDb.position.x);
});

test('FIXTURE 6: Mixed workspace - text, diagram, sticky notes, freehand', () => {
  const objects = [
    text('t1', 100, 50, 'System Overview', { fontSize: 32, fontWeight: 'bold' }),
    shape('n1', 100, 150),
    shape('n2', 300, 150),
    connector('c1', 'n1', 'n2', 200, 150),
    note('sticky1', 100, 400, '#ef4444'),
    note('sticky2', 240, 400, '#ef4444'),
    stroke('ann1', 1000, 1000)
  ];

  const { proposal } = createPlan(objects);
  assert.ok(proposal.sections.length >= 2);
  assert.equal(proposal.placements.length, objects.length);
});

test('FIXTURE 7: Shape + recreated text linked unit', () => {
  const shapeObj = shape('s1', 100, 100, {
    elementId: 'elem1',
    relationshipMetadata: { attachedTextId: 't1' },
    relationships: [
      { type: 'contains_text', targetId: 't1' },
      { type: 'shared_element', targetId: 't1' }
    ]
  });
  const textObj = text('t1', 100, 100, 'Inside Text', {}, {
    elementId: 'elem1',
    relationshipMetadata: { parentShapeId: 's1' },
    relationships: [
      { type: 'contained_by', targetId: 's1' },
      { type: 'shared_element', targetId: 's1' }
    ]
  });

  const { proposal } = createPlan([shapeObj, textObj]);
  const pS1 = getPlacement(proposal, 's1');
  const pT1 = getPlacement(proposal, 't1');

  assert.equal(pS1.unitId, pT1.unitId);
  assert.equal(pT1.position.x - pS1.position.x, 0);
  assert.equal(pT1.position.y - pS1.position.y, 0);
});

test('FIXTURE 8: Sparse workspace', () => {
  const objects = [
    text('t1', 0, 0, 'Isolated Text 1'),
    shape('s1', 2000, 2000)
  ];

  const { proposal } = createPlan(objects);
  assert.equal(proposal.placements.length, 2);
  assert.ok(proposal.canvasBounds.width > 0);
});

test('FIXTURE 9: Dense workspace', () => {
  const objects = Array.from({ length: 20 }, (_, i) => note(`note_${i}`, (i % 5) * 60, Math.floor(i / 5) * 60));
  const { proposal } = createPlan(objects);

  assert.equal(proposal.placements.length, 20);
  assert.ok(proposal.canvasBounds.height > 0);
});

test('FIXTURE 10: Multiple independent sections', () => {
  const objects = [
    text('h1', 100, 50, 'Section 1', { fontSize: 24, fontWeight: 'bold' }),
    text('p1', 100, 100, 'Content 1', { fontSize: 16 }),
    text('h2', 100, 300, 'Section 2', { fontSize: 24, fontWeight: 'bold' }),
    text('p2', 100, 350, 'Content 2', { fontSize: 16 })
  ];

  const { proposal } = createPlan(objects);
  const sec1 = proposal.sections.find((s) => s.titleObjectId === 'h1');
  const sec2 = proposal.sections.find((s) => s.titleObjectId === 'h2');

  assert.ok(sec1);
  assert.ok(sec2);
  assert.equal(boxesOverlap(sec1, sec2), false);
});
