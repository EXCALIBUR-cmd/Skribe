import assert from 'node:assert/strict';
import { normalizeObject } from '../src/features/messCleanup/normalizeObjects.js';
import { buildCleanupPlan } from '../src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../src/features/messCleanup/executeCleanupPlan.js';
import { buildPreviewRenderModel } from '../src/features/messCleanup/previewModel.js';
import { auditCleanupPipeline } from '../src/features/messCleanup/auditCleanupPipeline.js';
import { getSemanticType } from '../src/features/messCleanup/cleanupTypes.js';

import { buildCleanupResult } from '../src/features/messCleanup/buildCleanupResult.js';

console.log('================================================================================');
console.log('PHASE 4F.16 — EXPLAINABLE CLEANUP RESULT & REAL-WORLD EVALUATION');
console.log('================================================================================\n');

const evaluateBoard = (boardName, description, rawObjects, customScene = null) => {
  console.log(`\n--------------------------------------------------------------------------------`);
  console.log(`BOARD: ${boardName}`);
  console.log(`TYPE:  ${description}`);
  console.log(`--------------------------------------------------------------------------------`);

  const normalizedObjects = rawObjects.map(normalizeObject);
  const workspaceModel = { board: { objects: normalizedObjects } };

  const cleanupPlan = buildCleanupPlan(customScene, workspaceModel);
  const layoutProposal = executeCleanupPlan(cleanupPlan, workspaceModel);
  const previewModel = buildPreviewRenderModel(workspaceModel, layoutProposal);
  const cleanupResult = buildCleanupResult(cleanupPlan, layoutProposal, workspaceModel);

  const audit = auditCleanupPipeline(workspaceModel, cleanupPlan, layoutProposal, previewModel);

  console.log(`\n1. EXPLAINABLE SUMMARY:`);
  console.log(`   "${cleanupResult.summary.humanSummary}"`);
  console.log(`   Actions Executed:    ${cleanupResult.summary.actionCount}`);
  console.log(`   Objects Modified:    ${cleanupResult.summary.modifiedObjectCount}`);
  console.log(`   Objects Preserved:   ${cleanupResult.summary.untouchedObjectCount}`);

  console.log(`\n2. PROPOSED CLEANUP ACTIONS & IMPACT:`);
  if (cleanupResult.actions.length === 0) {
    console.log(`   (None — all objects safely preserved in place)`);
  } else {
    cleanupResult.actions.forEach((act, idx) => {
      console.log(`   [${idx + 1}] ${act.type.padEnd(16)} Conf: ${act.confidence.toFixed(2)} | Objects: [${act.objectIds.join(', ')}]`);
      if (act.ownedObjectIds) console.log(`       Owned Objects: [${act.ownedObjectIds.join(', ')}]`);
      if (act.connectorIds) console.log(`       Connectors:    [${act.connectorIds.join(', ')}]`);
      console.log(`       Impact:        Affected: ${act.impact.objectsAffected}, Moved: ${act.impact.objectsMoved}, Atomic Units: ${act.impact.atomicUnitsAffected}`);
      console.log(`       Reason:        "${act.reason}"`);
    });
  }

  console.log(`\n3. INTENTIONALLY PRESERVED CONTENT (${cleanupResult.preserved.length} categories):`);
  cleanupResult.preserved.forEach((p, idx) => {
    console.log(`   [${idx + 1}] Category '${p.category}' (${p.objectIds.length} objects: [${p.objectIds.join(', ')}]):`);
    console.log(`       Reason: "${p.reason}"`);
  });

  if (cleanupResult.diagnostics.suppressedActions.length > 0) {
    console.log(`\n4. SUPPRESSED ACTIONS (${cleanupResult.diagnostics.suppressedActions.length}):`);
    cleanupResult.diagnostics.suppressedActions.forEach((id, idx) => {
      console.log(`   [${idx + 1}] ${id}`);
    });
  }

  console.log(`\n5. SAFETY & CONSERVATION AUDIT:`);
  console.log(`   Fully Conserved:            ${cleanupResult.safety.isFullyConserved ? 'YES ✓' : 'NO ✖'}`);
  console.log(`   Untouched Invariant Met:    ${cleanupResult.safety.untouchedInvariantMet ? 'YES ✓' : 'NO ✖'}`);
  console.log(`   Missing Objects:            ${audit.missingObjectIds.length === 0 ? '0 ✓' : audit.missingObjectIds.join(', ')}`);
  console.log(`   Duplicate Objects:          ${audit.duplicateObjectIds.length === 0 ? '0 ✓' : audit.duplicateObjectIds.join(', ')}`);
  console.log(`   Canvas Bounds:              (${layoutProposal.canvasBounds.x}, ${layoutProposal.canvasBounds.y}, ${layoutProposal.canvasBounds.width}x${layoutProposal.canvasBounds.height})`);

  return {
    boardName,
    description,
    sourceCount: normalizedObjects.length,
    plan: cleanupPlan,
    proposal: layoutProposal,
    preview: previewModel,
    audit
  };
};

