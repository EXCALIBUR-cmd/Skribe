import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOrganizationPlan } from './validateOrganizationPlan.js';
import { createLayoutProposal } from './layoutEngine.js';

const workspace = (objects) => ({ version: 1, board: { objects } });

const shape = (id, x, y, extra = {}) => ({
  id,
  type: 'shape',
  shapeType: 'rect',
  text: null,
  position: { x, y },
  size: { width: 140, height: 90 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 1,
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
  size: { width: 160, height: 28 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  zIndex: 2,
  relationshipMetadata: {},
  relationships: [],
  metadata: {},
  ...extra
});

const note = (id, x, y, color = '#fff3a0', extra = {}) => ({
  ...shape(id, x, y, extra),
  type: 'note',
  size: { width: 140, height: 140 },
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
  size: { width: 60, height: 40 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  relationshipMetadata: {},
  relationships: [],
  metadata: { isVectorStroke: true },
  ...extra
});

const getPlacement = (proposal, objectId) =>
  proposal.placements.find((p) => p.objectId === objectId);

const boxesOverlap = (a, b) => (
  a.bounds.x < b.bounds.x + b.bounds.width &&
  a.bounds.x + a.bounds.width > b.bounds.x &&
  a.bounds.y < b.bounds.y + b.bounds.height &&
  a.bounds.y + a.bounds.height > b.bounds.y
);

const createV2Proposal = (objects, rawPlan) => {
  const model = workspace(objects);
  const plan = validateOrganizationPlan(model, rawPlan);
  const proposal = createLayoutProposal(plan, model);
  return { model, plan, proposal };
};

// TEST 1: Independent sections are placed in multiple regions instead of one vertical column
test('TEST 1: Independent sections are placed in multiple regions instead of one vertical column', () => {
  const objects = [
    shape('s1', 0, 0),
    shape('s2', 150, 0),
    connector('c1', 's1', 's2', 75, 0),
    note('n1', 400, 0),
    note('n2', 550, 0)
  ];
  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [
        { id: 'sec_diagram', type: 'diagram', objectIds: ['s1', 's2', 'c1'], layoutHint: 'flow' },
        { id: 'sec_notes', type: 'notes', objectIds: ['n1', 'n2'], layoutHint: 'grid' }
      ]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const secDiag = proposal.sections.find((s) => s.sectionId === 'sec_diagram');
  const secNotes = proposal.sections.find((s) => s.sectionId === 'sec_notes');

  assert.ok(secDiag && secNotes);
  // They should be placed side-by-side (different X coordinates, same row)
  assert.notEqual(secDiag.bounds.x, secNotes.bounds.x);
  assert.equal(proposal.metadata.diagnostics.compositionColumns >= 2, true);
});

// TEST 2: Landscape composition remains usable
test('TEST 2: Landscape composition remains usable with a balanced aspect ratio', () => {
  const objects = [
    shape('s1', 0, 0), shape('s2', 200, 0),
    connector('c1', 's1', 's2', 100, 0),
    note('n1', 400, 0), note('n2', 600, 0), note('n3', 800, 0)
  ];
  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [
        { id: 'sec_diag', type: 'diagram', objectIds: ['s1', 's2', 'c1'], layoutHint: 'flow' },
        { id: 'sec_notes', type: 'notes', objectIds: ['n1', 'n2', 'n3'], layoutHint: 'grid' }
      ]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const { canvasBounds } = proposal;
  const aspectRatio = canvasBounds.width / Math.max(1, canvasBounds.height);

  assert.ok(aspectRatio >= 1.0, `Expected landscape aspect ratio >= 1.0, got ${aspectRatio}`);
  assert.ok(canvasBounds.width > 500);
});

// TEST 3: Linked shape + recreated text remain a single layout unit
test('TEST 3: Linked shape + recreated text remain a single layout unit', () => {
  const s1 = shape('s1', 200, 200, {
    elementId: 'elem_1',
    relationshipMetadata: { attachedTextId: 't1' },
    relationships: [{ type: 'contains_text', targetId: 't1' }, { type: 'shared_element', targetId: 't1' }]
  });
  const t1 = text('t1', 200, 200, 'Process', {
    elementId: 'elem_1',
    relationshipMetadata: { parentShapeId: 's1' },
    relationships: [{ type: 'contained_by', targetId: 's1' }, { type: 'shared_element', targetId: 's1' }]
  });

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1', 't1'] }]
    }
  };

  const { proposal } = createV2Proposal([s1, t1], rawPlan);
  const pShape = getPlacement(proposal, 's1');
  const pText = getPlacement(proposal, 't1');

  assert.ok(pShape && pText);
  assert.equal(pShape.unitId, pText.unitId);
});

// TEST 4: Shape/text relationship survives layout
test('TEST 4: Shape/text relative position relationship survives layout', () => {
  const s1 = shape('s1', 100, 100, {
    elementId: 'elem_card',
    relationshipMetadata: { attachedTextId: 't1' }
  });
  const t1 = text('t1', 100, 100, 'Card Label', {
    elementId: 'elem_card',
    relationshipMetadata: { parentShapeId: 's1' }
  });

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1', 't1'] }]
    }
  };

  const { proposal } = createV2Proposal([s1, t1], rawPlan);
  const pShape = getPlacement(proposal, 's1');
  const pText = getPlacement(proposal, 't1');

  assert.equal(pText.position.x - pShape.position.x, 0);
  assert.equal(pText.position.y - pShape.position.y, 0);
});

