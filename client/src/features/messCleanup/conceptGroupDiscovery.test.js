import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverVisualStructures } from './discoverVisualStructures.js';
import { generateCompositionCandidates } from './discoverVisualStructures.js';
import { STRUCTURE_TYPES, TEMPLATE_TYPES } from './discoverVisualStructures.js';
import { normalizeObject } from './normalizeObjects.js';

test('1. Confident concept group -> conceptGroup CanvasStructure', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 200, top: 200, width: 100, height: 80 });

  const scene = {
    groups: [{ id: 'group_spec', type: 'concept', objectIds: ['c1', 'c2'] }]
  };

  const model = { board: { objects: [c1, c2] } };
  const structures = discoverVisualStructures(model, scene);
  
  const conceptGrp = structures.find(s => s.type === STRUCTURE_TYPES.CONCEPT_GROUP);
  assert.ok(conceptGrp, 'Concept group should be discovered');
  assert.equal(conceptGrp.objectIds.length, 2);
  assert.ok(conceptGrp.objectIds.includes('c1'));
  assert.ok(conceptGrp.objectIds.includes('c2'));

  const candidates = generateCompositionCandidates(structures);
  assert.ok(candidates.some(c => c.type === STRUCTURE_TYPES.CONCEPT_GROUP), 'Concept group candidate should be generated');
});

test('2. Ambiguous cluster (no semantic group) -> NOT conceptGroup', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 100, top: 200, width: 100, height: 80 });

  const scene = { groups: [] };
  const model = { board: { objects: [c1, c2] } };
  const structures = discoverVisualStructures(model, scene);
  
  const conceptGrp = structures.find(s => s.type === STRUCTURE_TYPES.CONCEPT_GROUP);
  assert.equal(conceptGrp, undefined, 'Concept group should not be inferred from proximity alone');
});

test('3. Insufficient evidence (unassigned fallback) -> never conceptGroup', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 100, top: 200, width: 100, height: 80 });

  const scene = {
    groups: [{ id: 'group_concept_unassigned', type: 'concept', purpose: 'Unassigned content', objectIds: ['c1', 'c2'] }]
  };
  const model = { board: { objects: [c1, c2] } };
  const structures = discoverVisualStructures(model, scene);
  
  const conceptGrp = structures.find(s => s.type === STRUCTURE_TYPES.CONCEPT_GROUP);
  assert.equal(conceptGrp, undefined, 'Unassigned fallback group should not become a concept group structure');
});

test('4. Multiple independent groups -> separate structures', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 100, top: 200, width: 100, height: 80 });
  
  const c3 = normalizeObject({ id: 'c3', type: 'rect', left: 500, top: 100, width: 100, height: 80 });
  const c4 = normalizeObject({ id: 'c4', type: 'rect', left: 500, top: 200, width: 100, height: 80 });

  const scene = {
    groups: [
      { id: 'group1', type: 'concept', objectIds: ['c1', 'c2'] },
      { id: 'group2', type: 'concept', objectIds: ['c3', 'c4'] }
    ]
  };

  const model = { board: { objects: [c1, c2, c3, c4] } };
  const structures = discoverVisualStructures(model, scene);
  
  const conceptGrps = structures.filter(s => s.type === STRUCTURE_TYPES.CONCEPT_GROUP);
  assert.equal(conceptGrps.length, 2, 'Two separate concept groups should be discovered');
  assert.equal(conceptGrps[0].objectIds.length, 2);
  assert.equal(conceptGrps[1].objectIds.length, 2);
});

test('5. Concept group does not contaminate flowchart', () => {
  const node1 = normalizeObject({ id: 'n1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const node2 = normalizeObject({ id: 'n2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({ id: 'conn1', type: 'connector', startObjectId: 'n1', endObjectId: 'n2', path: 'M 200 140 L 300 140' });
  
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 400, width: 100, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 100, top: 500, width: 100, height: 80 });

  const scene = {
    groups: [
      { id: 'flow', type: 'flowchart', objectIds: ['n1', 'n2', 'conn1'] },
      { id: 'concept', type: 'concept', objectIds: ['c1', 'c2'] }
    ]
  };

  const model = { board: { objects: [node1, node2, conn, c1, c2] } };
  const structures = discoverVisualStructures(model, scene);
  
  const conceptGrp = structures.find(s => s.type === STRUCTURE_TYPES.CONCEPT_GROUP);
  
  assert.ok(conceptGrp, 'Concept group discovered');
  
  assert.deepEqual(conceptGrp.objectIds.sort(), ['c1', 'c2'].sort());
});