const makeLinked = (id, type, shapeType, text, x, y, w = 120, h = 80, fill = '#e2e8f0') => {
  const shapeId = `shape_${id}`;
  const textId = `text_${id}`;
  return [
    { id: shapeId, elementId: `elem_${id}`, type, shapeType, left: x, top: y, width: w, height: h, fill, relationshipMetadata: { attachedTextId: textId } },
    { id: textId, elementId: `elem_${id}`, type: 'text', text, left: x + 10, top: y + 25, width: w - 20, height: 24, relationshipMetadata: { parentShapeId: shapeId } }
  ];
};

const board1Objects = [
  ...makeLinked('proc_hex', 'path', 'hexagon', 'Process', 300, 200, 120, 80, '#dbeafe'),
  ...makeLinked('circle', 'circle', 'circle', 'Circle', 100, 200, 90, 90, '#f1f5f9'),
  ...makeLinked('triangle', 'path', 'triangle', 'Triangle', 700, 200, 100, 90, '#f1f5f9'),
  ...makeLinked('decision', 'path', 'diamond', 'Decision', 550, 200, 100, 90, '#fef3c7'),
  ...makeLinked('blue_sticky', 'note', 'rect', 'New Sticky Note', 300, 350, 160, 160, '#bae6fd'),
  ...makeLinked('important_note', 'note', 'rect', 'Important Note', 550, 350, 160, 160, '#fed7aa'),
  ...makeLinked('testing_phase', 'rect', 'rounded_rect', 'This is a testing phase.', 700, 350, 140, 80, '#000000'),
  ...makeLinked('test_over', 'rect', 'rounded_rect', 'Test will be over', 880, 350, 120, 60, '#000000'),
  { id: 'text_hello_world', type: 'text', text: 'Hello World!', left: 450, top: 520, width: 100, height: 24, rotation: 0 },
  { id: 'line_divider', type: 'path', isSkribeLine: true, isStraightLine: true, left: 950, top: 140, width: 2, height: 500 },
  { id: 'conn_process_important', type: 'path', isConnector: true, connectorType: 'straight', sourceShapeId: 'shape_proc_hex', targetShapeId: 'shape_decision', left: 420, top: 240, width: 130, height: 10, endArrow: true },
  { id: 'conn_curved', type: 'path', isConnector: true, connectorType: 'curved', left: 800, top: 150, width: 120, height: 60, endArrow: true },
  { id: 'conn_elbow', type: 'path', isConnector: true, connectorType: 'elbow', sourceShapeId: 'shape_blue_sticky', left: 420, top: 370, width: 100, height: 40, endArrow: true },
  { id: 'stroke_H', type: 'stroke', isVectorStroke: true, left: 300, top: 450, width: 20, height: 40 },
  { id: 'stroke_e', type: 'stroke', isVectorStroke: true, left: 325, top: 460, width: 15, height: 30 },
  { id: 'stroke_l1', type: 'stroke', isVectorStroke: true, left: 345, top: 450, width: 10, height: 40 },
  { id: 'stroke_l2', type: 'stroke', isVectorStroke: true, left: 360, top: 450, width: 10, height: 40 },
  { id: 'stroke_o', type: 'stroke', isVectorStroke: true, left: 375, top: 460, width: 20, height: 30 },
  { id: 'dot_1', type: 'stroke', isVectorStroke: true, left: 200, top: 80, width: 6, height: 6 },
  { id: 'dot_2', type: 'stroke', isVectorStroke: true, left: 240, top: 80, width: 6, height: 6 },
  { id: 'dot_3', type: 'stroke', isVectorStroke: true, left: 280, top: 80, width: 6, height: 6 },
  { id: 'dot_4', type: 'stroke', isVectorStroke: true, left: 320, top: 80, width: 6, height: 6 }
];

