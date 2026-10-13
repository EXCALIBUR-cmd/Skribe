import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMacroCandidates, selectMacroCandidates, MACRO_CANDIDATE_TYPES } from './macroComposition.js';
import { STRUCTURE_TYPES } from './discoverVisualStructures.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { validateCleanupPlan } from './cleanupPlanTypes.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildCleanupResult } from './buildCleanupResult.js';
import { validateCleanupResult } from './cleanupResultTypes.js';
import { createLayoutProposal } from './layoutEngine.js';
import { normalizeObject } from './normalizeObjects.js';
import { buildPreviewRenderModel } from './previewModel.js';
import { applyCleanup } from './applyCleanup.js';

const makeBlock = (id, x, y, w, h, type = STRUCTURE_TYPES.FLOW, isProtected = false, extra = {}) => ({
  id,
  structureId: id,
  type,
  bounds: { x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 },
  center: { x: x + w / 2, y: y + h / 2 },
  objectIds: [`${id}_obj`],
  connectorIds: [],
  protected: isProtected,
  cleanupEligibility: isProtected ? 'outside-scope' : 'eligible',
  ...extra
});

const makeEvidence = (blocks, relationships = []) => ({
  blocks,
  relationships,
  boardBounds: null,
  occupiedBounds: null,
  protectedOccupiedBounds: null,
  evidence: {}
});

describe('Macro Composition - Candidate Generation', () => {
  test('TEST B: PACK_ADJACENT_ALIGNED candidate generation works', () => {
    const blocks = [
      makeBlock('b1', 100, 100, 200, 100),
      makeBlock('b2', 500, 100, 200, 100)
    ];
    const rels = [{
      blockA: 'b1', blockB: 'b2',
      connected: true, overlapping: false,
      horizontalGap: 200, verticalGap: 0, minDistance: 200,
      alignmentEvidence: [{ axis: 'y', type: 'top-edge', deviation: 0 }]
    }];
    const evidence = makeEvidence(blocks, rels);
    const options = { objectMap: new Map(), ownership: {} };

    const candidates = generateMacroCandidates(evidence, options);
    assert.equal(candidates.length > 0, true);
    
    const packCand = candidates.find(c => c.type === MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED);
    assert.ok(packCand);
    assert.equal(packCand.safe, true);
    assert.ok(packCand.benefit > 0);
  });

  test('TEST E: RESOLVE_MACRO_OVERLAP candidate generation works', () => {
    const blocks = [
      makeBlock('b1', 100, 100, 200, 100),
      makeBlock('b2', 250, 150, 200, 100)
    ];
    const rels = [{
      blockA: 'b1', blockB: 'b2',
      connected: false, overlapping: true, overlapArea: 2500, overlapRatio: 0.125,
      horizontalGap: 0, verticalGap: 0, minDistance: 0,
      alignmentEvidence: []
    }];
    const evidence = makeEvidence(blocks, rels);
    const options = { objectMap: new Map(), ownership: {} };

    const candidates = generateMacroCandidates(evidence, options);
    assert.equal(candidates.length > 0, true);
    
    const resolveCand = candidates.find(c => c.type === MACRO_CANDIDATE_TYPES.RESOLVE_MACRO_OVERLAP);
    assert.ok(resolveCand);
    assert.equal(resolveCand.safe, true);
    assert.ok(resolveCand.benefit > 0);
  });

  test('TEST F: Minimum displacement is geometry-derived (Overlap)', () => {
    const blocks = [
      makeBlock('b1', 100, 100, 200, 100),
      makeBlock('b2', 250, 150, 200, 100)
    ];
    const rels = [{
      blockA: 'b1', blockB: 'b2', connected: false, overlapping: true,
      overlapArea: 2500, overlapRatio: 0.125, alignmentEvidence: []
    }];
    const evidence = makeEvidence(blocks, rels);
    const candidates = generateMacroCandidates(evidence, { objectMap: new Map() });
    
    const candB2 = candidates.find(c => c.blockIds.includes('b2'));
    assert.ok(candB2);
    const trans = candB2.blockTranslations['b2'];
    assert.equal(Math.abs(trans.dx), 0);
    assert.equal(Math.abs(trans.dy), 70);
  });

  test('TEST H: Protected blocks are not moved', () => {
    const blocks = [
      makeBlock('b1', 100, 100, 200, 100, STRUCTURE_TYPES.CREATIVE, true),
      makeBlock('b2', 250, 150, 200, 100, STRUCTURE_TYPES.FLOW, false)
    ];
    const rels = [{
      blockA: 'b1', blockB: 'b2', connected: false, overlapping: true,
      overlapRatio: 0.1, alignmentEvidence: []
    }];
    const evidence = makeEvidence(blocks, rels);
    const candidates = generateMacroCandidates(evidence, { objectMap: new Map() });
    
    const movingB1 = candidates.find(c => c.blockIds.includes('b1'));
    assert.equal(movingB1, undefined);
    
    const movingB2 = candidates.find(c => c.blockIds.includes('b2'));
    assert.ok(movingB2);
  });

  test('TEST G: Intentional semantic containment overlap is rejected', () => {
    const blocks = [
      makeBlock('b1', 100, 100, 400, 400, STRUCTURE_TYPES.FLOW),
      makeBlock('b2', 150, 150, 100, 100, STRUCTURE_TYPES.STANDALONE)
    ];
    const rels = [{
      blockA: 'b1', blockB: 'b2', connected: false, overlapping: true,
      overlapRatio: 1.0, alignmentEvidence: []
    }];
    const evidence = makeEvidence(blocks, rels);
    const candidates = generateMacroCandidates(evidence, { objectMap: new Map() });
    
    const overlapCands = candidates.filter(c => c.type === MACRO_CANDIDATE_TYPES.RESOLVE_MACRO_OVERLAP);
    assert.equal(overlapCands.length, 0);
  });

  test('TEST M: Unsafe candidate is rejected before utility', () => {
    const blocks = [
      makeBlock('b1', 100, 100, 200, 100),
      makeBlock('b2', 500, 100, 200, 100),
      makeBlock('b3', 350, 100, 50, 50)
    ];
    const rawObjects = [
      { id: 'b3_obj', bounds: { x: 350, y: 100, width: 50, height: 50 }, type: 'shape' }
    ];
    const rels = [{
      blockA: 'b1', blockB: 'b2', connected: true, overlapping: false,
      horizontalGap: 200, verticalGap: 0, minDistance: 200, alignmentEvidence: [{ axis: 'y' }]
    }];
    const evidence = makeEvidence(blocks, rels);
    
    const objectMap = new Map();
    objectMap.set('b1_obj', { id: 'b1_obj', bounds: { x: 100, y: 100, width: 200, height: 100 } });
    objectMap.set('b3_obj', rawObjects[0]);

    const candidates = generateMacroCandidates(evidence, { objectMap, rawObjects });
    const cand = candidates.find(c => c.blockIds.includes('b1'));
    assert.equal(cand, undefined);
  });
});

