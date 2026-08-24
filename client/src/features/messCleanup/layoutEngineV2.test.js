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
  size: { width: 180, height: 28 },
  rotation: 0,
  scale: { x: 1, y: 1 },
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

// --- D: Document tests ---

test('D1: Document title placed at top, above all sections', () => {
  const objects = [
    text('title', 500, 500, 'My Document'),
    text('h1', 100, 100, 'Section 1'),
    shape('s1', 100, 200)
  ];
  const rawPlan = {
    workspaceType: 'document',
    document: {
      titleObjectId: 'title',
      sections: [
        { id: 'sec1', type: 'content', titleObjectId: 'h1', objectIds: ['title', 'h1', 's1'], layoutHint: 'vertical-flow' }
      ]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const titlePlacement = getPlacement(proposal, 'title');
  const h1Placement = getPlacement(proposal, 'h1');

  assert.ok(titlePlacement);
  assert.ok(h1Placement);
  assert.ok(titlePlacement.position.y < h1Placement.position.y);

  const titleSection = proposal.sections.find((s) => s.sectionId === 'section_document_title');
  assert.ok(titleSection);
  assert.equal(titleSection.titleObjectId, 'title');
});

test('D2: Section heading above body text in same section', () => {
  const objects = [
    text('h1', 100, 100, 'Heading'),
    text('p1', 100, 200, 'Paragraph text')
  ];
  const rawPlan = {
    workspaceType: 'document',
    document: {
      sections: [
        { id: 'sec1', type: 'content', titleObjectId: 'h1', objectIds: ['h1', 'p1'], layoutHint: 'vertical-flow' }
      ]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  assert.ok(getPlacement(proposal, 'h1').position.y < getPlacement(proposal, 'p1').position.y);
});

test('D3: Multiple sections with independent headings', () => {
  const objects = [
    text('h1', 0, 0, 'Section A'),
    shape('s1', 0, 50),
    text('h2', 0, 200, 'Section B'),
    shape('s2', 0, 250)
  ];
  const rawPlan = {
    workspaceType: 'document',
    document: {
      sections: [
        { id: 'sec1', type: 'content', titleObjectId: 'h1', objectIds: ['h1', 's1'], layoutHint: 'vertical-flow' },
        { id: 'sec2', type: 'content', titleObjectId: 'h2', objectIds: ['h2', 's2'], layoutHint: 'vertical-flow' }
      ]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const sec1 = proposal.sections.find((s) => s.sectionId === 'sec1');
  const sec2 = proposal.sections.find((s) => s.sectionId === 'sec2');

  assert.ok(sec1);
  assert.ok(sec2);
  assert.equal(boxesOverlap(sec1, sec2), false);
  assert.ok(sec1.bounds.y < sec2.bounds.y);
});

test('D5: Section ordering respects v2 plan order (not original Y)', () => {
  const objects = [
    text('h_bottom', 0, 500, 'This was at bottom'),
    text('h_top', 0, 0, 'This was at top')
  ];
  const rawPlan = {
    workspaceType: 'document',
    document: {
      sections: [
        { id: 'sec_bottom_first', type: 'content', objectIds: ['h_bottom'] },
        { id: 'sec_top_second', type: 'content', objectIds: ['h_top'] }
      ]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const secBottom = proposal.sections.find((s) => s.sectionId === 'sec_bottom_first');
  const secTop = proposal.sections.find((s) => s.sectionId === 'sec_top_second');

  assert.ok(secBottom.bounds.y < secTop.bounds.y);
});

// --- G: Diagram tests ---

test('G1: Horizontal 3-node chain placed left to right', () => {
  const objects = [
    shape('n1', 0, 0), shape('n2', 200, 0), shape('n3', 400, 0),
    connector('c1', 'n1', 'n2', 100, 0),
    connector('c2', 'n2', 'n3', 300, 0)
  ];
  const rawPlan = {
    workspaceType: 'diagram',
    document: {
      sections: [{ id: 'sec1', type: 'diagram', objectIds: ['n1', 'n2', 'n3', 'c1', 'c2'], layoutHint: 'flow' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  assert.ok(getPlacement(proposal, 'n1').position.x < getPlacement(proposal, 'n2').position.x);
  assert.ok(getPlacement(proposal, 'n2').position.x < getPlacement(proposal, 'n3').position.x);
});

test('G2: Vertical 3-node chain placed top to bottom', () => {
  const objects = [
    shape('n1', 0, 0), shape('n2', 0, 200), shape('n3', 0, 400),
    connector('c1', 'n1', 'n2', 0, 100),
    connector('c2', 'n2', 'n3', 0, 300)
  ];
  const rawPlan = {
    workspaceType: 'diagram',
    document: {
      sections: [{ id: 'sec1', type: 'diagram', objectIds: ['n1', 'n2', 'n3', 'c1', 'c2'], layoutHint: 'flow' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  assert.ok(getPlacement(proposal, 'n1').position.y < getPlacement(proposal, 'n2').position.y);
  assert.ok(getPlacement(proposal, 'n2').position.y < getPlacement(proposal, 'n3').position.y);
});

test('G5: Cycle detection produces fallback', () => {
  const objects = [
    shape('a', 0, 0), shape('b', 200, 0),
    connector('c1', 'a', 'b', 100, 0),
    connector('c2', 'b', 'a', 100, 0)
  ];
  const rawPlan = {
    workspaceType: 'diagram',
    document: {
      sections: [{ id: 'sec1', type: 'diagram', objectIds: ['a', 'b', 'c1', 'c2'], layoutHint: 'flow' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const diagSection = proposal.sections.find((s) => s.sectionId === 'sec1');
  assert.equal(diagSection.fallback, 'cyclic-diagram');
});

// --- N: Note tests ---

test('N3: Heading above note grid', () => {
  const objects = [
    text('h1', 0, 0, 'Notes'),
    note('n1', 0, 100),
    note('n2', 150, 100),
    note('n3', 300, 100)
  ];
  const rawPlan = {
    workspaceType: 'notes',
    document: {
      sections: [{ id: 'sec1', type: 'notes', titleObjectId: 'h1', objectIds: ['h1', 'n1', 'n2', 'n3'], layoutHint: 'grid' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  assert.ok(getPlacement(proposal, 'h1').position.y < getPlacement(proposal, 'n1').position.y);
});

test('N4: Adaptive columns — 7+ notes use 4 columns', () => {
  const objects = Array.from({ length: 8 }, (_, i) => note(`n${i}`, i * 60, 0));
  const rawPlan = {
    workspaceType: 'notes',
    document: {
      sections: [{ id: 'sec1', type: 'notes', objectIds: objects.map((o) => o.id), layoutHint: 'grid' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const xPositions = new Set(objects.map((o) => getPlacement(proposal, o.id).position.x));
  assert.ok(xPositions.size <= 4);
});

// --- A: Annotation tests ---

test('A1: Annotation stroke near target after layout', () => {
  const objects = [
    shape('target', 100, 100),
    stroke('ann1', 120, 130)
  ];
  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'mixed', objectIds: ['target', 'ann1'] }]
    },
    annotations: [{
      objectId: 'ann1',
      targetObjectIds: ['target'],
      type: 'freehand-annotation',
      confidence: 0.9
    }]
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const targetP = getPlacement(proposal, 'target');
  const annP = getPlacement(proposal, 'ann1');

  const originalOffsetX = 120 - 100;
  const originalOffsetY = 130 - 100;
  assert.equal(annP.position.x - targetP.position.x, originalOffsetX);
  assert.equal(annP.position.y - targetP.position.y, originalOffsetY);
});

test('A2: Stroke rotation preserved', () => {
  const objects = [
    stroke('s1', 100, 100, { rotation: 45 })
  ];
  const rawPlan = {
    workspaceType: 'freeform',
    document: {
      sections: [{ id: 'sec1', type: 'freeform', objectIds: ['s1'], layoutHint: 'freeform' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  assert.equal(getPlacement(proposal, 's1').rotation, 45);
});

// --- F: Freeform tests ---

test('F1: Freeform preserves relative positions', () => {
  const objects = [
    shape('a', 100, 100),
    shape('b', 200, 200),
    shape('c', 300, 100)
  ];
  const rawPlan = {
    workspaceType: 'freeform',
    document: {
      sections: [{ id: 'sec1', type: 'freeform', objectIds: ['a', 'b', 'c'], layoutHint: 'freeform' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const pA = getPlacement(proposal, 'a');
  const pB = getPlacement(proposal, 'b');
  const pC = getPlacement(proposal, 'c');

  assert.equal(pB.position.x - pA.position.x, 200 - 100);
  assert.equal(pB.position.y - pA.position.y, 200 - 100);
  assert.equal(pC.position.x - pA.position.x, 300 - 100);
  assert.equal(pC.position.y - pA.position.y, 0);
});

// --- M: Mixed workspace tests ---

test('M1: Full mixed workspace produces coherent composition', () => {
  const objects = [
    text('title', 0, 0, 'System Overview'),
    text('h1', 0, 100, 'Architecture'),
    shape('n1', 0, 200), shape('n2', 200, 200),
    connector('c1', 'n1', 'n2', 100, 200),
    text('h2', 0, 400, 'Tasks'),
    note('note1', 0, 500), note('note2', 200, 500),
    stroke('ann1', 10, 510)
  ];
  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      titleObjectId: 'title',
      sections: [
        { id: 'sec1', type: 'diagram', titleObjectId: 'h1', objectIds: ['title', 'h1', 'n1', 'n2', 'c1'], layoutHint: 'flow' },
        { id: 'sec2', type: 'notes', titleObjectId: 'h2', objectIds: ['h2', 'note1', 'note2', 'ann1'], layoutHint: 'grid' }
      ]
    },
    annotations: [{
      objectId: 'ann1',
      targetObjectIds: ['note1'],
      type: 'freehand-annotation'
    }]
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  assert.ok(proposal.placements.length === objects.length);
  assert.ok(proposal.sections.length >= 2);

  const titleSection = proposal.sections.find((s) => s.sectionId === 'section_document_title');
  assert.ok(titleSection);
});

test('M3: No overlapping sections in dense workspace', () => {
  const objects = Array.from({ length: 20 }, (_, i) => note(`n${i}`, (i % 5) * 60, Math.floor(i / 5) * 60));
  const rawPlan = {
    workspaceType: 'notes',
    document: {
      sections: [
        { id: 'sec1', type: 'notes', objectIds: objects.slice(0, 10).map((o) => o.id), layoutHint: 'grid' },
        { id: 'sec2', type: 'notes', objectIds: objects.slice(10).map((o) => o.id), layoutHint: 'grid' }
      ]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const sec1 = proposal.sections.find((s) => s.sectionId === 'sec1');
  const sec2 = proposal.sections.find((s) => s.sectionId === 'sec2');
  assert.ok(sec1);
  assert.ok(sec2);
  assert.equal(boxesOverlap(sec1, sec2), false);
});

// --- X: Determinism + immutability ---

test('X1: Identical input produces byte-identical JSON', () => {
  const objects = [text('h1', 0, 0, 'Title'), shape('s1', 0, 100)];
  const rawPlan = {
    workspaceType: 'document',
    document: {
      titleObjectId: 'h1',
      sections: [{ id: 'sec1', type: 'content', objectIds: ['h1', 's1'] }]
    }
  };

  const { plan: plan1, proposal: prop1 } = createV2Proposal(objects, rawPlan);
  const { plan: plan2, proposal: prop2 } = createV2Proposal(objects, rawPlan);
  assert.equal(JSON.stringify(prop1), JSON.stringify(prop2));
});

test('X2: Input OrganizationPlan v2 not mutated', () => {
  const objects = [shape('s1', 0, 0)];
  const rawPlan = { document: { sections: [{ id: 'sec1', type: 'content', objectIds: ['s1'] }] } };
  const model = workspace(objects);
  const plan = validateOrganizationPlan(model, rawPlan);
  const planBefore = JSON.stringify(plan);
  createLayoutProposal(plan, model);
  assert.equal(JSON.stringify(plan), planBefore);
});

test('X3: Input WorkspaceModel not mutated', () => {
  const objects = [shape('s1', 0, 0)];
  const rawPlan = { document: { sections: [{ id: 'sec1', type: 'content', objectIds: ['s1'] }] } };
  const model = workspace(objects);
  const modelBefore = JSON.stringify(model);
  const plan = validateOrganizationPlan(model, rawPlan);
  createLayoutProposal(plan, model);
  assert.equal(JSON.stringify(model), modelBefore);
});

// --- B: Linked shape/text via v2 ---

test('B4: Linked shape/text grouped in same unit via v2 plan (no structuralUnits)', () => {
  const objects = [
    shape('s1', 100, 100, {
      elementId: 'elem1',
      relationshipMetadata: { attachedTextId: 't1' },
      relationships: [{ type: 'contains_text', targetId: 't1' }, { type: 'shared_element', targetId: 't1' }]
    }),
    text('t1', 100, 100, 'Label', {
      elementId: 'elem1',
      relationshipMetadata: { parentShapeId: 's1' },
      relationships: [{ type: 'contained_by', targetId: 's1' }, { type: 'shared_element', targetId: 's1' }]
    })
  ];
  const rawPlan = {
    workspaceType: 'document',
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1', 't1'] }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const sP = getPlacement(proposal, 's1');
  const tP = getPlacement(proposal, 't1');
  assert.equal(sP.unitId, tP.unitId);
});

// --- LH: Layout hint tests ---

test('LH1: vertical-flow hint produces vertical layout', () => {
  const objects = [shape('s1', 0, 0), shape('s2', 0, 100)];
  const rawPlan = {
    document: {
      sections: [{ id: 'sec1', type: 'mixed', objectIds: ['s1', 's2'], layoutHint: 'vertical-flow' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  assert.ok(getPlacement(proposal, 's1').position.y < getPlacement(proposal, 's2').position.y);
});

test('LH2: grid hint produces grid layout', () => {
  const objects = [shape('a', 0, 0), shape('b', 100, 0), shape('c', 200, 0)];
  const rawPlan = {
    document: {
      sections: [{ id: 'sec1', type: 'mixed', objectIds: ['a', 'b', 'c'], layoutHint: 'grid' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  assert.equal(proposal.placements.length, 3);
});
