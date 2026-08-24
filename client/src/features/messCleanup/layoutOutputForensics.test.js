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
  size: { width: 140, height: 28 },
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
  size: { width: 160, height: 160 },
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

// TEST 1: Every linked shape/text pair produces exactly one LayoutUnit
test('TEST 1: Every linked shape/text pair produces exactly one LayoutUnit', () => {
  const s1 = shape('s1', 100, 100, {
    elementId: 'elem_1',
    relationshipMetadata: { attachedTextId: 't1' }
  });
  const t1 = text('t1', 100, 100, 'Process', {
    elementId: 'elem_1',
    relationshipMetadata: { parentShapeId: 's1' }
  });

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1', 't1'] }]
    }
  };

  const { proposal } = createV2Proposal([s1, t1], rawPlan);
  const pS = getPlacement(proposal, 's1');
  const pT = getPlacement(proposal, 't1');

  assert.ok(pS && pT);
  assert.equal(pS.unitId, pT.unitId);
  const unitReport = proposal.metadata.diagnostics.units.find((u) => u.unitId === pS.unitId);
  assert.ok(unitReport);
  assert.deepEqual(unitReport.objectIds.sort(), ['s1', 't1']);
});

// TEST 2: Linked shape/text relative geometry is preserved
test('TEST 2: Linked shape/text relative geometry is preserved', () => {
  const s1 = shape('s1', 300, 200, {
    relationshipMetadata: { attachedTextId: 't1' }
  });
  const t1 = text('t1', 300, 200, 'Process', {
    relationshipMetadata: { parentShapeId: 's1' }
  });

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1', 't1'] }]
    }
  };

  const { proposal } = createV2Proposal([s1, t1], rawPlan);
  const pS = getPlacement(proposal, 's1');
  const pT = getPlacement(proposal, 't1');

  // Both should share center anchor and exact same position
  assert.equal(pT.position.x - pS.position.x, 0);
  assert.equal(pT.position.y - pS.position.y, 0);
  assert.equal(pT.anchor, 'center');
  assert.equal(pS.anchor, 'center');
});

// TEST 3: Collision resolution never separates linked units
test('TEST 3: Collision resolution never separates linked units', () => {
  const s1 = shape('s1', 100, 100, { relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = text('t1', 100, 100, 'Label 1', { relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = shape('s2', 120, 110, { relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = text('t2', 120, 110, 'Label 2', { relationshipMetadata: { parentShapeId: 's2' } });

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1', 't1', 's2', 't2'] }]
    }
  };

  const { proposal } = createV2Proposal([s1, t1, s2, t2], rawPlan);
  const pS1 = getPlacement(proposal, 's1');
  const pT1 = getPlacement(proposal, 't1');
  const pS2 = getPlacement(proposal, 's2');
  const pT2 = getPlacement(proposal, 't2');

  // Unit 1 preserved
  assert.equal(pT1.position.x - pS1.position.x, 0);
  assert.equal(pT1.position.y - pS1.position.y, 0);

  // Unit 2 preserved
  assert.equal(pT2.position.x - pS2.position.x, 0);
  assert.equal(pT2.position.y - pS2.position.y, 0);
});

// TEST 4: Freehand group remains one logical unit when grouped
test('TEST 4: Freehand group remains one logical unit when grouped', () => {
  const strokes = [
    stroke('st_H', 100, 400),
    stroke('st_e', 130, 400),
    stroke('st_l1', 150, 400),
    stroke('st_l2', 165, 400),
    stroke('st_o', 180, 400)
  ];

  const rawPlan = {
    workspaceType: 'freeform',
    document: {
      sections: [{ id: 'sec_draw', type: 'freeform', objectIds: strokes.map((s) => s.id), layoutHint: 'freeform' }]
    }
  };

  const { proposal } = createV2Proposal(strokes, rawPlan);
  const unitIds = new Set(strokes.map((s) => getPlacement(proposal, s.id).unitId));

  // All 5 strokes of "Hello" must belong to exactly 1 freeform-group unit
  assert.equal(unitIds.size, 1);
  const groupUnit = proposal.metadata.diagnostics.units.find((u) => u.unitId === [...unitIds][0]);
  assert.ok(groupUnit);
  assert.equal(groupUnit.type, 'freeform-group');
  assert.equal(groupUnit.objectIds.length, 5);
});

// TEST 5: Annotation remains near its target
test('TEST 5: Annotation remains near its target', () => {
  const targetCard = shape('target_card', 300, 300);
  const circleStroke = stroke('circle_stroke', 310, 305);

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'mixed', objectIds: ['target_card', 'circle_stroke'] }]
    },
    annotations: [{
      objectId: 'circle_stroke',
      targetObjectIds: ['target_card'],
      type: 'freehand-annotation'
    }]
  };

  const { proposal } = createV2Proposal([targetCard, circleStroke], rawPlan);
  const pTarget = getPlacement(proposal, 'target_card');
  const pCircle = getPlacement(proposal, 'circle_stroke');

  assert.equal(pCircle.position.x - pTarget.position.x, 10);
  assert.equal(pCircle.position.y - pTarget.position.y, 5);
});