describe('Macro Composition - Generalized Corpus & Property Invariants (Loop 25D)', () => {
  const mockOptions = {
    simulatedPlacements: [],
    rawObjects: []
  };

  test('TEST 01: no macro candidate produces empty selection and clean plan', () => {
    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates([], mockOptions);
    assert.equal(selectedMacroCandidates.length, 0);
    assert.equal(macroConflicts.length, 0);
  });

  test('TEST 02: one valid macro candidate is selected', () => {
    const cand = {
      candidateId: 'macro_pack_b1_b2',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b1'],
      affectedObjectIds: ['b1_obj'],
      affectedConnectorIds: [],
      blockTranslations: { b1: { dx: 50, dy: 0 } },
      objectGeometry: {
        candidateNodeBounds: [{ id: 'b1_obj', x: 150, y: 100, width: 100, height: 80 }],
        candidateLabelBounds: [],
        candidateConnectorGeometry: [],
        candidateCompleteBounds: { x: 150, y: 100, width: 100, height: 80 }
      },
      confidence: 0.9,
      utility: 12.5,
      evidence: ['moved block b1']
    };
    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates([cand], mockOptions);
    assert.equal(selectedMacroCandidates.length, 1);
    assert.equal(selectedMacroCandidates[0].candidateId, 'macro_pack_b1_b2');
    assert.equal(macroConflicts.length, 0);
  });

  test('TEST 03: two compatible candidates are both selected', () => {
    const candidates = [
      { candidateId: 'c1', safe: true, blockIds: ['b1'], affectedObjectIds: ['b1_obj'], affectedConnectorIds: [], objectGeometry: {}, blockTranslations: { b1: { dx: 10, dy: 0 } }, utility: 10 },
      { candidateId: 'c2', safe: true, blockIds: ['b2'], affectedObjectIds: ['b2_obj'], affectedConnectorIds: [], objectGeometry: {}, blockTranslations: { b2: { dx: 10, dy: 0 } }, utility: 8 }
    ];
    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates(candidates, mockOptions);
    assert.equal(selectedMacroCandidates.length, 2);
    assert.equal(macroConflicts.length, 0);
  });

  test('TEST 04 & 05: A+B vs B+C block ownership conflict', () => {
    const candidates = [
      { candidateId: 'c1', safe: true, blockIds: ['b1', 'b2'], affectedObjectIds: [], affectedConnectorIds: [], objectGeometry: {}, blockTranslations: { b1: { dx: 10, dy: 0 } }, utility: 10 },
      { candidateId: 'c2', safe: true, blockIds: ['b2', 'b3'], affectedObjectIds: [], affectedConnectorIds: [], objectGeometry: {}, blockTranslations: { b2: { dx: 10, dy: 0 } }, utility: 5 }
    ];
    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates(candidates, mockOptions);
    assert.equal(selectedMacroCandidates.length, 1);
    assert.equal(selectedMacroCandidates[0].candidateId, 'c1');
    assert.equal(macroConflicts.length, 1);
    assert.equal(macroConflicts[0].candidateId, 'c2');
    assert.equal(macroConflicts[0].reason, 'block_ownership_conflict');
  });

  test('TEST 06: two translations of same block resolved by utility', () => {
    const candidates = [
      { candidateId: 'c_transA', safe: true, blockIds: ['b1'], affectedObjectIds: ['b1_obj'], affectedConnectorIds: [], objectGeometry: {}, blockTranslations: { b1: { dx: -40, dy: 0 } }, utility: 7 },
      { candidateId: 'c_transB', safe: true, blockIds: ['b1'], affectedObjectIds: ['b1_obj'], affectedConnectorIds: [], objectGeometry: {}, blockTranslations: { b1: { dx: 0, dy: -30 } }, utility: 12 }
    ];
    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates(candidates, mockOptions);
    assert.equal(selectedMacroCandidates.length, 1);
    assert.equal(selectedMacroCandidates[0].candidateId, 'c_transB');
    assert.equal(macroConflicts.length, 1);
    assert.equal(macroConflicts[0].candidateId, 'c_transA');
    assert.equal(macroConflicts[0].reason, 'block_ownership_conflict');
  });

  test('TEST 07: protected collision rejects candidate', () => {
    const cand = {
      candidateId: 'c_into_creative',
      safe: true,
      blockIds: ['b1'],
      affectedObjectIds: ['b1_obj'],
      affectedConnectorIds: [],
      objectGeometry: {
        candidateNodeBounds: [{ id: 'b1_obj', x: 300, y: 100, width: 100, height: 100 }],
        candidateLabelBounds: [],
        candidateConnectorGeometry: []
      },
      blockTranslations: { b1: { dx: 200, dy: 0 } },
      utility: 15
    };
    const optionsWithCreative = {
      rawObjects: [{ id: 'creative_stroke', type: 'freehand', bounds: { x: 350, y: 120, width: 60, height: 60 } }],
      simulatedPlacements: []
    };
    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates([cand], optionsWithCreative);
    assert.equal(selectedMacroCandidates.length, 0);
    assert.equal(macroConflicts.length, 1);
    assert.equal(macroConflicts[0].reason, 'combined_plan_collision_detected');
  });

  test('TEST 08: local + macro combined collision rejection', () => {
    const cand = {
      candidateId: 'c1', safe: true, blockIds: ['b1'],
      affectedObjectIds: ['b1_obj'], affectedConnectorIds: [],
      objectGeometry: {
        candidateNodeBounds: [{ id: 'b1_obj', x: 200, y: 100, width: 50, height: 50 }],
        candidateLabelBounds: [], candidateConnectorGeometry: []
      },
      blockTranslations: { b1: { dx: 100, dy: 0 } },
      utility: 10
    };
    
    const simOptions = {
      rawObjects: [{ id: 'obs1', type: 'shape', bounds: { x: 500, y: 100, width: 50, height: 50 } }],
      simulatedPlacements: [
        { objectId: 'obs1', bounds: { x: 200, y: 100, width: 50, height: 50 } }
      ]
    };

    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates([cand], simOptions);
    assert.equal(selectedMacroCandidates.length, 0);
    assert.equal(macroConflicts.length, 1);
    assert.equal(macroConflicts[0].reason, 'combined_plan_collision_detected');
  });

  test('TEST 09: macro + external label preserves label offset', () => {
    const block = makeBlock('b1', 100, 100, 120, 80);
    const objShape = { id: 'b1_obj', type: 'shape', bounds: { x: 100, y: 100, width: 120, height: 80 } };
    const objLabel = { id: 'b1_lbl', type: 'text', bounds: { x: 120, y: 190, width: 80, height: 24 } };
    const objectMap = new Map([['b1_obj', objShape], ['b1_lbl', objLabel]]);
    const ownership = { ownedByOwner: new Map([['b1_obj', ['b1_lbl']]]) };
    
    const blocks = [block, makeBlock('b2', 180, 100, 120, 80)];
    const rels = [{ blockA: 'b1', blockB: 'b2', connected: false, overlapping: true, overlapArea: 3200, overlapRatio: 0.33, alignmentEvidence: [] }];
    const evidence = makeEvidence(blocks, rels);

    const candidates = generateMacroCandidates(evidence, { objectMap, ownership, rawObjects: [objShape, objLabel] });
    const cand = candidates.find(c => c.blockIds.includes('b1'));
    assert.ok(cand);
    assert.ok(cand.affectedObjectIds.includes('b1_lbl'));
    
    const trans = cand.blockTranslations.b1;
    const movedShape = cand.objectGeometry.candidateNodeBounds.find(b => b.id === 'b1_obj');
    const movedLabel = cand.objectGeometry.candidateLabelBounds.find(b => b.id === 'b1_lbl');
    assert.ok(movedShape);
    assert.ok(movedLabel);
    
    const origDiffX = objLabel.bounds.x - objShape.bounds.x;
    const origDiffY = objLabel.bounds.y - objShape.bounds.y;
    const plannedDiffX = movedLabel.x - movedShape.x;
    const plannedDiffY = movedLabel.y - movedShape.y;
    assert.equal(origDiffX, plannedDiffX);
    assert.equal(origDiffY, plannedDiffY);
  });

  test('TEST 10: macro + connector translates rigidly with block', () => {
    const block = makeBlock('b1', 100, 100, 200, 150);
    block.connectorIds = ['conn_internal'];
    const connObj = {
      id: 'conn_internal',
      type: 'connector',
      startPoint: { x: 120, y: 120 },
      endPoint: { x: 250, y: 220 }
    };
    const objectMap = new Map([
      ['b1_obj', { id: 'b1_obj', bounds: { x: 100, y: 100, width: 200, height: 150 } }],
      ['conn_internal', connObj]
    ]);
    const blocks = [block, makeBlock('b2', 250, 120, 200, 150)];
    const rels = [{ blockA: 'b1', blockB: 'b2', connected: false, overlapping: true, overlapArea: 1000, overlapRatio: 0.1, alignmentEvidence: [] }];
    const evidence = makeEvidence(blocks, rels);

    const candidates = generateMacroCandidates(evidence, { objectMap, rawObjects: [connObj] });
    const cand = candidates.find(c => c.blockIds.includes('b1'));
    assert.ok(cand);
    assert.ok(cand.affectedConnectorIds.includes('conn_internal'));
    
    const translatedConn = cand.objectGeometry.candidateConnectorGeometry.find(cg => cg.connId === 'conn_internal');
    assert.ok(translatedConn);
    const trans = cand.blockTranslations.b1;
    assert.equal(translatedConn.startPoint.x, connObj.startPoint.x + trans.dx);
    assert.equal(translatedConn.startPoint.y, connObj.startPoint.y + trans.dy);
  });

  test('TEST 11: cross-structure connector requires verified routing or rejects', () => {
    const blockA = makeBlock('b1', 100, 100, 150, 100);
    const blockB = makeBlock('b2', 500, 100, 150, 100);
    const crossConn = {
      id: 'cross_conn',
      type: 'connector',
      sourceShapeId: 'b1_obj',
      targetShapeId: 'b2_obj'
    };
    const objectMap = new Map([
      ['b1_obj', { id: 'b1_obj', bounds: { x: 100, y: 100, width: 150, height: 100 } }],
      ['b2_obj', { id: 'b2_obj', bounds: { x: 500, y: 100, width: 150, height: 100 } }],
      ['cross_conn', crossConn]
    ]);
    const rels = [{
      blockA: 'b1', blockB: 'b2', connected: true, overlapping: false,
      horizontalGap: 250, verticalGap: 0, minDistance: 250, alignmentEvidence: [{ axis: 'y' }]
    }];
    const evidence = makeEvidence([blockA, blockB], rels);

    const candidates = generateMacroCandidates(evidence, { objectMap, rawObjects: [crossConn] });
    const candA = candidates.find(c => c.blockIds.includes('b1') && c.safe);
    assert.equal(candA, undefined);
  });

  test('TEST 12: selection-scope macro candidate out-of-scope block rejected', () => {
    const outOfScopeBlock = makeBlock('b_out', 100, 100, 150, 100, STRUCTURE_TYPES.FLOW, true, { cleanupEligibility: 'outside-scope' });
    const inScopeBlock = makeBlock('b_in', 400, 100, 150, 100, STRUCTURE_TYPES.FLOW, false, { cleanupEligibility: 'eligible' });
    
    const cand = {
      candidateId: 'macro_cand_scope',
      safe: true,
      blockIds: ['b_out'],
      affectedObjectIds: ['b_out_obj'],
      affectedConnectorIds: [],
      objectGeometry: {},
      blockTranslations: { b_out: { dx: 40, dy: 0 } },
      utility: 10
    };
    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates([cand], {
      blocks: [outOfScopeBlock, inScopeBlock],
      rawObjects: [],
      cleanupContext: { scopeType: 'SELECTION', selectedObjectIds: ['b_in_obj'] }
    });
    assert.equal(selectedMacroCandidates.length, 0);
    assert.equal(macroConflicts.length, 1);
    assert.equal(macroConflicts[0].reason, 'outside_scope');
  });

  test('TEST 13: board-scope macro candidate considers all eligible blocks', () => {
    const blockA = makeBlock('b1', 100, 100, 150, 100);
    const blockB = makeBlock('b2', 400, 100, 150, 100);
    const cand = {
      candidateId: 'macro_board_scope',
      safe: true,
      blockIds: ['b1'],
      affectedObjectIds: ['b1_obj'],
      affectedConnectorIds: [],
      objectGeometry: {},
      blockTranslations: { b1: { dx: 30, dy: 0 } },
      utility: 9
    };
    const { selectedMacroCandidates } = selectMacroCandidates([cand], {
      blocks: [blockA, blockB],
      rawObjects: [],
      cleanupContext: { scopeType: 'BOARD' }
    });
    assert.equal(selectedMacroCandidates.length, 1);
  });

  test('TEST 14: local geometry preservation: final = local + macro', () => {
    const localBounds = { x: 120, y: 110, width: 100, height: 80 };
    const cand = {
      candidateId: 'c_local_plus_macro',
      safe: true,
      blockIds: ['b1'],
      affectedObjectIds: ['n1'],
      affectedConnectorIds: [],
      blockTranslations: { b1: { dx: 45, dy: -25 } },
      objectGeometry: {
        candidateNodeBounds: [{ id: 'n1', x: localBounds.x + 45, y: localBounds.y - 25, width: 100, height: 80 }]
      },
      utility: 8
    };
    const { selectedMacroCandidates } = selectMacroCandidates([cand], mockOptions);
    assert.equal(selectedMacroCandidates.length, 1);
    const plannedNode = selectedMacroCandidates[0].objectGeometry.candidateNodeBounds[0];
    assert.equal(plannedNode.x, localBounds.x + 45);
    assert.equal(plannedNode.y, localBounds.y - 25);
  });

  test('TEST 15: no duplicate micro-actions: single macro action owns complete block', () => {
    const block = makeBlock('b1', 100, 100, 200, 100);
    block.objectIds = ['n1', 'n2'];
    block.connectorIds = ['c1'];
    
    const cand = {
      candidateId: 'c_single_owner',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b1'],
      affectedObjectIds: ['n1', 'n2', 'lbl1'],
      affectedConnectorIds: ['c1'],
      blockTranslations: { b1: { dx: 30, dy: 0 } },
      objectGeometry: {
        candidateNodeBounds: [
          { id: 'n1', x: 130, y: 100, width: 80, height: 50 },
          { id: 'n2', x: 230, y: 100, width: 80, height: 50 }
        ],
        candidateLabelBounds: [{ id: 'lbl1', x: 140, y: 160, width: 60, height: 20 }],
        candidateConnectorGeometry: [{ connId: 'c1', startPoint: { x: 170, y: 125 }, endPoint: { x: 230, y: 125 } }],
        candidateCompleteBounds: { x: 130, y: 100, width: 180, height: 80 }
      },
      confidence: 0.9,
      utility: 11
    };
    const { selectedMacroCandidates } = selectMacroCandidates([cand], mockOptions);
    assert.equal(selectedMacroCandidates.length, 1);
    const act = selectedMacroCandidates[0];
    assert.deepEqual(act.blockIds, ['b1']);
    assert.equal(act.affectedObjectIds.length, 3);
    assert.equal(act.affectedConnectorIds.length, 1);
  });

  test('TEST 16: no-macro regression: CleanupPlan unchanged when no candidate valid', () => {
    const model = {
      board: {
        objects: [
          { id: 'shape1', type: 'shape', bounds: { x: 100, y: 100, width: 120, height: 80 }, relationshipMetadata: {} },
          { id: 'shape2', type: 'shape', bounds: { x: 100, y: 220, width: 120, height: 80 }, relationshipMetadata: {} }
        ]
      }
    };
    const plan = buildCleanupPlan(null, model);
    assert.ok(plan);
    const macroActions = plan.actions.filter(a => a.type === 'macroTranslate');
    assert.equal(macroActions.length, 0);
    assert.equal(plan.diagnostics.selectedMacroCandidates.length, 0);
  });

  test('TEST 17: deterministic macro selection', () => {
    const c1 = { candidateId: 'cand_alpha', safe: true, blockIds: ['b1'], affectedObjectIds: [], affectedConnectorIds: [], objectGeometry: {}, blockTranslations: { b1: { dx: 10, dy: 0 } }, utility: 10 };
    const c2 = { candidateId: 'cand_beta', safe: true, blockIds: ['b2'], affectedObjectIds: [], affectedConnectorIds: [], objectGeometry: {}, blockTranslations: { b2: { dx: 10, dy: 0 } }, utility: 15 };
    const c3 = { candidateId: 'cand_gamma', safe: true, blockIds: ['b3'], affectedObjectIds: [], affectedConnectorIds: [], objectGeometry: {}, blockTranslations: { b3: { dx: 10, dy: 0 } }, utility: 8 };

    const run1 = selectMacroCandidates([c1, c2, c3], mockOptions);
    const run2 = selectMacroCandidates([c3, c1, c2], mockOptions);
    assert.deepEqual(run1.selectedMacroCandidates.map(c => c.candidateId), run2.selectedMacroCandidates.map(c => c.candidateId));
    assert.equal(run1.selectedMacroCandidates[0].candidateId, 'cand_beta');
  });

  test('TEST 18: unsafe macro hard rejection in selection', () => {
    const candidates = [
      { candidateId: 'c_unsafe', safe: false, rejectionReason: 'collision_detected', blockIds: ['b1'], utility: 100 }
    ];
    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates(candidates, mockOptions);
    assert.equal(selectedMacroCandidates.length, 0);
    assert.equal(macroConflicts.length, 1);
    assert.equal(macroConflicts[0].reason, 'collision_detected');
  });

  test('TEST 19: equivalent candidate behavior broken deterministically by ID', () => {
    const cA = { candidateId: 'cand_a', safe: true, blockIds: ['b1'], affectedObjectIds: [], affectedConnectorIds: [], objectGeometry: {}, blockTranslations: { b1: { dx: 10, dy: 0 } }, utility: 10 };
    const cB = { candidateId: 'cand_b', safe: true, blockIds: ['b1'], affectedObjectIds: [], affectedConnectorIds: [], objectGeometry: {}, blockTranslations: { b1: { dx: 20, dy: 0 } }, utility: 10 };

    const res = selectMacroCandidates([cB, cA], mockOptions);
    assert.equal(res.selectedMacroCandidates.length, 1);
    assert.equal(res.selectedMacroCandidates[0].candidateId, 'cand_a');
  });

  test('REPRESENTATIVE BOARD TEST: Multi-structure representative scene', () => {
    const flowA = makeBlock('b_flowA', 100, 100, 200, 100, STRUCTURE_TYPES.FLOW);
    const flowB = makeBlock('b_flowB', 500, 100, 200, 100, STRUCTURE_TYPES.FLOW);
    const cluster = makeBlock('b_cluster', 100, 400, 180, 150, STRUCTURE_TYPES.CLUSTER);
    const concept = makeBlock('b_concept', 400, 400, 220, 150, STRUCTURE_TYPES.CONCEPT_GROUP);
    const creative = makeBlock('b_creative', 750, 100, 200, 200, STRUCTURE_TYPES.CREATIVE, true);
    const standalone = makeBlock('b_note', 750, 400, 120, 120, STRUCTURE_TYPES.STANDALONE, false);

    const validCandidate = {
      candidateId: 'cand_valid_pack',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b_flowB'],
      affectedObjectIds: ['b_flowB_obj'],
      affectedConnectorIds: [],
      blockTranslations: { b_flowB: { dx: -100, dy: 0 } },
      objectGeometry: {
        candidateNodeBounds: [{ id: 'b_flowB_obj', x: 400, y: 100, width: 200, height: 100 }],
        candidateLabelBounds: [],
        candidateConnectorGeometry: [],
        candidateCompleteBounds: { x: 400, y: 100, width: 200, height: 100 }
      },
      utility: 14
    };

    const conflictingCandidate = {
      candidateId: 'cand_conflicting_flowB',
      type: MACRO_CANDIDATE_TYPES.RESOLVE_MACRO_OVERLAP,
      safe: true,
      blockIds: ['b_flowB'],
      affectedObjectIds: ['b_flowB_obj'],
      affectedConnectorIds: [],
      blockTranslations: { b_flowB: { dx: 50, dy: 50 } },
      objectGeometry: {},
      utility: 9
    };

    const unsafeCandidate = {
      candidateId: 'cand_unsafe_collide_creative',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b_concept'],
      affectedObjectIds: ['b_concept_obj'],
      affectedConnectorIds: [],
      blockTranslations: { b_concept: { dx: 300, dy: -250 } },
      objectGeometry: {
        candidateNodeBounds: [{ id: 'b_concept_obj', x: 700, y: 150, width: 220, height: 150 }],
        candidateLabelBounds: [],
        candidateConnectorGeometry: []
      },
      utility: 25
    };

    const rawObjects = [
      { id: 'b_creative_obj', type: 'freehand', bounds: { x: 750, y: 100, width: 200, height: 200 } },
      { id: 'b_note_obj', type: 'note', bounds: { x: 750, y: 400, width: 120, height: 120 } }
    ];

    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates(
      [validCandidate, conflictingCandidate, unsafeCandidate],
      {
        blocks: [flowA, flowB, cluster, concept, creative, standalone],
        rawObjects,
        simulatedPlacements: []
      }
    );

    assert.equal(selectedMacroCandidates.length, 1);
    assert.equal(selectedMacroCandidates[0].candidateId, 'cand_valid_pack');
    
    assert.equal(macroConflicts.length, 2);
    const confRejection = macroConflicts.find(r => r.candidateId === 'cand_conflicting_flowB');
    assert.ok(confRejection);
    assert.equal(confRejection.reason, 'block_ownership_conflict');

    const unsafeRejection = macroConflicts.find(r => r.candidateId === 'cand_unsafe_collide_creative');
    assert.ok(unsafeRejection);
    assert.equal(unsafeRejection.reason, 'combined_plan_collision_detected');
  });

  test('PROPERTY INVARIANT A: No macro candidate preserves plan', () => {
    const model = {
      board: {
        objects: [
          { id: 's1', type: 'shape', bounds: { x: 50, y: 50, width: 100, height: 60 }, relationshipMetadata: {} }
        ]
      }
    };
    const plan = buildCleanupPlan(null, model);
    assert.equal(plan.actions.filter(a => a.type === 'macroTranslate').length, 0);
  });

  test('PROPERTY INVARIANT I: Planning does not mutate workspace objects', () => {
    const raw = { id: 's1', type: 'shape', bounds: { x: 50, y: 50, width: 100, height: 60 } };
    const model = { board: { objects: [raw] } };
    const snapshot = JSON.stringify(model);
    buildCleanupPlan(null, model);
    assert.equal(JSON.stringify(model), snapshot);
  });

  test('PROPERTY INVARIANT J: Re-running planning produces deterministic plan', () => {
    const model = {
      board: {
        objects: [
          { id: 's1', type: 'shape', bounds: { x: 10, y: 10, width: 80, height: 60 }, relationshipMetadata: {} },
          { id: 's2', type: 'shape', bounds: { x: 100, y: 10, width: 80, height: 60 }, relationshipMetadata: {} }
        ]
      }
    };
    const plan1 = buildCleanupPlan(null, model);
    const plan2 = buildCleanupPlan(null, model);
    assert.deepEqual(plan1.actions.map(a => a.id), plan2.actions.map(a => a.id));
  });
});

