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

// TEST 1: Title is placed above content
test('TEST 1: Title is placed above content', () => {
  const model = {
    board: {
      objects: [
        text('title_1', 'Document Title', 0, 0, { metadata: { isHeading: true } }),
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
    hierarchy: { rootTitleObjectId: 'title_1', mainConceptIds: ['g1'] }
  };
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const pTitle = getPlacement(proposal, 'title_1');
  const pShape = getPlacement(proposal, 's1');

  assert.ok(pTitle && pShape);
  assert.ok(pTitle.position.y < pShape.position.y);
});

// TEST 2: No title is invented when absent
test('TEST 2: No title is invented when absent', () => {
  const model = { board: { objects: [shape('s1'), shape('s2')] } };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 's2'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.equal(proposal.placements.length, 2);
  assert.equal(proposal.placements.some((p) => p.objectId.includes('title')), false);
});

// TEST 3: Concept uses notebook-stack
test('TEST 3: Concept uses notebook-stack', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 0, 0),
        text('txt_under', 'Explanation text', 0, 100)
      ]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'mixed',
    groups: [{ id: 'g_concept', type: 'concept', objectIds: ['s1', 'txt_under'] }],
    relationships: [],
    annotations: [],
    readingOrder: ['g_concept'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['g_concept'] }
  };
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const pShape = getPlacement(proposal, 's1');
  const pText = getPlacement(proposal, 'txt_under');

  assert.ok(pShape && pText);
  assert.ok(pShape.position.y < pText.position.y);
});

// TEST 4: Concept + explanation remain visually associated
test('TEST 4: Concept + explanation remain visually associated', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 0, 0),
        text('t1', 'Explanation paragraph', 0, 50)
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 't1'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const sec = proposal.sections.find((s) => s.objectIds.includes('s1'));
  assert.ok(sec);
  assert.ok(sec.objectIds.includes('t1'));
});

// TEST 5: Multiple concepts can coexist horizontally
test('TEST 5: Multiple concepts can coexist horizontally', () => {
  const model = {
    board: {
      objects: [
        shape('sA', 0, 0),
        shape('sB', 500, 0)
      ]
    }
  };
  const scene = {
    version: 1,
    workspaceType: 'mixed',
    groups: [
      { id: 'gA', type: 'concept', objectIds: ['sA'] },
      { id: 'gB', type: 'concept', objectIds: ['sB'] }
    ],
    relationships: [],
    annotations: [],
    readingOrder: ['gA', 'gB'],
    hierarchy: { rootTitleObjectId: null, mainConceptIds: ['gA', 'gB'] }
  };
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const pA = getPlacement(proposal, 'sA');
  const pB = getPlacement(proposal, 'sB');

  assert.ok(pA && pB);
  assert.equal(pA.position.y, pB.position.y);
  assert.ok(pA.position.x < pB.position.x);
});

