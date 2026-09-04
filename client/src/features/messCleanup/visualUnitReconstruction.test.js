import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectWorkspaceVisualUnits,
  buildVisualObjectModel,
  reconstructVisualUnits,
} from './visualUnits.js';
import { createLayoutProposal } from './layoutEngine.js';

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

test('TEST 1: Shape dimensions preserved', () => {
  const s = shape('s1', 100, 100, 220, 110);
  const model = { board: { objects: [s] } };
  const proposal = createLayoutProposal(model, model);
  const p = getPlacement(proposal, 's1');

  assert.equal(p.size.width, 220);
  assert.equal(p.size.height, 110);
});

test('TEST 2: Shape rotation preserved', () => {
  const s = shape('s1', 100, 100, 140, 90, { rotation: 45 });
  const model = { board: { objects: [s] } };
  const proposal = createLayoutProposal(model, model);
  const p = getPlacement(proposal, 's1');

  assert.equal(p.rotation, 45);
});

test('TEST 3: Shape + attached label remains atomic', () => {
  const s = shape('s1', 100, 100, 140, 90, { relationshipMetadata: { attachedTextId: 't1' } });
  const t = text('t1', 'Hello', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s, t] } };
  const proposal = createLayoutProposal(model, model);

  const pS = getPlacement(proposal, 's1');
  const pT = getPlacement(proposal, 't1');
  assert.equal(pT.relationshipMetadata.parentShapeId, 's1');
  assert.equal(pS.relationshipMetadata.attachedTextId, 't1');
});

test('TEST 4: Label remains centered inside shape', () => {
  const s = shape('s1', 100, 100, 140, 90, { relationshipMetadata: { attachedTextId: 't1' } });
  const t = text('t1', 'Hello', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s, t] } };
  const proposal = createLayoutProposal(model, model);

  const pS = getPlacement(proposal, 's1');
  const pT = getPlacement(proposal, 't1');
  assert.equal(pT.bounds.x, 100);
  assert.equal(pT.bounds.y, 100 + (90 - 28) / 2);
});

test('TEST 5: Explanation remains associated with concept', () => {
  const s = shape('s1', 100, 100, 140, 90, { relationshipMetadata: { attachedTextId: 't1' } });
  const t = text('t1', 'Process', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 's1' } });
  const expl = text('t_expl', 'This is process detail', 100, 200, 180, 28);
  const model = { board: { objects: [s, t, expl] } };
  const scene = { groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 't1', 't_expl'] }] };
  const proposal = createLayoutProposal(scene, model);

  const pS = getPlacement(proposal, 's1');
  const pE = getPlacement(proposal, 't_expl');
  assert.ok(pS && pE);
  assert.equal(pE.bounds.x, 100);
  assert.equal(pE.bounds.y, 200);
});

test('TEST 6: Connector source preserved', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 400, 100);
  const c = connector('c1', 'b1', 'b2');
  const model = { board: { objects: [b1, b2, c] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createLayoutProposal(scene, model);

  const pC = getPlacement(proposal, 'c1');
  assert.equal(pC.relationshipMetadata.sourceShapeId, 'b1');
});

test('TEST 7: Connector target preserved', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 400, 100);
  const c = connector('c1', 'b1', 'b2');
  const model = { board: { objects: [b1, b2, c] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createLayoutProposal(scene, model);

  const pC = getPlacement(proposal, 'c1');
  assert.equal(pC.relationshipMetadata.targetShapeId, 'b2');
});

test('TEST 8: Horizontal connector remains horizontal when graph is horizontal', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 400, 100);
  const c = connector('c1', 'b1', 'b2', 250, 100);
  const model = { board: { objects: [b1, b2, c] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createLayoutProposal(scene, model);

  const p1 = getPlacement(proposal, 'b1');
  const p2 = getPlacement(proposal, 'b2');
  assert.equal(p1.position.y, p2.position.y);
  assert.ok(p1.position.x < p2.position.x);
});