// TEST 6: Connector remains associated with source and target
test('TEST 6: Connector remains associated with source and target', () => {
  const nodeA = shape('nodeA', 100, 100);
  const nodeB = shape('nodeB', 400, 100);
  const conn = connector('connAB', 'nodeA', 'nodeB', 250, 100);

  const rawPlan = {
    workspaceType: 'diagram',
    document: {
      sections: [{ id: 'sec_diag', type: 'diagram', objectIds: ['nodeA', 'nodeB', 'connAB'], layoutHint: 'flow' }]
    }
  };

  const { proposal } = createV2Proposal([nodeA, nodeB, conn], rawPlan);
  const pA = getPlacement(proposal, 'nodeA');
  const pB = getPlacement(proposal, 'nodeB');
  const pConn = getPlacement(proposal, 'connAB');

  assert.ok(pConn);
  assert.ok(pConn.position.x >= pA.position.x && pConn.position.x <= pB.position.x);
});

// TEST 7: Connector does not become a standalone section object
test('TEST 7: Connector does not become a standalone section object', () => {
  const nodeA = shape('nodeA', 0, 0);
  const nodeB = shape('nodeB', 200, 0);
  const conn = connector('connAB', 'nodeA', 'nodeB', 100, 0);

  const rawPlan = {
    workspaceType: 'diagram',
    document: {
      sections: [{ id: 'sec_diag', type: 'diagram', objectIds: ['nodeA', 'nodeB', 'connAB'], layoutHint: 'flow' }]
    }
  };

  const { proposal } = createV2Proposal([nodeA, nodeB, conn], rawPlan);
  const diagSection = proposal.sections.find((s) => s.sectionId === 'sec_diag');
  assert.ok(diagSection);
  assert.ok(diagSection.placementObjectIds.includes('connAB'));
});

// TEST 8: Heading remains with its section
test('TEST 8: Heading remains with its section', () => {
  const h1 = text('h1', 0, 0, 'Section Title');
  const p1 = text('p1', 0, 40, 'Body paragraph');

  const rawPlan = {
    workspaceType: 'document',
    document: {
      sections: [{ id: 'sec1', type: 'content', titleObjectId: 'h1', objectIds: ['h1', 'p1'], layoutHint: 'vertical-flow' }]
    }
  };

  const { proposal } = createV2Proposal([h1, p1], rawPlan);
  const sec = proposal.sections.find((s) => s.sectionId === 'sec1');
  assert.equal(sec.titleObjectId, 'h1');
  assert.ok(getPlacement(proposal, 'h1').position.y < getPlacement(proposal, 'p1').position.y);
});

// TEST 9: Body remains under its heading
test('TEST 9: Body remains under its heading', () => {
  const h1 = text('h1', 0, 0, 'Sprint Goals');
  const p1 = text('p1', 0, 50, 'Deliver mess cleanup layout engine.');

  const rawPlan = {
    workspaceType: 'document',
    document: {
      sections: [{ id: 'sec_sprint', type: 'content', titleObjectId: 'h1', objectIds: ['h1', 'p1'], layoutHint: 'vertical-flow' }]
    }
  };

  const { proposal } = createV2Proposal([h1, p1], rawPlan);
  const pH = getPlacement(proposal, 'h1');
  const pB = getPlacement(proposal, 'p1');

  assert.ok(pH.bounds.y + pH.bounds.height <= pB.bounds.y);
});