// TEST 6: Flowchart remains atomic
test('TEST 6: Flowchart remains atomic', () => {
  const model = {
    board: {
      objects: [
        shape('b1', 100, 100),
        shape('b2', 400, 100),
        connector('c1', 'b1', 'b2', 250, 100)
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'flowchart',
    groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'b2', 'c1'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const flowSec = proposal.sections.find((s) => s.strategy === 'flowchart');
  assert.ok(flowSec);
  assert.deepEqual(flowSec.placementObjectIds.sort(), ['b1', 'b2', 'c1']);
});

// TEST 7: Flowchart nodes preserve topology
test('TEST 7: Flowchart nodes preserve topology (left to right)', () => {
  const model = {
    board: {
      objects: [
        shape('step1', 100, 100),
        shape('step2', 400, 100),
        connector('c12', 'step1', 'step2', 250, 100)
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'flowchart',
    groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['step1', 'step2', 'c12'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const p1 = getPlacement(proposal, 'step1');
  const p2 = getPlacement(proposal, 'step2');
  const pConn = getPlacement(proposal, 'c12');

  assert.ok(p1.position.x < p2.position.x);
  assert.ok(pConn.position.x > p1.position.x && pConn.position.x < p2.position.x);
});

// TEST 8: Flowchart labels remain attached
test('TEST 8: Flowchart labels remain attached', () => {
  const model = {
    board: {
      objects: [
        shape('b1', 100, 100, { relationshipMetadata: { attachedTextId: 'lbl1' } }),
        text('lbl1', 'Start', 100, 100, { relationshipMetadata: { parentShapeId: 'b1' } }),
        shape('b2', 400, 100, { relationshipMetadata: { attachedTextId: 'lbl2' } }),
        text('lbl2', 'End', 400, 100, { relationshipMetadata: { parentShapeId: 'b2' } }),
        connector('c1', 'b1', 'b2')
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'flowchart',
    groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['b1', 'lbl1', 'b2', 'lbl2', 'c1'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const pB1 = getPlacement(proposal, 'b1');
  const pL1 = getPlacement(proposal, 'lbl1');
  assert.equal(pB1.position.x - pL1.position.x, 0);
  assert.equal(pB1.position.y - pL1.position.y, 0);
});

// TEST 9: Flowchart direction is deterministic
test('TEST 9: Flowchart direction is deterministic', () => {
  const model = {
    board: {
      objects: [shape('nodeA'), shape('nodeB'), connector('cAB', 'nodeA', 'nodeB')]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'flowchart',
    groups: [{ id: 'g_flow', type: 'flowchart', objectIds: ['nodeA', 'nodeB', 'cAB'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const p1 = createNotebookLayoutProposal(plan, model);
  const p2 = createNotebookLayoutProposal(plan, model);

  assert.equal(JSON.stringify(p1), JSON.stringify(p2));
});

// TEST 10: Sticky notes form a balanced grid
test('TEST 10: Sticky notes form a balanced grid', () => {
  const model = {
    board: {
      objects: [note('n1', 'A'), note('n2', 'B'), note('n3', 'C'), note('n4', 'D')]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'notes',
    groups: [{ id: 'g_notes', type: 'notes', objectIds: ['n1', 'n2', 'n3', 'n4'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const p1 = getPlacement(proposal, 'n1');
  const p2 = getPlacement(proposal, 'n2');
  const p3 = getPlacement(proposal, 'n3');
  const p4 = getPlacement(proposal, 'n4');

  assert.equal(p1.position.y, p2.position.y);
  assert.equal(p3.position.y, p4.position.y);
  assert.ok(p1.position.y < p3.position.y);
});

// TEST 11: Single sticky note does not create unnecessary grid
test('TEST 11: Single sticky note does not create unnecessary grid', () => {
  const model = { board: { objects: [note('n1', 'Alone')] } };
  const scene = buildSemanticScene(model, {
    workspaceType: 'notes',
    groups: [{ id: 'g_notes', type: 'notes', objectIds: ['n1'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.equal(proposal.placements.length, 1);
});

// TEST 12: Freeform strokes remain atomic
test('TEST 12: Freeform strokes remain atomic (same unitId)', () => {
  const strokes = [stroke('st1', 10, 10), stroke('st2', 30, 10), stroke('st3', 50, 10)];
  const model = { board: { objects: strokes } };
  const scene = buildSemanticScene(model, {
    workspaceType: 'freeform',
    groups: [{ id: 'g_hello', type: 'freeform', objectIds: ['st1', 'st2', 'st3'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const unitIds = new Set(strokes.map((s) => getPlacement(proposal, s.id).unitId));
  assert.equal(unitIds.size, 1);
});

// TEST 13: Freeform relative geometry remains unchanged
test('TEST 13: Freeform relative geometry remains unchanged', () => {
  const model = {
    board: {
      objects: [stroke('st1', 100, 200), stroke('st2', 150, 220)]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'freeform',
    groups: [{ id: 'g_free', type: 'freeform', objectIds: ['st1', 'st2'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const p1 = getPlacement(proposal, 'st1');
  const p2 = getPlacement(proposal, 'st2');

  assert.equal(p2.position.x - p1.position.x, 50);
  assert.equal(p2.position.y - p1.position.y, 20);
});

// TEST 14: Annotations remain near their targets
test('TEST 14: Annotations remain near their targets', () => {
  const model = {
    board: {
      objects: [shape('target_card', 300, 300), stroke('circle_stroke', 315, 310)]
    }
  };
  const scene = buildSemanticScene(model, {
    workspaceType: 'mixed',
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

// TEST 15: Independent text participates in reading flow
test('TEST 15: Independent text participates in reading flow', () => {
  const model = {
    board: {
      objects: [shape('s1'), text('txt_memo', 'Standalone note')]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g_concept', type: 'concept', objectIds: ['s1'] },
      { id: 'g_memo', type: 'concept', objectIds: ['txt_memo'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const pMemo = getPlacement(proposal, 'txt_memo');
  assert.ok(pMemo);
});

// TEST 16: Blocks do not overlap
test('TEST 16: Blocks do not overlap', () => {
  const model = {
    board: {
      objects: [shape('s1'), shape('s2'), note('n1'), note('n2')]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g1', type: 'concept', objectIds: ['s1', 's2'] },
      { id: 'g2', type: 'notes', objectIds: ['n1', 'n2'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  const s1 = proposal.sections[0].bounds;
  const s2 = proposal.sections[1].bounds;

  const overlaps = (
    s1.x < s2.x + s2.width &&
    s1.x + s1.width > s2.x &&
    s1.y < s2.y + s2.height &&
    s1.y + s1.height > s2.y
  );
  assert.equal(overlaps, false);
});

// TEST 17: Linked shape/text objects never separate
test('TEST 17: Linked shape/text objects never separate (detachedLinkedObjects is empty)', () => {
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

// TEST 18: Connectors are never independently displaced
test('TEST 18: Connectors are never independently displaced (orphanConnectors is empty)', () => {
  const model = {
    board: {
      objects: [
        shape('b1', 100, 100),
        shape('b2', 400, 100),
        connector('c1', 'b1', 'b2')
      ]
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

// TEST 19: Page width remains within reasonable range
test('TEST 19: Page width remains within reasonable range (approx 700-1400px)', () => {
  const model = {
    board: {
      objects: [
        shape('s1'), shape('s2'), note('n1'), note('n2'), stroke('st1')
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g1', type: 'concept', objectIds: ['s1', 's2'] },
      { id: 'g2', type: 'notes', objectIds: ['n1', 'n2'] },
      { id: 'g3', type: 'freeform', objectIds: ['st1'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.ok(proposal.canvasBounds.width >= 600);
  assert.ok(proposal.canvasBounds.width <= 1600);
});

// TEST 20: Pathological vertical aspect ratios are prevented
test('TEST 20: Pathological vertical aspect ratios are prevented (aspectRatio >= 1.0)', () => {
  const model = {
    board: {
      objects: [shape('s1'), shape('s2'), note('n1'), note('n2')]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g1', type: 'concept', objectIds: ['s1', 's2'] },
      { id: 'g2', type: 'notes', objectIds: ['n1', 'n2'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.ok(proposal.metadata.diagnostics.aspectRatio >= 1.0);
});

// TEST 21: Outliers do not create giant canvas bounds
test('TEST 21: Outliers do not create giant canvas bounds', () => {
  const model = {
    board: {
      objects: [
        shape('s1', 100, 100),
        stroke('outlier_st', 99999, 99999)
      ]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1'] }]
  });
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.ok(proposal.canvasBounds.width < 3000);
  assert.ok(proposal.canvasBounds.height < 3000);
});

// TEST 22: Objects are not unnecessarily scaled
test('TEST 22: Objects are not unnecessarily scaled (scale = 1)', () => {
  const model = { board: { objects: [shape('s1')] } };
  const scene = buildSemanticScene(model, {});
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.equal(proposal.placements[0].scale.x, 1);
  assert.equal(proposal.placements[0].scale.y, 1);
});

// TEST 23: Composition is deterministic
test('TEST 23: Composition is deterministic', () => {
  const model = {
    board: {
      objects: [shape('sA'), shape('sB'), note('n1')]
    }
  };
  const scene = buildSemanticScene(model, {
    groups: [
      { id: 'g2', type: 'notes', objectIds: ['n1'] },
      { id: 'g1', type: 'concept', objectIds: ['sA', 'sB'] }
    ]
  });
  const plan = buildCompositionPlan(scene, model);

  const p1 = createNotebookLayoutProposal(plan, model);
  const p2 = createNotebookLayoutProposal(plan, model);

  assert.equal(JSON.stringify(p1), JSON.stringify(p2));
});

// TEST 24: Input CompositionPlan remains immutable
test('TEST 24: Input CompositionPlan remains immutable', () => {
  const model = { board: { objects: [shape('s1')] } };
  const scene = buildSemanticScene(model, {});
  const plan = buildCompositionPlan(scene, model);

  const planSnapshot = JSON.stringify(plan);
  createNotebookLayoutProposal(plan, model);

  assert.equal(JSON.stringify(plan), planSnapshot);
});

// TEST 25: Existing LayoutProposal contract remains valid
test('TEST 25: Existing LayoutProposal contract remains valid', () => {
  const model = { board: { objects: [shape('s1'), text('t1', 'Hi')] } };
  const scene = buildSemanticScene(model, {});
  const plan = buildCompositionPlan(scene, model);
  const proposal = createNotebookLayoutProposal(plan, model);

  assert.equal(proposal.version, 1);
  assert.ok(proposal.canvasBounds && typeof proposal.canvasBounds.width === 'number');
  assert.ok(Array.isArray(proposal.sections));
  assert.ok(Array.isArray(proposal.placements));
  assert.ok(proposal.metadata && proposal.metadata.diagnostics);
  assert.equal(proposal.placements.length, 2);
});