describe('Macro Composition - Execution & Downstream Consumers (Loop 25E)', () => {
  test('AUDIT: Selected macro candidates execute in plan.actions and achieve Preview/Apply parity', () => {
    const model = {
      board: {
        objects: [
          normalizeObject({ id: 'f1_a', type: 'rect', left: 100, top: 100, width: 80, height: 40 }),
          normalizeObject({ id: 'f1_b', type: 'rect', left: 240, top: 100, width: 80, height: 40 }),
          normalizeObject({ id: 'c1', type: 'line', isConnector: true, sourceShapeId: 'f1_a', targetShapeId: 'f1_b', left: 180, top: 120, width: 60, height: 2 }),
          normalizeObject({ id: 'f2_a', type: 'rect', left: 260, top: 110, width: 80, height: 40 }),
          normalizeObject({ id: 'f2_b', type: 'rect', left: 400, top: 110, width: 80, height: 40 }),
          normalizeObject({ id: 'c2', type: 'line', isConnector: true, sourceShapeId: 'f2_a', targetShapeId: 'f2_b', left: 340, top: 130, width: 60, height: 2 })
        ]
      }
    };

    const plan = buildCleanupPlan(null, model);

    assert.ok(Array.isArray(plan.macroActions));
    assert.ok(plan.macroActions.length > 0);
    assert.ok(plan.diagnostics.selectedMacroCandidates.length > 0);
    assert.equal(plan.macroActions.length, plan.diagnostics.selectedMacroCandidates.length);

    const macroActionsInPlan = plan.actions.filter(a => a.type === 'macroTranslate');
    assert.ok(macroActionsInPlan.length > 0);

    const planValidation = validateCleanupPlan(plan, model);
    assert.equal(planValidation.valid, true);

    const proposal = executeCleanupPlan(plan, model);
    assert.ok(proposal);
    assert.equal(proposal.valid, true);
    assert.ok(Array.isArray(proposal.placements));

    const cleanupResult = buildCleanupResult(plan, proposal, model);
    assert.ok(cleanupResult);
    assert.ok(cleanupResult.actions.filter(a => a.type === 'macroTranslate').length > 0);
    assert.equal(cleanupResult.summary.actionCount, plan.actions.length);

    const resultValidation = validateCleanupResult(cleanupResult, model);
    assert.equal(resultValidation.valid, true);

    const layoutProposal = createLayoutProposal(null, model);
    assert.ok(layoutProposal);
    assert.equal(layoutProposal.valid, true);
    assert.ok(layoutProposal.placements.length > 0);

    const previewModel = buildPreviewRenderModel(model, layoutProposal);
    assert.ok(previewModel);
    assert.equal(previewModel.objects.length, model.board.objects.length);

    const canvasObjects = model.board.objects.map(o => ({
      ...o,
      set(props) { Object.assign(this, props); },
      setCoords() {}
    }));
    const mockCanvas = {
      getObjects: () => canvasObjects,
      requestRenderAll: () => {}
    };

    const applyRes = applyCleanup(mockCanvas, layoutProposal, model);
    assert.equal(applyRes.success, true);
    assert.equal(applyRes.appliedCount, model.board.objects.length);

    layoutProposal.placements.forEach(p => {
      const prevObj = previewModel.objects.find(o => o.originalObjectId === p.objectId);
      const liveObj = canvasObjects.find(o => o.id === p.objectId);
      assert.ok(prevObj);
      assert.ok(liveObj);
      assert.ok(Math.abs(p.position.x - prevObj.position.x) < 0.001);
      assert.ok(Math.abs(p.position.y - prevObj.position.y) < 0.001);
      assert.ok(Math.abs(p.position.x - liveObj.left) < 0.001);
      assert.ok(Math.abs(p.position.y - liveObj.top) < 0.001);
    });
  });
});

