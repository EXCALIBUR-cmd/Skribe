/**
 * Faithful regression fixture for the inner-shape / sticky-note text detachment bug.
 *
 * WHY THIS EXISTS (see memory: messcleanup-atomicity-layer / messcleanup-visual-verification):
 * Every hand-written unit-test fixture places a shape and its inner label in the SAME
 * Nemotron group, so the in-group weld always succeeds and the real bug stays hidden.
 * Real boards fail differently: Nemotron returns a `groups` array that SPLITS a shape
 * from its metadata-linked label (or leaves note text ungrouped), and that split reaches
 * reconstruction UNRECONCILED because:
 *   - `validateOrganizationPlan` only re-welds shape<->text inside `document.sections`
 *     (validateOrganizationPlan.js:112-138); the `groups` array is passed through raw
 *     (validateOrganizationPlan.js:228).
 *   - `createNotebookLayoutProposal` prefers `organizationPlan.groups` when present
 *     (notebookLayoutEngine.js:223), so the broken split is exactly what reconstruction sees.
 *
 * This fixture therefore builds the board from RAW Fabric-serialized objects (real
 * `shape_<eid>` / `text_<eid>` ids, top-level `attachedTextId` / `parentShapeId` /
 * `elementId` / `isStickyNote` / `noteColor` / `isVectorStroke`), runs them through the
 * REAL `normalizeObject` + `detectRelationships` (identical to `extractWorkspaceModel`),
 * and pairs them with an `organizationPlan` whose `groups` reproduce the real failure:
 *   - hexagon "Process" and triangle "Triangle" are split from their labels
 *     (labels dumped into a stray text-only group),
 *   - flow box_1's label is split out of the flowchart group,
 *   - the sticky note's text is left UNGROUPED entirely,
 *   - one metadata-less text sits geometrically inside a plain rect (Tier-2 containment),
 *   - one truly independent text sits outside every shape (must stay standalone).
 *
 * Geometry mirrors the user's screenshot board: three labelled shapes across the top,
 * two connected flow boxes, a sticky note, "Hello" handwriting strokes.
 */

import { normalizeObject } from '../normalizeObjects.js';
import { detectRelationships } from '../detectRelationships.js';

// Six vertices for a hexagon so getShapeType() classifies it faithfully (not load-bearing
// for atomicity, but keeps the fixture honest to real polygon serialization).
const HEX_POINTS = [
  { x: 35, y: 0 }, { x: 105, y: 0 }, { x: 140, y: 50 },
  { x: 105, y: 100 }, { x: 35, y: 100 }, { x: 0, y: 50 }
];

// RAW Fabric objects, exactly as they are serialized off the canvas (left/top/width/height/
// angle, top-level relationship + flag fields). These are the true input to normalizeObject.
const rawFabricObjects = [
  // --- Row 1: three labelled shapes (shape + inner text, shared elementId) ---
  { id: 'shape_hex', elementId: 'hex', type: 'polygon', points: HEX_POINTS,
    left: 100, top: 100, width: 140, height: 100, attachedTextId: 'text_hex', fill: '#93C5FD' },
  { id: 'text_hex', elementId: 'hex', type: 'textbox', text: 'Process',
    left: 130, top: 135, width: 80, height: 28, parentShapeId: 'shape_hex' },

  { id: 'shape_circle', elementId: 'circle', type: 'circle',
    left: 320, top: 100, width: 120, height: 120, attachedTextId: 'text_circle', fill: '#93C5FD' },
  { id: 'text_circle', elementId: 'circle', type: 'textbox', text: 'Circle',
    left: 345, top: 150, width: 70, height: 28, parentShapeId: 'shape_circle' },

  { id: 'shape_tri', elementId: 'tri', type: 'triangle',
    left: 520, top: 100, width: 130, height: 110, attachedTextId: 'text_tri', fill: '#93C5FD' },
  { id: 'text_tri', elementId: 'tri', type: 'textbox', text: 'Triangle',
    left: 545, top: 150, width: 80, height: 28, parentShapeId: 'shape_tri' },

  // --- Row 2: two connected flow boxes ---
  { id: 'shape_b1', elementId: 'b1', type: 'rect',
    left: 120, top: 320, width: 150, height: 80, attachedTextId: 'text_b1', fill: '#93C5FD' },
  { id: 'text_b1', elementId: 'b1', type: 'textbox', text: 'This is a testing phase',
    left: 135, top: 345, width: 120, height: 28, parentShapeId: 'shape_b1' },

  { id: 'shape_b2', elementId: 'b2', type: 'rect',
    left: 420, top: 320, width: 150, height: 80, attachedTextId: 'text_b2', fill: '#93C5FD' },
  { id: 'text_b2', elementId: 'b2', type: 'textbox', text: 'Test will be over',
    left: 435, top: 345, width: 120, height: 28, parentShapeId: 'shape_b2' },

  { id: 'conn_1', type: 'connector', isConnector: true, connectorType: 'straight',
    left: 270, top: 355, width: 150, height: 12, sourceShapeId: 'shape_b1', targetShapeId: 'shape_b2' },

  // --- Sticky note: real two-object structure (background rect + separate text) ---
  { id: 'shape_note', elementId: 'note', type: 'rect', isStickyNote: true, noteColor: '#FEF08A',
    left: 720, top: 100, width: 180, height: 180, attachedTextId: 'text_note' },
  { id: 'text_note', elementId: 'note', type: 'textbox', text: 'New Sticky Note',
    left: 740, top: 120, width: 140, height: 40, parentShapeId: 'shape_note' },

  // --- "Hello" handwriting: multi-stroke atomic drawing ---
  { id: 'stroke_h1', strokeId: 'h1', type: 'stroke', isVectorStroke: true, left: 120, top: 470, width: 30, height: 40 },
  { id: 'stroke_h2', strokeId: 'h2', type: 'stroke', isVectorStroke: true, left: 155, top: 475, width: 24, height: 34 },
  { id: 'stroke_h3', strokeId: 'h3', type: 'stroke', isVectorStroke: true, left: 184, top: 472, width: 28, height: 38 },

  // --- Metadata-LESS text geometrically inside a plain rect (exercises Tier-2 containment) ---
  { id: 'shape_plain', elementId: 'plain', type: 'rect',
    left: 420, top: 470, width: 160, height: 90, fill: '#93C5FD' },
  { id: 'text_inside', type: 'textbox', text: 'Contained note',
    left: 445, top: 505, width: 110, height: 28 }, // no parentShapeId, no elementId

  // --- Truly independent standalone text (must remain its own unit, horizontally readable) ---
  { id: 'text_free', type: 'text', text: 'Random floating note',
    left: 720, top: 470, width: 180, height: 28 }
];

