import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { normalizeObject } from './normalizeObjects.js';


test('1. Empty plan executes safely with zero object movement', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 100 }),
        normalizeObject({ id: 't1', type: 'text', text: 'Label', left: 120, top: 120, width: 60, height: 20 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [],
    untouchedObjectIds: ['s1', 't1'],
    diagnostics: { actionCount: 0, highConfidenceActionCount: 0, untouchedObjectCount: 2, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);
  assert.equal(proposal.placements.length, 2);

  const pS1 = proposal.placements.find((p) => p.objectId === 's1');
  const pT1 = proposal.placements.find((p) => p.objectId === 't1');

  assert.equal(pS1.bounds.x, 100);
  assert.equal(pS1.bounds.y, 100);
  assert.equal(pT1.bounds.x, 120);
  assert.equal(pT1.bounds.y, 120);
});

test('2. Preserve action guarantees 0 movement and 0 geometry changes', () => {
  const strokePath = [['M', 0, 0], ['C', 10, 20, 30, 40, 50, 60]];
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'stroke_1', type: 'stroke', isVectorStroke: true, left: 300, top: 400, width: 50, height: 60, path: strokePath })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_pres', type: 'preserve', objectIds: ['stroke_1'], confidence: 1.0, reason: 'Preserve user artwork' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);
  const p = proposal.placements.find((x) => x.objectId === 'stroke_1');
  assert.equal(p.bounds.x, 300);
  assert.equal(p.bounds.y, 400);
  assert.deepEqual(p.path, strokePath);
});

test('3. attachText action links shape and text and centers text inside shape', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'shape_1', elementId: 'elem_1', type: 'rect', left: 200, top: 200, width: 120, height: 80 }),
        normalizeObject({ id: 'text_1', elementId: 'elem_1', type: 'text', text: 'Centered Label', left: 210, top: 210, width: 60, height: 20 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_att', type: 'attachText', objectIds: ['shape_1', 'text_1'], confidence: 0.99, reason: 'Attached label' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const pShape = proposal.placements.find((p) => p.objectId === 'shape_1');
  const pText = proposal.placements.find((p) => p.objectId === 'text_1');

  assert.equal(pShape.bounds.x, 200);
  assert.equal(pShape.bounds.y, 200);
  assert.equal(pText.bounds.x, 230);
  assert.equal(pText.bounds.y, 230);
  assert.equal(pText.rotation, 0);
  assert.equal(pShape.relationshipMetadata.attachedTextId, 'text_1');
  assert.equal(pText.relationshipMetadata.parentShapeId, 'shape_1');
});

test('4. Centered label movement: text bounds correctly update while shape stays anchored', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'hex_1', type: 'path', shapeType: 'hexagon', left: 400, top: 100, width: 140, height: 90 }),
        normalizeObject({ id: 'txt_1', type: 'text', text: 'Process', left: 410, top: 110, width: 70, height: 24 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_1', type: 'attachText', objectIds: ['hex_1', 'txt_1'], confidence: 0.95, reason: 'Center text' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const pTxt = proposal.placements.find((p) => p.objectId === 'txt_1');
  assert.equal(pTxt.bounds.x, 400 + (140 - 70) / 2);
  assert.equal(pTxt.bounds.y, 100 + (90 - 24) / 2);
});

test('5. align x aligns multiple shapes along left boundary', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 120, top: 100, width: 80, height: 60 }),
        normalizeObject({ id: 's2', type: 'rect', left: 100, top: 200, width: 90, height: 60 }),
        normalizeObject({ id: 's3', type: 'rect', left: 140, top: 300, width: 80, height: 60 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_align_x', type: 'align', axis: 'x', objectIds: ['s1', 's2', 's3'], confidence: 0.95, reason: 'Left align' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const minLeft = 100;
  assert.equal(proposal.placements.find((p) => p.objectId === 's1').bounds.x, minLeft);
  assert.equal(proposal.placements.find((p) => p.objectId === 's2').bounds.x, minLeft);
  assert.equal(proposal.placements.find((p) => p.objectId === 's3').bounds.x, minLeft);
});

test('6. align y aligns multiple shapes along top boundary', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 100, top: 150, width: 80, height: 60 }),
        normalizeObject({ id: 's2', type: 'rect', left: 250, top: 120, width: 90, height: 60 }),
        normalizeObject({ id: 's3', type: 'rect', left: 400, top: 160, width: 80, height: 60 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_align_y', type: 'align', axis: 'y', objectIds: ['s1', 's2', 's3'], confidence: 0.95, reason: 'Top align' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const minTop = 120;
  assert.equal(proposal.placements.find((p) => p.objectId === 's1').bounds.y, minTop);
  assert.equal(proposal.placements.find((p) => p.objectId === 's2').bounds.y, minTop);
  assert.equal(proposal.placements.find((p) => p.objectId === 's3').bounds.y, minTop);
});