// TEST 10: Diagram title remains above diagram
test('TEST 10: Diagram title remains above diagram', () => {
  const title = text('diag_title', 0, 0, 'Architecture');
  const nodeA = shape('nA', 0, 100);
  const nodeB = shape('nB', 200, 100);
  const conn = connector('cAB', 'nA', 'nB', 100, 100);

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{
        id: 'sec_arch',
        type: 'diagram',
        titleObjectId: 'diag_title',
        objectIds: ['diag_title', 'nA', 'nB', 'cAB'],
        layoutHint: 'flow'
      }]
    }
  };

  const { proposal } = createV2Proposal([title, nodeA, nodeB, conn], rawPlan);
  const pTitle = getPlacement(proposal, 'diag_title');
  const pNodeA = getPlacement(proposal, 'nA');

  assert.ok(pTitle.position.y < pNodeA.position.y);
});

// TEST 11: Standalone text remains independent
test('TEST 11: Standalone text remains independent and listed in independentTextObjects', () => {
  const s1 = shape('s1', 0, 0);
  const txtStandalone = text('txt_independent', 500, 500, 'Standalone memo');

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [
        { id: 'sec1', type: 'content', objectIds: ['s1'] },
        { id: 'sec2', type: 'content', objectIds: ['txt_independent'] }
      ]
    }
  };

  const { proposal } = createV2Proposal([s1, txtStandalone], rawPlan);
  assert.ok(proposal.metadata.diagnostics.independentTextObjects.includes('txt_independent'));
});

// TEST 12: Two unrelated sections remain separate
test('TEST 12: Two unrelated sections remain separate without overlap', () => {
  const objects = [
    shape('s1', 0, 0), shape('s2', 150, 0),
    note('n1', 0, 300), note('n2', 150, 300)
  ];

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [
        { id: 'sec_shapes', type: 'content', objectIds: ['s1', 's2'] },
        { id: 'sec_notes', type: 'notes', objectIds: ['n1', 'n2'], layoutHint: 'grid' }
      ]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const sec1 = proposal.sections.find((s) => s.sectionId === 'sec_shapes');
  const sec2 = proposal.sections.find((s) => s.sectionId === 'sec_notes');

  assert.ok(sec1 && sec2);
  assert.equal(boxesOverlap(sec1, sec2), false);
});

// TEST 13: Outlier does not determine primary canvas bounds
test('TEST 13: Outlier does not determine primary canvas bounds', () => {
  const main1 = shape('m1', 100, 100);
  const main2 = shape('m2', 250, 100);
  const outlier = stroke('outlier_stroke', 99999, 99999);

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec_main', type: 'content', objectIds: ['m1', 'm2'] }]
    },
    unassignedObjectIds: ['outlier_stroke']
  };

  const { proposal } = createV2Proposal([main1, main2, outlier], rawPlan);
  assert.ok(proposal.canvasBounds.width < 3000);
  assert.ok(proposal.canvasBounds.height < 3000);
});

// TEST 14: Final composition remains usable landscape
test('TEST 14: Final composition remains usable landscape', () => {
  const objects = [
    shape('s1', 0, 0), shape('s2', 200, 0),
    note('n1', 400, 0), note('n2', 600, 0)
  ];

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [
        { id: 'sec_diag', type: 'content', objectIds: ['s1', 's2'] },
        { id: 'sec_notes', type: 'notes', objectIds: ['n1', 'n2'], layoutHint: 'grid' }
      ]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const aspectRatio = proposal.canvasBounds.width / Math.max(1, proposal.canvasBounds.height);
  assert.ok(aspectRatio >= 1.0);
});

