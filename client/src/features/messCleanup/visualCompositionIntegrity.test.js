import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectWorkspaceVisualUnits,
  buildVisualObjectModel,
  reconstructVisualUnits,
  assertShapeGeometryIntegrity,
  assertPlacementsWithinCanvas
} from './visualUnits.js';
import { createNotebookLayoutProposal } from './notebookLayoutEngine.js';

const shape = (id, x = 100, y = 100, w = 140, h = 90, extra = {}) => ({
  id,
  type: 'shape',
  shapeType: 'rect',
  position: { x, y },
  size: { width: w, height: h },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 1,
  relationshipMetadata: {},
  ...extra
});

const text = (id, val, x = 100, y = 100, w = 140, h = 28, extra = {}) => ({
  id,
  type: 'text',
  text: val,
  position: { x, y },
  size: { width: w, height: h },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 2,
  relationshipMetadata: {},
  ...extra
});

const note = (id, val, x = 200, y = 200, w = 160, h = 160, extra = {}) => ({
  id,
  type: 'note',
  text: val,
  position: { x, y },
  size: { width: w, height: h },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 1,
  relationshipMetadata: {},
  metadata: { isStickyNote: true },
  ...extra
});

const connector = (id, src, tgt, x = 200, y = 100, w = 100, h = 12, extra = {}) => ({
  id,
  type: 'connector',
  position: { x, y },
  size: { width: w, height: h },
  rotation: 0,
  scale: { x: 1, y: 1 },
  relationshipMetadata: { sourceShapeId: src, targetShapeId: tgt },
  ...extra
});

const stroke = (id, x = 50, y = 50, w = 40, h = 40, extra = {}) => ({
  id,
  type: 'stroke',
  position: { x, y },
  size: { width: w, height: h },
  rotation: 0,
  scale: { x: 1, y: 1 },
  relationshipMetadata: {},
  metadata: { isVectorStroke: true },
  ...extra
});

const getPlacement = (proposal, id) => proposal.placements.find((p) => p.objectId === id);

// TEST 1: All objects accounted for
test('TEST 1: All objects accounted for', () => {
  const objects = [shape('s1'), text('t1', 'A'), note('n1', 'N'), stroke('st1')];
  const model = { board: { objects } };
  const proposal = createNotebookLayoutProposal(model, model);

  assert.equal(proposal.placements.length, objects.length);
  objects.forEach((obj) => {
    assert.ok(proposal.placements.some((p) => p.objectId === obj.id));
  });
});

// TEST 2: No duplicate memberships
test('TEST 2: No duplicate memberships', () => {
  const objects = [shape('s1'), text('t1', 'A'), note('n1', 'N')];
  const model = { board: { objects } };
  const proposal = createNotebookLayoutProposal(model, model);

  const placedIds = proposal.placements.map((p) => p.objectId);
  assert.equal(placedIds.length, new Set(placedIds).size);
});

// TEST 3: No missing objects
test('TEST 3: No missing objects (missingObjectIds is empty)', () => {
  const objects = [shape('s1'), text('t1', 'A')];
  const model = { board: { objects } };
  const proposal = createNotebookLayoutProposal(model, model);

  assert.deepEqual(proposal.metadata.diagnostics.visualIntegrity.missingObjectIds, []);
});

// TEST 4: Shape geometry valid
test('TEST 4: Shape geometry valid', () => {
  const s = shape('s1', 100, 100, 150, 100);
  const model = { board: { objects: [s] } };
  const proposal = createNotebookLayoutProposal(model, model);
  const p = getPlacement(proposal, 's1');

  assert.ok(Number.isFinite(p.bounds.x));
  assert.ok(Number.isFinite(p.bounds.y));
  assert.ok(Number.isFinite(p.bounds.width));
  assert.ok(Number.isFinite(p.bounds.height));
});

// TEST 5: Shape dimensions positive
test('TEST 5: Shape dimensions positive', () => {
  const s = shape('s1', 100, 100, 140, 90);
  const model = { board: { objects: [s] } };
  const proposal = createNotebookLayoutProposal(model, model);

  proposal.placements.forEach((p) => {
    assert.ok(p.size.width > 0);
    assert.ok(p.size.height > 0);
  });
});