test('7. align centerX aligns shapes along horizontal center axis', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 60 }),
        normalizeObject({ id: 's2', type: 'rect', left: 200, top: 200, width: 60, height: 60 })
      ]
    }
  };

  const avgCenterX = (150 + 230) / 2;

  const plan = {
    version: 1,
    actions: [
      { id: 'act_cx', type: 'align', axis: 'centerX', objectIds: ['s1', 's2'], confidence: 0.95, reason: 'Center X align' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const p1 = proposal.placements.find((p) => p.objectId === 's1');
  const p2 = proposal.placements.find((p) => p.objectId === 's2');

  assert.equal(p1.bounds.x + p1.bounds.width / 2, avgCenterX);
  assert.equal(p2.bounds.x + p2.bounds.width / 2, avgCenterX);
});

test('8. align centerY aligns shapes along vertical center axis', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 80, height: 100 }),
        normalizeObject({ id: 's2', type: 'rect', left: 300, top: 180, width: 80, height: 60 })
      ]
    }
  };

  const avgCenterY = (150 + 210) / 2;

  const plan = {
    version: 1,
    actions: [
      { id: 'act_cy', type: 'align', axis: 'centerY', objectIds: ['s1', 's2'], confidence: 0.95, reason: 'Center Y align' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const p1 = proposal.placements.find((p) => p.objectId === 's1');
  const p2 = proposal.placements.find((p) => p.objectId === 's2');

  assert.equal(p1.bounds.y + p1.bounds.height / 2, avgCenterY);
  assert.equal(p2.bounds.y + p2.bounds.height / 2, avgCenterY);
});

test('9. equalizeSpacing uniformly distributes objects between first and last bounds', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 60 }),
        normalizeObject({ id: 's2', type: 'rect', left: 150, top: 100, width: 100, height: 60 }),
        normalizeObject({ id: 's3', type: 'rect', left: 700, top: 100, width: 100, height: 60 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_eq', type: 'equalizeSpacing', axis: 'x', objectIds: ['s1', 's2', 's3'], confidence: 0.92, reason: 'Equalize space' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const p1 = proposal.placements.find((p) => p.objectId === 's1');
  const p2 = proposal.placements.find((p) => p.objectId === 's2');
  const p3 = proposal.placements.find((p) => p.objectId === 's3');

  const gap1 = p2.bounds.x - (p1.bounds.x + p1.bounds.width);
  const gap2 = p3.bounds.x - (p2.bounds.x + p2.bounds.width);

  assert.ok(Math.abs(gap1 - gap2) < 0.01, 'Gaps between items must be equal');
});

test('10. arrangeGrid arranges sticky notes into deterministic compact grid', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'n1', type: 'rect', isStickyNote: true, left: 100, top: 100, width: 120, height: 120 }),
        normalizeObject({ id: 'n2', type: 'rect', isStickyNote: true, left: 300, top: 250, width: 120, height: 120 }),
        normalizeObject({ id: 'n3', type: 'rect', isStickyNote: true, left: 150, top: 400, width: 120, height: 120 }),
        normalizeObject({ id: 'n4', type: 'rect', isStickyNote: true, left: 400, top: 500, width: 120, height: 120 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_grid', type: 'arrangeGrid', objectIds: ['n1', 'n2', 'n3', 'n4'], confidence: 0.92, reason: 'Arrange grid' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const p1 = proposal.placements.find((p) => p.objectId === 'n1');
  const p2 = proposal.placements.find((p) => p.objectId === 'n2');
  const p3 = proposal.placements.find((p) => p.objectId === 'n3');
  const p4 = proposal.placements.find((p) => p.objectId === 'n4');

  assert.equal(p1.bounds.y, p2.bounds.y);
  assert.equal(p3.bounds.y, p4.bounds.y);
  assert.equal(p1.bounds.x, p3.bounds.x);
  assert.equal(p2.bounds.x, p4.bounds.x);
});

test('11. normalizeText normalizes rotation to 0 for standalone text', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'txt_rot', type: 'text', text: 'Hello World', left: 400, top: 500, width: 100, height: 24, rotation: 15 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_norm', type: 'normalizeText', objectIds: ['txt_rot'], confidence: 0.90, reason: 'Normalize rotation' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const p = proposal.placements.find((x) => x.objectId === 'txt_rot');
  assert.equal(p.rotation, 0);
  assert.equal(p.bounds.x, 400);
  assert.equal(p.bounds.y, 500);
});

test('12. Untouched object position preserved strictly', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'moved_shape', type: 'rect', left: 100, top: 100, width: 100, height: 100 }),
        normalizeObject({ id: 'moved_shape_2', type: 'rect', left: 150, top: 200, width: 100, height: 100 }),
        normalizeObject({ id: 'untouched_shape', type: 'circle', left: 700, top: 300, width: 120, height: 120 }),
        normalizeObject({ id: 'untouched_line', type: 'line', isSkribeLine: true, isStraightLine: true, left: 900, top: 100, width: 2, height: 400 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_1', type: 'align', axis: 'x', objectIds: ['moved_shape', 'moved_shape_2'], confidence: 0.9, reason: 'Align test' }
    ],
    untouchedObjectIds: ['untouched_shape', 'untouched_line'],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 2, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const pCircle = proposal.placements.find((p) => p.objectId === 'untouched_shape');
  const pLine = proposal.placements.find((p) => p.objectId === 'untouched_line');

  assert.equal(pCircle.bounds.x, 700);
  assert.equal(pCircle.bounds.y, 300);
  assert.equal(pLine.bounds.x, 900);
  assert.equal(pLine.bounds.y, 100);
});