const board1Scene = {
  groups: [
    { id: 'group_testing_shapes', type: 'concept', purpose: 'Testing phase shapes', objectIds: ['shape_testing_phase', 'shape_test_over'] }
  ]
};

const res1 = evaluateBoard('Board 1 — Mixed Real Whiteboard', 'Mixed diagram, sticky notes, standalone text, connectors, freehand drawings', board1Objects, board1Scene);

const board2Objects = [
  ...makeLinked('start', 'rect', 'rounded_rect', 'Start', 80, 200, 100, 60, '#bbf7d0'),
  ...makeLinked('validate', 'rect', 'rect', 'Validate Input', 240, 200, 120, 60, '#e0e7ff'),
  ...makeLinked('decision', 'path', 'diamond', 'Is Valid?', 420, 185, 100, 90, '#fef08a'),
  ...makeLinked('process', 'rect', 'rect', 'Process Data', 580, 120, 120, 60, '#e0e7ff'),
  ...makeLinked('error_handle', 'rect', 'rect', 'Show Error Alert', 580, 280, 130, 60, '#fee2e2'),
  ...makeLinked('end', 'rect', 'rounded_rect', 'End Flow', 760, 120, 100, 60, '#fecaca'),
  { id: 'c1', type: 'path', isConnector: true, connectorType: 'straight', sourceShapeId: 'shape_start', targetShapeId: 'shape_validate', left: 180, top: 230, width: 60, height: 10, endArrow: true },
  { id: 'c2', type: 'path', isConnector: true, connectorType: 'straight', sourceShapeId: 'shape_validate', targetShapeId: 'shape_decision', left: 360, top: 230, width: 60, height: 10, endArrow: true },
  { id: 'c3', type: 'path', isConnector: true, connectorType: 'elbow', sourceShapeId: 'shape_decision', targetShapeId: 'shape_process', left: 520, top: 150, width: 60, height: 50, endArrow: true },
  { id: 'c4', type: 'path', isConnector: true, connectorType: 'elbow', sourceShapeId: 'shape_decision', targetShapeId: 'shape_error_handle', left: 520, top: 250, width: 60, height: 50, endArrow: true },
  { id: 'c5', type: 'path', isConnector: true, connectorType: 'straight', sourceShapeId: 'shape_process', targetShapeId: 'shape_end', left: 700, top: 150, width: 60, height: 10, endArrow: true }
];

const res2 = evaluateBoard('Board 2 — Diagram / Flowchart-Heavy Board', 'Multi-node branching DAG process flow with 6 shapes and 5 explicit connectors', board2Objects);

const board3Objects = [
  ...makeLinked('note_a', 'note', 'rect', 'Idea A: User Auth', 150, 150, 150, 150, '#fef08a'),
  ...makeLinked('note_b', 'note', 'rect', 'Idea B: OAuth Google', 320, 160, 150, 150, '#fef08a'),
  ...makeLinked('note_c', 'note', 'rect', 'Idea C: Passkeys WebAuthn', 160, 320, 150, 150, '#fef08a'),
  ...makeLinked('note_d', 'note', 'rect', 'Idea D: Magic Links', 330, 330, 150, 150, '#fef08a'),
  ...makeLinked('note_isolated', 'note', 'rect', 'Parking Lot: Billing', 850, 500, 160, 160, '#fed7aa'),
  { id: 'doodle_1', type: 'stroke', isVectorStroke: true, left: 550, top: 180, width: 30, height: 30 },
  { id: 'doodle_2', type: 'stroke', isVectorStroke: true, left: 580, top: 180, width: 25, height: 25 },
  { id: 'conn_sketch_arrow', type: 'path', isConnector: true, connectorType: 'curved', sourceShapeId: 'shape_note_b', left: 470, top: 190, width: 70, height: 20, endArrow: true }
];

const board3Scene = {
  groups: [
    { id: 'group_auth_brainstorm', type: 'notes', purpose: 'Brainstorming Authentication', objectIds: ['shape_note_a', 'shape_note_b', 'shape_note_c', 'shape_note_d'] },
    { id: 'group_parking_lot', type: 'notes', purpose: 'Parking lot backlog', objectIds: ['shape_note_isolated'] }
  ]
};

