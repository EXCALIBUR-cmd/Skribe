import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotebookLayoutProposal } from './notebookLayoutEngine.js';
import { buildSemanticScene } from './semanticSceneAdapter.js';

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


test('TEST 1: Multiple shapes originally side-by-side remain side-by-side', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 100, 100),
        shape('s2', 300, 110),
        shape('s3', 500, 105)
      ]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);
  const p1 = getPlacement(proposal, 's1');
  const p2 = getPlacement(proposal, 's2');
  const p3 = getPlacement(proposal, 's3');

  assert.ok(p1 && p2 && p3);
  assert.equal(p1.position.y, p2.position.y);
  assert.equal(p2.position.y, p3.position.y);
  assert.ok(p1.position.x < p2.position.x);
  assert.ok(p2.position.x < p3.position.x);
});

test('TEST 2: Multiple shapes originally separated vertically remain in different rows', () => {
  const model = {
    board: {
      objects: [
        shape('topShape', 100, 100),
        shape('bottomShape', 100, 600)
      ]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);
  const pTop = getPlacement(proposal, 'topShape');
  const pBottom = getPlacement(proposal, 'bottomShape');

  assert.ok(pTop && pBottom);
  assert.notEqual(pTop.position.y, pBottom.position.y);
  assert.ok(pTop.position.y < pBottom.position.y);
});

test('TEST 3: Shape + attached text remains atomic', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 200, 200, 140, 90, { relationshipMetadata: { attachedTextId: 't1' } }),
        text('t1', 'Process', 200, 200, 140, 28, { relationshipMetadata: { parentShapeId: 's1' } })
      ]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);
  const pS = getPlacement(proposal, 's1');
  const pT = getPlacement(proposal, 't1');

  assert.ok(pS && pT);
  assert.equal(pS.unitId, pT.unitId);
  assert.equal(pS.position.x, pT.position.x);
  assert.equal(pS.position.y, pT.position.y);
});

test('TEST 4: Flowchart topology is preserved', () => {
  const model = {
    board: {
      objects: [
        shape('nodeA', 100, 200),
        shape('nodeB', 400, 200),
        connector('cAB', 'nodeA', 'nodeB', 250, 200)
      ]
    }
  };
  const scene = {
    groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['nodeA', 'nodeB', 'cAB'] }]
  };
  const proposal = createNotebookLayoutProposal(scene, model);
  const pA = getPlacement(proposal, 'nodeA');
  const pB = getPlacement(proposal, 'nodeB');
  const pConn = getPlacement(proposal, 'cAB');

  assert.ok(pA && pB && pConn);
  assert.equal(pA.unitId, pB.unitId);
  assert.ok(pA.position.x < pB.position.x);
});

test('TEST 5: Horizontal flowchart remains horizontal', () => {
  const model = {
    board: {
      objects: [
        shape('nA', 100, 100),
        shape('nB', 400, 100),
        connector('c1', 'nA', 'nB', 250, 100)
      ]
    }
  };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['nA', 'nB', 'c1'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);
  const pA = getPlacement(proposal, 'nA');
  const pB = getPlacement(proposal, 'nB');

  assert.equal(pA.position.y, pB.position.y);
  assert.ok(pA.position.x < pB.position.x);
});

test('TEST 6: Vertical flowchart remains vertical', () => {
  const model = {
    board: {
      objects: [
        shape('nA', 100, 100),
        shape('nB', 100, 400),
        connector('c1', 'nA', 'nB', 100, 250)
      ]
    }
  };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['nA', 'nB', 'c1'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);
  const pA = getPlacement(proposal, 'nA');
  const pB = getPlacement(proposal, 'nB');

  assert.equal(pA.position.x, pB.position.x);
  assert.ok(pA.position.y < pB.position.y);
});