test('13. Untouched object vector geometry (path) is preserved byte-for-byte', () => {
  const path = [['M', 0, 0], ['Q', 20, 30, 40, 50]];
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'freehand_doodle', type: 'stroke', isVectorStroke: true, left: 500, top: 600, width: 40, height: 50, path })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [],
    untouchedObjectIds: ['freehand_doodle'],
    diagnostics: { actionCount: 0, highConfidenceActionCount: 0, untouchedObjectCount: 1, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const p = proposal.placements.find((x) => x.objectId === 'freehand_doodle');
  assert.deepEqual(p.path, path);
});

test('14. Atomic shape+text movement: moving shape moves attached label by exact same delta', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', elementId: 'e1', type: 'rect', left: 100, top: 100, width: 100, height: 100, relationshipMetadata: { attachedTextId: 't1' } }),
        normalizeObject({ id: 't1', elementId: 'e1', type: 'text', text: 'Label', left: 120, top: 140, width: 60, height: 20, relationshipMetadata: { parentShapeId: 's1' } }),
        normalizeObject({ id: 's2', elementId: 'e2', type: 'rect', left: 300, top: 300, width: 100, height: 100 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_align', type: 'align', axis: 'y', objectIds: ['s1', 's2'], confidence: 0.95, reason: 'Top align' }
    ],
    untouchedObjectIds: ['t1'],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 1, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const pS1 = proposal.placements.find((p) => p.objectId === 's1');
  const pT1 = proposal.placements.find((p) => p.objectId === 't1');

  assert.equal(pS1.bounds.y, 100, 'Top align picks min top (100)');
  assert.equal(pT1.bounds.y, 140, 'Text moves with shape');
});

test('15. Atomic note+text movement: grid arrangement moves note and its contained text together', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'n1', elementId: 'e1', type: 'rect', isStickyNote: true, left: 100, top: 100, width: 140, height: 140, relationshipMetadata: { attachedTextId: 't1' } }),
        normalizeObject({ id: 't1', elementId: 'e1', type: 'text', text: 'Note Text', left: 110, top: 110, width: 120, height: 40, relationshipMetadata: { parentShapeId: 'n1' } }),
        normalizeObject({ id: 'n2', elementId: 'e2', type: 'rect', isStickyNote: true, left: 500, top: 400, width: 140, height: 140, relationshipMetadata: { attachedTextId: 't2' } }),
        normalizeObject({ id: 't2', elementId: 'e2', type: 'text', text: 'Note Text 2', left: 510, top: 410, width: 120, height: 40, relationshipMetadata: { parentShapeId: 'n2' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_grid', type: 'arrangeGrid', objectIds: ['n1', 'n2'], confidence: 0.92, reason: 'Arrange grid' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const pN2 = proposal.placements.find((p) => p.objectId === 'n2');
  const pT2 = proposal.placements.find((p) => p.objectId === 't2');

  const deltaX = pN2.bounds.x - 500;
  const deltaY = pN2.bounds.y - 400;

  assert.equal(pT2.bounds.x, 510 + deltaX, 'Text moves with note along X');
  assert.equal(pT2.bounds.y, 410 + deltaY, 'Text moves with note along Y');
});

test('16. Freeform rigid movement: stroke path commands translate rigidly with placement', () => {
  const initialPath = [['M', 10, 10], ['L', 50, 50]];
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 100 }),
        normalizeObject({ id: 's2', type: 'stroke', isVectorStroke: true, left: 200, top: 200, width: 50, height: 50, path: initialPath, pathCommands: initialPath })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_a', type: 'align', axis: 'x', objectIds: ['s1', 's2'], confidence: 0.9, reason: 'Align stroke' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const pS2 = proposal.placements.find((p) => p.objectId === 's2');
  assert.equal(pS2.bounds.x, 100, 'Stroke aligned to left 100 (dx = -100)');
  assert.equal(pS2.path[0][1], -90, 'Path M x translated by -100');
});

test('17. No object duplication: every source ID maps to exactly 1 placement', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'o1', type: 'rect', left: 10, top: 10, width: 50, height: 50 }),
        normalizeObject({ id: 'o2', type: 'text', text: 'T', left: 20, top: 20, width: 30, height: 20 }),
        normalizeObject({ id: 'o3', type: 'circle', left: 100, top: 100, width: 60, height: 60 })
      ]
    }
  };

  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  const ids = proposal.placements.map((p) => p.objectId);
  const uniqueIds = new Set(ids);
  assert.equal(ids.length, 3);
  assert.equal(uniqueIds.size, 3, 'No duplicate placements');
});

test('18. No object disappearance: all source objects survive into proposal', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'a', type: 'rect', left: 10, top: 10, width: 40, height: 40 }),
        normalizeObject({ id: 'b', type: 'circle', left: 60, top: 10, width: 40, height: 40 }),
        normalizeObject({ id: 'c', type: 'stroke', left: 110, top: 10, width: 40, height: 40 }),
        normalizeObject({ id: 'd', type: 'line', left: 160, top: 10, width: 2, height: 100 })
      ]
    }
  };

  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);

  assert.equal(proposal.placements.length, 4);
  assert.ok(proposal.placements.some((p) => p.objectId === 'a'));
  assert.ok(proposal.placements.some((p) => p.objectId === 'b'));
  assert.ok(proposal.placements.some((p) => p.objectId === 'c'));
  assert.ok(proposal.placements.some((p) => p.objectId === 'd'));
});