test('TEST 9: Vertical connector remains vertical when graph is vertical', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 100, 400);
  const c = connector('c1', 'b1', 'b2', 100, 250);
  const model = { board: { objects: [b1, b2, c] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createLayoutProposal(scene, model);

  const p1 = getPlacement(proposal, 'b1');
  const p2 = getPlacement(proposal, 'b2');
  assert.equal(p1.position.x, p2.position.x);
  assert.ok(p1.position.y < p2.position.y);
});

test('TEST 10: Connector never becomes an independent layout block', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 400, 100);
  const c = connector('c1', 'b1', 'b2');
  const model = { board: { objects: [b1, b2, c] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createLayoutProposal(scene, model);

  
  const standaloneConnSection = proposal.sections.find((s) => s.objectIds.length === 1 && s.objectIds.includes('c1'));
  assert.equal(standaloneConnSection, undefined);
});

test('TEST 11: Multiple graph nodes remain connected', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 300, 100);
  const b3 = shape('b3', 500, 100);
  const c1 = connector('c1', 'b1', 'b2');
  const c2 = connector('c2', 'b2', 'b3');
  const model = { board: { objects: [b1, b2, b3, c1, c2] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'b3', 'c1', 'c2'] }] };
  const proposal = createLayoutProposal(scene, model);

  const p1 = getPlacement(proposal, 'b1');
  const p2 = getPlacement(proposal, 'b2');
  const p3 = getPlacement(proposal, 'b3');
  assert.ok(p1.position.x < p2.position.x && p2.position.x < p3.position.x);
});

test('TEST 12: Freehand strokes remain atomic and untouched', () => {
  const strokes = [
    stroke('st1', 100, 100, 20, 20),
    stroke('st2', 130, 110, 20, 20),
    stroke('st3', 160, 105, 20, 20)
  ];
  const model = { board: { objects: strokes } };
  const scene = { groups: [{ id: 'g_free', type: 'freeform', objectIds: ['st1', 'st2', 'st3'] }] };
  const proposal = createLayoutProposal(scene, model);

  const p1 = getPlacement(proposal, 'st1');
  const p2 = getPlacement(proposal, 'st2');
  const p3 = getPlacement(proposal, 'st3');

  assert.ok(p1 && p2 && p3);
  assert.equal(p1.bounds.x, 100);
  assert.equal(p2.bounds.x, 130);
  assert.equal(p3.bounds.x, 160);
});

test('TEST 13: Standalone text remains readable horizontally', () => {
  const t = text('txt_rot', 'Hello World', 100, 100, 140, 28, { rotation: 90 });
  const model = { board: { objects: [t] } };
  const proposal = createLayoutProposal(model, model);

  const p = getPlacement(proposal, 'txt_rot');
  assert.equal(p.rotation, 0); 
});

test('TEST 14: Attached text remains readable', () => {
  const s = shape('s1', 100, 100, 140, 90, { relationshipMetadata: { attachedTextId: 't1' } });
  const t = text('t1', 'Step 1', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s, t] } };
  const proposal = createLayoutProposal(model, model);

  const p = getPlacement(proposal, 't1');
  assert.equal(p.rotation, 0);
});

test('TEST 15: Text dimensions remain valid', () => {
  const t = text('t1', 'Some content', 100, 100, 140, 28);
  const model = { board: { objects: [t] } };
  const proposal = createLayoutProposal(model, model);

  const p = getPlacement(proposal, 't1');
  assert.ok(p.size.width > 0 && p.size.height > 0);
});

test('TEST 16: No zero-width shapes', () => {
  const s = shape('s1', 100, 100, 140, 90);
  const model = { board: { objects: [s] } };
  const proposal = createLayoutProposal(model, model);

  proposal.placements.forEach((p) => {
    assert.ok(p.size.width > 0, `Placement ${p.objectId} has 0 width`);
  });
});