// TEST 5: Horizontal A → B → C diagram remains horizontal
test('TEST 5: Horizontal A -> B -> C diagram remains horizontal', () => {
  const objects = [
    shape('nA', 0, 0), shape('nB', 200, 0), shape('nC', 400, 0),
    connector('cAB', 'nA', 'nB', 100, 0),
    connector('cBC', 'nB', 'nC', 300, 0)
  ];
  const rawPlan = {
    workspaceType: 'diagram',
    document: {
      sections: [{ id: 'sec_diag', type: 'diagram', objectIds: ['nA', 'nB', 'nC', 'cAB', 'cBC'], layoutHint: 'flow' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const pA = getPlacement(proposal, 'nA');
  const pB = getPlacement(proposal, 'nB');
  const pC = getPlacement(proposal, 'nC');

  assert.ok(pA.position.x < pB.position.x);
  assert.ok(pB.position.x < pC.position.x);
});

// TEST 6: Connector endpoints remain associated with their shapes
test('TEST 6: Connector endpoints remain associated with their shapes', () => {
  const objects = [
    shape('src', 0, 0),
    shape('tgt', 300, 0),
    connector('c1', 'src', 'tgt', 150, 0)
  ];
  const rawPlan = {
    workspaceType: 'diagram',
    document: {
      sections: [{ id: 'sec1', type: 'diagram', objectIds: ['src', 'tgt', 'c1'], layoutHint: 'flow' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const pSrc = getPlacement(proposal, 'src');
  const pTgt = getPlacement(proposal, 'tgt');
  const pConn = getPlacement(proposal, 'c1');

  assert.ok(pConn);
  // Connector positioned between source and target
  assert.ok(pConn.position.x >= pSrc.position.x && pConn.position.x <= pTgt.position.x);
});

// TEST 7: Heading remains above its associated body
test('TEST 7: Heading remains above its associated body', () => {
  const objects = [
    text('h1', 0, 0, 'Section Title', { metadata: { isHeading: true } }),
    text('p1', 0, 50, 'Body paragraph text.')
  ];
  const rawPlan = {
    workspaceType: 'document',
    document: {
      sections: [{ id: 'sec1', type: 'content', titleObjectId: 'h1', objectIds: ['h1', 'p1'], layoutHint: 'vertical-flow' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const pH = getPlacement(proposal, 'h1');
  const pP = getPlacement(proposal, 'p1');

  assert.ok(pH.position.y < pP.position.y);
});

// TEST 8: Heading remains associated with diagram
test('TEST 8: Heading remains associated with diagram', () => {
  const objects = [
    text('h_diag', 0, 0, 'Architecture Flow'),
    shape('box1', 0, 100), shape('box2', 200, 100),
    connector('conn', 'box1', 'box2', 100, 100)
  ];
  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{
        id: 'sec_diag',
        type: 'diagram',
        titleObjectId: 'h_diag',
        objectIds: ['h_diag', 'box1', 'box2', 'conn'],
        layoutHint: 'flow'
      }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const pH = getPlacement(proposal, 'h_diag');
  const pB1 = getPlacement(proposal, 'box1');

  assert.ok(pH);
  assert.ok(pB1);
  assert.ok(pH.position.y < pB1.position.y);
});

// TEST 9: Sticky notes form a compact grid
test('TEST 9: Sticky notes form a compact grid', () => {
  const notes = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((id, i) =>
    note(id, (i % 3) * 100, Math.floor(i / 3) * 100)
  );
  const rawPlan = {
    workspaceType: 'notes',
    document: {
      sections: [{ id: 'sec_notes', type: 'notes', objectIds: notes.map((n) => n.id), layoutHint: 'grid' }]
    }
  };

  const { proposal } = createV2Proposal(notes, rawPlan);
  const placements = notes.map((n) => getPlacement(proposal, n.id));
  const xs = new Set(placements.map((p) => p.position.x));
  const ys = new Set(placements.map((p) => p.position.y));

  assert.ok(xs.size >= 2);
  assert.ok(ys.size >= 2);
});

// TEST 10: Colored sticky-note groups remain together
test('TEST 10: Colored sticky-note groups remain together in layout', () => {
  const yellowNotes = [note('y1', 0, 0, '#fff3a0'), note('y2', 100, 0, '#fff3a0')];
  const blueNotes = [note('b1', 300, 0, '#a5f3fc'), note('b2', 400, 0, '#a5f3fc')];
  const allNotes = [...yellowNotes, ...blueNotes];

  const rawPlan = {
    workspaceType: 'notes',
    document: {
      sections: [
        { id: 'sec_yellow', type: 'notes', objectIds: ['y1', 'y2'], layoutHint: 'grid' },
        { id: 'sec_blue', type: 'notes', objectIds: ['b1', 'b2'], layoutHint: 'grid' }
      ]
    }
  };

  const { proposal } = createV2Proposal(allNotes, rawPlan);
  const secY = proposal.sections.find((s) => s.sectionId === 'sec_yellow');
  const secB = proposal.sections.find((s) => s.sectionId === 'sec_blue');

  assert.ok(secY && secB);
  assert.equal(boxesOverlap(secY, secB), false);
});

// TEST 11: Freehand annotation remains near its target
test('TEST 11: Freehand annotation remains near its target', () => {
  const target = shape('target_card', 200, 200);
  const ann = stroke('ann_circle', 210, 215);

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'mixed', objectIds: ['target_card', 'ann_circle'] }]
    },
    annotations: [{
      objectId: 'ann_circle',
      targetObjectIds: ['target_card'],
      type: 'freehand-annotation',
      confidence: 0.95
    }]
  };

  const { proposal } = createV2Proposal([target, ann], rawPlan);
  const pTarget = getPlacement(proposal, 'target_card');
  const pAnn = getPlacement(proposal, 'ann_circle');

  const origOffsetX = 210 - 200;
  const origOffsetY = 215 - 200;

  assert.equal(pAnn.position.x - pTarget.position.x, origOffsetX);
  assert.equal(pAnn.position.y - pTarget.position.y, origOffsetY);
});

// TEST 12: Isolated freehand stroke does not distort main bounds
test('TEST 12: Isolated freehand stroke does not distort main bounds', () => {
  const mainObj = shape('main_shape', 100, 100);
  const isolatedStroke = stroke('far_stroke', 8000, 8000);

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec_main', type: 'content', objectIds: ['main_shape'] }]
    },
    unassignedObjectIds: ['far_stroke']
  };

  const { proposal } = createV2Proposal([mainObj, isolatedStroke], rawPlan);
  const { canvasBounds } = proposal;

  // The total canvas width and height must not be anywhere near 8000
  assert.ok(canvasBounds.width < 2500, `Expected width < 2500, got ${canvasBounds.width}`);
  assert.ok(canvasBounds.height < 2500, `Expected height < 2500, got ${canvasBounds.height}`);
});

// TEST 13: Unrelated standalone text does not get absorbed into another section
test('TEST 13: Unrelated standalone text does not get absorbed into another section', () => {
  const s1 = shape('s1', 0, 0);
  const standaloneText = text('txt_standalone', 2000, 2000, 'Random memo');

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec_main', type: 'content', objectIds: ['s1'] }]
    },
    unassignedObjectIds: ['txt_standalone']
  };

  const { proposal } = createV2Proposal([s1, standaloneText], rawPlan);
  assert.ok(proposal.unassignedObjectIds.includes('txt_standalone'));
  assert.ok(getPlacement(proposal, 'txt_standalone'));
});

// TEST 14: Text does not overlap its associated shape
test('TEST 14: Text does not overlap its associated shape inappropriately', () => {
  const heading = text('h1', 0, 0, 'Overview');
  const card = shape('card', 0, 50);

  const rawPlan = {
    workspaceType: 'document',
    document: {
      sections: [{ id: 'sec1', type: 'content', titleObjectId: 'h1', objectIds: ['h1', 'card'], layoutHint: 'vertical-flow' }]
    }
  };

  const { proposal } = createV2Proposal([heading, card], rawPlan);
  const pH = getPlacement(proposal, 'h1');
  const pC = getPlacement(proposal, 'card');

  assert.equal(boxesOverlap(pH, pC), false);
});

// TEST 15: Two independent sections do not overlap
test('TEST 15: Two independent sections do not overlap', () => {
  const s1 = shape('s1', 0, 0);
  const s2 = shape('s2', 200, 0);
  const n1 = note('n1', 0, 200);

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [
        { id: 'sec1', type: 'diagram', objectIds: ['s1', 's2'], layoutHint: 'flow' },
        { id: 'sec2', type: 'notes', objectIds: ['n1'], layoutHint: 'grid' }
      ]
    }
  };

  const { proposal } = createV2Proposal([s1, s2, n1], rawPlan);
  const sec1 = proposal.sections.find((s) => s.sectionId === 'sec1');
  const sec2 = proposal.sections.find((s) => s.sectionId === 'sec2');

  assert.ok(sec1 && sec2);
  assert.equal(boxesOverlap(sec1, sec2), false);
});

// TEST 16: Outlier objects do not make the entire board microscopic
test('TEST 16: Outlier objects do not make the entire board microscopic', () => {
  const objects = [
    shape('center_1', 100, 100),
    shape('center_2', 250, 100),
    stroke('outlier_1', 10000, 10000)
  ];
  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec_center', type: 'content', objectIds: ['center_1', 'center_2'] }]
    },
    unassignedObjectIds: ['outlier_1']
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const p1 = getPlacement(proposal, 'center_1');
  const pOutlier = getPlacement(proposal, 'outlier_1');

  assert.ok(p1 && pOutlier);
  assert.ok(proposal.canvasBounds.width < 3000);
  assert.ok(proposal.canvasBounds.height < 3000);
});

// TEST 17: zIndex remains correct
test('TEST 17: zIndex ordering is preserved in placements', () => {
  const backgroundShape = shape('bg', 0, 0, { zIndex: 0 });
  const foregroundText = text('fg', 0, 0, 'Top Label', { zIndex: 10 });

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['bg', 'fg'] }]
    }
  };

  const { proposal } = createV2Proposal([backgroundShape, foregroundText], rawPlan);
  assert.equal(proposal.placements.length, 2);
  assert.ok(getPlacement(proposal, 'bg'));
  assert.ok(getPlacement(proposal, 'fg'));
});