test('19. Deterministic output: multiple executions produce identical proposal', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 100 }),
        normalizeObject({ id: 't1', type: 'text', text: 'Label', left: 120, top: 120, width: 60, height: 20 })
      ]
    }
  };

  const plan = buildCleanupPlan(null, model);
  const prop1 = executeCleanupPlan(plan, model);
  const prop2 = executeCleanupPlan(plan, model);

  assert.deepEqual(prop1, prop2, 'Executions must be 100% deterministic');
});

test('20. Input immutability: executeCleanupPlan does not mutate inputs', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 100 })
      ]
    }
  };
  const plan = buildCleanupPlan(null, model);

  const snapModel = JSON.stringify(model);
  const snapPlan = JSON.stringify(plan);

  executeCleanupPlan(plan, model);

  assert.equal(JSON.stringify(model), snapModel, 'Model unmutated');
  assert.equal(JSON.stringify(plan), snapPlan, 'Plan unmutated');
});

test('21. Conflicting action rejection: invalid plan returns failure without partial execution', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 100 })
      ]
    }
  };

  const invalidPlan = {
    version: 1,
    actions: [
      { id: 'a1', type: 'align', axis: 'x', objectIds: ['s1'], confidence: 0.9, reason: 'Align' },
      { id: 'a2', type: 'preserve', objectIds: ['s1'], confidence: 1.0, reason: 'Preserve conflict' }
    ],
    untouchedObjectIds: [],
    diagnostics: {}
  };

  const proposal = executeCleanupPlan(invalidPlan, model);
  assert.equal(proposal.valid, false, 'Invalid plan must be transactionally rejected');
  assert.ok(proposal.error.includes('validation failed'));
});


test('22. cleanFlowchart: basic two-node horizontal graph aligns nodes and routes connector', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'node_a', type: 'rect', left: 100, top: 120, width: 120, height: 80 }),
        normalizeObject({ id: 'node_b', type: 'rect', left: 400, top: 160, width: 120, height: 80 }),
        normalizeObject({ id: 'conn_ab', type: 'path', isConnector: true, connectorType: 'straight', left: 220, top: 140, width: 180, height: 40, relationshipMetadata: { sourceShapeId: 'node_a', targetShapeId: 'node_b' }, endArrow: true })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_flow', type: 'cleanFlowchart', objectIds: ['node_a', 'node_b'], connectorIds: ['conn_ab'], confidence: 0.95, reason: '2-node horizontal' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const pA = proposal.placements.find((p) => p.objectId === 'node_a');
  const pB = proposal.placements.find((p) => p.objectId === 'node_b');
  const pConn = proposal.placements.find((p) => p.objectId === 'conn_ab');

  assert.equal(pA.bounds.y, pB.bounds.y);
  assert.ok(pB.bounds.x > pA.bounds.x + pA.bounds.width);
  assert.equal(pConn.bounds.x, pA.bounds.x + pA.bounds.width);
  assert.equal(pConn.bounds.x + pConn.bounds.width, pB.bounds.x);
});

test('23. cleanFlowchart: basic two-node vertical graph aligns nodes vertically and routes connector', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'node_top', type: 'rect', left: 200, top: 100, width: 120, height: 80 }),
        normalizeObject({ id: 'node_bot', type: 'rect', left: 240, top: 350, width: 120, height: 80 }),
        normalizeObject({ id: 'conn_down', type: 'path', isConnector: true, connectorType: 'straight', left: 220, top: 180, width: 40, height: 170, relationshipMetadata: { sourceShapeId: 'node_top', targetShapeId: 'node_bot' }, endArrow: true })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_flow_vert', type: 'cleanFlowchart', objectIds: ['node_top', 'node_bot'], connectorIds: ['conn_down'], confidence: 0.95, reason: '2-node vertical' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const pTop = proposal.placements.find((p) => p.objectId === 'node_top');
  const pBot = proposal.placements.find((p) => p.objectId === 'node_bot');
  const pConn = proposal.placements.find((p) => p.objectId === 'conn_down');

  assert.equal(pTop.bounds.x, pBot.bounds.x);
  assert.ok(pBot.bounds.y > pTop.bounds.y + pTop.bounds.height);
  assert.equal(pConn.bounds.y, pTop.bounds.y + pTop.bounds.height);
  assert.equal(pConn.bounds.y + pConn.bounds.height, pBot.bounds.y);
});