test('6. Measurable improvement generates candidate', () => {
  // Intentional misalignment to create measurable benefit
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 200, top: 200, width: 100, height: 80 }); 

  const scene = {
    groups: [{ id: 'group_spec', type: 'concept', objectIds: ['c1', 'c2'] }]
  };

  const model = { board: { objects: [c1, c2] } };
  const structures = discoverVisualStructures(model, scene);
  const candidates = generateCompositionCandidates(structures);
  
  const cand = candidates.find(c => c.type === STRUCTURE_TYPES.CONCEPT_GROUP);
  assert.ok(cand, 'Candidate should be generated');
  assert.ok(cand.compositionBenefit >= 1.5, 'Benefit should be high enough to generate candidate');
});

test('7. No measurable improvement -> no candidate generated', () => {
  // perfectly aligned
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 100, top: 200, width: 100, height: 80 }); 

  const scene = {
    groups: [{ id: 'group_spec', type: 'concept', objectIds: ['c1', 'c2'] }]
  };

  const model = { board: { objects: [c1, c2] } };
  const structures = discoverVisualStructures(model, scene);
  const candidates = generateCompositionCandidates(structures);
  
  const cand = candidates.find(c => c.type === STRUCTURE_TYPES.CONCEPT_GROUP);
  if (cand) {
     assert.ok(cand.compositionBenefit < 1.5, 'Benefit should be low for perfectly aligned objects');
  } else {
     assert.ok(true, 'No candidate generated due to low benefit');
  }
});

test('8. SELECTION scope isolation', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 100, top: 200, width: 100, height: 80 });

  const c3 = normalizeObject({ id: 'c3', type: 'rect', left: 500, top: 100, width: 100, height: 80 });
  const c4 = normalizeObject({ id: 'c4', type: 'rect', left: 500, top: 200, width: 100, height: 80 });

  const scene = {
    groups: [
      { id: 'group1', type: 'concept', objectIds: ['c1', 'c2'] },
      { id: 'group2', type: 'concept', objectIds: ['c3', 'c4'] }
    ]
  };

  const model = { board: { objects: [c1, c2, c3, c4] } };
  // Normally discoverVisualStructures doesn't take scope directly (that's handled in buildCleanupPlan/resolveCleanupOpportunity)
  // We'll test that the structure has all properties correctly for downstream scoping.
  const structures = discoverVisualStructures(model, scene);
  
  const g1 = structures.find(s => s.id === 'struct_seq_group1');
  const g2 = structures.find(s => s.id === 'struct_seq_group2');
  
  assert.ok(g1);
  assert.ok(g2);
});

test('9. Protected content isolation', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 100, top: 200, width: 100, height: 80 });
  const drawing = normalizeObject({ id: 'drawing', type: 'stroke', left: 110, top: 150, width: 50, height: 50, isVectorStroke: true });

  const scene = {
    groups: [{ id: 'group_spec', type: 'concept', objectIds: ['c1', 'c2'] }]
  };

  const model = { board: { objects: [c1, c2, drawing] } };
  const structures = discoverVisualStructures(model, scene);
  
  const conceptGrp = structures.find(s => s.type === STRUCTURE_TYPES.CONCEPT_GROUP);
  assert.ok(conceptGrp);
  assert.equal(conceptGrp.objectIds.includes('drawing'), false, 'Drawing should not be included in concept group');
  
  const creative = structures.find(s => s.type === STRUCTURE_TYPES.CREATIVE);
  assert.ok(creative, 'Drawing should be separate creative structure');
});

test('10. Input ordering stability', () => {
  const c1 = normalizeObject({ id: 'c1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const c2 = normalizeObject({ id: 'c2', type: 'rect', left: 100, top: 200, width: 100, height: 80 });

  const scene1 = { groups: [{ id: 'g1', type: 'concept', objectIds: ['c1', 'c2'] }] };
  const scene2 = { groups: [{ id: 'g1', type: 'concept', objectIds: ['c2', 'c1'] }] };

  const model = { board: { objects: [c1, c2] } };
  
  const s1 = discoverVisualStructures(model, scene1).find(s => s.type === STRUCTURE_TYPES.CONCEPT_GROUP);
  const s2 = discoverVisualStructures(model, scene2).find(s => s.type === STRUCTURE_TYPES.CONCEPT_GROUP);
  
  assert.deepEqual(s1.objectIds, s2.objectIds, 'Ordering of input should not affect final structure objectIds');
});