// TEST 18: Original object IDs remain unchanged
test('TEST 18: Original object IDs remain completely unchanged', () => {
  const ids = ['shape_alpha', 'shape_beta', 'conn_gamma', 'note_delta'];
  const objects = [
    shape('shape_alpha', 0, 0),
    shape('shape_beta', 200, 0),
    connector('conn_gamma', 'shape_alpha', 'shape_beta', 100, 0),
    note('note_delta', 0, 200)
  ];

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [
        { id: 'sec_diag', type: 'diagram', objectIds: ['shape_alpha', 'shape_beta', 'conn_gamma'], layoutHint: 'flow' },
        { id: 'sec_note', type: 'notes', objectIds: ['note_delta'], layoutHint: 'grid' }
      ]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const placementIds = proposal.placements.map((p) => p.objectId).sort();
  assert.deepEqual(placementIds, ids.sort());
});

// TEST 19: Layout is deterministic (byte-equivalent JSON)
test('TEST 19: Layout is deterministic given identical inputs', () => {
  const objects = [
    shape('sB', 200, 50),
    shape('sA', 0, 50),
    note('n1', 100, 300)
  ];
  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [
        { id: 'sec1', type: 'content', objectIds: ['sA', 'sB'] },
        { id: 'sec2', type: 'notes', objectIds: ['n1'] }
      ]
    }
  };

  const { plan: plan1, proposal: prop1 } = createV2Proposal(objects, rawPlan);
  const { plan: plan2, proposal: prop2 } = createV2Proposal(objects, rawPlan);

  assert.equal(JSON.stringify(prop1), JSON.stringify(prop2));
});

// TEST 20: Input OrganizationPlan and WorkspaceModel remain immutable
test('TEST 20: Input OrganizationPlan and WorkspaceModel remain strictly immutable', () => {
  const objects = [shape('s1', 100, 100), note('n1', 200, 200)];
  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1', 'n1'] }]
    }
  };

  const model = workspace(objects);
  const plan = validateOrganizationPlan(model, rawPlan);

  const modelSnapshot = JSON.stringify(model);
  const planSnapshot = JSON.stringify(plan);

  createLayoutProposal(plan, model);

  assert.equal(JSON.stringify(model), modelSnapshot);
  assert.equal(JSON.stringify(plan), planSnapshot);
});
