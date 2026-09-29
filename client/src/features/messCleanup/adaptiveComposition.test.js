import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMovementCost, computeAdaptiveNormalization, computeGroupCandidateGeometry } from './discoverVisualStructures.js';

test('1. calculateMovementCost returns higher cost for larger displacement', () => {
  const costSmall = calculateMovementCost({
    objectCount: 3,
    currentQuality: 5,
    candidateQuality: 9,
    isBranchingOrMerge: false,
    totalDisplacement: 15 // avg 5px
  });
  
  const costLarge = calculateMovementCost({
    objectCount: 3,
    currentQuality: 5,
    candidateQuality: 9,
    isBranchingOrMerge: false,
    totalDisplacement: 1500 // avg 500px
  });

  assert.ok(costLarge > costSmall, 'Large displacement should cost more than small displacement');
});

test('2. Adaptive Normalization preserves order and normalizes gaps (horizontal)', () => {
  const compObjects = [
    { id: '1', left: 0, top: 0, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0 },
    { id: '2', left: 200, top: 10, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0 }, // gap 100
    { id: '3', left: 500, top: -5, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0 }  // gap 200
  ];
  const compLevelMap = new Map([['1', 0], ['2', 1], ['3', 2]]);
  const compEdges = [];
  
  const result = computeAdaptiveNormalization({ compObjects, compLevelMap, orientation: 'horizontal', compEdges });
  
  // median gap between [100, 200] is 150, but capped at 120
  assert.equal(result.nodes.length, 3);
  assert.equal(result.nodes[0].x, 0);
  assert.equal(result.nodes[1].x, 200); // 100 gap not changed
  assert.equal(result.nodes[2].x, 420); // 200 gap normalized to 120
});

test('3. Cluster Geometry Generation (real geometry)', () => {
  const compObjects = [
    { id: '1', left: 0, top: 0, width: 50, height: 50, scaleX: 1, scaleY: 1, angle: 0 },
    { id: '2', left: 100, top: 0, width: 50, height: 50, scaleX: 1, scaleY: 1, angle: 0 },
    { id: '3', left: 0, top: 100, width: 50, height: 50, scaleX: 1, scaleY: 1, angle: 0 },
    { id: '4', left: 100, top: 100, width: 50, height: 50, scaleX: 1, scaleY: 1, angle: 0 }
  ];
  
  const result = computeGroupCandidateGeometry({ compObjects, orientation: 'horizontal', structureType: 'cluster' });
  
  assert.equal(result.nodes.length, 4);
  // Grid layout applied
  assert.equal(result.nodes[0].x, 0);
  assert.equal(result.nodes[0].y, 0);
  assert.ok(result.nodes[1].x > 0);
  assert.ok(result.nodes[2].y > 0);
});

test('4. Concept Group Geometry Generation (real geometry)', () => {
  const compObjects = [
    { id: '1', left: 0, top: 0, width: 50, height: 50, scaleX: 1, scaleY: 1, angle: 0 },
    { id: '2', left: 60, top: 5, width: 50, height: 50, scaleX: 1, scaleY: 1, angle: 0 },
    { id: '3', left: 130, top: -2, width: 50, height: 50, scaleX: 1, scaleY: 1, angle: 0 }
  ];
  
  const result = computeGroupCandidateGeometry({ compObjects, orientation: 'horizontal', structureType: 'sequence' });
  
  assert.equal(result.nodes.length, 3);
  // Y should be aligned (mean)
  assert.equal(result.nodes[0].y, result.nodes[1].y);
  assert.equal(result.nodes[1].y, result.nodes[2].y);
  // X should be spaced
  assert.ok(result.nodes[1].x > result.nodes[0].x);
  assert.ok(result.nodes[2].x > result.nodes[1].x);
});

test('5. Zero-change invariant (clean-flow no-op)', () => {
  const compObjects = [
    { id: '1', left: 0, top: 0, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0 },
    { id: '2', left: 200, top: 0, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0 },
    { id: '3', left: 400, top: 0, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0 }
  ];
  const compLevelMap = new Map([['1', 0], ['2', 1], ['3', 2]]);
  const compEdges = [];
  
  const result = computeAdaptiveNormalization({ compObjects, compLevelMap, orientation: 'horizontal', compEdges });
  
  assert.equal(result.nodes[0].x, 0);
  assert.equal(result.nodes[0].y, 0);
  assert.equal(result.nodes[1].x, 200);
  assert.equal(result.nodes[1].y, 0);
  assert.equal(result.nodes[2].x, 400);
  assert.equal(result.nodes[2].y, 0);
});

test('6. Local rather than global movement (one outlier)', () => {
  const compObjects = [
    { id: '1', left: 0, top: 0, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0 },
    { id: '2', left: 200, top: 0, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0 },
    { id: '3', left: 1000, top: 0, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0 }
  ];
  const compLevelMap = new Map([['1', 0], ['2', 1], ['3', 2]]);
  const compEdges = [];
  
  const result = computeAdaptiveNormalization({ compObjects, compLevelMap, orientation: 'horizontal', compEdges });
  
  // Median gap is (100+700)/2 = 400, clamped to 120.
  // Gap between 1 and 2 is 100. It is < 120*1.5 (180), so it is not shifted.
  // Gap between 2 and 3 is 700. It is normalized to 120.
  // 1 and 2 should NOT move. 3 should move to 200 + 100 + 120 = 420.
  assert.equal(result.nodes[0].x, 0);
  assert.equal(result.nodes[1].x, 200);
  assert.equal(result.nodes[2].x, 420); // 200 + 100 + 120 gap
});

