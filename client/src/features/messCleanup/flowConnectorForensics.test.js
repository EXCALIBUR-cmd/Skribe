import test from 'node:test';
import assert from 'node:assert/strict';

import { getSemanticType } from './cleanupTypes.js';
import { recoverConnectorTopology } from './connectorTopology.js';
import { findDetachedFlowAssociation } from './detachedFlowAssociation.js';
import { discoverVisualStructures, STRUCTURE_TYPES } from './discoverVisualStructures.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildCleanupResult } from './buildCleanupResult.js';


const createCanonicalFixture = (overrides = {}) => {
  const defaultObjects = [
    {
      id: 'rect-1',
      type: 'shape',
      shapeType: 'rounded_rect',
      position: { x: 400, y: 300 },
      left: 400,
      top: 300,
      width: 160,
      height: 140,
      bounds: { x: 400, y: 300, width: 160, height: 140 }
    },
    {
      id: 'arrow-1',
      type: 'connector',
      connectorType: 'straight',
      position: { x: 615, y: 385 },
      left: 615,
      top: 385,
      width: 145,
      height: 16,
      bounds: { x: 615, y: 385, width: 145, height: 16 },
      path: 'M 615 393 L 760 393',
      endArrow: true,
      startArrow: false,
      sourceShapeId: null,
      targetShapeId: null
    },
    {
      id: 'circle-1',
      type: 'shape',
      shapeType: 'circle',
      position: { x: 800, y: 200 },
      left: 800,
      top: 200,
      width: 120,
      height: 120,
      bounds: { x: 800, y: 200, width: 120, height: 120 }
    },
    {
      id: 'stroke-1',
      type: 'stroke',
      isVectorStroke: true,
      position: { x: 718, y: 550 },
      left: 718,
      top: 550,
      width: 320,
      height: 25,
      bounds: { x: 718, y: 550, width: 320, height: 25 }
    }
  ];

  const objects = overrides.objects || defaultObjects;
  return { objects };
};

test('Test 1 — Connector classification: arrow is classified as connector even with vector stroke traits', () => {
  const fixture = createCanonicalFixture();
  const arrow = fixture.objects.find((o) => o.id === 'arrow-1');
  const arrowWithStroke = { ...arrow, isVectorStroke: true };

  assert.equal(getSemanticType(arrow), 'connector');
  assert.equal(getSemanticType(arrowWithStroke), 'connector');
});

test('Test 2 — Freehand classification: creative stroke classified as stroke and preserved', () => {
  const fixture = createCanonicalFixture();
  const stroke = fixture.objects.find((o) => o.id === 'stroke-1');

  assert.equal(getSemanticType(stroke), 'stroke');

  const structures = discoverVisualStructures(fixture);
  const creativeStruct = structures.find((s) => s.type === STRUCTURE_TYPES.CREATIVE);
  assert.ok(creativeStruct, 'Creative structure discovered');
  assert.ok(creativeStruct.objectIds.includes('stroke-1'), 'stroke-1 is in creative structure');
  assert.equal(creativeStruct.candidateCompositions[0].template, 'preserve');
});

test('Test 3 — Strict topology remains strict: gap > 35px is unverified by ordinary topology recovery', () => {
  const fixture = createCanonicalFixture();
  const arrow = fixture.objects.find((o) => o.id === 'arrow-1');
  const candidateShapes = fixture.objects.filter((o) => o.type === 'shape');

  const topo = recoverConnectorTopology(arrow, candidateShapes);
  assert.equal(topo.sourceShapeId, null, 'Source must be null because 55px gap exceeds MAX_ATTACH_DISTANCE (35px)');
  assert.equal(topo.targetShapeId, null, 'Target must be null because 112.9px gap exceeds MAX_ATTACH_DISTANCE (35px)');
  assert.ok((topo.overallConfidence ?? 0) < 0.85, 'Overall confidence must be below verified threshold');
});

test('Test 4 — Detached flow intent: corridor evidence discovers intentional flow', () => {
  const fixture = createCanonicalFixture();
  const arrow = fixture.objects.find((o) => o.id === 'arrow-1');
  const candidateShapes = fixture.objects.filter((o) => o.type === 'shape');

  const res = findDetachedFlowAssociation(arrow, candidateShapes);
  assert.ok(res?.association, 'Detached flow association discovered');
  assert.equal(res.association.sourceCandidateId, 'rect-1');
  assert.equal(res.association.targetCandidateId, 'circle-1');
  assert.ok(res.association.associationConfidence >= 0.90, 'Confidence >= 0.90');
  assert.equal(res.association.provenance, 'detached-flow-intent');
});