test('24. cleanFlowchart: three-node chain (A -> B -> C) creates 3 distinct levels', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'node_1', type: 'rect', left: 50, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'node_2', type: 'rect', left: 250, top: 150, width: 100, height: 80 }),
        normalizeObject({ id: 'node_3', type: 'rect', left: 500, top: 120, width: 100, height: 80 }),
        normalizeObject({ id: 'c1', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'node_1', targetShapeId: 'node_2' }, endArrow: true }),
        normalizeObject({ id: 'c2', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'node_2', targetShapeId: 'node_3' }, endArrow: true })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_chain', type: 'cleanFlowchart', objectIds: ['node_1', 'node_2', 'node_3'], connectorIds: ['c1', 'c2'], confidence: 0.95, reason: '3-node chain' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const p1 = proposal.placements.find((p) => p.objectId === 'node_1');
  const p2 = proposal.placements.find((p) => p.objectId === 'node_2');
  const p3 = proposal.placements.find((p) => p.objectId === 'node_3');

  assert.ok(p1.bounds.x < p2.bounds.x);
  assert.ok(p2.bounds.x < p3.bounds.x);
  assert.equal(p1.bounds.y, p2.bounds.y);
  assert.equal(p2.bounds.y, p3.bounds.y);
});

test('25. cleanFlowchart: branching graph (A -> B, A -> C) places B and C in same column', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'node_root', type: 'rect', left: 100, top: 200, width: 120, height: 80 }),
        normalizeObject({ id: 'node_branch_1', type: 'rect', left: 350, top: 100, width: 120, height: 80 }),
        normalizeObject({ id: 'node_branch_2', type: 'rect', left: 350, top: 300, width: 120, height: 80 }),
        normalizeObject({ id: 'c_b1', type: 'path', isConnector: true, connectorType: 'elbow', relationshipMetadata: { sourceShapeId: 'node_root', targetShapeId: 'node_branch_1' } }),
        normalizeObject({ id: 'c_b2', type: 'path', isConnector: true, connectorType: 'elbow', relationshipMetadata: { sourceShapeId: 'node_root', targetShapeId: 'node_branch_2' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_branch', type: 'cleanFlowchart', objectIds: ['node_root', 'node_branch_1', 'node_branch_2'], connectorIds: ['c_b1', 'c_b2'], confidence: 0.95, reason: 'Branching graph' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const pB1 = proposal.placements.find((p) => p.objectId === 'node_branch_1');
  const pB2 = proposal.placements.find((p) => p.objectId === 'node_branch_2');

  assert.equal(pB1.bounds.x, pB2.bounds.x, 'Branches B1 and B2 share the same column X');
  assert.ok(pB2.bounds.y > pB1.bounds.y + pB1.bounds.height, 'Branches are stacked with sibling gap');
});

test('26. cleanFlowchart: merging graph (A -> C, B -> C) merges multiple roots into single target level', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'root_1', type: 'rect', left: 100, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'root_2', type: 'rect', left: 100, top: 250, width: 100, height: 80 }),
        normalizeObject({ id: 'target_node', type: 'rect', left: 350, top: 180, width: 100, height: 80 }),
        normalizeObject({ id: 'c1', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'root_1', targetShapeId: 'target_node' } }),
        normalizeObject({ id: 'c2', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'root_2', targetShapeId: 'target_node' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_merge', type: 'cleanFlowchart', objectIds: ['root_1', 'root_2', 'target_node'], connectorIds: ['c1', 'c2'], confidence: 0.95, reason: 'Merging graph' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const pR1 = proposal.placements.find((p) => p.objectId === 'root_1');
  const pR2 = proposal.placements.find((p) => p.objectId === 'root_2');
  const pT = proposal.placements.find((p) => p.objectId === 'target_node');

  assert.equal(pR1.bounds.x, pR2.bounds.x, 'Root 1 and Root 2 share Level 0 column');
  assert.ok(pT.bounds.x > pR1.bounds.x + pR1.bounds.width, 'Target node placed in Level 1 column');
});

test('27. cleanFlowchart: topological level calculation accurately places longest path dependencies', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'A', type: 'rect', left: 50, top: 50, width: 80, height: 60 }),
        normalizeObject({ id: 'B', type: 'rect', left: 180, top: 50, width: 80, height: 60 }),
        normalizeObject({ id: 'C', type: 'rect', left: 320, top: 50, width: 80, height: 60 }),
        normalizeObject({ id: 'D', type: 'rect', left: 450, top: 50, width: 80, height: 60 }),
        normalizeObject({ id: 'cAB', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'A', targetShapeId: 'B' } }),
        normalizeObject({ id: 'cBC', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'B', targetShapeId: 'C' } }),
        normalizeObject({ id: 'cCD', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'C', targetShapeId: 'D' } }),
        normalizeObject({ id: 'cAD', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'A', targetShapeId: 'D' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_topol', type: 'cleanFlowchart', objectIds: ['A', 'B', 'C', 'D'], connectorIds: ['cAB', 'cBC', 'cCD', 'cAD'], confidence: 0.95, reason: 'DAG levels' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const pA = proposal.placements.find((p) => p.objectId === 'A');
  const pB = proposal.placements.find((p) => p.objectId === 'B');
  const pC = proposal.placements.find((p) => p.objectId === 'C');
  const pD = proposal.placements.find((p) => p.objectId === 'D');

  assert.ok(pA.bounds.x < pB.bounds.x);
  assert.ok(pB.bounds.x < pC.bounds.x);
  assert.ok(pC.bounds.x < pD.bounds.x, 'D is placed at Level 3 due to longest path A -> B -> C -> D');
});