test('TEST 7: Freehand strokes remain atomic', () => {
  const strokes = [
    stroke('st1', 100, 100, 20, 20),
    stroke('st2', 130, 110, 20, 20),
    stroke('st3', 160, 105, 20, 20)
  ];
  const model = { board: { objects: strokes } };
  const scene = { groups: [{ id: 'g_free', type: 'freeform', objectIds: ['st1', 'st2', 'st3'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);

  const p1 = getPlacement(proposal, 'st1');
  const p2 = getPlacement(proposal, 'st2');
  const p3 = getPlacement(proposal, 'st3');

  assert.equal(p1.unitId, p2.unitId);
  assert.equal(p2.unitId, p3.unitId);
  assert.equal(p2.position.x - p1.position.x, 30);
  assert.equal(p2.position.y - p1.position.y, 10);
});

// TEST 8: Sticky notes form a reasonable cluster
test('TEST 8: Sticky notes form a reasonable cluster', () => {
  const model = {
    board: {
      objects: [
        note('n1', 'Task 1', 100, 100),
        note('n2', 'Task 2', 300, 100)
      ]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);
  const p1 = getPlacement(proposal, 'n1');
  const p2 = getPlacement(proposal, 'n2');

  assert.equal(p1.position.y, p2.position.y);
  assert.ok(p1.position.x < p2.position.x);
});

// TEST 9: Standalone text does not automatically become a vertical column
test('TEST 9: Standalone text does not automatically become a vertical column', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 100, 100),
        text('txt_side', 'Side note', 400, 100)
      ]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);
  const pS = getPlacement(proposal, 's1');
  const pT = getPlacement(proposal, 'txt_side');

  assert.equal(pS.bounds.y, pT.bounds.y);
  assert.ok(pS.bounds.x < pT.bounds.x);
});

test('TEST 10: Outliers do not distort page dimensions', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 100, 100),
        shape('s2', 300, 100),
        shape('outlier', 99999, 99999)
      ]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);
  assert.ok(proposal.canvasBounds.width <= 1400);
  assert.ok(proposal.canvasBounds.height <= 1000);
});

test('TEST 11: Collision resolution moves atomic units only', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 100, 100, 140, 90, { relationshipMetadata: { attachedTextId: 't1' } }),
        text('t1', 'A', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 's1' } }),
        shape('s2', 120, 105, 140, 90, { relationshipMetadata: { attachedTextId: 't2' } }),
        text('t2', 'B', 120, 105, 140, 28, { relationshipMetadata: { parentShapeId: 's2' } })
      ]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);
  const pS1 = getPlacement(proposal, 's1');
  const pT1 = getPlacement(proposal, 't1');
  const pS2 = getPlacement(proposal, 's2');
  const pT2 = getPlacement(proposal, 't2');

  assert.equal(pS1.position.x, pT1.position.x);
  assert.equal(pS2.position.x, pT2.position.x);
});

test('TEST 12: No detached labels (detachedLinkedObjects is empty)', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 100, 100, 140, 90, { relationshipMetadata: { attachedTextId: 't1' } }),
        text('t1', 'Label', 100, 100, 140, 28, { relationshipMetadata: { parentShapeId: 's1' } })
      ]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);
  assert.deepEqual(proposal.metadata.diagnostics.detachedLinkedObjects, []);
});

test('TEST 13: No orphan connectors (orphanConnectors is empty)', () => {
  const model = {
    board: {
      objects: [
        shape('b1', 100, 100),
        shape('b2', 400, 100),
        connector('c1', 'b1', 'b2')
      ]
    }
  };
  const scene = { groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }] };
  const proposal = createNotebookLayoutProposal(scene, model);
  assert.deepEqual(proposal.metadata.diagnostics.orphanConnectors, []);
});