// TEST 6: Shape aspect ratio preserved
test('TEST 6: Shape aspect ratio preserved', () => {
  const s = shape('s1', 100, 100, 200, 100); // 2:1 ratio
  const model = { board: { objects: [s] } };
  const proposal = createNotebookLayoutProposal(model, model);
  const p = getPlacement(proposal, 's1');

  assert.equal(p.size.width / p.size.height, 2);
});

// TEST 7: Shape rotation valid
test('TEST 7: Shape rotation valid', () => {
  const s = shape('s1', 100, 100, 140, 90, { rotation: 30 });
  const model = { board: { objects: [s] } };
  const proposal = createNotebookLayoutProposal(model, model);
  const p = getPlacement(proposal, 's1');

  assert.equal(p.rotation, 30);
});

// TEST 8: Shape-label atomicity
test('TEST 8: Shape-label atomicity', () => {
  const s = shape('s1', 100, 100, 140, 90, { relationshipMetadata: { attachedTextId: 't1' } });
  const t = text('t1', 'Step 1', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s, t] } };
  const proposal = createNotebookLayoutProposal(model, model);

  const pS = getPlacement(proposal, 's1');
  const pT = getPlacement(proposal, 't1');
  assert.equal(pS.unitId, pT.unitId);
});

// TEST 9: Label center alignment
test('TEST 9: Label center alignment', () => {
  const s = shape('s1', 100, 100, 140, 90, { relationshipMetadata: { attachedTextId: 't1' } });
  const t = text('t1', 'Process', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s, t] } };
  const proposal = createNotebookLayoutProposal(model, model);

  const pS = getPlacement(proposal, 's1');
  const pT = getPlacement(proposal, 't1');
  assert.equal(pS.position.x, pT.position.x);
  assert.equal(pS.position.y, pT.position.y);
});

// TEST 10: Explanation association
test('TEST 10: Explanation association', () => {
  const s = shape('s1', 100, 100, 140, 90, { relationshipMetadata: { attachedTextId: 't1' } });
  const t = text('t1', 'Process', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 's1' } });
  const expl = text('t_expl', 'Testing note', 100, 200, 180, 28);
  const model = { board: { objects: [s, t, expl] } };
  const scene = { groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 't1', 't_expl'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);

  const pS = getPlacement(proposal, 's1');
  const pE = getPlacement(proposal, 't_expl');
  assert.equal(pS.unitId, pE.unitId);
});

// TEST 11: Connector source preserved
test('TEST 11: Connector source preserved', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 400, 100);
  const c = connector('c1', 'b1', 'b2');
  const model = { board: { objects: [b1, b2, c] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);

  const pC = getPlacement(proposal, 'c1');
  assert.equal(pC.relationshipMetadata.sourceShapeId, 'b1');
});

// TEST 12: Connector target preserved
test('TEST 12: Connector target preserved', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 400, 100);
  const c = connector('c1', 'b1', 'b2');
  const model = { board: { objects: [b1, b2, c] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);

  const pC = getPlacement(proposal, 'c1');
  assert.equal(pC.relationshipMetadata.targetShapeId, 'b2');
});

// TEST 13: Connector graph integrity
test('TEST 13: Connector graph integrity (preserved edges)', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 400, 100);
  const c = connector('c1', 'b1', 'b2');
  const model = { board: { objects: [b1, b2, c] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);

  assert.deepEqual(proposal.metadata.diagnostics.orphanConnectors, []);
});

// TEST 14: Connector not an independent block
test('TEST 14: Connector not an independent block', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 400, 100);
  const c = connector('c1', 'b1', 'b2');
  const model = { board: { objects: [b1, b2, c] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);

  const independentConnSections = proposal.sections.filter((s) => s.objectIds.length === 1 && s.objectIds.includes('c1'));
  assert.equal(independentConnSections.length, 0);
});

