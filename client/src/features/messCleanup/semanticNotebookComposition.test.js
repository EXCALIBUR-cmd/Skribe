import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotebookLayoutProposal } from './notebookLayoutEngine.js';
import { buildCompositionPlan } from './buildCompositionPlan.js';
import { buildSemanticScene } from './semanticSceneAdapter.js';

const shape = (id, x = 100, y = 100, extra = {}) => ({
  id,
  type: 'shape',
  shapeType: 'rect',
  position: { x, y },
  size: { width: 140, height: 90 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 1,
  relationshipMetadata: {},
  ...extra
});

const text = (id, val, x = 100, y = 100, extra = {}) => ({
  id,
  type: 'text',
  text: val,
  position: { x, y },
  size: { width: 140, height: 28 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 2,
  relationshipMetadata: {},
  ...extra
});

const note = (id, val, x = 200, y = 200, extra = {}) => ({
  id,
  type: 'note',
  text: val,
  position: { x, y },
  size: { width: 160, height: 160 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 1,
  relationshipMetadata: {},
  metadata: { isStickyNote: true },
  ...extra
});

const connector = (id, src, tgt, x = 200, y = 100, extra = {}) => ({
  id,
  type: 'connector',
  position: { x, y },
  size: { width: 100, height: 12 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  relationshipMetadata: { sourceShapeId: src, targetShapeId: tgt },
  ...extra
});

const stroke = (id, x = 50, y = 50, extra = {}) => ({
  id,
  type: 'stroke',
  position: { x, y },
  size: { width: 40, height: 40 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  relationshipMetadata: {},
  metadata: { isVectorStroke: true },
  ...extra
});

const getPlacement = (proposal, id) => proposal.placements.find((p) => p.objectId === id);

// TEST 1: Title receives dedicated full-width row
test('TEST 1: Title receives dedicated full-width row', () => {
  const model = {
    board: {
      objects: [
        text('doc_title', 'System Architecture', 0, 0, { metadata: { isHeading: true } }),
        shape('s1', 100, 300)
      ]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'document',
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1'] }],
    relationships: [],
    annotations: [],
    readingOrder: ['g1'],
    hierarchy: { rootTitleObjectId: 'doc_title', mainConceptIds: ['g1'] }
  };
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const pTitle = getPlacement(proposal, 'doc_title');
  const pShape = getPlacement(proposal, 's1');

  assert.ok(pTitle && pShape);
  assert.ok(pTitle.position.y < pShape.position.y);
  assert.ok(pShape.position.y - pTitle.position.y >= 80);
});

// TEST 2: Flowchart receives dedicated row when sufficiently large
test('TEST 2: Flowchart receives dedicated row when sufficiently large', () => {
  const model = {
    board: {
      objects: [
        shape('hex_concept', 0, 0),
        shape('box_A', 300, 0),
        shape('box_B', 500, 0),
        connector('c_AB', 'box_A', 'box_B', 400, 0)
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'mixed',
    groups: [
      { id: 'g_concept', type: 'concept', objectIds: ['hex_concept'] },
      { id: 'g_flow', type: 'flowchart', objectIds: ['box_A', 'box_B', 'c_AB'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const pConcept = getPlacement(proposal, 'hex_concept');
  const pBoxA = getPlacement(proposal, 'box_A');

  // Concept and flowchart must NOT share the same row
  assert.notEqual(pConcept.position.y, pBoxA.position.y);
});

// TEST 3: Two compatible concept blocks can share a row
test('TEST 3: Two compatible concept blocks can share a row', () => {
  const model = {
    board: {
      objects: [shape('concept_1', 0, 0), shape('concept_2', 300, 0)]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'mixed',
    groups: [
      { id: 'g1', type: 'concept', objectIds: ['concept_1'] },
      { id: 'g2', type: 'concept', objectIds: ['concept_2'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const p1 = getPlacement(proposal, 'concept_1');
  const p2 = getPlacement(proposal, 'concept_2');

  assert.equal(p1.position.y, p2.position.y);
  assert.ok(p1.position.x < p2.position.x);
});

// TEST 4: Flowchart + unrelated sticky note do not get forced into same row
test('TEST 4: Flowchart + unrelated sticky note do not get forced into same row', () => {
  const model = {
    board: {
      objects: [
        shape('box1', 0, 0), shape('box2', 200, 0), connector('c12', 'box1', 'box2', 100, 0),
        note('note1', 'Task', 400, 0)
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'mixed',
    groups: [
      { id: 'g_flow', type: 'flowchart', objectIds: ['box1', 'box2', 'c12'] },
      { id: 'g_note', type: 'notes', objectIds: ['note1'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const pBox = getPlacement(proposal, 'box1');
  const pNote = getPlacement(proposal, 'note1');

  assert.notEqual(pBox.position.y, pNote.position.y);
});

// TEST 5: Shape + attached text remain atomic
test('TEST 5: Shape + attached text remain atomic', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 100, 100, { relationshipMetadata: { attachedTextId: 't1' } }),
        text('t1', 'Attached', 100, 100, { relationshipMetadata: { parentShapeId: 's1' } })
      ]
    }
  };
  const scene = buildSemanticScene(model, {});
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const pS = getPlacement(proposal, 's1');
  const pT = getPlacement(proposal, 't1');

  assert.equal(pS.position.x - pT.position.x, 0);
  assert.equal(pS.position.y - pT.position.y, 0);
  assert.equal(pT.anchor, 'center');
});

// TEST 6: Shape + explanation remain semantically ordered
test('TEST 6: Shape + explanation remain semantically ordered', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 0, 0),
        text('exp', 'Explanation text', 0, 100)
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 'exp'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const pS = getPlacement(proposal, 's1');
  const pExp = getPlacement(proposal, 'exp');

  assert.ok(pS.position.y < pExp.position.y);
});

// TEST 7: Sticky notes form a compact supporting grid
test('TEST 7: Sticky notes form a compact supporting grid', () => {
  const model = {
    board: {
      objects: [note('n1', '1'), note('n2', '2'), note('n3', '3')]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'notes',
    groups: [{ id: 'g_notes', type: 'notes', objectIds: ['n1', 'n2', 'n3'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const p1 = getPlacement(proposal, 'n1');
  const p2 = getPlacement(proposal, 'n2');
  const p3 = getPlacement(proposal, 'n3');

  assert.equal(p1.position.y, p2.position.y);
  assert.equal(p2.position.y, p3.position.y);
});

// TEST 8: Freehand strokes remain one rigid group
test('TEST 8: Freehand strokes remain one rigid group', () => {
  const strokes = [stroke('st1', 10, 10), stroke('st2', 30, 20), stroke('st3', 50, 15)];
  const model = { board: { objects: strokes } };
  const scene = buildSemanticScene(model, {
    workspaceType: 'freeform',
    groups: [{ id: 'g_draw', type: 'freeform', objectIds: ['st1', 'st2', 'st3'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const p1 = getPlacement(proposal, 'st1');
  const p2 = getPlacement(proposal, 'st2');

  assert.equal(p2.position.x - p1.position.x, 20);
  assert.equal(p2.position.y - p1.position.y, 10);
});

// TEST 9: Standalone text uses text-block composition
test('TEST 9: Standalone text uses text-block composition', () => {
  const model = {
    board: {
      objects: [shape('s1'), text('txt_memo', 'Meeting memo')]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g_concept', type: 'concept', objectIds: ['s1'] },
      { id: 'g_memo', type: 'concept', objectIds: ['txt_memo'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);
  const memoBlock = plan.blocks.find((b) => b.objectIds.includes('txt_memo'));
  assert.equal(memoBlock.strategy, 'text-block');
});

// TEST 10: Rotated standalone text is not classified as freeform merely because it is rotated
test('TEST 10: Rotated standalone text is classified as text-block', () => {
  const model = {
    board: {
      objects: [text('txt_rot', 'Hello World!', 0, 0, { rotation: 90 })]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g_rot', type: 'freeform', objectIds: ['txt_rot'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const block = plan.blocks.find((b) => b.objectIds.includes('txt_rot'));
  assert.equal(block.strategy, 'text-block');
  assert.equal(block.role, 'text');
});

// TEST 11: Small blocks do not create giant page columns
test('TEST 11: Small blocks do not create giant page columns', () => {
  const model = {
    board: {
      objects: [shape('s1'), note('n1')]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g1', type: 'concept', objectIds: ['s1'] },
      { id: 'g2', type: 'notes', objectIds: ['n1'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.ok(proposal.canvasBounds.width <= 1400);
});

// TEST 12: Output avoids pathological 3+ aspect ratio for normal mixed boards
test('TEST 12: Output avoids pathological 3+ aspect ratio for normal mixed boards', () => {
  const model = {
    board: {
      objects: [
        shape('s1'), shape('s2'), shape('s3'),
        shape('b1'), shape('b2'), connector('c1', 'b1', 'b2'),
        note('n1'), stroke('st1')
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g_concept1', type: 'concept', objectIds: ['s1', 's2'] },
      { id: 'g_concept2', type: 'concept', objectIds: ['s3'] },
      { id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] },
      { id: 'g_notes', type: 'notes', objectIds: ['n1'] },
      { id: 'g_draw', type: 'freeform', objectIds: ['st1'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.ok(proposal.metadata.diagnostics.aspectRatio < 2.5);
  assert.ok(proposal.metadata.diagnostics.aspectRatio >= 1.0);
});

// TEST 13: Collision resolution does not break connectors
test('TEST 13: Collision resolution does not break connectors', () => {
  const model = {
    board: {
      objects: [shape('b1'), shape('b2'), connector('c1', 'b1', 'b2')]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'flowchart',
    groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.deepEqual(proposal.metadata.diagnostics.orphanConnectors, []);
});

// TEST 14: Collision resolution does not separate attached text
test('TEST 14: Collision resolution does not separate attached text', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 100, 100, { relationshipMetadata: { attachedTextId: 't1' } }),
        text('t1', 'Process', 100, 100, { relationshipMetadata: { parentShapeId: 's1' } })
      ]
    }
  };
  const scene = buildSemanticScene(model, {});
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.deepEqual(proposal.metadata.diagnostics.detachedLinkedObjects, []);
});

// TEST 15: Annotation remains attached to target
test('TEST 15: Annotation remains attached to target', () => {
  const model = {
    board: {
      objects: [shape('target_card', 300, 300), stroke('circle_stroke', 315, 310)]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['target_card', 'circle_stroke'] }],
    annotations: [{ objectId: 'circle_stroke', targetObjectIds: ['target_card'], type: 'freehand-annotation' }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const pTarget = getPlacement(proposal, 'target_card');
  const pCircle = getPlacement(proposal, 'circle_stroke');

  assert.equal(pCircle.position.x - pTarget.position.x, 15);
  assert.equal(pCircle.position.y - pTarget.position.y, 10);
});

// TEST 16: Reading order is deterministic
test('TEST 16: Reading order is deterministic', () => {
  const model = { board: { objects: [shape('sA'), shape('sB'), note('n1')] } };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g2', type: 'notes', objectIds: ['n1'] },
      { id: 'g1', type: 'concept', objectIds: ['sA', 'sB'] }
    ]
  });
  const plan1 = buildCompositionPlan(scene, model);
  const plan2 = buildCompositionPlan(scene, model);

  const p1 = createNotebookLayoutProposal(plan1, model);
  const p2 = createNotebookLayoutProposal(plan2, model);

  assert.equal(JSON.stringify(p1), JSON.stringify(p2));
});

// TEST 17: Same input produces byte-identical LayoutProposal JSON
test('TEST 17: Same input produces byte-identical LayoutProposal JSON', () => {
  const model = { board: { objects: [shape('s1'), note('n1')] } };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 'n1'] }]
  });
  const plan = buildCompositionPlan(scene, model);

  const out1 = JSON.stringify(createNotebookLayoutProposal(plan, model));
  const out2 = JSON.stringify(createNotebookLayoutProposal(plan, model));

  assert.equal(out1, out2);
});

// TEST 18: No object is lost
test('TEST 18: No object is lost', () => {
  const objects = [shape('s1'), shape('s2'), text('t1', 'A'), note('n1')];
  const model = { board: { objects } };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 's2', 't1', 'n1'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.equal(proposal.placements.length, objects.length);
});

// TEST 19: No object is duplicated
test('TEST 19: No object is duplicated', () => {
  const objects = [shape('s1'), text('t1', 'A'), note('n1')];
  const model = { board: { objects } };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 't1', 'n1'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const uniquePlacedIds = new Set(proposal.placements.map((p) => p.objectId));
  assert.equal(uniquePlacedIds.size, objects.length);
});

// TEST 20: No physical object geometry is mutated during planning
test('TEST 20: No physical object geometry is mutated during planning', () => {
  const model = {
    board: {
      objects: [shape('s1', 100, 100, { size: { width: 140, height: 90 } })]
    }
  };
  const modelSnapshot = JSON.stringify(model);
  const scene = buildSemanticScene(model, {});
  const plan = buildCompositionPlan(scene, model);
  createNotebookLayoutProposal(plan, model);

  assert.equal(JSON.stringify(model), modelSnapshot);
});

// TEST 21: Existing legacy LayoutProposal contract remains valid
test('TEST 21: Existing legacy LayoutProposal contract remains valid', () => {
  const model = { board: { objects: [shape('s1')] } };
  const scene = buildSemanticScene(model, {});
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.equal(proposal.version, 1);
  assert.ok(proposal.canvasBounds && typeof proposal.canvasBounds.width === 'number');
  assert.ok(Array.isArray(proposal.sections));
  assert.ok(Array.isArray(proposal.placements));
  assert.ok(proposal.metadata?.diagnostics);
  assert.equal(proposal.metadata.diagnostics.compositionMode, 'semantic-notebook');
});

// TEST 22: Existing notebook composition diagnostics reflect semantic rows and dedicated rows
test('TEST 22: Diagnostics reflect semantic rows and dedicated rows', () => {
  const model = {
    board: {
      objects: [
        shape('s1'),
        shape('b1'), shape('b2'), connector('c1', 'b1', 'b2'),
        note('n1')
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g_concept', type: 'concept', objectIds: ['s1'] },
      { id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] },
      { id: 'g_notes', type: 'notes', objectIds: ['n1'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.equal(proposal.metadata.diagnostics.dedicatedRows, 1);
  assert.ok(proposal.metadata.diagnostics.rows >= 2);
});