// Mirror extractWorkspaceModel exactly: normalizeObject(object, index) then detectRelationships.
const normalizedObjects = detectRelationships(
  rawFabricObjects.map((object, index) => normalizeObject(object, index))
);

export const workspaceModel = {
  version: 1,
  board: { objects: normalizedObjects }
};

/**
 * OrganizationPlan as Nemotron really returns it: a `groups` array (consumed directly by
 * the layout engine, bypassing section reconciliation). The groups SPLIT shapes from their
 * labels and leave the sticky-note text ungrouped — the true production failure.
 */
export const organizationPlan = {
  version: 2,
  source: { engine: 'nemotron-omni', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning' },
  workspaceType: 'mixed',
  groups: [
    // Hexagon split from its "Process" label:
    { id: 'g_hex', type: 'concept', objectIds: ['shape_hex'] },
    // Triangle split from its "Triangle" label:
    { id: 'g_tri', type: 'concept', objectIds: ['shape_tri'] },
    // Both stray labels dumped together into a text-only group (no shape to weld to here):
    { id: 'g_stray_labels', type: 'concept', objectIds: ['text_hex', 'text_tri'] },
    // Circle kept WITH its label — co-located control that must still weld:
    { id: 'g_circle', type: 'concept', objectIds: ['shape_circle', 'text_circle'] },
    // Flowchart with box_1's label split out (text_b1 missing here):
    { id: 'g_flow', type: 'flowchart', objectIds: ['shape_b1', 'shape_b2', 'conn_1', 'text_b2'] },
    { id: 'g_stray_flow', type: 'concept', objectIds: ['text_b1'] },
    // Sticky note background only; text_note is intentionally left UNGROUPED (see below):
    { id: 'g_notes', type: 'notes', objectIds: ['shape_note'] },
    // Handwriting strokes:
    { id: 'g_free', type: 'freeform', objectIds: ['stroke_h1', 'stroke_h2', 'stroke_h3'] },
    // Plain shape; its contained text is split into a stray group (only Tier-2 containment can weld):
    { id: 'g_plain', type: 'concept', objectIds: ['shape_plain'] },
    { id: 'g_stray_contained', type: 'concept', objectIds: ['text_inside'] },
    // Truly independent text:
    { id: 'g_independent', type: 'concept', objectIds: ['text_free'] }
  ],
  readingOrder: [
    'g_hex', 'g_circle', 'g_tri', 'g_stray_labels', 'g_flow', 'g_stray_flow',
    'g_notes', 'g_free', 'g_plain', 'g_stray_contained', 'g_independent'
  ],
  relationships: [],
  annotations: []
};

// Convenience map of the shape<->label pairs this fixture asserts must stay welded.
export const weldedPairs = [
  ['shape_hex', 'text_hex'],
  ['shape_circle', 'text_circle'],
  ['shape_tri', 'text_tri'],
  ['shape_b1', 'text_b1'],
  ['shape_b2', 'text_b2'],
  ['shape_note', 'text_note'],
  ['shape_plain', 'text_inside'] // welded by geometric containment (Tier 2), no metadata link
];

export default { workspaceModel, organizationPlan, weldedPairs };