describe('Macro Composition - 20 Scenario Regression Corpus & Parity (Loop 25E)', () => {
  test('SCENARIO 01: two excessively separated connected flows pack toward target gap', () => {
    const b1 = makeBlock('b_flowA', 100, 100, 200, 100, STRUCTURE_TYPES.FLOW);
    const b2 = makeBlock('b_flowB', 600, 100, 200, 100, STRUCTURE_TYPES.FLOW);
    const rels = [{
      blockA: 'b_flowA', blockB: 'b_flowB',
      connected: true, overlapping: false,
      horizontalGap: 300, verticalGap: 0, minDistance: 300,
      alignmentEvidence: [{ axis: 'y', type: 'centerline', deviation: 0 }]
    }];
    const evidence = makeEvidence([b1, b2], rels);
    const candidates = generateMacroCandidates(evidence, { objectMap: new Map(), ownership: {} });
    const packCand = candidates.find(c => c.type === MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED);
    assert.ok(packCand);
    assert.equal(packCand.safe, true);
    const trans = packCand.blockTranslations[b2.id] || packCand.blockTranslations[b1.id];
    assert.ok(Math.abs(trans.dx) > 0);
  });

  test('SCENARIO 02: two overlapping movable structures resolve overlap', () => {
    const b1 = makeBlock('b_struct1', 100, 100, 200, 100, STRUCTURE_TYPES.FLOW);
    const b2 = makeBlock('b_struct2', 250, 150, 200, 100, STRUCTURE_TYPES.CLUSTER);
    const rels = [{
      blockA: 'b_struct1', blockB: 'b_struct2',
      connected: false, overlapping: true, overlapRatio: 0.25,
      horizontalGap: 0, verticalGap: 0, minDistance: 0,
      alignmentEvidence: []
    }];
    const evidence = makeEvidence([b1, b2], rels);
    const candidates = generateMacroCandidates(evidence, { objectMap: new Map(), ownership: {} });
    const overlapCand = candidates.find(c => c.type === MACRO_CANDIDATE_TYPES.RESOLVE_MACRO_OVERLAP);
    assert.ok(overlapCand);
    assert.equal(overlapCand.safe, true);
  });

  test('SCENARIO 03: overlapping structure and protected drawing is rejected', () => {
    const flow = makeBlock('b_flow', 100, 100, 200, 100, STRUCTURE_TYPES.FLOW);
    const drawing = makeBlock('b_drawing', 250, 120, 100, 100, STRUCTURE_TYPES.CREATIVE, true);
    const rels = [{
      blockA: 'b_flow', blockB: 'b_drawing',
      connected: false, overlapping: true, overlapRatio: 0.3,
      horizontalGap: 0, verticalGap: 0, minDistance: 0,
      alignmentEvidence: []
    }];
    const evidence = makeEvidence([flow, drawing], rels);
    const rawObjects = [
      { id: 'b_drawing_obj', type: 'stroke', isVectorStroke: true, bounds: { x: 250, y: 120, width: 100, height: 100 } }
    ];
    const objectMap = new Map(rawObjects.map(o => [o.id, o]));
    const candidates = generateMacroCandidates(evidence, { rawObjects, objectMap, ownership: {} });
    const movingDrawing = candidates.find(c => c.blockIds?.includes('b_drawing'));
    assert.equal(movingDrawing, undefined);
  });

  test('SCENARIO 04: overlapping structure and structural divider is rejected', () => {
    const flow = makeBlock('b_flow', 100, 100, 200, 100, STRUCTURE_TYPES.FLOW);
    const divider = makeBlock('b_divider', 250, 0, 2, 400, STRUCTURE_TYPES.STRUCTURAL, true);
    const rels = [{
      blockA: 'b_flow', blockB: 'b_divider',
      connected: false, overlapping: true, overlapRatio: 0.5,
      horizontalGap: 0, verticalGap: 0, minDistance: 0,
      alignmentEvidence: []
    }];
    const evidence = makeEvidence([flow, divider], rels);
    const rawObjects = [
      { id: 'b_divider_obj', type: 'line', isStraightLine: true, bounds: { x: 250, y: 0, width: 2, height: 400 } }
    ];
    const objectMap = new Map(rawObjects.map(o => [o.id, o]));
    const candidates = generateMacroCandidates(evidence, { rawObjects, objectMap, ownership: {} });
    const movingDivider = candidates.find(c => c.blockIds?.includes('b_divider'));
    assert.equal(movingDivider, undefined);
  });

  test('SCENARIO 05: flow plus cluster compose safely', () => {
    const flow = makeBlock('b_flow', 100, 100, 200, 100, STRUCTURE_TYPES.FLOW);
    const cluster = makeBlock('b_cluster', 400, 100, 150, 150, STRUCTURE_TYPES.CLUSTER);
    const cand = {
      candidateId: 'cand_pack_fc',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b_cluster'],
      affectedObjectIds: ['b_cluster_obj'],
      affectedConnectorIds: [],
      blockTranslations: { b_cluster: { dx: -50, dy: 0 } },
      objectGeometry: {
        candidateNodeBounds: [{ id: 'b_cluster_obj', x: 350, y: 100, width: 150, height: 150 }],
        candidateLabelBounds: [],
        candidateConnectorGeometry: []
      },
      utility: 10
    };
    const { selectedMacroCandidates } = selectMacroCandidates([cand], {
      blocks: [flow, cluster],
      rawObjects: [{ id: 'b_flow_obj', bounds: { x: 100, y: 100, width: 200, height: 100 } }]
    });
    assert.equal(selectedMacroCandidates.length, 1);
  });

  test('SCENARIO 06: flow plus concept group compose safely', () => {
    const flow = makeBlock('b_flow', 100, 100, 200, 100, STRUCTURE_TYPES.FLOW);
    const concept = makeBlock('b_concept', 100, 300, 250, 150, STRUCTURE_TYPES.CONCEPT_GROUP);
    const cand = {
      candidateId: 'cand_pack_concept',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b_concept'],
      affectedObjectIds: ['b_concept_obj'],
      affectedConnectorIds: [],
      blockTranslations: { b_concept: { dx: 0, dy: -50 } },
      objectGeometry: {
        candidateNodeBounds: [{ id: 'b_concept_obj', x: 100, y: 250, width: 250, height: 150 }],
        candidateLabelBounds: [],
        candidateConnectorGeometry: []
      },
      utility: 12
    };
    const { selectedMacroCandidates } = selectMacroCandidates([cand], {
      blocks: [flow, concept],
      rawObjects: [{ id: 'b_flow_obj', bounds: { x: 100, y: 100, width: 200, height: 100 } }]
    });
    assert.equal(selectedMacroCandidates.length, 1);
  });

  test('SCENARIO 07: standalone note near a flow is preserved if independent', () => {
    const flow = makeBlock('b_flow', 100, 100, 200, 100, STRUCTURE_TYPES.FLOW);
    const note = makeBlock('b_note', 350, 100, 100, 100, STRUCTURE_TYPES.STANDALONE);
    const rawObjects = [
      { id: 'b_note_obj', type: 'note', bounds: { x: 350, y: 100, width: 100, height: 100 } }
    ];
    const cand = {
      candidateId: 'cand_move_flow',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b_flow'],
      affectedObjectIds: ['b_flow_obj'],
      affectedConnectorIds: [],
      blockTranslations: { b_flow: { dx: 50, dy: 0 } },
      objectGeometry: {
        candidateNodeBounds: [{ id: 'b_flow_obj', x: 150, y: 100, width: 200, height: 100 }],
        candidateLabelBounds: [],
        candidateConnectorGeometry: []
      },
      utility: 8
    };
    const { selectedMacroCandidates } = selectMacroCandidates([cand], {
      blocks: [flow, note],
      rawObjects
    });
    assert.equal(selectedMacroCandidates.length, 1);
    assert.ok(!selectedMacroCandidates[0].affectedObjectIds.includes('b_note_obj'));
  });

  test('SCENARIO 08: standalone note far from other content remains in untouchedObjectIds', () => {
    const model = {
      board: {
        objects: [
          normalizeObject({ id: 's1', type: 'rect', left: 10, top: 10, width: 80, height: 40 }),
          normalizeObject({ id: 'isolated_note', type: 'rect', isStickyNote: true, left: 900, top: 900, width: 100, height: 100 })
        ]
      }
    };
    const plan = buildCleanupPlan(null, model);
    assert.ok(plan.untouchedObjectIds.includes('isolated_note'));
  });

  test('SCENARIO 09: external labels maintain relative offset after macro translation', () => {
    const b = makeBlock('b1', 100, 100, 100, 50, STRUCTURE_TYPES.FLOW);
    const cand = {
      candidateId: 'cand_lbl',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b1'],
      affectedObjectIds: ['shape_node', 'external_label'],
      affectedConnectorIds: [],
      blockTranslations: { b1: { dx: 100, dy: 50 } },
      objectGeometry: {
        candidateNodeBounds: [{ id: 'shape_node', x: 200, y: 150, width: 100, height: 50 }],
        candidateLabelBounds: [{ id: 'external_label', x: 200, y: 210, width: 80, height: 20 }],
        candidateConnectorGeometry: []
      },
      utility: 10
    };
    const plan = {
      version: 1,
      actions: [{
        id: 'act_macro_lbl',
        type: 'macroTranslate',
        structureBlockIds: ['b1'],
        objectIds: ['shape_node', 'external_label'],
        connectorIds: [],
        translations: { b1: { dx: 100, dy: 50 } },
        geometry: cand.objectGeometry,
        reason: 'test',
        confidence: 0.9
      }],
      untouchedObjectIds: [],
      diagnostics: {}
    };
    const wsModel = {
      board: {
        objects: [
          normalizeObject({ id: 'shape_node', type: 'rect', left: 100, top: 100, width: 100, height: 50 }),
          normalizeObject({ id: 'external_label', type: 'text', text: 'Label', left: 100, top: 160, width: 80, height: 20 })
        ]
      }
    };
    const proposal = executeCleanupPlan(plan, wsModel);
    assert.equal(proposal.valid, true);
    const pShape = proposal.placements.find(p => p.objectId === 'shape_node');
    const pLabel = proposal.placements.find(p => p.objectId === 'external_label');
    assert.equal(pShape.position.x, 200);
    assert.equal(pShape.position.y, 150);
    assert.equal(pLabel.position.x, 200);
    assert.equal(pLabel.position.y, 210);
    assert.equal(pLabel.position.y - pShape.position.y, 60);
  });

  test('SCENARIO 10: block-internal connectors translate rigidly with block', () => {
    const plan = {
      version: 1,
      actions: [{
        id: 'act_macro_conn',
        type: 'macroTranslate',
        structureBlockIds: ['b1'],
        objectIds: ['node_a', 'node_b'],
        connectorIds: ['conn_internal'],
        translations: { b1: { dx: 80, dy: 40 } },
        geometry: {},
        reason: 'test',
        confidence: 0.9
      }],
      untouchedObjectIds: [],
      diagnostics: {}
    };
    const wsModel = {
      board: {
        objects: [
          normalizeObject({ id: 'node_a', type: 'rect', left: 100, top: 100, width: 80, height: 40 }),
          normalizeObject({ id: 'node_b', type: 'rect', left: 240, top: 100, width: 80, height: 40 }),
          normalizeObject({
            id: 'conn_internal',
            type: 'line',
            isConnector: true,
            sourceShapeId: 'node_a',
            targetShapeId: 'node_b',
            left: 180,
            top: 120,
            width: 60,
            height: 2,
            pathCommands: [['M', 180, 120], ['L', 240, 120]]
          })
        ]
      }
    };
    const proposal = executeCleanupPlan(plan, wsModel);
    assert.equal(proposal.valid, true);
    const pConn = proposal.placements.find(p => p.objectId === 'conn_internal');
    assert.equal(pConn.position.x, 260);
    assert.equal(pConn.position.y, 160);
    assert.deepEqual(pConn.pathCommands, [['M', 260, 160], ['L', 320, 160]]);
  });

  test('SCENARIO 11: cross-structure connector with identical block translations translates rigidly', () => {
    const plan = {
      version: 1,
      actions: [{
        id: 'act_macro_cross_sync',
        type: 'macroTranslate',
        structureBlockIds: ['b1', 'b2'],
        objectIds: ['s1', 's2'],
        connectorIds: ['c_cross'],
        translations: { b1: { dx: 50, dy: 50 }, b2: { dx: 50, dy: 50 } },
        geometry: {},
        reason: 'test',
        confidence: 0.9
      }],
      untouchedObjectIds: [],
      diagnostics: {}
    };
    const wsModel = {
      board: {
        objects: [
          normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 80, height: 40 }),
          normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 80, height: 40 }),
          normalizeObject({
            id: 'c_cross',
            type: 'line',
            isConnector: true,
            sourceShapeId: 's1',
            targetShapeId: 's2',
            left: 180,
            top: 120,
            width: 120,
            height: 2,
            pathCommands: [['M', 180, 120], ['L', 300, 120]]
          })
        ]
      }
    };
    const proposal = executeCleanupPlan(plan, wsModel);
    assert.equal(proposal.valid, true);
    const pConn = proposal.placements.find(p => p.objectId === 'c_cross');
    assert.equal(pConn.position.x, 230);
    assert.equal(pConn.position.y, 170);
  });

  test('SCENARIO 12: cross-structure connector requiring differential routing is rejected when unrouted', () => {
    const flowA = makeBlock('b_flowA', 100, 100, 100, 60);
    const flowB = makeBlock('b_flowB', 300, 100, 100, 60);
    const rawConns = [{ id: 'cross_conn', type: 'connector', sourceShapeId: 'b_flowA_obj', targetShapeId: 'b_flowB_obj' }];
    const rawObjects = [
      { id: 'b_flowA_obj', type: 'rect', bounds: { x: 100, y: 100, width: 100, height: 60 } },
      { id: 'b_flowB_obj', type: 'rect', bounds: { x: 300, y: 100, width: 100, height: 60 } },
      ...rawConns
    ];
    const objectMap = new Map(rawObjects.map(o => [o.id, o]));
    const rels = [{
      blockA: 'b_flowA', blockB: 'b_flowB',
      connected: true, overlapping: false,
      horizontalGap: 100, verticalGap: 0, minDistance: 100,
      alignmentEvidence: [{ axis: 'y', type: 'top-edge', deviation: 0 }]
    }];
    const evidence = makeEvidence([flowA, flowB], rels);
    const candidates = generateMacroCandidates(evidence, { objectMap, rawObjects, ownership: {} });
    assert.equal(candidates.length, 0);
  });

  test('SCENARIO 13: locally composed structure subsequently translated as a block preserves composed geometry', () => {
    const plan = {
      version: 1,
      actions: [
        {
          id: 'act_align',
          type: 'align',
          axis: 'centerY',
          objectIds: ['node1', 'node2'],
          reason: 'local alignment',
          confidence: 0.95
        },
        {
          id: 'act_macro',
          type: 'macroTranslate',
          structureBlockIds: ['b1'],
          objectIds: ['node1', 'node2'],
          connectorIds: [],
          translations: { b1: { dx: 100, dy: 100 } },
          geometry: {},
          reason: 'macro pack',
          confidence: 0.9
        }
      ],
      untouchedObjectIds: [],
      diagnostics: {}
    };
    const wsModel = {
      board: {
        objects: [
          normalizeObject({ id: 'node1', type: 'rect', left: 100, top: 100, width: 80, height: 40 }),
          normalizeObject({ id: 'node2', type: 'rect', left: 240, top: 120, width: 80, height: 40 })
        ]
      }
    };
    const proposal = executeCleanupPlan(plan, wsModel);
    assert.equal(proposal.valid, true);
    const p1 = proposal.placements.find(p => p.objectId === 'node1');
    const p2 = proposal.placements.find(p => p.objectId === 'node2');
    assert.equal(p1.bounds.y, p2.bounds.y);
    assert.equal(p1.position.x, 200);
    assert.equal(p2.position.x, 340);
  });

  test('SCENARIO 14: multiple compatible macro actions both execute', () => {
    const cand1 = {
      candidateId: 'cand_1',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b1'],
      affectedObjectIds: ['o1'],
      affectedConnectorIds: [],
      blockTranslations: { b1: { dx: 50, dy: 0 } },
      objectGeometry: { candidateNodeBounds: [{ id: 'o1', x: 150, y: 100, width: 50, height: 50 }], candidateLabelBounds: [], candidateConnectorGeometry: [] },
      utility: 10
    };
    const cand2 = {
      candidateId: 'cand_2',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b2'],
      affectedObjectIds: ['o2'],
      affectedConnectorIds: [],
      blockTranslations: { b2: { dx: 0, dy: 50 } },
      objectGeometry: { candidateNodeBounds: [{ id: 'o2', x: 500, y: 550, width: 50, height: 50 }], candidateLabelBounds: [], candidateConnectorGeometry: [] },
      utility: 8
    };
    const { selectedMacroCandidates } = selectMacroCandidates([cand1, cand2], {
      blocks: [makeBlock('b1', 100, 100, 50, 50), makeBlock('b2', 500, 500, 50, 50)],
      rawObjects: [{ id: 'o1', bounds: { x: 100, y: 100, width: 50, height: 50 } }, { id: 'o2', bounds: { x: 500, y: 500, width: 50, height: 50 } }]
    });
    assert.equal(selectedMacroCandidates.length, 2);
  });

  test('SCENARIO 15: conflicting macro actions on same block selects highest utility', () => {
    const cand1 = {
      candidateId: 'cand_high',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b1'],
      affectedObjectIds: ['o1'],
      affectedConnectorIds: [],
      blockTranslations: { b1: { dx: 40, dy: 0 } },
      objectGeometry: { candidateNodeBounds: [{ id: 'o1', x: 140, y: 100, width: 50, height: 50 }], candidateLabelBounds: [], candidateConnectorGeometry: [] },
      utility: 15
    };
    const cand2 = {
      candidateId: 'cand_low',
      type: MACRO_CANDIDATE_TYPES.RESOLVE_MACRO_OVERLAP,
      safe: true,
      blockIds: ['b1'],
      affectedObjectIds: ['o1'],
      affectedConnectorIds: [],
      blockTranslations: { b1: { dx: 0, dy: 30 } },
      objectGeometry: { candidateNodeBounds: [{ id: 'o1', x: 100, y: 130, width: 50, height: 50 }], candidateLabelBounds: [], candidateConnectorGeometry: [] },
      utility: 8
    };
    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates([cand2, cand1], {
      blocks: [makeBlock('b1', 100, 100, 50, 50)],
      rawObjects: [{ id: 'o1', bounds: { x: 100, y: 100, width: 50, height: 50 } }]
    });
    assert.equal(selectedMacroCandidates.length, 1);
    assert.equal(selectedMacroCandidates[0].candidateId, 'cand_high');
    assert.equal(macroConflicts.length, 1);
    assert.equal(macroConflicts[0].candidateId, 'cand_low');
  });

  test('SCENARIO 16: selection-scoped macro candidate rejects out-of-scope block', () => {
    const bScope = makeBlock('b_out', 100, 100, 100, 50, STRUCTURE_TYPES.FLOW, true);
    const cand = {
      candidateId: 'cand_scoped',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b_out'],
      affectedObjectIds: ['b_out_obj'],
      affectedConnectorIds: [],
      blockTranslations: { b_out: { dx: 50, dy: 0 } },
      objectGeometry: {},
      utility: 10
    };
    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates([cand], {
      blocks: [bScope],
      rawObjects: []
    });
    assert.equal(selectedMacroCandidates.length, 0);
    assert.equal(macroConflicts[0].reason, 'outside_scope');
  });

  test('SCENARIO 17: board-scoped macro cleanup considers all eligible blocks', () => {
    const b1 = makeBlock('b1', 100, 100, 100, 50, STRUCTURE_TYPES.FLOW);
    const b2 = makeBlock('b2', 400, 100, 100, 50, STRUCTURE_TYPES.FLOW);
    const cand = {
      candidateId: 'cand_board',
      type: MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED,
      safe: true,
      blockIds: ['b2'],
      affectedObjectIds: ['b2_obj'],
      affectedConnectorIds: [],
      blockTranslations: { b2: { dx: -50, dy: 0 } },
      objectGeometry: { candidateNodeBounds: [{ id: 'b2_obj', x: 350, y: 100, width: 100, height: 50 }], candidateLabelBounds: [], candidateConnectorGeometry: [] },
      utility: 10
    };
    const { selectedMacroCandidates } = selectMacroCandidates([cand], {
      blocks: [b1, b2],
      rawObjects: [{ id: 'b1_obj', bounds: { x: 100, y: 100, width: 100, height: 50 } }, { id: 'b2_obj', bounds: { x: 400, y: 100, width: 100, height: 50 } }]
    });
    assert.equal(selectedMacroCandidates.length, 1);
  });

  test('SCENARIO 18: Preview render model produces identical geometry regardless of presentation', () => {
    const model = {
      board: {
        objects: [
          normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 80, height: 40 }),
          normalizeObject({ id: 's2', type: 'rect', left: 240, top: 100, width: 80, height: 40 })
        ]
      }
    };
    const proposal = createLayoutProposal(null, model);
    const preview1 = buildPreviewRenderModel(model, proposal);
    const preview2 = buildPreviewRenderModel(model, proposal);
    assert.deepEqual(preview1.objects.map(o => o.position), preview2.objects.map(o => o.position));
  });

  test('SCENARIO 19: failure caused by stale/missing object IDs returns valid: false', () => {
    const plan = {
      version: 1,
      actions: [{
        id: 'act_stale',
        type: 'macroTranslate',
        structureBlockIds: ['b1'],
        objectIds: ['missing_node'],
        connectorIds: [],
        translations: { b1: { dx: 50, dy: 0 } },
        geometry: {},
        reason: 'test',
        confidence: 0.9
      }],
      untouchedObjectIds: [],
      diagnostics: {}
    };
    const wsModel = {
      board: {
        objects: [normalizeObject({ id: 'existing_node', type: 'rect', left: 10, top: 10, width: 50, height: 50 })]
      }
    };
    const proposal = executeCleanupPlan(plan, wsModel);
    assert.equal(proposal.valid, false);
    assert.equal(proposal.errorType, 'missingObject');
  });

  test('SCENARIO 20: save, reload, and verify retains applied macro positions and paths', () => {
    const model = {
      board: {
        objects: [
          normalizeObject({ id: 'f1_a', type: 'rect', left: 100, top: 100, width: 80, height: 40 }),
          normalizeObject({ id: 'f1_b', type: 'rect', left: 240, top: 100, width: 80, height: 40 }),
          normalizeObject({ id: 'c1', type: 'line', isConnector: true, sourceShapeId: 'f1_a', targetShapeId: 'f1_b', left: 180, top: 120, width: 60, height: 2 }),
          normalizeObject({ id: 'f2_a', type: 'rect', left: 260, top: 110, width: 80, height: 40 }),
          normalizeObject({ id: 'f2_b', type: 'rect', left: 400, top: 110, width: 80, height: 40 }),
          normalizeObject({ id: 'c2', type: 'line', isConnector: true, sourceShapeId: 'f2_a', targetShapeId: 'f2_b', left: 340, top: 130, width: 60, height: 2 })
        ]
      }
    };
    const proposal = createLayoutProposal(null, model);
    const canvasObjects = model.board.objects.map(o => ({
      ...o,
      set(props) { Object.assign(this, props); },
      setCoords() {}
    }));
    const mockCanvas = {
      getObjects: () => canvasObjects,
      requestRenderAll: () => {}
    };
    const applyRes = applyCleanup(mockCanvas, proposal, model);
    assert.equal(applyRes.success, true);

    const serialized = JSON.stringify(canvasObjects);
    const reloaded = JSON.parse(serialized);

    const liveF1b = canvasObjects.find(o => o.id === 'f1_b');
    const reloadedF1b = reloaded.find(o => o.id === 'f1_b');
    assert.equal(reloadedF1b.left, liveF1b.left);
    assert.equal(reloadedF1b.top, liveF1b.top);

    const liveF2a = canvasObjects.find(o => o.id === 'f2_a');
    const reloadedF2a = reloaded.find(o => o.id === 'f2_a');
    assert.equal(reloadedF2a.left, liveF2a.left);
    assert.equal(reloadedF2a.top, liveF2a.top);
  });
});