// TEST 15: Connector endpoint validity
test('TEST 15: Connector endpoint validity', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 400, 100);
  const c = connector('c1', 'b1', 'b2');
  const model = { board: { objects: [b1, b2, c] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);

  const pC = getPlacement(proposal, 'c1');
  const p1 = getPlacement(proposal, 'b1');
  const p2 = getPlacement(proposal, 'b2');

  assert.ok(pC.position.x >= p1.position.x && pC.position.x <= p2.position.x);
});

// TEST 16: Freeform atomicity
test('TEST 16: Freeform atomicity', () => {
  const strokes = [stroke('st1', 100, 100), stroke('st2', 130, 110), stroke('st3', 160, 105)];
  const model = { board: { objects: strokes } };
  const scene = { groups: [{ id: 'g_free', type: 'freeform', objectIds: ['st1', 'st2', 'st3'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);

  const p1 = getPlacement(proposal, 'st1');
  const p2 = getPlacement(proposal, 'st2');
  const p3 = getPlacement(proposal, 'st3');

  assert.equal(p1.unitId, p2.unitId);
  assert.equal(p2.unitId, p3.unitId);
});

// TEST 17: Freeform relative geometry preserved
test('TEST 17: Freeform relative geometry preserved', () => {
  const strokes = [stroke('st1', 100, 100), stroke('st2', 130, 110)];
  const model = { board: { objects: strokes } };
  const scene = { groups: [{ id: 'g_free', type: 'freeform', objectIds: ['st1', 'st2'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);

  const p1 = getPlacement(proposal, 'st1');
  const p2 = getPlacement(proposal, 'st2');

  assert.equal(p2.position.x - p1.position.x, 30);
  assert.equal(p2.position.y - p1.position.y, 10);
});

// TEST 18: Standalone text validity
test('TEST 18: Standalone text validity', () => {
  const t = text('t1', 'Normal text', 100, 100, 140, 28);
  const model = { board: { objects: [t] } };
  const proposal = createNotebookLayoutProposal(model, model);

  const p = getPlacement(proposal, 't1');
  assert.ok(p.size.width > 0 && p.size.height > 0);
});

// TEST 19: Standalone text horizontal normalization
test('TEST 19: Standalone text horizontal normalization', () => {
  const t = text('t_rot', 'Hello World', 100, 100, 140, 28, { rotation: 90 });
  const model = { board: { objects: [t] } };
  const proposal = createNotebookLayoutProposal(model, model);

  const p = getPlacement(proposal, 't_rot');
  assert.equal(p.rotation, 0);
});

// TEST 20: Sticky note validity
test('TEST 20: Sticky note validity', () => {
  const n = note('n1', 'Sticky note text', 100, 100, 160, 160);
  const model = { board: { objects: [n] } };
  const proposal = createNotebookLayoutProposal(model, model);

  const p = getPlacement(proposal, 'n1');
  assert.equal(p.size.width, 160);
  assert.equal(p.size.height, 160);
});

// TEST 21: Every placement inside canvas
test('TEST 21: Every placement inside canvas (assertPlacementsWithinCanvas passes)', () => {
  const objects = [
    shape('s1', 100, 100), shape('s2', 300, 100),
    shape('b1', 100, 300), shape('b2', 400, 300), connector('c1', 'b1', 'b2'),
    note('n1', 'Note', 100, 500)
  ];
  const model = { board: { objects } };
  const proposal = createNotebookLayoutProposal(model, model);

  assert.ok(assertPlacementsWithinCanvas(proposal));
});

// TEST 22: Canvas bounds contain all content
test('TEST 22: Canvas bounds contain all content', () => {
  const objects = [shape('s1', 100, 100), shape('s2', 500, 500)];
  const model = { board: { objects } };
  const proposal = createNotebookLayoutProposal(model, model);

  proposal.placements.forEach((p) => {
    assert.ok(p.bounds.x >= proposal.canvasBounds.x - 2);
    assert.ok(p.bounds.y >= proposal.canvasBounds.y - 2);
    assert.ok(p.bounds.x + p.bounds.width <= proposal.canvasBounds.x + proposal.canvasBounds.width + 2);
    assert.ok(p.bounds.y + p.bounds.height <= proposal.canvasBounds.y + proposal.canvasBounds.height + 2);
  });
});

// TEST 23: Preview scale finite and reasonable
test('TEST 23: Preview scale finite and reasonable (>= 0.6 in 900x500 modal)', () => {
  const objects = [shape('s1', 100, 100), shape('s2', 300, 100), note('n1', 'A', 500, 100)];
  const model = { board: { objects } };
  const proposal = createNotebookLayoutProposal(model, model);

  const modalW = 900 - 48;
  const modalH = 500 - 48;
  const scale = Math.min(modalW / proposal.canvasBounds.width, modalH / proposal.canvasBounds.height, 1);

  assert.ok(scale >= 0.6);
  assert.ok(Number.isFinite(scale));
});

// TEST 24: Deterministic LayoutProposal
test('TEST 24: Deterministic LayoutProposal', () => {
  const model = { board: { objects: [shape('s1', 100, 100), note('n1', 'Note', 300, 100)] } };
  const p1 = createNotebookLayoutProposal(model, model);
  const p2 = createNotebookLayoutProposal(model, model);

  assert.equal(JSON.stringify(p1), JSON.stringify(p2));
});

// TEST 25: Real-board mixed scene integrity
test('TEST 25: Real-board mixed scene integrity', () => {
  const objects = [
    shape('hex_1', 100, 100, 140, 100, { relationshipMetadata: { attachedTextId: 'txt_hex' } }),
    text('txt_hex', 'Process', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 'hex_1' } }),
    text('txt_under_hex', 'This is a testing phase.', 100, 220, 180, 28),
    shape('circle_1', 350, 100, 120, 120, { relationshipMetadata: { attachedTextId: 'txt_circle' } }),
    text('txt_circle', 'Circle', 350, 100, 120, 28, { relationshipMetadata: { parentShapeId: 'circle_1' } }),
    note('sticky_1', 'New Sticky Note', 950, 120, 160, 160),
    stroke('st_H', 50, 450, 25, 40), stroke('st_e', 80, 455, 20, 30), stroke('st_l1', 105, 450, 10, 40), stroke('st_l2', 120, 450, 10, 40), stroke('st_o', 135, 455, 20, 30), stroke('st_line', 50, 500, 110, 8),
    shape('box_1', 400, 300, 140, 80, { relationshipMetadata: { attachedTextId: 'txt_b1' } }),
    text('txt_b1', 'This is testing', 400, 300, 140, 28, { relationshipMetadata: { parentShapeId: 'box_1' } }),
    connector('conn_1', 'box_1', 'box_2', 540, 340, 100, 12),
    shape('box_2', 640, 300, 140, 80, { relationshipMetadata: { attachedTextId: 'txt_b2' } }),
    text('txt_b2', 'Test done', 640, 300, 140, 28, { relationshipMetadata: { parentShapeId: 'box_2' } }),
    shape('triangle_1', 700, 100, 120, 100, { relationshipMetadata: { attachedTextId: 'txt_tri' } }),
    text('txt_tri', 'Triangle', 700, 100, 120, 28, { relationshipMetadata: { parentShapeId: 'triangle_1' } }),
    text('txt_rot', 'Hello World!', 900, 400, 140, 28, { rotation: 90 })
  ];

  const model = { version: 1, board: { objects } };
  const proposal = createNotebookLayoutProposal(model, model);

  assert.ok(assertPlacementsWithinCanvas(proposal));
  assert.equal(proposal.placements.length, objects.length);
  assert.deepEqual(proposal.metadata.diagnostics.visualIntegrity.detachedTextIds, []);
  assert.deepEqual(proposal.metadata.diagnostics.visualIntegrity.orphanConnectorIds, []);
  assert.ok(proposal.metadata.diagnostics.visualIntegrity.geometryIntegrityPassed);
});