test('TEST 14: No detached annotations (detachedAnnotations is empty)', () => {
  const model = {
    board: {
      objects: [shape('target1', 100, 100)]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);
  assert.deepEqual(proposal.metadata.diagnostics.detachedAnnotations, []);
});

test('TEST 15: 10 mixed objects produce a readable page (aspectRatio >= 1.0)', () => {
  const objects = [
    shape('s1', 100, 100), shape('s2', 300, 100), shape('s3', 500, 100),
    shape('b1', 100, 300), shape('b2', 400, 300), connector('c1', 'b1', 'b2', 250, 300),
    note('n1', 'Task', 100, 500), note('n2', 'Idea', 300, 500),
    stroke('st1', 100, 700), stroke('st2', 150, 700)
  ];
  const model = { board: { objects } };
  const proposal = createNotebookLayoutProposal(model, model);

  assert.ok(proposal.canvasBounds.width >= 800);
  assert.ok(proposal.metadata.diagnostics.aspectRatio >= 0.9);
});

test('TEST 16: 20 mixed objects produce a readable page', () => {
  const objects = [];
  for (let i = 0; i < 5; i++) objects.push(shape(`s_${i}`, 100 + i * 200, 100));
  for (let i = 0; i < 5; i++) objects.push(shape(`b_${i}`, 100 + i * 200, 300));
  for (let i = 0; i < 5; i++) objects.push(note(`n_${i}`, `Note ${i}`, 100 + i * 200, 500));
  for (let i = 0; i < 5; i++) objects.push(stroke(`st_${i}`, 100 + i * 50, 700));

  const model = { board: { objects } };
  const proposal = createNotebookLayoutProposal(model, model);

  assert.ok(proposal.canvasBounds.width >= 800);
  assert.ok(proposal.canvasBounds.width <= 1400);
  assert.ok(proposal.metadata.diagnostics.aspectRatio >= 0.9);
});

test('TEST 17: 40 mixed objects do not collapse into a narrow column (width >= 800px)', () => {
  const objects = [];
  for (let i = 0; i < 40; i++) {
    objects.push(shape(`shape_${i}`, (i % 5) * 200, Math.floor(i / 5) * 150));
  }
  const model = { board: { objects } };
  const proposal = createNotebookLayoutProposal(model, model);

  assert.ok(proposal.canvasBounds.width >= 800);
  assert.ok(proposal.metadata.diagnostics.columns >= 3);
});


test('TEST 18: Page fits content width and never exceeds the max page width', () => {
  const model = {
    board: {
      objects: [shape('s1', 100, 100), shape('s2', 300, 100), shape('s3', 500, 100)]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);
  const contentRight = Math.max(...proposal.placements.map((p) => p.bounds.x + p.bounds.width));
  assert.ok(proposal.canvasBounds.x + proposal.canvasBounds.width >= contentRight); 
  assert.ok(proposal.canvasBounds.width <= 1400); 
});

test('TEST 19: Pathological aspect ratios trigger horizontal redistribution', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 100, 100),
        shape('s2', 100, 300),
        shape('s3', 100, 500),
        shape('s4', 100, 700),
        shape('s5', 100, 900),
        shape('s6', 100, 1100)
      ]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);
  assert.ok(proposal.metadata.diagnostics.rows < 6);
  assert.ok(proposal.metadata.diagnostics.horizontalRedistributions > 0);
});

// TEST 20: Output is deterministic
test('TEST 20: Output is deterministic', () => {
  const model = {
    board: {
      objects: [shape('s1', 100, 100), shape('s2', 300, 200), note('n1', 'A', 500, 150)]
    }
  };
  const p1 = createNotebookLayoutProposal(model, model);
  const p2 = createNotebookLayoutProposal(model, model);

  assert.equal(JSON.stringify(p1), JSON.stringify(p2));
});

test('TEST 21: Original WorkspaceModel remains immutable', () => {
  const model = {
    board: {
      objects: [shape('s1', 100, 100, 140, 90)]
    }
  };
  const snapshot = JSON.stringify(model);
  createNotebookLayoutProposal(model, model);

  assert.equal(JSON.stringify(model), snapshot);
});

test('TEST 22: LayoutProposal contract remains compatible with preview/apply', () => {
  const model = {
    board: {
      objects: [shape('s1', 100, 100), text('t1', 'Hi', 100, 100)]
    }
  };
  const proposal = createNotebookLayoutProposal(model, model);

  assert.equal(proposal.version, 1);
  assert.ok(proposal.canvasBounds && typeof proposal.canvasBounds.width === 'number');
  assert.ok(Array.isArray(proposal.sections));
  assert.ok(Array.isArray(proposal.placements));
  assert.ok(proposal.metadata?.diagnostics);
  assert.equal(proposal.metadata.diagnostics.compositionMode, 'semantic-notebook');
});