const res3 = evaluateBoard('Board 3 — Sticky-Note Brainstorming Cluster', 'Brainstorming cluster of 4 notes + 1 distant isolated note + doodle sketch', board3Objects, board3Scene);

const board4Objects = [
  { id: 'title_main', type: 'text', text: 'System Architecture Specification v1.0', left: 80, top: 60, width: 400, height: 36, rotation: 0 },
  ...makeLinked('sec1_card', 'rect', 'rect', 'Section 1: Data Pipeline', 80, 130, 300, 100, '#f8fafc'),
  ...makeLinked('sec2_card', 'rect', 'rect', 'Section 2: API Gateway', 80, 250, 300, 100, '#f8fafc'),
  ...makeLinked('sec3_card', 'rect', 'rect', 'Section 3: Storage Engine', 80, 410, 300, 100, '#f8fafc'),
  { id: 'text_tilted_comment', type: 'text', text: 'Review pending by security team', left: 450, top: 160, width: 220, height: 24, rotation: -15 },
  { id: 'text_footer_status', type: 'text', text: 'Status: Approved for Stage 2', left: 450, top: 410, width: 200, height: 24, rotation: 0 },
  { id: 'divider_vert', type: 'path', isSkribeLine: true, isStraightLine: true, left: 410, top: 120, width: 2, height: 400 }
];

const board4Scene = {
  groups: [
    { id: 'group_spec_sections', type: 'concept', purpose: 'Architecture specification sections', objectIds: ['shape_sec1_card', 'shape_sec2_card', 'shape_sec3_card'] }
  ]
};

const res4 = evaluateBoard('Board 4 — Text-Heavy Architecture / Spec Board', 'Structured text headers, cards, tilted review comment, vertical margin divider', board4Objects, board4Scene);

const board5Objects = [
  { id: 'sk_card_top', type: 'stroke', isVectorStroke: true, left: 100, top: 100, width: 200, height: 10 },
  { id: 'sk_card_bottom', type: 'stroke', isVectorStroke: true, left: 100, top: 250, width: 200, height: 10 },
  { id: 'sk_card_left', type: 'stroke', isVectorStroke: true, left: 100, top: 100, width: 10, height: 150 },
  { id: 'sk_card_right', type: 'stroke', isVectorStroke: true, left: 300, top: 100, width: 10, height: 150 },
  { id: 'sk_btn_stroke1', type: 'stroke', isVectorStroke: true, left: 130, top: 180, width: 80, height: 30 },
  { id: 'sk_btn_stroke2', type: 'stroke', isVectorStroke: true, left: 130, top: 180, width: 80, height: 30 },
  { id: 'txt_btn_label', type: 'text', text: 'Submit Button', left: 140, top: 185, width: 60, height: 20, rotation: 0 },
  { id: 'hw_stroke_1', type: 'stroke', isVectorStroke: true, left: 400, top: 120, width: 15, height: 30 },
  { id: 'hw_stroke_2', type: 'stroke', isVectorStroke: true, left: 420, top: 120, width: 15, height: 30 },
  { id: 'hw_stroke_3', type: 'stroke', isVectorStroke: true, left: 440, top: 120, width: 15, height: 30 },
  { id: 'hw_stroke_4', type: 'stroke', isVectorStroke: true, left: 460, top: 120, width: 15, height: 30 },
  { id: 'sk_arrow_1', type: 'stroke', isVectorStroke: true, left: 320, top: 175, width: 60, height: 10 },
  { id: 'conn_unattached_arc', type: 'path', isConnector: true, connectorType: 'curved', left: 330, top: 210, width: 50, height: 40, endArrow: true },
  { id: 'txt_sidebar', type: 'text', text: 'Sidebar Notes', left: 400, top: 200, width: 100, height: 24, rotation: 0 }
];

const res5 = evaluateBoard('Board 5 — Freeform / Sketch-Heavy Board', 'Hand-drawn wireframe strokes, handwritten title strokes, floating arrows, standalone text', board5Objects);

console.log('\n================================================================================');
console.log('PHASE 4F.13.8 — EVALUATION COMPLETED ACROSS ALL 5 BOARDS ✓');
console.log('================================================================================');
