import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStructureBlocks, extractBoardEvidence, RELATIONSHIP_TYPES } from './structureBlock.js';
import { STRUCTURE_TYPES, _planningStateCache } from './discoverVisualStructures.js';

const makeObj = (id, x, y, w = 100, h = 80, sem = 'shape') => ({
  id,
  position: { x, y },
  left: x,
  top: y,
  size: { width: w, height: h },
  width: w,
  height: h,
  bounds: { x, y, width: w, height: h },
  type: sem,
  metadata: {}
});

const makeStruct = (id, type, objectIds, connectorIds = [], extra = {}) => ({
  id,
  type,
  objectIds,
  connectorIds,
  confidence: extra.confidence ?? 0.96,
  evidence: extra.evidence || ['test-evidence'],
  relationships: extra.relationships || [],
  bounds: extra.bounds || null
});

describe('StructureBlock Extraction', () => {
  test('TEST 1: Single flow produces one block with correct bounds', () => {
    _planningStateCache.clear();
    const objects = [makeObj('s1', 100, 100, 120, 80), makeObj('s2', 300, 100, 120, 80)];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const struct = makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1', 's2'], ['c1']);
    const connObj = makeObj('c1', 210, 130, 100, 20, 'connector');
    objectMap.set('c1', connObj);

    const blocks = extractStructureBlocks([struct], { objectMap, ownership: {} });

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].structureId, 'struct_flow_s1');
    assert.equal(blocks[0].type, STRUCTURE_TYPES.FLOW);
    assert.ok(blocks[0].bounds);
    assert.equal(blocks[0].bounds.x, 100);
    assert.equal(blocks[0].bounds.y, 100);
    assert.equal(blocks[0].bounds.width, 320);
    assert.equal(blocks[0].bounds.height, 80);
    assert.deepEqual(blocks[0].center, { x: 260, y: 140 });
    assert.equal(blocks[0].width, 320);
    assert.equal(blocks[0].height, 80);
    assert.equal(blocks[0].protected, false);
  });

  test('TEST 2: Bounds include owned labels', () => {
    _planningStateCache.clear();
    const objects = [
      makeObj('s1', 100, 100, 120, 80),
      makeObj('lbl1', 100, 190, 120, 20, 'text')
    ];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const struct = makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1']);
    const ownership = {
      ownedByOwner: new Map([['s1', ['lbl1']]])
    };

    const blocks = extractStructureBlocks([struct], { objectMap, ownership });

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].bounds.y, 100);
    assert.equal(blocks[0].bounds.height, 110);
  });

  test('TEST 3: Resolved local candidate geometry used when available', () => {
    _planningStateCache.clear();
    const objects = [makeObj('s1', 100, 100, 120, 80), makeObj('s2', 500, 300, 120, 80)];
    const objectMap = new Map(objects.map(o => [o.id, o]));

    const resolvedBounds = { x: 100, y: 100, width: 350, height: 80, cx: 275, cy: 140 };
    _planningStateCache.set('struct_flow_s1', {
      candidateCompositions: [{
        candidateCompleteBounds: resolvedBounds,
        template: 'flow_horizontal',
        compositionBenefit: 3.5
      }]
    });

    const struct = makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1', 's2']);
    const blocks = extractStructureBlocks([struct], { objectMap, ownership: {} });

    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0].bounds, resolvedBounds);
    assert.ok(blocks[0].localResolution);
    assert.ok(blocks[0].resolvedBounds);
    assert.ok(blocks[0].currentBounds);
  });

  test('TEST 4: No-cleanup structure uses current geometry', () => {
    _planningStateCache.clear();
    const objects = [makeObj('s1', 100, 100, 120, 80)];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const struct = makeStruct('struct_standalone_s1', STRUCTURE_TYPES.STANDALONE, ['s1']);

    const blocks = extractStructureBlocks([struct], { objectMap, ownership: {} });

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].localResolution, null);
    assert.equal(blocks[0].bounds.x, 100);
    assert.equal(blocks[0].resolvedBounds, null);
  });

  test('TEST 5: Center equals bounds center', () => {
    _planningStateCache.clear();
    const objects = [makeObj('s1', 200, 300, 100, 50)];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const struct = makeStruct('struct_standalone_s1', STRUCTURE_TYPES.STANDALONE, ['s1']);

    const blocks = extractStructureBlocks([struct], { objectMap, ownership: {} });

    assert.equal(blocks[0].center.x, blocks[0].bounds.cx);
    assert.equal(blocks[0].center.y, blocks[0].bounds.cy);
    assert.equal(blocks[0].center.x, 250);
    assert.equal(blocks[0].center.y, 325);
  });

  test('TEST 6: Creative structure is marked protected', () => {
    _planningStateCache.clear();
    const objects = [makeObj('stroke1', 50, 50, 200, 200, 'stroke')];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const struct = makeStruct('struct_creative_cluster', STRUCTURE_TYPES.CREATIVE, ['stroke1']);

    const blocks = extractStructureBlocks([struct], { objectMap, ownership: {} });

    assert.equal(blocks[0].protected, true);
    assert.equal(blocks[0].type, STRUCTURE_TYPES.CREATIVE);
  });

  test('TEST 7: Structural divider is marked protected', () => {
    _planningStateCache.clear();
    const objects = [makeObj('div1', 0, 0, 800, 5, 'line')];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const struct = makeStruct('struct_structural_div1', STRUCTURE_TYPES.STRUCTURAL, ['div1']);

    const blocks = extractStructureBlocks([struct], { objectMap, ownership: {} });

    assert.equal(blocks[0].protected, true);
  });

  test('TEST 8: Multiple structures produce independent blocks', () => {
    _planningStateCache.clear();
    const objects = [
      makeObj('s1', 100, 100, 120, 80),
      makeObj('s2', 100, 200, 120, 80),
      makeObj('s3', 600, 100, 120, 80),
      makeObj('s4', 600, 200, 120, 80)
    ];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const struct1 = makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1', 's2'], ['c1']);
    const struct2 = makeStruct('struct_flow_s3', STRUCTURE_TYPES.FLOW, ['s3', 's4'], ['c2']);
    objectMap.set('c1', makeObj('c1', 150, 180, 20, 20, 'connector'));
    objectMap.set('c2', makeObj('c2', 650, 180, 20, 20, 'connector'));

    const blocks = extractStructureBlocks([struct1, struct2], { objectMap, ownership: {} });

    assert.equal(blocks.length, 2);
    assert.notEqual(blocks[0].id, blocks[1].id);
    assert.notEqual(blocks[0].structureId, blocks[1].structureId);
  });

  test('TEST 9: Canonical relationships preserved', () => {
    _planningStateCache.clear();
    const objects = [makeObj('s1', 100, 100), makeObj('s2', 300, 100)];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const rels = [{
      id: 'rel_c1',
      type: 'connectedTo',
      sourceObjectId: 's1',
      targetObjectId: 's2',
      connectorId: 'c1',
      confidence: 0.98,
      evidence: ['connector-topology']
    }];
    const struct = makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1', 's2'], ['c1'], { relationships: rels });

    const blocks = extractStructureBlocks([struct], { objectMap, ownership: {} });

    assert.equal(blocks[0].relationships.length, 1);
    assert.equal(blocks[0].relationships[0].type, 'connectedTo');
    assert.equal(blocks[0].relationships[0].sourceObjectId, 's1');
  });

  test('TEST 10: Extraction does not mutate source structures', () => {
    _planningStateCache.clear();
    const objects = [makeObj('s1', 100, 100), makeObj('s2', 300, 100)];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const struct = makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1', 's2']);
    const originalObjectIds = [...struct.objectIds];
    const originalEvidence = [...struct.evidence];

    const s1Before = JSON.stringify(objectMap.get('s1'));
    const s2Before = JSON.stringify(objectMap.get('s2'));

    extractStructureBlocks([struct], { objectMap, ownership: {} });

    assert.deepEqual(struct.objectIds, originalObjectIds);
    assert.deepEqual(struct.evidence, originalEvidence);
    assert.equal(JSON.stringify(objectMap.get('s1')), s1Before);
    assert.equal(JSON.stringify(objectMap.get('s2')), s2Before);
  });

  test('TEST 11: Extraction is deterministic', () => {
    _planningStateCache.clear();
    const objects = [
      makeObj('s1', 100, 100),
      makeObj('s2', 300, 100),
      makeObj('s3', 500, 100),
      makeObj('note1', 700, 400, 150, 100, 'note')
    ];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const structs = [
      makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1', 's2', 's3']),
      makeStruct('struct_standalone_note1', STRUCTURE_TYPES.STANDALONE, ['note1'])
    ];
    const opts = { objectMap, ownership: {} };

    const run1 = extractStructureBlocks(structs, opts);
    const run2 = extractStructureBlocks(structs, opts);

    assert.deepEqual(run1, run2);
  });

  test('TEST 12: selectedCandidates override resolved bounds', () => {
    _planningStateCache.clear();
    const objects = [makeObj('s1', 100, 100), makeObj('s2', 500, 400)];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const struct = makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1', 's2']);

    const selectedCandidates = [{
      structureId: 'struct_flow_s1',
      template: 'adaptive_normalization',
      compositionBenefit: 4.2,
      quality: 8.5,
      safe: true,
      candidateCompleteBounds: { x: 100, y: 100, width: 320, height: 80, cx: 260, cy: 140 }
    }];

    const blocks = extractStructureBlocks([struct], { objectMap, ownership: {}, selectedCandidates });

    assert.equal(blocks[0].bounds.x, 100);
    assert.equal(blocks[0].bounds.width, 320);
    assert.equal(blocks[0].localResolution.template, 'adaptive_normalization');
    assert.equal(blocks[0].localResolution.benefit, 4.2);
  });

  test('TEST 13: Bounds include connector geometry', () => {
    _planningStateCache.clear();
    const objects = [
      makeObj('s1', 100, 100, 100, 80),
      makeObj('s2', 400, 100, 100, 80)
    ];
    const connObj = makeObj('c1', 200, 120, 200, 40, 'connector');
    const objectMap = new Map([...objects, connObj].map(o => [o.id, o]));
    const struct = makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1', 's2'], ['c1']);

    const blocks = extractStructureBlocks([struct], { objectMap, ownership: {} });

    assert.equal(blocks[0].bounds.x, 100);
    assert.equal(blocks[0].bounds.width, 400);
  });

  test('TEST 14: Width and height derived from canonical bounds', () => {
    _planningStateCache.clear();
    const objects = [makeObj('s1', 50, 75, 200, 150)];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const struct = makeStruct('struct_standalone_s1', STRUCTURE_TYPES.STANDALONE, ['s1']);

    const blocks = extractStructureBlocks([struct], { objectMap, ownership: {} });

    assert.equal(blocks[0].width, blocks[0].bounds.width);
    assert.equal(blocks[0].height, blocks[0].bounds.height);
    assert.equal(blocks[0].width, 200);
    assert.equal(blocks[0].height, 150);
  });

  test('TEST 15: Protected content remains outside movable block', () => {
    _planningStateCache.clear();
    const objects = [
      makeObj('s1', 100, 100, 120, 80),
      makeObj('stroke1', 50, 50, 400, 400, 'stroke')
    ];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const flowStruct = makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1']);
    const creativeStruct = makeStruct('struct_creative_cluster', STRUCTURE_TYPES.CREATIVE, ['stroke1']);

    const blocks = extractStructureBlocks([flowStruct, creativeStruct], { objectMap, ownership: {} });

    const flowBlock = blocks.find(b => b.structureId === 'struct_flow_s1');
    const creativeBlock = blocks.find(b => b.structureId === 'struct_creative_cluster');

    assert.equal(flowBlock.protected, false);
    assert.equal(creativeBlock.protected, true);
    assert.ok(!flowBlock.objectIds.includes('stroke1'));
  });
});