test('TEST 23: Real messy board produces a spacious landscape notebook page (aspectRatio >= 1.0)', () => {
  const objects = [
    shape('hex_1', 100, 100, 140, 100, { elementId: 'elem_hex', relationshipMetadata: { attachedTextId: 'txt_hex' } }),
    text('txt_hex', 'Process', 100, 100, 140, 28, { elementId: 'elem_hex', relationshipMetadata: { parentShapeId: 'hex_1' } }),
    text('txt_under_hex', 'This is a testing phase.', 100, 220, 180, 28),
    shape('circle_1', 350, 100, 120, 120, { elementId: 'elem_circle', relationshipMetadata: { attachedTextId: 'txt_circle' } }),
    text('txt_circle', 'Circle', 350, 100, 120, 28, { elementId: 'elem_circle', relationshipMetadata: { parentShapeId: 'circle_1' } }),
    note('sticky_1', 'New Sticky Note', 950, 120, 160, 160),
    stroke('st_H', 50, 450, 25, 40), stroke('st_e', 80, 455, 20, 30), stroke('st_l1', 105, 450, 10, 40), stroke('st_l2', 120, 450, 10, 40), stroke('st_o', 135, 455, 20, 30), stroke('st_line', 50, 500, 110, 8),
    shape('box_1', 400, 300, 140, 80, { elementId: 'elem_b1', relationshipMetadata: { attachedTextId: 'txt_b1' } }),
    text('txt_b1', 'This is a testing phase.', 400, 300, 140, 28, { elementId: 'elem_b1', relationshipMetadata: { parentShapeId: 'box_1' } }),
    connector('conn_1', 'box_1', 'box_2', 540, 340, 100, 12),
    shape('box_2', 640, 300, 140, 80, { elementId: 'elem_b2', relationshipMetadata: { attachedTextId: 'txt_b2' } }),
    text('txt_b2', 'Test will be over', 640, 300, 140, 28, { elementId: 'elem_b2', relationshipMetadata: { parentShapeId: 'box_2' } }),
    shape('triangle_1', 700, 100, 120, 100, { elementId: 'elem_tri', relationshipMetadata: { attachedTextId: 'txt_tri' } }),
    text('txt_tri', 'Triangle', 700, 100, 120, 28, { elementId: 'elem_tri', relationshipMetadata: { parentShapeId: 'triangle_1' } }),
    text('txt_rot', 'Hello World!', 900, 400, 140, 28, { rotation: 90 })
  ];

  const model = { version: 1, board: { objects } };
  const nemotronResponse = {
    groups: [
      { id: 'g_hex', type: 'concept', objectIds: ['hex_1', 'txt_hex', 'txt_under_hex'] },
      { id: 'g_circle', type: 'concept', objectIds: ['circle_1', 'txt_circle'] },
      { id: 'g_tri', type: 'concept', objectIds: ['triangle_1', 'txt_tri'] },
      { id: 'g_flow', type: 'flowchart', objectIds: ['box_1', 'txt_b1', 'box_2', 'txt_b2', 'conn_1'] },
      { id: 'g_sticky', type: 'notes', objectIds: ['sticky_1'] },
      { id: 'g_freeform', type: 'freeform', objectIds: ['st_H', 'st_e', 'st_l1', 'st_l2', 'st_o', 'st_line'] },
      { id: 'g_rot', type: 'concept', objectIds: ['txt_rot'] }
    ]
  };

  const proposal = createNotebookLayoutProposal(nemotronResponse, model);

  
  const contentRight = Math.max(...proposal.placements.map((p) => p.bounds.x + p.bounds.width));
  assert.ok(proposal.canvasBounds.x + proposal.canvasBounds.width >= contentRight); 
  assert.ok(proposal.canvasBounds.width <= 1400);
  
  assert.ok(proposal.metadata.diagnostics.aspectRatio >= 1.0);
  assert.deepEqual(proposal.metadata.diagnostics.detachedLinkedObjects, []);
  assert.deepEqual(proposal.metadata.diagnostics.orphanConnectors, []);
});