test('TEST 17: No zero-height shapes', () => {
  const s = shape('s1', 100, 100, 140, 90);
  const model = { board: { objects: [s] } };
  const proposal = createLayoutProposal(model, model);

  proposal.placements.forEach((p) => {
    assert.ok(p.size.height > 0, `Placement ${p.objectId} has 0 height`);
  });
});

test('TEST 18: No orphan connectors', () => {
  const b1 = shape('b1', 100, 100);
  const b2 = shape('b2', 400, 100);
  const c = connector('c1', 'b1', 'b2');
  const model = { board: { objects: [b1, b2, c] } };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createLayoutProposal(scene, model);

  assert.deepEqual(proposal.metadata.diagnostics.orphanConnectors, []);
});

test('TEST 19: No detached labels', () => {
  const s = shape('s1', 100, 100, 140, 90, { relationshipMetadata: { attachedTextId: 't1' } });
  const t = text('t1', 'Process', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 's1' } });
  const model = { board: { objects: [s, t] } };
  const proposal = createLayoutProposal(model, model);

  assert.deepEqual(proposal.metadata.diagnostics.detachedLinkedObjects, []);
});

test('TEST 20: No duplicate object membership', () => {
  const objects = [shape('s1', 100, 100), text('t1', 'A', 100, 100), note('n1', 'N', 300, 100)];
  const model = { board: { objects } };
  const proposal = createLayoutProposal(model, model);

  const placedIds = proposal.placements.map((p) => p.objectId);
  const uniquePlacedIds = new Set(placedIds);
  assert.equal(placedIds.length, uniquePlacedIds.size);
});

test('TEST 21: All WorkspaceModel objects accounted for', () => {
  const objects = [shape('s1', 100, 100), text('t1', 'A', 100, 100), note('n1', 'N', 300, 100)];
  const model = { board: { objects } };
  const proposal = createLayoutProposal(model, model);

  objects.forEach((obj) => {
    assert.ok(proposal.placements.some((p) => p.objectId === obj.id));
  });
});

test('TEST 22: Original WorkspaceModel immutable', () => {
  const model = { board: { objects: [shape('s1', 100, 100)] } };
  const snapshot = JSON.stringify(model);
  createLayoutProposal(model, model);

  assert.equal(JSON.stringify(model), snapshot);
});

test('TEST 23: Deterministic reconstruction', () => {
  const model = {
    board: { objects: [shape('s1', 100, 100), note('n1', 'Note', 300, 100)] }
  };
  const p1 = createLayoutProposal(model, model);
  const p2 = createLayoutProposal(model, model);

  assert.equal(JSON.stringify(p1), JSON.stringify(p2));
});