test('28. cleanFlowchart: deterministic node ordering ensures predictable sibling positioning', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'root', type: 'rect', left: 50, top: 200, width: 80, height: 60 }),
        normalizeObject({ id: 'node_top_orig', type: 'rect', left: 200, top: 100, width: 80, height: 60 }),
        normalizeObject({ id: 'node_bot_orig', type: 'rect', left: 200, top: 300, width: 80, height: 60 }),
        normalizeObject({ id: 'c1', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'root', targetShapeId: 'node_top_orig' } }),
        normalizeObject({ id: 'c2', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'root', targetShapeId: 'node_bot_orig' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_det', type: 'cleanFlowchart', objectIds: ['root', 'node_top_orig', 'node_bot_orig'], connectorIds: ['c1', 'c2'], confidence: 0.95, reason: 'Deterministic order' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const pTop = proposal.placements.find((p) => p.objectId === 'node_top_orig');
  const pBot = proposal.placements.find((p) => p.objectId === 'node_bot_orig');

  assert.ok(pTop.bounds.y < pBot.bounds.y, 'Original top sibling remains top sibling');
});

test('29. cleanFlowchart: attached labels move atomically with nodes', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'step_shape', elementId: 'elem_step', type: 'path', shapeType: 'hexagon', left: 100, top: 100, width: 120, height: 80, relationshipMetadata: { attachedTextId: 'step_text' } }),
        normalizeObject({ id: 'step_text', elementId: 'elem_step', type: 'text', text: 'Step 1', left: 120, top: 130, width: 60, height: 20, relationshipMetadata: { parentShapeId: 'step_shape' } }),
        normalizeObject({ id: 'decision_shape', elementId: 'elem_dec', type: 'path', shapeType: 'diamond', left: 350, top: 150, width: 100, height: 100, relationshipMetadata: { attachedTextId: 'decision_text' } }),
        normalizeObject({ id: 'decision_text', elementId: 'elem_dec', type: 'text', text: 'Decision', left: 360, top: 190, width: 60, height: 20, relationshipMetadata: { parentShapeId: 'decision_shape' } }),
        normalizeObject({ id: 'conn_step_dec', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'step_shape', targetShapeId: 'decision_shape' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_atomic_flow', type: 'cleanFlowchart', objectIds: ['step_shape', 'decision_shape'], connectorIds: ['conn_step_dec'], confidence: 0.95, reason: 'Atomic flowchart nodes' }
    ],
    untouchedObjectIds: ['step_text', 'decision_text'],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 2, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const pStepShape = proposal.placements.find((p) => p.objectId === 'step_shape');
  const pStepText = proposal.placements.find((p) => p.objectId === 'step_text');
  const pDecShape = proposal.placements.find((p) => p.objectId === 'decision_shape');
  const pDecText = proposal.placements.find((p) => p.objectId === 'decision_text');

  const stepDeltaX = pStepShape.bounds.x - 100;
  const stepDeltaY = pStepShape.bounds.y - 100;
  assert.equal(pStepText.bounds.x, 120 + stepDeltaX);
  assert.equal(pStepText.bounds.y, 130 + stepDeltaY);

  const decDeltaX = pDecShape.bounds.x - 350;
  const decDeltaY = pDecShape.bounds.y - 150;
  assert.equal(pDecText.bounds.x, 360 + decDeltaX);
  assert.equal(pDecText.bounds.y, 190 + decDeltaY);
});

test('30. cleanFlowchart: node dimensions are preserved strictly', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'rect_custom', type: 'rect', left: 100, top: 100, width: 220, height: 110 }),
        normalizeObject({ id: 'circle_custom', type: 'circle', left: 400, top: 100, width: 90, height: 90 }),
        normalizeObject({ id: 'c1', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'rect_custom', targetShapeId: 'circle_custom' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_dims', type: 'cleanFlowchart', objectIds: ['rect_custom', 'circle_custom'], connectorIds: ['c1'], confidence: 0.95, reason: 'Preserve dimensions' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const pR = proposal.placements.find((p) => p.objectId === 'rect_custom');
  const pC = proposal.placements.find((p) => p.objectId === 'circle_custom');

  assert.equal(pR.bounds.width, 220);
  assert.equal(pR.bounds.height, 110);
  assert.equal(pC.bounds.width, 90);
  assert.equal(pC.bounds.height, 90);
});

test('31. cleanFlowchart: straight connector preserved as straight', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'a', type: 'rect', left: 100, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'b', type: 'rect', left: 400, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'c_straight', type: 'path', isConnector: true, connectorType: 'straight', relationshipMetadata: { sourceShapeId: 'a', targetShapeId: 'b' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_s', type: 'cleanFlowchart', objectIds: ['a', 'b'], connectorIds: ['c_straight'], confidence: 0.95, reason: 'Straight connector' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const pConn = proposal.placements.find((p) => p.objectId === 'c_straight');
  assert.ok(pConn.pathCommands.every((cmd) => cmd[0] === 'M' || cmd[0] === 'L'));
});