describe('Board Evidence Extraction', () => {
  test('TEST 16: Board bounds are union of all block bounds', () => {
    const blocks = [
      { id: 'b1', structureId: 's1', type: 'flow', bounds: { x: 100, y: 100, width: 200, height: 100 }, center: { x: 200, y: 150 }, width: 200, height: 100, objectIds: ['s1'], connectorIds: [], relationships: [], protected: false },
      { id: 'b2', structureId: 's2', type: 'flow', bounds: { x: 500, y: 300, width: 200, height: 100 }, center: { x: 600, y: 350 }, width: 200, height: 100, objectIds: ['s2'], connectorIds: [], relationships: [], protected: false }
    ];

    const evidence = extractBoardEvidence(blocks, { rawObjects: [] });

    assert.equal(evidence.boardBounds.x, 100);
    assert.equal(evidence.boardBounds.y, 100);
    assert.equal(evidence.boardBounds.width, 600);
    assert.equal(evidence.boardBounds.height, 300);
  });

  test('TEST 17: Occupied bounds from raw objects', () => {
    const blocks = [];
    const rawObjects = [
      makeObj('o1', 0, 0, 50, 50),
      makeObj('o2', 800, 600, 100, 100)
    ];
    const objectMap = new Map(rawObjects.map(o => [o.id, o]));

    const evidence = extractBoardEvidence(blocks, { rawObjects, objectMap });

    assert.ok(evidence.occupiedBounds);
    assert.equal(evidence.occupiedBounds.x, 0);
    assert.equal(evidence.occupiedBounds.y, 0);
    assert.equal(evidence.occupiedBounds.width, 900);
    assert.equal(evidence.occupiedBounds.height, 700);
  });

  test('TEST 18: Overlapping blocks are detected', () => {
    const blocks = [
      { id: 'b1', structureId: 's1', type: 'flow', bounds: { x: 100, y: 100, width: 200, height: 100, cx: 200, cy: 150 }, center: { x: 200, y: 150 }, width: 200, height: 100, objectIds: ['s1'], connectorIds: [], relationships: [], protected: false },
      { id: 'b2', structureId: 's2', type: 'flow', bounds: { x: 250, y: 150, width: 200, height: 100, cx: 350, cy: 200 }, center: { x: 350, y: 200 }, width: 200, height: 100, objectIds: ['s2'], connectorIds: [], relationships: [], protected: false }
    ];

    const evidence = extractBoardEvidence(blocks, { rawObjects: [] });

    assert.equal(evidence.relationships.length, 1);
    assert.equal(evidence.relationships[0].overlapping, true);
    assert.ok(evidence.relationships[0].overlapArea > 0);
    assert.equal(evidence.evidence.overlappingPairs, 1);
  });

  test('TEST 19: Adjacent blocks detected with measured distance', () => {
    const blocks = [
      { id: 'b1', structureId: 's1', type: 'flow', bounds: { x: 100, y: 100, width: 200, height: 100, cx: 200, cy: 150 }, center: { x: 200, y: 150 }, width: 200, height: 100, objectIds: ['s1'], connectorIds: [], relationships: [], protected: false },
      { id: 'b2', structureId: 's2', type: 'flow', bounds: { x: 350, y: 100, width: 200, height: 100, cx: 450, cy: 150 }, center: { x: 450, y: 150 }, width: 200, height: 100, objectIds: ['s2'], connectorIds: [], relationships: [], protected: false }
    ];

    const evidence = extractBoardEvidence(blocks, { rawObjects: [] });

    assert.equal(evidence.relationships[0].overlapping, false);
    assert.equal(evidence.relationships[0].horizontalGap, 50);
    assert.equal(evidence.relationships[0].verticalGap, 0);
  });

  test('TEST 20: Alignment evidence detected', () => {
    const blocks = [
      { id: 'b1', structureId: 's1', type: 'flow', bounds: { x: 100, y: 100, width: 200, height: 100, cx: 200, cy: 150 }, center: { x: 200, y: 150 }, width: 200, height: 100, objectIds: ['s1'], connectorIds: [], relationships: [], protected: false },
      { id: 'b2', structureId: 's2', type: 'flow', bounds: { x: 400, y: 103, width: 200, height: 100, cx: 500, cy: 153 }, center: { x: 500, y: 153 }, width: 200, height: 100, objectIds: ['s2'], connectorIds: [], relationships: [], protected: false }
    ];

    const evidence = extractBoardEvidence(blocks, { rawObjects: [] });

    const rel = evidence.relationships[0];
    assert.ok(rel.alignmentEvidence.length > 0);
    const topEdge = rel.alignmentEvidence.find(e => e.type === 'top-edge');
    assert.ok(topEdge);
    assert.equal(topEdge.deviation, 3);
  });

  test('TEST 21: Connected relationship requires verified evidence', () => {
    const blocks = [
      { id: 'b1', structureId: 's1', type: 'flow', bounds: { x: 100, y: 100, width: 200, height: 100, cx: 200, cy: 150 }, center: { x: 200, y: 150 }, width: 200, height: 100, objectIds: ['s1', 's2'], connectorIds: ['c1'], relationships: [{ id: 'rel_c1', type: 'connectedTo', sourceObjectId: 's1', targetObjectId: 's2', connectorId: 'c1', confidence: 0.98 }], protected: false },
      { id: 'b2', structureId: 's2', type: 'flow', bounds: { x: 400, y: 100, width: 200, height: 100, cx: 500, cy: 150 }, center: { x: 500, y: 150 }, width: 200, height: 100, objectIds: ['s3', 's4'], connectorIds: ['c2'], relationships: [], protected: false }
    ];

    const evidence = extractBoardEvidence(blocks, { rawObjects: [] });

    assert.equal(evidence.relationships[0].connected, false);
    assert.equal(evidence.evidence.connectedPairs, 0);
  });

  test('TEST 22: Proximity alone does not create CONNECTED', () => {
    const blocks = [
      { id: 'b1', structureId: 's1', type: 'flow', bounds: { x: 100, y: 100, width: 200, height: 100, cx: 200, cy: 150 }, center: { x: 200, y: 150 }, width: 200, height: 100, objectIds: ['s1'], connectorIds: [], relationships: [], protected: false },
      { id: 'b2', structureId: 's2', type: 'cluster', bounds: { x: 310, y: 100, width: 200, height: 100, cx: 410, cy: 150 }, center: { x: 410, y: 150 }, width: 200, height: 100, objectIds: ['n1', 'n2'], connectorIds: [], relationships: [], protected: false }
    ];

    const evidence = extractBoardEvidence(blocks, { rawObjects: [] });

    assert.equal(evidence.relationships[0].connected, false);
    assert.equal(evidence.relationships[0].minDistance, 10);
  });

  test('TEST 23: Excessive separation is measured', () => {
    const blocks = [
      { id: 'b1', structureId: 's1', type: 'flow', bounds: { x: 100, y: 100, width: 200, height: 100, cx: 200, cy: 150 }, center: { x: 200, y: 150 }, width: 200, height: 100, objectIds: ['s1'], connectorIds: [], relationships: [], protected: false },
      { id: 'b2', structureId: 's2', type: 'flow', bounds: { x: 2000, y: 1500, width: 200, height: 100, cx: 2100, cy: 1550 }, center: { x: 2100, y: 1550 }, width: 200, height: 100, objectIds: ['s2'], connectorIds: [], relationships: [], protected: false }
    ];

    const evidence = extractBoardEvidence(blocks, { rawObjects: [] });

    assert.ok(evidence.relationships[0].minDistance > 1000);
    assert.equal(evidence.relationships[0].overlapping, false);
  });

  test('TEST 24: Protected occupied region is represented', () => {
    const blocks = [
      { id: 'b1', structureId: 's1', type: 'creative', bounds: { x: 50, y: 50, width: 400, height: 400, cx: 250, cy: 250 }, center: { x: 250, y: 250 }, width: 400, height: 400, objectIds: ['stroke1'], connectorIds: [], relationships: [], protected: true },
      { id: 'b2', structureId: 's2', type: 'flow', bounds: { x: 500, y: 100, width: 200, height: 100, cx: 600, cy: 150 }, center: { x: 600, y: 150 }, width: 200, height: 100, objectIds: ['s1'], connectorIds: [], relationships: [], protected: false }
    ];

    const evidence = extractBoardEvidence(blocks, { rawObjects: [] });

    assert.ok(evidence.protectedOccupiedBounds);
    assert.equal(evidence.protectedOccupiedBounds.x, 50);
    assert.equal(evidence.protectedOccupiedBounds.y, 50);
    assert.equal(evidence.protectedOccupiedBounds.width, 400);
    assert.equal(evidence.protectedOccupiedBounds.height, 400);
    assert.equal(evidence.evidence.protectedBlockCount, 1);
  });

  test('TEST 25: Standalone content preserved independently', () => {
    _planningStateCache.clear();
    const objects = [
      makeObj('s1', 100, 100, 120, 80),
      makeObj('note1', 600, 500, 150, 100, 'note'),
      makeObj('text1', 800, 200, 80, 30, 'text')
    ];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    const structs = [
      makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1']),
      makeStruct('struct_standalone_note1', STRUCTURE_TYPES.STANDALONE, ['note1']),
      makeStruct('struct_standalone_text1', STRUCTURE_TYPES.STANDALONE, ['text1'])
    ];

    const blocks = extractStructureBlocks(structs, { objectMap, ownership: {} });

    assert.equal(blocks.length, 3);
    const standaloneBlocks = blocks.filter(b => b.type === STRUCTURE_TYPES.STANDALONE);
    assert.equal(standaloneBlocks.length, 2);
    standaloneBlocks.forEach(b => {
      assert.equal(b.localResolution, null);
      assert.equal(b.protected, false);
    });
  });

  test('TEST 26: Block summary is accurate', () => {
    const blocks = [
      { id: 'b1', structureId: 's1', type: 'flow', bounds: { x: 0, y: 0, width: 100, height: 100 }, center: { x: 50, y: 50 }, width: 100, height: 100, objectIds: [], connectorIds: [], relationships: [], protected: false, localResolution: { template: 'flow_horizontal', benefit: 3.0, quality: 8.5, safe: true } },
      { id: 'b2', structureId: 's2', type: 'flow', bounds: { x: 200, y: 0, width: 100, height: 100 }, center: { x: 250, y: 50 }, width: 100, height: 100, objectIds: [], connectorIds: [], relationships: [], protected: false, localResolution: null },
      { id: 'b3', structureId: 's3', type: 'creative', bounds: { x: 400, y: 0, width: 100, height: 100 }, center: { x: 450, y: 50 }, width: 100, height: 100, objectIds: [], connectorIds: [], relationships: [], protected: true, localResolution: null },
      { id: 'b4', structureId: 's4', type: 'standalone', bounds: { x: 600, y: 0, width: 100, height: 100 }, center: { x: 650, y: 50 }, width: 100, height: 100, objectIds: [], connectorIds: [], relationships: [], protected: false, localResolution: null }
    ];

    const evidence = extractBoardEvidence(blocks, { rawObjects: [] });

    assert.equal(evidence.blockSummary.total, 4);
    assert.equal(evidence.blockSummary.byType.flow, 2);
    assert.equal(evidence.blockSummary.byType.creative, 1);
    assert.equal(evidence.blockSummary.byType.standalone, 1);
    assert.equal(evidence.blockSummary.protectedCount, 1);
    assert.equal(evidence.blockSummary.withLocalResolution, 1);
    assert.equal(evidence.blockSummary.standaloneCount, 1);
  });

  test('TEST 27: Relative position evidence is correct', () => {
    const blocks = [
      { id: 'b1', structureId: 's1', type: 'flow', bounds: { x: 0, y: 0, width: 100, height: 100, cx: 50, cy: 50 }, center: { x: 50, y: 50 }, width: 100, height: 100, objectIds: [], connectorIds: [], relationships: [], protected: false },
      { id: 'b2', structureId: 's2', type: 'flow', bounds: { x: 400, y: 200, width: 100, height: 100, cx: 450, cy: 250 }, center: { x: 450, y: 250 }, width: 100, height: 100, objectIds: [], connectorIds: [], relationships: [], protected: false }
    ];

    const evidence = extractBoardEvidence(blocks, { rawObjects: [] });

    assert.equal(evidence.relationships[0].relativePosition.dx, 400);
    assert.equal(evidence.relationships[0].relativePosition.dy, 200);
  });

  test('TEST 28: Board evidence is deterministic', () => {
    const blocks = [
      { id: 'b1', structureId: 's1', type: 'flow', bounds: { x: 0, y: 0, width: 100, height: 100, cx: 50, cy: 50 }, center: { x: 50, y: 50 }, width: 100, height: 100, objectIds: ['s1'], connectorIds: [], relationships: [], protected: false },
      { id: 'b2', structureId: 's2', type: 'cluster', bounds: { x: 300, y: 0, width: 100, height: 100, cx: 350, cy: 50 }, center: { x: 350, y: 50 }, width: 100, height: 100, objectIds: ['n1', 'n2'], connectorIds: [], relationships: [], protected: false },
      { id: 'b3', structureId: 's3', type: 'standalone', bounds: { x: 600, y: 400, width: 50, height: 50, cx: 625, cy: 425 }, center: { x: 625, y: 425 }, width: 50, height: 50, objectIds: ['t1'], connectorIds: [], relationships: [], protected: false }
    ];
    const opts = { rawObjects: [] };

    const run1 = extractBoardEvidence(blocks, opts);
    const run2 = extractBoardEvidence(blocks, opts);

    assert.deepEqual(run1, run2);
  });

  test('TEST 29: Unrelated structures remain separate', () => {
    _planningStateCache.clear();
    const objects = [
      makeObj('s1', 100, 100, 120, 80),
      makeObj('s2', 300, 100, 120, 80),
      makeObj('n1', 700, 400, 150, 100, 'note'),
      makeObj('n2', 870, 400, 150, 100, 'note')
    ];
    const objectMap = new Map(objects.map(o => [o.id, o]));
    objectMap.set('c1', makeObj('c1', 220, 130, 80, 20, 'connector'));
    const structs = [
      makeStruct('struct_flow_s1', STRUCTURE_TYPES.FLOW, ['s1', 's2'], ['c1']),
      makeStruct('struct_cluster_n1', STRUCTURE_TYPES.CLUSTER, ['n1', 'n2'])
    ];

    const blocks = extractStructureBlocks(structs, { objectMap, ownership: {} });
    const evidence = extractBoardEvidence(blocks, { rawObjects: objects });

    assert.equal(blocks.length, 2);
    const rel = evidence.relationships[0];
    assert.equal(rel.connected, false);
    assert.ok(rel.minDistance > 0);
  });

  test('TEST 30: Empty board produces null boardBounds', () => {
    const evidence = extractBoardEvidence([], { rawObjects: [] });

    assert.equal(evidence.boardBounds, null);
    assert.equal(evidence.occupiedBounds, null);
    assert.equal(evidence.protectedOccupiedBounds, null);
    assert.equal(evidence.relationships.length, 0);
  });
});