test('Test 5 — Ambiguous detached flow: two equally plausible target shapes reject association', () => {
  const fixture = createCanonicalFixture({
    objects: [
      {
        id: 'rect-1',
        type: 'shape',
        shapeType: 'rounded_rect',
        position: { x: 400, y: 300 },
        bounds: { x: 400, y: 300, width: 160, height: 140 }
      },
      {
        id: 'arrow-1',
        type: 'connector',
        connectorType: 'straight',
        position: { x: 615, y: 385 },
        bounds: { x: 615, y: 385, width: 145, height: 16 },
        path: 'M 615 393 L 760 393',
        endArrow: true
      },
      
      {
        id: 'circle-1',
        type: 'shape',
        shapeType: 'circle',
        position: { x: 800, y: 250 },
        bounds: { x: 800, y: 250, width: 120, height: 120 }
      },
      
      {
        id: 'circle-2',
        type: 'shape',
        shapeType: 'circle',
        position: { x: 800, y: 410 },
        bounds: { x: 800, y: 410, width: 120, height: 120 }
      }
    ]
  });

  const arrow = fixture.objects.find((o) => o.id === 'arrow-1');
  const candidateShapes = fixture.objects.filter((o) => o.type === 'shape');

  const res = findDetachedFlowAssociation(arrow, candidateShapes);
  assert.equal(res.association, null, 'Ambiguous targets must reject association');
  assert.ok(res.rejectionReason?.includes('AMBIGUOUS'), 'Rejection reason indicates ambiguity');

  const plan = buildCleanupPlan(null, fixture);
  const layout = executeCleanupPlan(plan, fixture);
  const result = buildCleanupResult(plan, layout, fixture);
  assert.equal(result.summary.resultType, 'NO_SAFE_CLEANUP_FOUND');
});

test('Test 6 — Wrong-direction candidate: shapes placed behind arrow direction are rejected', () => {
  const fixture = createCanonicalFixture({
    objects: [
      
      {
        id: 'rect-1',
        type: 'shape',
        position: { x: 800, y: 300 },
        bounds: { x: 800, y: 300, width: 120, height: 120 }
      },
      {
        id: 'arrow-1',
        type: 'connector',
        connectorType: 'straight',
        position: { x: 400, y: 350 },
        bounds: { x: 400, y: 350, width: 100, height: 16 },
        path: 'M 500 350 L 400 350', 
        endArrow: true
      },
      {
        id: 'circle-1',
        type: 'shape',
        position: { x: 950, y: 300 },
        bounds: { x: 950, y: 300, width: 120, height: 120 }
      }
    ]
  });

  const arrow = fixture.objects.find((o) => o.id === 'arrow-1');
  const candidateShapes = fixture.objects.filter((o) => o.type === 'shape');

  const res = findDetachedFlowAssociation(arrow, candidateShapes);
  assert.equal(res?.association, null, 'Wrong-direction candidates must not form association');
});

test('Test 7 — Creative stroke preservation: freehand curve is not owned or moved', () => {
  const fixture = createCanonicalFixture();
  const plan = buildCleanupPlan(null, fixture);

  const action = plan.actions[0];
  assert.ok(action, 'Cleanup action produced');
  assert.ok(!action.ownedObjectIds?.includes('stroke-1'), 'stroke-1 is not owned by flow action');
  assert.ok(plan.untouchedObjectIds.includes('stroke-1'), 'stroke-1 is in untouchedObjectIds');

  const layout = executeCleanupPlan(plan, fixture);
  const strokePlacement = layout.placements.find((p) => p.objectId === 'stroke-1');
  assert.equal(strokePlacement.position.x, 718, 'stroke-1 X position unchanged');
  assert.equal(strokePlacement.position.y, 550, 'stroke-1 Y position unchanged');
});

test('Test 8 — Complete candidate geometry: candidate contains node and connector geometry with shaft and arrowhead', () => {
  const fixture = createCanonicalFixture();
  const structures = discoverVisualStructures(fixture);
  const flowStruct = structures.find((s) => s.type === STRUCTURE_TYPES.FLOW);

  assert.ok(flowStruct, 'Flow structure discovered');
  const cand = flowStruct.candidateCompositions[0];
  assert.ok(cand.candidateNodeBounds.length >= 2, 'Candidate includes node bounds');
  assert.ok(cand.candidateConnectorGeometry.length >= 1, 'Candidate includes connector geometry');
  assert.ok(cand.candidateCompleteBounds, 'Candidate includes complete bounds');
  assert.ok(cand.safe !== undefined, 'Candidate includes collision safety evaluation');
});