test('32. cleanFlowchart: elbow connector preserved as orthogonal elbow', () => {
  const origElbowPath = [['M', 200, 140], ['L', 250, 140], ['L', 250, 200], ['L', 300, 200]];
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'a', type: 'rect', left: 100, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'b', type: 'rect', left: 300, top: 250, width: 100, height: 80 }),
        normalizeObject({ id: 'c_elbow', type: 'path', isConnector: true, connectorType: 'elbow', path: origElbowPath, relationshipMetadata: { sourceShapeId: 'a', targetShapeId: 'b' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_e', type: 'cleanFlowchart', objectIds: ['a', 'b'], connectorIds: ['c_elbow'], confidence: 0.95, reason: 'Elbow connector' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const pConn = proposal.placements.find((p) => p.objectId === 'c_elbow');
  assert.ok(pConn.pathCommands.length >= 3, 'Elbow contains multiple orthogonal segments');
});

test('33. cleanFlowchart: curved connector preserved as smooth curve', () => {
  const origCurvedPath = [['M', 200, 140], ['C', 250, 100, 300, 100, 350, 140]];
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'a', type: 'rect', left: 100, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'b', type: 'rect', left: 350, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'c_curved', type: 'path', isConnector: true, connectorType: 'curved', path: origCurvedPath, relationshipMetadata: { sourceShapeId: 'a', targetShapeId: 'b' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_c', type: 'cleanFlowchart', objectIds: ['a', 'b'], connectorIds: ['c_curved'], confidence: 0.95, reason: 'Curved connector' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const pConn = proposal.placements.find((p) => p.objectId === 'c_curved');
  assert.ok(pConn.pathCommands.some((cmd) => cmd[0] === 'C' || cmd[0] === 'Q'), 'Curved connector preserves bezier commands');
});

test('34. cleanFlowchart: arrowheads and direction preserved', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'src', type: 'rect', left: 100, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'tgt', type: 'rect', left: 300, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'conn_arrow', type: 'path', isConnector: true, startArrow: false, endArrow: true, relationshipMetadata: { sourceShapeId: 'src', targetShapeId: 'tgt' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_arrow', type: 'cleanFlowchart', objectIds: ['src', 'tgt'], connectorIds: ['conn_arrow'], confidence: 0.95, reason: 'Arrow direction' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  const pConn = proposal.placements.find((p) => p.objectId === 'conn_arrow');
  assert.equal(pConn.endArrow, true);
  assert.equal(pConn.startArrow, false);
});

test('35. cleanFlowchart: unrelated objects (shapes, notes, freehand) do not move', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'flow_1', type: 'rect', left: 100, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'flow_2', type: 'rect', left: 300, top: 150, width: 100, height: 80 }),
        normalizeObject({ id: 'flow_conn', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'flow_1', targetShapeId: 'flow_2' } }),
        normalizeObject({ id: 'unrelated_note', type: 'rect', isStickyNote: true, left: 600, top: 400, width: 140, height: 140 }),
        normalizeObject({ id: 'unrelated_stroke', type: 'stroke', isVectorStroke: true, left: 800, top: 100, width: 50, height: 50 }),
        normalizeObject({ id: 'unrelated_line', type: 'line', isSkribeLine: true, isStraightLine: true, left: 950, top: 50, width: 2, height: 500 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_local_flow', type: 'cleanFlowchart', objectIds: ['flow_1', 'flow_2'], connectorIds: ['flow_conn'], confidence: 0.95, reason: 'Local flowchart only' }
    ],
    untouchedObjectIds: ['unrelated_note', 'unrelated_stroke', 'unrelated_line'],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 3, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const pNote = proposal.placements.find((p) => p.objectId === 'unrelated_note');
  const pStroke = proposal.placements.find((p) => p.objectId === 'unrelated_stroke');
  const pLine = proposal.placements.find((p) => p.objectId === 'unrelated_line');

  assert.equal(pNote.bounds.x, 600);
  assert.equal(pNote.bounds.y, 400);
  assert.equal(pStroke.bounds.x, 800);
  assert.equal(pStroke.bounds.y, 100);
  assert.equal(pLine.bounds.x, 950);
  assert.equal(pLine.bounds.y, 50);
});

test('36. cleanFlowchart: external endpoint dependency is detected and rejected safely', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'flow_node_1', type: 'rect', left: 100, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'flow_node_2', type: 'rect', left: 300, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'external_shape', type: 'circle', left: 700, top: 500, width: 80, height: 80 }),
        normalizeObject({ id: 'conn_external', type: 'path', isConnector: true, relationshipMetadata: { sourceShapeId: 'flow_node_1', targetShapeId: 'external_shape' } })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_bad_flow', type: 'cleanFlowchart', objectIds: ['flow_node_1', 'flow_node_2'], connectorIds: ['conn_external'], confidence: 0.95, reason: 'External endpoint dependency test' }
    ],
    untouchedObjectIds: ['external_shape'],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 1, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, false, 'External endpoint dependency must be safely rejected');
  assert.equal(proposal.errorType, 'externalEndpointDependency');
});

test('37. cleanFlowchart: missing node in objectIds triggers clean transactional rejection', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'node_1', type: 'rect', left: 100, top: 100, width: 100, height: 80 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_missing_node', type: 'cleanFlowchart', objectIds: ['node_1', 'ghost_node_2'], connectorIds: [], confidence: 0.95, reason: 'Missing node' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, false);
  assert.ok(proposal.error.includes('Missing node') || proposal.error.includes('unknown object ID'));
});