// TEST 15: No linked object becomes detached
test('TEST 15: No linked object becomes detached (detachedLinkedObjects is empty)', () => {
  const s1 = shape('s1', 100, 100, { relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = text('t1', 100, 100, 'Inside Text', { relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = shape('s2', 300, 100, { relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = text('t2', 300, 100, 'Inside Text 2', { relationshipMetadata: { parentShapeId: 's2' } });

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [
        { id: 'sec1', type: 'content', objectIds: ['s1', 't1'] },
        { id: 'sec2', type: 'content', objectIds: ['s2', 't2'] }
      ]
    }
  };

  const { proposal } = createV2Proposal([s1, t1, s2, t2], rawPlan);
  assert.deepEqual(proposal.metadata.diagnostics.detachedLinkedObjects, []);
});

// TEST 16: No orphan connector exists
test('TEST 16: No orphan connector exists (orphanConnectors is empty for valid board)', () => {
  const nodeA = shape('nodeA', 100, 100);
  const nodeB = shape('nodeB', 300, 100);
  const conn = connector('connAB', 'nodeA', 'nodeB', 200, 100);

  const rawPlan = {
    workspaceType: 'diagram',
    document: {
      sections: [{ id: 'sec_diag', type: 'diagram', objectIds: ['nodeA', 'nodeB', 'connAB'], layoutHint: 'flow' }]
    }
  };

  const { proposal } = createV2Proposal([nodeA, nodeB, conn], rawPlan);
  assert.deepEqual(proposal.metadata.diagnostics.orphanConnectors, []);
});

// TEST 17: No semantic relationship is removed by collision resolution
test('TEST 17: No semantic relationship is removed by collision resolution', () => {
  const s1 = shape('s1', 100, 100, { relationshipMetadata: { attachedTextId: 't1' } });
  const t1 = text('t1', 100, 100, 'Text 1', { relationshipMetadata: { parentShapeId: 's1' } });
  const s2 = shape('s2', 110, 105, { relationshipMetadata: { attachedTextId: 't2' } });
  const t2 = text('t2', 110, 105, 'Text 2', { relationshipMetadata: { parentShapeId: 's2' } });

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1', 't1', 's2', 't2'] }]
    }
  };

  const { proposal } = createV2Proposal([s1, t1, s2, t2], rawPlan);
  assert.equal(proposal.metadata.diagnostics.detachedLinkedObjects.length, 0);
  assert.equal(proposal.metadata.diagnostics.collisionsAfter, 0);
});

// TEST 18: Object IDs remain unchanged
test('TEST 18: Object IDs remain unchanged', () => {
  const ids = ['s_alpha', 's_beta', 't_label', 'conn_1'];
  const objects = [
    shape('s_alpha', 0, 0),
    shape('s_beta', 200, 0),
    text('t_label', 0, 0, 'Label'),
    connector('conn_1', 's_alpha', 's_beta', 100, 0)
  ];

  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'diagram', objectIds: ids, layoutHint: 'flow' }]
    }
  };

  const { proposal } = createV2Proposal(objects, rawPlan);
  const outIds = proposal.placements.map((p) => p.objectId).sort();
  assert.deepEqual(outIds, ids.sort());
});

// TEST 19: Deterministic output
test('TEST 19: Deterministic output given identical inputs', () => {
  const objects = [
    shape('sA', 100, 100),
    shape('sB', 300, 100),
    note('n1', 200, 300)
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

  const { proposal: p1 } = createV2Proposal(objects, rawPlan);
  const { proposal: p2 } = createV2Proposal(objects, rawPlan);

  assert.equal(JSON.stringify(p1), JSON.stringify(p2));
});

// TEST 20: Input models remain immutable
test('TEST 20: Input models remain immutable', () => {
  const objects = [shape('s1', 100, 100), note('n1', 200, 200)];
  const rawPlan = {
    workspaceType: 'mixed',
    document: {
      sections: [{ id: 'sec1', type: 'content', objectIds: ['s1', 'n1'] }]
    }
  };

  const model = workspace(objects);
  const plan = validateOrganizationPlan(model, rawPlan);

  const modelStr = JSON.stringify(model);
  const planStr = JSON.stringify(plan);

  createLayoutProposal(plan, model);

  assert.equal(JSON.stringify(model), modelStr);
  assert.equal(JSON.stringify(plan), planStr);
});
