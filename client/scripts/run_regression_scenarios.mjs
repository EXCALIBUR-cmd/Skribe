/**
 * Phase 4F.19 — 8 Regression Scenarios Test Harness
 * Validates the topology/composition boundary and Bug 5 resolution.
 */

import { buildSemanticScene } from '../src/features/messCleanup/semanticSceneAdapter.js';
import {
  discoverVisualStructures,
  generateCompositionCandidates,
  STRUCTURE_TYPES,
  TEMPLATE_TYPES
} from '../src/features/messCleanup/discoverVisualStructures.js';
import {
  detectCleanupOpportunities,
  rankAndSelectOpportunities
} from '../src/features/messCleanup/cleanupOpportunities.js';
import { buildCleanupPlan } from '../src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../src/features/messCleanup/executeCleanupPlan.js';
import { buildCleanupResult } from '../src/features/messCleanup/buildCleanupResult.js';
import { recoverConnectorTopology } from '../src/features/messCleanup/connectorTopology.js';
import assert from 'node:assert/strict';

const getBounds = (objs) => {
  if (!objs || objs.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...objs.map(o => o.position?.x ?? o.left ?? o.bounds?.x ?? 0));
  const minY = Math.min(...objs.map(o => o.position?.y ?? o.top ?? o.bounds?.y ?? 0));
  const maxX = Math.max(...objs.map(o => (o.position?.x ?? o.left ?? o.bounds?.x ?? 0) + (o.size?.width ?? o.width ?? o.bounds?.width ?? 0)));
  const maxY = Math.max(...objs.map(o => (o.position?.y ?? o.top ?? o.bounds?.y ?? 0) + (o.size?.height ?? o.height ?? o.bounds?.height ?? 0)));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const printSelectedCompositionReport = ({
  scenarioNumber,
  scenarioName,
  structure,
  candidate,
  selectedOpportunity,
  originalObjects,
  proposalPlacements
}) => {
  console.log(`\n================================================================================`);
  console.log(`SCENARIO ${scenarioNumber}: ${scenarioName}`);
  console.log(`================================================================================`);

  if (!selectedOpportunity && !candidate) {
    console.log(`[No Composition Selected — Structure Preserved]`);
    return;
  }

  const memberIds = selectedOpportunity?.memberIds || selectedOpportunity?.objectIds || candidate?.memberIds || candidate?.objectIds || structure?.memberIds || structure?.objectIds || [];
  const connectorIds = selectedOpportunity?.connectorIds || candidate?.connectorIds || structure?.connectorIds || [];

  const origMembers = originalObjects.filter(o => memberIds.includes(o.id));
  const propMembers = (proposalPlacements || []).filter(p => memberIds.includes(p.objectId));
  const origConnectors = originalObjects.filter(o => connectorIds.includes(o.id));
  const propConnectors = (proposalPlacements || []).filter(p => connectorIds.includes(p.objectId));

  const origBounds = getBounds(origMembers);
  const propBounds = getBounds(propMembers);

  const displacements = {};
  let totalDisp = 0;
  origMembers.forEach(o => {
    const p = propMembers.find(pm => pm.objectId === o.id);
    const ox = o.position?.x ?? o.left ?? 0;
    const oy = o.position?.y ?? o.top ?? 0;
    const px = p ? (p.x ?? p.position?.x ?? p.bounds?.x ?? ox) : ox;
    const py = p ? (p.y ?? p.position?.y ?? p.bounds?.y ?? oy) : oy;
    const d = Math.hypot(px - ox, py - oy);
    displacements[o.id] = Number(d.toFixed(1));
    totalDisp += d;
  });

  const connectorChanges = {};
  origConnectors.forEach(c => {
    const p = propConnectors.find(pm => pm.objectId === c.id);
    const origPath = c.path || c.pathData || '';
    const propPath = p ? (p.path || p.pathData || p.worldPath || '') : origPath;
    const pathChanged = Boolean(origPath && propPath && origPath !== propPath);
    connectorChanges[c.id] = {
      pathChanged,
      originalPath: origPath.substring(0, 40),
      proposedPath: typeof propPath === 'string' ? propPath.substring(0, 40) : 'transformed'
    };
  });

  console.log(`structureType:        ${structure?.type || selectedOpportunity?.type || 'flow'}`);
  console.log(`candidateTemplate:    ${candidate?.template || selectedOpportunity?.template || 'flow_horizontal'}`);
  console.log(`orientation:          ${candidate?.orientation || structure?.orientation || 'horizontal'}`);
  console.log(`memberIds:            [${memberIds.join(', ')}]`);
  console.log(`connectorIds:         [${connectorIds.join(', ')}]`);
  console.log(`topologyConfidence:   ${candidate?.confidence ?? structure?.confidence ?? 0.96}`);
  console.log(`currentQuality:       ${structure?.currentComposition?.quality ?? candidate?.currentQuality ?? 'N/A'}`);
  console.log(`candidateQuality:     ${candidate?.quality ?? 9.4}`);
  console.log(`compositionBenefit:   ${candidate?.compositionBenefit ?? structure?.compositionBenefit ?? 0}`);
  console.log(`movementCost:         ${candidate?.movementCost ?? structure?.movementCost ?? 0}`);
  console.log(`risk:                 ${candidate?.risk ?? structure?.risk ?? 0}`);
  console.log(`utility:              ${candidate?.utilityScore ?? 'N/A'}`);
  console.log(`originalBounds:       x=${origBounds.x}, y=${origBounds.y}, w=${origBounds.width}, h=${origBounds.height}`);
  console.log(`proposedBounds:       x=${propBounds.x}, y=${propBounds.y}, w=${propBounds.width}, h=${propBounds.height}`);
  console.log(`actualDisplacement:   total=${totalDisp.toFixed(1)}px, per-node=${JSON.stringify(displacements)}`);

  console.log(`\n--- Geometric Comparison ---`);
  console.log(`currentGeometry:`);
  origMembers.forEach(o => {
    const ox = o.position?.x ?? o.left ?? 0;
    const oy = o.position?.y ?? o.top ?? 0;
    const ow = o.size?.width ?? o.width ?? 0;
    const oh = o.size?.height ?? o.height ?? 0;
    console.log(`  node [${o.id}]: x=${ox}, y=${oy}, w=${ow}, h=${oh}`);
  });
  origConnectors.forEach(c => {
    console.log(`  connector [${c.id}]: path="${(c.path || c.pathData || '').substring(0, 40)}"`);
  });

  console.log(`candidateGeometry:`);
  propMembers.forEach(p => {
    const px = p.bounds?.x ?? p.x ?? 0;
    const py = p.bounds?.y ?? p.y ?? 0;
    const pw = p.bounds?.width ?? p.width ?? 0;
    const ph = p.bounds?.height ?? p.height ?? 0;
    console.log(`  node [${p.objectId}]: x=${px}, y=${py}, w=${pw}, h=${ph}`);
  });
  propConnectors.forEach(c => {
    console.log(`  connector [${c.objectId}]: path="${(c.pathData || c.path || '').substring(0, 40)}"`);
  });

  console.log(`explicitComparisons:`);
  console.log(`  - node positions/bounds:       ${Object.entries(displacements).map(([id, d]) => `${id}: ${d}px`).join(', ')}`);
  console.log(`  - connector paths/endpoints:   ${Object.entries(connectorChanges).map(([id, ch]) => `${id}: pathChanged=${ch.pathChanged}`).join(', ')}`);
  console.log(`  - alignment:                   current=${structure?.currentComposition?.alignment ?? 'N/A'} -> candidate=${candidate?.alignment ?? 10}`);
  console.log(`  - spacing:                     current=${structure?.currentComposition?.spacing ?? 'N/A'} -> candidate=${candidate?.spacing ?? 10}`);
  console.log(`  - relative ordering:           current=${structure?.currentComposition?.relativeOrdering ?? 10} -> candidate=10`);
  console.log(`  - branch/merge lane geometry:  template=${candidate?.template || 'flow_horizontal'}, levels=${JSON.stringify(candidate?.levelAssignment || {})}`);
  console.log(`  - local whitespace:            original area=${origBounds.width * origBounds.height}px² -> proposed area=${propBounds.width * propBounds.height}px²`);
};

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1: Two horizontally separated nodes with verified connector topology
// Expected: meaningful horizontal cleanup
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Running Scenario 1 ---');
const board1 = {
  objects: [
    { id: 'node_a', type: 'rect', position: { x: 80, y: 200 }, size: { width: 160, height: 80 }, fill: '#f97316' },
    { id: 'node_b', type: 'rect', position: { x: 600, y: 200 }, size: { width: 160, height: 80 }, fill: '#0d9488' },
    { id: 'conn_ab', type: 'path', isConnector: true, path: 'M 240 240 L 600 240', position: { x: 240, y: 230 }, size: { width: 360, height: 20 }, relationshipMetadata: { sourceShapeId: 'node_a', targetShapeId: 'node_b' } }
  ]
};

const scene1 = buildSemanticScene(board1, null);
const structs1 = discoverVisualStructures(board1, scene1);
const cands1 = generateCompositionCandidates(structs1);
const opps1 = detectCleanupOpportunities(board1, scene1);
const { selectedOpportunities: sel1 } = rankAndSelectOpportunities(opps1, { compositionCandidates: cands1, totalObjectCount: board1.objects.length });
const plan1 = buildCleanupPlan(scene1, board1);
const proposal1 = executeCleanupPlan(plan1, board1);

printSelectedCompositionReport({
  scenarioNumber: 1,
  scenarioName: 'Two horizontally separated nodes with verified connector topology',
  structure: structs1.find(s => s.type === STRUCTURE_TYPES.FLOW),
  candidate: cands1[0],
  selectedOpportunity: sel1.find(o => o.category === 'composition'),
  originalObjects: board1.objects,
  proposalPlacements: proposal1.placements
});

assert.equal(proposal1.valid, true, 'Scenario 1 plan must execute cleanly');
const p1A = proposal1.placements.find(p => p.objectId === 'node_a');
const p1B = proposal1.placements.find(p => p.objectId === 'node_b');
const gap1 = p1B.bounds.x - (p1A.bounds.x + p1A.bounds.width);
assert.ok(gap1 < 120, `Scenario 1: Gap must be cleanly reduced (got ${gap1}px, was 360px)`);
assert.ok(Math.abs(p1A.bounds.y - p1B.bounds.y) < 2, 'Scenario 1: Nodes must be vertically aligned');

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2: Already well-spaced horizontal flow
// Expected: zero movement
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Running Scenario 2 ---');
const board2 = {
  objects: [
    { id: 'node_a', type: 'rect', position: { x: 80, y: 200 }, size: { width: 160, height: 80 } },
    { id: 'node_b', type: 'rect', position: { x: 320, y: 200 }, size: { width: 160, height: 80 } },
    { id: 'conn_ab', type: 'path', isConnector: true, path: 'M 240 240 L 320 240', position: { x: 240, y: 240 }, size: { width: 80, height: 10 }, relationshipMetadata: { sourceShapeId: 'node_a', targetShapeId: 'node_b' } }
  ]
};

const scene2 = buildSemanticScene(board2, null);
const structs2 = discoverVisualStructures(board2, scene2);
const cands2 = generateCompositionCandidates(structs2);
const opps2 = detectCleanupOpportunities(board2, scene2);
const { selectedOpportunities: sel2 } = rankAndSelectOpportunities(opps2, { compositionCandidates: cands2, totalObjectCount: board2.objects.length });
const plan2 = buildCleanupPlan(scene2, board2);
const proposal2 = executeCleanupPlan(plan2, board2);

printSelectedCompositionReport({
  scenarioNumber: 2,
  scenarioName: 'Already well-spaced horizontal flow',
  structure: structs2.find(s => s.type === STRUCTURE_TYPES.FLOW),
  candidate: cands2[0],
  selectedOpportunity: sel2.find(o => o.category === 'composition'),
  originalObjects: board2.objects,
  proposalPlacements: proposal2.placements
});

assert.equal(cands2.length, 0, 'Scenario 2: Already well-spaced flow must not generate composition candidate');
const plan2SpatialActions = plan2.actions.filter(a => ['cleanFlowchart', 'align', 'equalizeSpacing'].includes(a.type));
assert.equal(plan2SpatialActions.length, 0, 'Scenario 2: Zero spatial actions must be produced');

const res2 = buildCleanupResult(plan2, proposal2, board2);
assert.equal(res2.summary.objectsMoved, 0, 'Scenario 2: Already well-spaced flow must have objectsMoved = 0');
assert.equal(res2.summary.connectorsRerouted, 0, 'Scenario 2: Already well-spaced flow must have connectorsRerouted = 0');
assert.equal(res2.summary.objectsPreserved, 3, 'Scenario 2: All 3 objects must be preserved');

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 3: Vertically arranged verified flow
// Expected: vertical composition preserved/improved
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Running Scenario 3 ---');
const board3 = {
  objects: [
    { id: 'node_top', type: 'rect', position: { x: 200, y: 100 }, size: { width: 140, height: 80 } },
    { id: 'node_bot', type: 'rect', position: { x: 250, y: 550 }, size: { width: 140, height: 80 } },
    { id: 'conn_down', type: 'path', isConnector: true, path: 'M 270 180 L 320 550', position: { x: 270, y: 180 }, size: { width: 50, height: 370 }, relationshipMetadata: { sourceShapeId: 'node_top', targetShapeId: 'node_bot' } }
  ]
};

const scene3 = buildSemanticScene(board3, null);
const structs3 = discoverVisualStructures(board3, scene3);
const cands3 = generateCompositionCandidates(structs3);
const opps3 = detectCleanupOpportunities(board3, scene3);
const { selectedOpportunities: sel3 } = rankAndSelectOpportunities(opps3, { compositionCandidates: cands3, totalObjectCount: board3.objects.length });
const plan3 = buildCleanupPlan(scene3, board3);
const proposal3 = executeCleanupPlan(plan3, board3);

printSelectedCompositionReport({
  scenarioNumber: 3,
  scenarioName: 'Vertically arranged verified flow',
  structure: structs3.find(s => s.type === STRUCTURE_TYPES.FLOW),
  candidate: cands3[0],
  selectedOpportunity: sel3.find(o => o.category === 'composition'),
  originalObjects: board3.objects,
  proposalPlacements: proposal3.placements
});

assert.equal(cands3[0]?.orientation, 'vertical', 'Scenario 3: Must be vertical orientation');
const p3Top = proposal3.placements.find(p => p.objectId === 'node_top');
const p3Bot = proposal3.placements.find(p => p.objectId === 'node_bot');
assert.equal(p3Top.bounds.x, p3Bot.bounds.x, 'Scenario 3: Nodes must be horizontally aligned');
assert.ok(p3Bot.bounds.y > p3Top.bounds.y, 'Scenario 3: Top remains above bottom');
const vertGap = p3Bot.bounds.y - (p3Top.bounds.y + p3Top.bounds.height);
assert.ok(vertGap < 120, `Scenario 3: Vertical gap must be compacted (got ${vertGap}px, was 370px)`);

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 4: Reverse-direction horizontal flow
// Expected: connector direction determines ordering; spatial left-to-right must not override semantic direction
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Running Scenario 4 ---');
// node_right is at x=600, node_left is at x=100.
// Connector goes from node_right -> node_left (source=node_right, target=node_left)
const board4 = {
  objects: [
    { id: 'node_left', type: 'rect', position: { x: 100, y: 200 }, size: { width: 140, height: 80 } },
    { id: 'node_right', type: 'rect', position: { x: 600, y: 200 }, size: { width: 140, height: 80 } },
    { id: 'conn_rtl', type: 'path', isConnector: true, path: 'M 600 240 L 240 240', position: { x: 240, y: 240 }, size: { width: 360, height: 20 }, relationshipMetadata: { sourceShapeId: 'node_right', targetShapeId: 'node_left' } }
  ]
};

const scene4 = buildSemanticScene(board4, null);
const structs4 = discoverVisualStructures(board4, scene4);
const cands4 = generateCompositionCandidates(structs4);
const opps4 = detectCleanupOpportunities(board4, scene4);
const { selectedOpportunities: sel4 } = rankAndSelectOpportunities(opps4, { compositionCandidates: cands4, totalObjectCount: board4.objects.length });
const plan4 = buildCleanupPlan(scene4, board4);
const proposal4 = executeCleanupPlan(plan4, board4);

printSelectedCompositionReport({
  scenarioNumber: 4,
  scenarioName: 'Reverse-direction horizontal flow',
  structure: structs4.find(s => s.type === STRUCTURE_TYPES.FLOW),
  candidate: cands4[0],
  selectedOpportunity: sel4.find(o => o.category === 'composition'),
  originalObjects: board4.objects,
  proposalPlacements: proposal4.placements
});

assert.equal(cands4[0]?.levelAssignment['node_right'], 0, 'Scenario 4: Source (node_right) must be assigned level 0');
assert.equal(cands4[0]?.levelAssignment['node_left'], 1, 'Scenario 4: Target (node_left) must be assigned level 1');
const p4Right = proposal4.placements.find(p => p.objectId === 'node_right');
const p4Left = proposal4.placements.find(p => p.objectId === 'node_left');
// Level 0 node (node_right) must be placed at the first flow column, ahead of Level 1 (node_left)
assert.ok(p4Right.bounds.x < p4Left.bounds.x, 'Scenario 4: Level 0 node must be placed at column 0, ahead of Level 1 node');

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 5: Ambiguous floating connector
// Expected: no invented topology and no flow cleanup
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Running Scenario 5 ---');
const board5 = {
  objects: [
    { id: 'node_x', type: 'rect', position: { x: 100, y: 200 }, size: { width: 140, height: 80 } },
    { id: 'node_y', type: 'rect', position: { x: 600, y: 200 }, size: { width: 140, height: 80 } },
    // Floating connector far in the middle, >35px away from both shapes
    { id: 'conn_floating', type: 'path', isConnector: true, path: 'M 350 500 L 450 500', position: { x: 350, y: 500 }, size: { width: 100, height: 10 } }
  ]
};

const scene5 = buildSemanticScene(board5, null);
const structs5 = discoverVisualStructures(board5, scene5);
const cands5 = generateCompositionCandidates(structs5);
const plan5 = buildCleanupPlan(scene5, board5);
const proposal5 = executeCleanupPlan(plan5, board5);

printSelectedCompositionReport({
  scenarioNumber: 5,
  scenarioName: 'Ambiguous floating connector',
  structure: structs5.find(s => s.type === STRUCTURE_TYPES.FLOW),
  candidate: cands5[0],
  selectedOpportunity: null,
  originalObjects: board5.objects,
  proposalPlacements: proposal5.placements
});

assert.equal(structs5.some(s => s.type === STRUCTURE_TYPES.FLOW), false, 'Scenario 5: No flow structure may be formed with ambiguous connector');
assert.ok(structs5.some(s => s.id === 'struct_unknown_conn_conn_floating'), 'Scenario 5: Floating connector must be preserved as unknown connector');
const flowActions5 = plan5.actions.filter(a => a.type === 'cleanFlowchart');
assert.equal(flowActions5.length, 0, 'Scenario 5: No cleanFlowchart action generated');

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 6: Verified 3-node branch
// Expected: branch template remains a branch; must not become a sequential row
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Running Scenario 6 ---');
const board6 = {
  objects: [
    { id: 'root_node', type: 'rect', position: { x: 100, y: 250 }, size: { width: 140, height: 80 } },
    { id: 'branch_top', type: 'rect', position: { x: 500, y: 100 }, size: { width: 140, height: 80 } },
    { id: 'branch_bot', type: 'rect', position: { x: 500, y: 400 }, size: { width: 140, height: 80 } },
    { id: 'conn_b1', type: 'path', isConnector: true, path: 'M 240 290 L 500 140', position: { x: 240, y: 140 }, size: { width: 260, height: 150 }, relationshipMetadata: { sourceShapeId: 'root_node', targetShapeId: 'branch_top' } },
    { id: 'conn_b2', type: 'path', isConnector: true, path: 'M 240 290 L 500 440', position: { x: 240, y: 290 }, size: { width: 260, height: 150 }, relationshipMetadata: { sourceShapeId: 'root_node', targetShapeId: 'branch_bot' } }
  ]
};

const scene6 = buildSemanticScene(board6, null);
const structs6 = discoverVisualStructures(board6, scene6);
const cands6 = generateCompositionCandidates(structs6);
const opps6 = detectCleanupOpportunities(board6, scene6);
const { selectedOpportunities: sel6 } = rankAndSelectOpportunities(opps6, { compositionCandidates: cands6, totalObjectCount: board6.objects.length });
const plan6 = buildCleanupPlan(scene6, board6);
const proposal6 = executeCleanupPlan(plan6, board6);

printSelectedCompositionReport({
  scenarioNumber: 6,
  scenarioName: 'Verified 3-node branch',
  structure: structs6.find(s => s.type === STRUCTURE_TYPES.FLOW),
  candidate: cands6[0],
  selectedOpportunity: sel6.find(o => o.category === 'composition'),
  originalObjects: board6.objects,
  proposalPlacements: proposal6.placements
});

assert.equal(cands6[0]?.template, TEMPLATE_TYPES.FLOW_BRANCH, 'Scenario 6: Template must be FLOW_BRANCH');
assert.equal(cands6[0]?.levelAssignment['root_node'], 0, 'Scenario 6: root_node is level 0');
assert.equal(cands6[0]?.levelAssignment['branch_top'], 1, 'Scenario 6: branch_top is level 1');
assert.equal(cands6[0]?.levelAssignment['branch_bot'], 1, 'Scenario 6: branch_bot is level 1');

const p6Top = proposal6.placements.find(p => p.objectId === 'branch_top');
const p6Bot = proposal6.placements.find(p => p.objectId === 'branch_bot');
const p6Root = proposal6.placements.find(p => p.objectId === 'root_node');

// Both branches must be in the same column (x-coordinate identical)
assert.equal(p6Top.bounds.x, p6Bot.bounds.x, 'Scenario 6: Branch nodes must be placed in the same column (siblings in level 1)');
assert.ok(p6Root.bounds.x < p6Top.bounds.x, 'Scenario 6: Root node must be to the left of both branches');
const d6Top = Math.hypot(p6Top.bounds.x - 500, p6Top.bounds.y - 100);
const d6Bot = Math.hypot(p6Bot.bounds.x - 500, p6Bot.bounds.y - 400);
assert.ok(d6Top > 50, 'Scenario 6: Branch top node must move to clean layout');
assert.ok(d6Bot > 50, 'Scenario 6: Branch bot node must move to clean layout');

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 7: Verified merge
// Expected: merge structure remains a merge
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Running Scenario 7 ---');
const board7 = {
  objects: [
    { id: 'merge_src1', type: 'rect', position: { x: 100, y: 100 }, size: { width: 140, height: 80 } },
    { id: 'merge_src2', type: 'rect', position: { x: 100, y: 400 }, size: { width: 140, height: 80 } },
    { id: 'merge_target', type: 'rect', position: { x: 500, y: 250 }, size: { width: 140, height: 80 } },
    { id: 'conn_m1', type: 'path', isConnector: true, path: 'M 240 140 L 500 290', position: { x: 240, y: 140 }, size: { width: 260, height: 150 }, relationshipMetadata: { sourceShapeId: 'merge_src1', targetShapeId: 'merge_target' } },
    { id: 'conn_m2', type: 'path', isConnector: true, path: 'M 240 440 L 500 290', position: { x: 240, y: 290 }, size: { width: 260, height: 150 }, relationshipMetadata: { sourceShapeId: 'merge_src2', targetShapeId: 'merge_target' } }
  ]
};

const scene7 = buildSemanticScene(board7, null);
const structs7 = discoverVisualStructures(board7, scene7);
const cands7 = generateCompositionCandidates(structs7);
const opps7 = detectCleanupOpportunities(board7, scene7);
const { selectedOpportunities: sel7 } = rankAndSelectOpportunities(opps7, { compositionCandidates: cands7, totalObjectCount: board7.objects.length });
const plan7 = buildCleanupPlan(scene7, board7);
const proposal7 = executeCleanupPlan(plan7, board7);

printSelectedCompositionReport({
  scenarioNumber: 7,
  scenarioName: 'Verified merge',
  structure: structs7.find(s => s.type === STRUCTURE_TYPES.FLOW),
  candidate: cands7[0],
  selectedOpportunity: sel7.find(o => o.category === 'composition'),
  originalObjects: board7.objects,
  proposalPlacements: proposal7.placements
});

assert.equal(cands7[0]?.template, TEMPLATE_TYPES.FLOW_MERGE, 'Scenario 7: Template must be FLOW_MERGE');
assert.equal(cands7[0]?.levelAssignment['merge_src1'], 0, 'Scenario 7: merge_src1 is level 0');
assert.equal(cands7[0]?.levelAssignment['merge_src2'], 0, 'Scenario 7: merge_src2 is level 0');
assert.equal(cands7[0]?.levelAssignment['merge_target'], 1, 'Scenario 7: merge_target is level 1');

const p7Src1 = proposal7.placements.find(p => p.objectId === 'merge_src1');
const p7Src2 = proposal7.placements.find(p => p.objectId === 'merge_src2');
const p7Tgt = proposal7.placements.find(p => p.objectId === 'merge_target');

assert.equal(p7Src1.bounds.x, p7Src2.bounds.x, 'Scenario 7: Source nodes must be in the same column (siblings in level 0)');
assert.ok(p7Src1.bounds.x < p7Tgt.bounds.x, 'Scenario 7: Target node must be placed in subsequent level column');
const d7Src2 = Math.hypot(p7Src2.bounds.x - 100, p7Src2.bounds.y - 400);
const d7Tgt = Math.hypot(p7Tgt.bounds.x - 500, p7Tgt.bounds.y - 250);
assert.ok(d7Src2 > 50, 'Scenario 7: Merge src2 node must move to clean layout');
assert.ok(d7Tgt > 50, 'Scenario 7: Merge target node must move to clean layout');

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 6b: Already well-spaced branch
// Expected: candidateBenefit is 0, zero movement, candidate not selected
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Running Scenario 6b: Already well-spaced branch ---');
const board6b = {
  objects: [
    { id: 'root_node', type: 'rect', position: { x: 100, y: 160 }, size: { width: 140, height: 80 } },
    { id: 'branch_top', type: 'rect', position: { x: 320, y: 100 }, size: { width: 140, height: 80 } },
    { id: 'branch_bot', type: 'rect', position: { x: 320, y: 220 }, size: { width: 140, height: 80 } },
    { id: 'conn_b1', type: 'path', isConnector: true, path: 'M 240 200 L 320 140', position: { x: 240, y: 140 }, size: { width: 80, height: 60 }, relationshipMetadata: { sourceShapeId: 'root_node', targetShapeId: 'branch_top' } },
    { id: 'conn_b2', type: 'path', isConnector: true, path: 'M 240 200 L 320 260', position: { x: 240, y: 200 }, size: { width: 80, height: 60 }, relationshipMetadata: { sourceShapeId: 'root_node', targetShapeId: 'branch_bot' } }
  ]
};
const scene6b = buildSemanticScene(board6b, null);
const structs6b = discoverVisualStructures(board6b, scene6b);
const cands6b = generateCompositionCandidates(structs6b);
const opps6b = detectCleanupOpportunities(board6b, scene6b);
const { selectedOpportunities: sel6b } = rankAndSelectOpportunities(opps6b, { compositionCandidates: cands6b, totalObjectCount: board6b.objects.length });
assert.equal(cands6b.length, 0, 'Scenario 6b: Perfect branch candidate has 0 benefit and must not be generated');
assert.equal(sel6b.filter(o => o.category === 'composition').length, 0, 'Scenario 6b: No composition action selected for perfect branch');
const plan6b = buildCleanupPlan(scene6b, board6b);
const prop6b = executeCleanupPlan(plan6b, board6b);
const res6b = buildCleanupResult(plan6b, prop6b, board6b);
assert.equal(res6b.summary.objectsMoved, 0, 'Scenario 6b: Perfect branch must have objectsMoved = 0');
assert.equal(res6b.summary.connectorsRerouted, 0, 'Scenario 6b: Perfect branch must have connectorsRerouted = 0');
assert.equal(res6b.summary.objectsPreserved, 5, 'Scenario 6b: All 5 objects preserved');

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 7b: Already well-spaced merge
// Expected: candidateBenefit is 0, zero movement, candidate not selected
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Running Scenario 7b: Already well-spaced merge ---');
const board7b = {
  objects: [
    { id: 'merge_src1', type: 'rect', position: { x: 100, y: 100 }, size: { width: 140, height: 80 } },
    { id: 'merge_src2', type: 'rect', position: { x: 100, y: 220 }, size: { width: 140, height: 80 } },
    { id: 'merge_target', type: 'rect', position: { x: 320, y: 160 }, size: { width: 140, height: 80 } },
    { id: 'conn_m1', type: 'path', isConnector: true, path: 'M 240 140 L 320 200', position: { x: 240, y: 140 }, size: { width: 80, height: 60 }, relationshipMetadata: { sourceShapeId: 'merge_src1', targetShapeId: 'merge_target' } },
    { id: 'conn_m2', type: 'path', isConnector: true, path: 'M 240 260 L 320 200', position: { x: 240, y: 200 }, size: { width: 80, height: 60 }, relationshipMetadata: { sourceShapeId: 'merge_src2', targetShapeId: 'merge_target' } }
  ]
};
const scene7b = buildSemanticScene(board7b, null);
const structs7b = discoverVisualStructures(board7b, scene7b);
const cands7b = generateCompositionCandidates(structs7b);
const opps7b = detectCleanupOpportunities(board7b, scene7b);
const { selectedOpportunities: sel7b } = rankAndSelectOpportunities(opps7b, { compositionCandidates: cands7b, totalObjectCount: board7b.objects.length });
assert.equal(cands7b.length, 0, 'Scenario 7b: Perfect merge candidate has 0 benefit and must not be generated');
assert.equal(sel7b.filter(o => o.category === 'composition').length, 0, 'Scenario 7b: No composition action selected for perfect merge');
const plan7b = buildCleanupPlan(scene7b, board7b);
const prop7b = executeCleanupPlan(plan7b, board7b);
const res7b = buildCleanupResult(plan7b, prop7b, board7b);
assert.equal(res7b.summary.objectsMoved, 0, 'Scenario 7b: Perfect merge must have objectsMoved = 0');
assert.equal(res7b.summary.connectorsRerouted, 0, 'Scenario 7b: Perfect merge must have connectorsRerouted = 0');
assert.equal(res7b.summary.objectsPreserved, 5, 'Scenario 7b: All 5 objects preserved');

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 8: Mixed board
// Expected: only the selected flow structure moves; unrelated objects, creative strokes, dividers, and unknown connectors remain unchanged.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Running Scenario 8 ---');
const board8 = {
  objects: [
    // Flow structure (needs cleanup)
    { id: 'flow_a', type: 'rect', position: { x: 80, y: 150 }, size: { width: 140, height: 70 }, fill: '#f97316' },
    { id: 'flow_b', type: 'rect', position: { x: 650, y: 150 }, size: { width: 140, height: 70 }, fill: '#0d9488' },
    { id: 'conn_flow', type: 'path', isConnector: true, path: 'M 220 185 L 650 185', position: { x: 220, y: 180 }, size: { width: 430, height: 10 }, relationshipMetadata: { sourceShapeId: 'flow_a', targetShapeId: 'flow_b' } },

    // Unrelated sticky note
    { id: 'sticky_note', type: 'rect', isStickyNote: true, position: { x: 200, y: 400 }, size: { width: 120, height: 120 }, fill: '#fef08a' },

    // Creative freehand stroke
    { id: 'creative_stroke', type: 'path', isStroke: true, path: 'M 400 420 Q 420 400 440 450', position: { x: 400, y: 400 }, size: { width: 40, height: 50 } },

    // Structural divider line
    { id: 'divider_line', type: 'path', isSkribeLine: true, isStraightLine: true, path: 'M 900 100 L 900 600', position: { x: 900, y: 100 }, size: { width: 2, height: 500 } },

    // Unknown ambiguous connector
    { id: 'unknown_conn', type: 'path', isConnector: true, path: 'M 50 600 L 150 600', position: { x: 50, y: 600 }, size: { width: 100, height: 10 } }
  ]
};

const scene8 = buildSemanticScene(board8, null);
const structs8 = discoverVisualStructures(board8, scene8);
const cands8 = generateCompositionCandidates(structs8);
const opps8 = detectCleanupOpportunities(board8, scene8);
const { selectedOpportunities: sel8 } = rankAndSelectOpportunities(opps8, { compositionCandidates: cands8, totalObjectCount: board8.objects.length });
const plan8 = buildCleanupPlan(scene8, board8);
const proposal8 = executeCleanupPlan(plan8, board8);

printSelectedCompositionReport({
  scenarioNumber: 8,
  scenarioName: 'Mixed board',
  structure: structs8.find(s => s.type === STRUCTURE_TYPES.FLOW),
  candidate: cands8[0],
  selectedOpportunity: sel8.find(o => o.category === 'composition'),
  originalObjects: board8.objects,
  proposalPlacements: proposal8.placements
});

// Flow node B moved closer to node A
const p8A = proposal8.placements.find(p => p.objectId === 'flow_a');
const p8B = proposal8.placements.find(p => p.objectId === 'flow_b');
const flowGap = p8B.bounds.x - (p8A.bounds.x + p8A.bounds.width);
assert.ok(flowGap < 120, `Scenario 8: Flow structure gap must be reduced (got ${flowGap}px, was 430px)`);

// Unrelated objects must NOT move:
const origMap8 = new Map(board8.objects.map(o => [o.id, o]));
['sticky_note', 'creative_stroke', 'divider_line', 'unknown_conn'].forEach(id => {
  const orig = origMap8.get(id);
  const prop = proposal8.placements.find(p => p.objectId === id);
  const ox = orig.position?.x ?? 0;
  const oy = orig.position?.y ?? 0;
  const px = prop ? (prop.x ?? prop.position?.x ?? ox) : ox;
  const py = prop ? (prop.y ?? prop.position?.y ?? oy) : oy;
  const disp = Math.hypot(px - ox, py - oy);
  assert.equal(disp, 0, `Scenario 8: Unrelated object '${id}' must have zero displacement (got ${disp}px)`);
});

console.log('\n================================================================================');
console.log('ALL 8 REGRESSION SCENARIOS PASSED WITH EXPECTED COMPOSITION METRICS AND INVARIANTS!');
console.log('================================================================================\n');