test('38. cleanFlowchart: invalid connector in connectorIds triggers safe rejection', () => {
  const model = {
    board: {
      objects: [
        normalizeObject({ id: 'n1', type: 'rect', left: 100, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'n2', type: 'rect', left: 300, top: 100, width: 100, height: 80 }),
        normalizeObject({ id: 'not_a_connector', type: 'text', text: 'Text', left: 200, top: 100, width: 60, height: 20 })
      ]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_bad_c', type: 'cleanFlowchart', objectIds: ['n1', 'n2'], connectorIds: ['not_a_connector'], confidence: 0.95, reason: 'Invalid connector' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, false);
  assert.ok(proposal.reason.includes('not a connector'));
});

test('39. Real Board Fixture: flowchart execution cleans process & decision nodes without touching other elements', () => {
  const processShape = normalizeObject({ id: 'shape_process', elementId: 'elem_proc', type: 'path', shapeType: 'hexagon', left: 300, top: 200, width: 100, height: 100, relationshipMetadata: { attachedTextId: 'text_proc' } });
  const processText = normalizeObject({ id: 'text_proc', elementId: 'elem_proc', type: 'text', text: 'Process', left: 310, top: 220, width: 60, height: 20, relationshipMetadata: { parentShapeId: 'shape_process' } });

  const decisionShape = normalizeObject({ id: 'shape_decision', elementId: 'elem_dec', type: 'path', shapeType: 'diamond', left: 550, top: 210, width: 100, height: 100, relationshipMetadata: { attachedTextId: 'text_dec' } });
  const decisionText = normalizeObject({ id: 'text_dec', elementId: 'elem_dec', type: 'text', text: 'Decision', left: 560, top: 230, width: 60, height: 20, relationshipMetadata: { parentShapeId: 'shape_decision' } });

  const connProcDec = normalizeObject({ id: 'conn_proc_dec', type: 'path', isConnector: true, connectorType: 'straight', relationshipMetadata: { sourceShapeId: 'shape_process', targetShapeId: 'shape_decision' }, endArrow: true });

  const stickyNote = normalizeObject({ id: 'note_blue', elementId: 'elem_blue', type: 'rect', isStickyNote: true, left: 300, top: 400, width: 140, height: 140 });
  const helloText = normalizeObject({ id: 'text_hello', type: 'text', text: 'Hello World!', left: 450, top: 560, width: 100, height: 24, rotation: -12 });
  const dividerLine = normalizeObject({ id: 'line_divider', type: 'path', isSkribeLine: true, isStraightLine: true, left: 950, top: 200, width: 2, height: 400 });
  const freehandStroke = normalizeObject({ id: 'stroke_H', type: 'stroke', isVectorStroke: true, left: 300, top: 580, width: 20, height: 40 });

  const model = {
    board: {
      objects: [processShape, processText, decisionShape, decisionText, connProcDec, stickyNote, helloText, dividerLine, freehandStroke]
    }
  };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_flowchart', type: 'cleanFlowchart', objectIds: ['shape_process', 'shape_decision'], connectorIds: ['conn_proc_dec'], confidence: 0.95, reason: 'Flowchart process -> decision' },
      { id: 'act_attach_proc', type: 'attachText', objectIds: ['shape_process', 'text_proc'], confidence: 0.99, reason: 'Process text' },
      { id: 'act_attach_dec', type: 'attachText', objectIds: ['shape_decision', 'text_dec'], confidence: 0.99, reason: 'Decision text' },
      { id: 'act_norm_hello', type: 'normalizeText', objectIds: ['text_hello'], confidence: 0.90, reason: 'Hello text' }
    ],
    untouchedObjectIds: ['note_blue', 'line_divider', 'stroke_H'],
    diagnostics: { actionCount: 4, highConfidenceActionCount: 4, untouchedObjectCount: 3, unsupportedActionCount: 0 }
  };

  const proposal = executeCleanupPlan(plan, model);
  assert.equal(proposal.valid, true);

  const pProc = proposal.placements.find((p) => p.objectId === 'shape_process');
  const pDec = proposal.placements.find((p) => p.objectId === 'shape_decision');
  const pConn = proposal.placements.find((p) => p.objectId === 'conn_proc_dec');
  const pSticky = proposal.placements.find((p) => p.objectId === 'note_blue');
  const pDivider = proposal.placements.find((p) => p.objectId === 'line_divider');
  const pStroke = proposal.placements.find((p) => p.objectId === 'stroke_H');

  assert.equal(pProc.bounds.y, pDec.bounds.y);
  assert.equal(pConn.bounds.x, pProc.bounds.x + pProc.bounds.width);
  assert.equal(pConn.bounds.x + pConn.bounds.width, pDec.bounds.x);

  assert.equal(pSticky.bounds.x, 300);
  assert.equal(pSticky.bounds.y, 400);
  assert.equal(pDivider.bounds.x, 950);
  assert.equal(pDivider.bounds.y, 200);
  assert.equal(pStroke.bounds.x, 300);
  assert.equal(pStroke.bounds.y, 580);
});