test('TEST 24: Real-board mixed scene reconstruction', () => {
  const objects = [
    shape('hex_1', 100, 100, 140, 100, { relationshipMetadata: { attachedTextId: 'txt_hex' } }),
    text('txt_hex', 'Process', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 'hex_1' } }),
    shape('circle_1', 350, 100, 120, 120, { relationshipMetadata: { attachedTextId: 'txt_circle' } }),
    text('txt_circle', 'Circle', 350, 100, 120, 28, { relationshipMetadata: { parentShapeId: 'circle_1' } }),
    note('sticky_1', 'New Sticky Note', 950, 120, 160, 160),
    stroke('st_H', 50, 450, 25, 40), stroke('st_e', 80, 455, 20, 30),
    shape('box_1', 400, 300, 140, 80, { relationshipMetadata: { attachedTextId: 'txt_b1' } }),
    text('txt_b1', 'This is testing', 400, 300, 140, 28, { relationshipMetadata: { parentShapeId: 'box_1' } }),
    connector('conn_1', 'box_1', 'box_2', 540, 340, 100, 12),
    shape('box_2', 640, 300, 140, 80, { relationshipMetadata: { attachedTextId: 'txt_b2' } }),
    text('txt_b2', 'Test done', 640, 300, 140, 28, { relationshipMetadata: { parentShapeId: 'box_2' } }),
    shape('triangle_1', 700, 100, 120, 100, { relationshipMetadata: { attachedTextId: 'txt_tri' } }),
    text('txt_tri', 'Triangle', 700, 100, 120, 28, { relationshipMetadata: { parentShapeId: 'triangle_1' } }),
    text('txt_rot', 'Hello World!', 900, 400, 140, 28, { rotation: 90 })
  ];

  const model = { board: { objects } };
  const proposal = createLayoutProposal(model, model);

  
  
  
  
  const contentRight = Math.max(...proposal.placements.map((p) => p.bounds.x + p.bounds.width));
  assert.ok(proposal.canvasBounds.x + proposal.canvasBounds.width >= contentRight);
  assert.equal(proposal.valid, true);

  [['hex_1', 'txt_hex'], ['circle_1', 'txt_circle'], ['box_1', 'txt_b1'], ['box_2', 'txt_b2'], ['triangle_1', 'txt_tri']]
    .forEach(([s, t]) => {
      const pS = getPlacement(proposal, s);
      const pT = getPlacement(proposal, t);
      assert.ok(pS && pT, `${s} and ${t} must both be placed`);
      assert.equal(pT.relationshipMetadata.parentShapeId, s, `${t} linked to ${s}`);
    });
  assert.deepEqual(proposal.metadata.diagnostics.detachedLinkedObjects, []);
});

test('TEST 25: LayoutProposal remains compatible', () => {
  const model = { board: { objects: [shape('s1', 100, 100)] } };
  const proposal = createLayoutProposal(model, model);

  assert.equal(proposal.version, 1);
  assert.ok(proposal.canvasBounds);
  assert.ok(Array.isArray(proposal.sections));
  assert.ok(Array.isArray(proposal.placements));
});

test('TEST 26: Sticky note text stays attached to the note background', () => {
  const noteBg = note('note_bg', null, 900, 120, 180, 180, {
    relationshipMetadata: { attachedTextId: 'note_txt' }
  });
  const noteTxt = text('note_txt', 'New Sticky Note', 918, 138, 144, 40, {
    relationshipMetadata: { parentShapeId: 'note_bg' }
  });
  const model = { board: { objects: [noteBg, noteTxt] } };
  const proposal = createLayoutProposal(model, model);

  const pBg = getPlacement(proposal, 'note_bg');
  const pTxt = getPlacement(proposal, 'note_txt');
  assert.ok(pBg && pTxt, 'both note objects must be placed');
  assert.equal(pTxt.relationshipMetadata.parentShapeId, 'note_bg', 'note text must link to note background');

  const cx = pTxt.bounds.x + pTxt.bounds.width / 2;
  const cy = pTxt.bounds.y + pTxt.bounds.height / 2;
  assert.ok(
    cx >= pBg.bounds.x && cx <= pBg.bounds.x + pBg.bounds.width &&
    cy >= pBg.bounds.y && cy <= pBg.bounds.y + pBg.bounds.height,
    'note text center must fall within the note background bounds'
  );
});

test('TEST 27: Sticky note text attaches via reverse parentShapeId link', () => {
  const noteBg = note('note_bg', null, 300, 300, 180, 180);
  const noteTxt = text('note_txt', 'Reminder', 318, 318, 144, 30, {
    relationshipMetadata: { parentShapeId: 'note_bg' }
  });
  const model = { board: { objects: [noteBg, noteTxt] } };
  const proposal = createLayoutProposal(model, model);

  const pBg = getPlacement(proposal, 'note_bg');
  const pTxt = getPlacement(proposal, 'note_txt');
  assert.ok(pBg && pTxt);
  assert.equal(pTxt.relationshipMetadata.parentShapeId, 'note_bg', 'reverse-linked note text must link to note background');
});