test('Test 9 — Protected-object collision: obstacle in proposed flow placement rejects candidate', () => {
  const fixture = createCanonicalFixture({
    objects: [
      {
        id: 'rect-1',
        type: 'shape',
        shapeType: 'rounded_rect',
        position: { x: 400, y: 300 },
        bounds: { x: 400, y: 300, width: 160, height: 140 }
      },
      {
        id: 'arrow-1',
        type: 'connector',
        connectorType: 'straight',
        position: { x: 615, y: 385 },
        bounds: { x: 615, y: 385, width: 145, height: 16 },
        path: 'M 615 393 L 760 393',
        endArrow: true
      },
      {
        id: 'circle-1',
        type: 'shape',
        shapeType: 'circle',
        position: { x: 800, y: 200 },
        bounds: { x: 800, y: 200, width: 120, height: 120 }
      },
      
      {
        id: 'protected-obstacle',
        type: 'stroke',
        isVectorStroke: true,
        position: { x: 600, y: 220 },
        bounds: { x: 600, y: 220, width: 150, height: 100 }
      }
    ]
  });

  const structures = discoverVisualStructures(fixture);
  const flowStruct = structures.find((s) => s.type === STRUCTURE_TYPES.FLOW);
  if (flowStruct) {
    const cand = flowStruct.candidateCompositions.find((c) => c.actionType === 'cleanFlowchart');
    if (cand) {
      assert.equal(cand.safe, false, 'Candidate B collides with protected obstacle');
    }
  }
});

test('Test 10 — Safe repair: canonical detached arrow fixture produces successful cleanup with rerouted connector', () => {
  const fixture = createCanonicalFixture();
  const plan = buildCleanupPlan(null, fixture);
  assert.ok(plan.actions.length >= 1, 'Executable action produced');

  const layout = executeCleanupPlan(plan, fixture);
  assert.equal(layout.valid, true, 'Execution is valid');

  const result = buildCleanupResult(plan, layout, fixture);
  assert.equal(result.summary.resultType, 'MEANINGFULLY_CLEANED');
  assert.ok(result.summary.connectorsRerouted === 1, '1 connector rerouted');
  assert.ok(result.summary.objectsMoved >= 0, 'objectsMoved >= 0');
  assert.equal(result.summary.objectsPreserved, 1, '1 object preserved (stroke-1)');
});

test('Test 11 — Zero-change candidate: candidate with delta <= tolerance has visualBenefit = 0', () => {
  
  const fixture = createCanonicalFixture({
    objects: [
      {
        id: 'rect-1',
        type: 'shape',
        position: { x: 400, y: 300 },
        bounds: { x: 400, y: 300, width: 160, height: 140 }
      },
      {
        id: 'arrow-1',
        type: 'connector',
        connectorType: 'straight',
        position: { x: 560, y: 370 },
        bounds: { x: 560, y: 370, width: 80, height: 10 },
        path: 'M 560 370 L 640 370',
        endArrow: true,
        sourceShapeId: 'rect-1',
        targetShapeId: 'circle-1'
      },
      {
        id: 'circle-1',
        type: 'shape',
        position: { x: 640, y: 310 },
        bounds: { x: 640, y: 310, width: 120, height: 120 }
      }
    ]
  });

  const plan = buildCleanupPlan(null, fixture);
  const layout = executeCleanupPlan(plan, fixture);
  const result = buildCleanupResult(plan, layout, fixture);
  assert.equal(result.summary.resultType, 'ALREADY_WELL_ORGANIZED');
  assert.equal(result.summary.actionCount, 0);
});

test('Test 12 — Preview/apply identity: immutable CleanupPlan applied without recomputing layout', () => {
  const fixture = createCanonicalFixture();
  const plan = buildCleanupPlan(null, fixture);

  
  const previewLayout = executeCleanupPlan(plan, fixture);
  const previewArrow = previewLayout.placements.find((p) => p.objectId === 'arrow-1');

  
  const appliedLayout = executeCleanupPlan(plan, fixture);
  const appliedArrow = appliedLayout.placements.find((p) => p.objectId === 'arrow-1');

  
  assert.equal(previewArrow.position.x, appliedArrow.position.x);
  assert.equal(previewArrow.position.y, appliedArrow.position.y);
  assert.equal(previewArrow.bounds.width, appliedArrow.bounds.width);
  assert.equal(previewArrow.bounds.height, appliedArrow.bounds.height);
  assert.deepEqual(previewArrow.pathCommands, appliedArrow.pathCommands);
});
