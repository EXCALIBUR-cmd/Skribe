
import { normalizeObject } from '../normalizeObjects.js';
import { detectRelationships } from '../detectRelationships.js';

const HEX_POINTS = [
  { x: 35, y: 0 }, { x: 105, y: 0 }, { x: 140, y: 50 },
  { x: 105, y: 100 }, { x: 35, y: 100 }, { x: 0, y: 50 }
];

const rawFabricObjects = [
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

  { id: 'shape_note', elementId: 'note', type: 'rect', isStickyNote: true, noteColor: '#FEF08A',
    left: 720, top: 100, width: 180, height: 180, attachedTextId: 'text_note' },
  { id: 'text_note', elementId: 'note', type: 'textbox', text: 'New Sticky Note',
    left: 740, top: 120, width: 140, height: 40, parentShapeId: 'shape_note' },

  { id: 'stroke_h1', strokeId: 'h1', type: 'stroke', isVectorStroke: true, left: 120, top: 470, width: 30, height: 40 },
  { id: 'stroke_h2', strokeId: 'h2', type: 'stroke', isVectorStroke: true, left: 155, top: 475, width: 24, height: 34 },
  { id: 'stroke_h3', strokeId: 'h3', type: 'stroke', isVectorStroke: true, left: 184, top: 472, width: 28, height: 38 },

  { id: 'shape_plain', elementId: 'plain', type: 'rect',
    left: 420, top: 470, width: 160, height: 90, fill: '#93C5FD' },
  { id: 'text_inside', type: 'textbox', text: 'Contained note',
    left: 445, top: 505, width: 110, height: 28 },

  { id: 'text_free', type: 'text', text: 'Random floating note',
    left: 720, top: 470, width: 180, height: 28 }
];

const normalizedObjects = detectRelationships(
  rawFabricObjects.map((object, index) => normalizeObject(object, index))
);

export const workspaceModel = {
  version: 1,
  board: { objects: normalizedObjects }
};

export const organizationPlan = {
  version: 2,
  source: { engine: 'nemotron-omni', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning' },
  workspaceType: 'mixed',
  groups: [
    { id: 'g_hex', type: 'concept', objectIds: ['shape_hex'] },
    { id: 'g_tri', type: 'concept', objectIds: ['shape_tri'] },
    { id: 'g_stray_labels', type: 'concept', objectIds: ['text_hex', 'text_tri'] },
    { id: 'g_circle', type: 'concept', objectIds: ['shape_circle', 'text_circle'] },
    { id: 'g_flow', type: 'flowchart', objectIds: ['shape_b1', 'shape_b2', 'conn_1', 'text_b2'] },
    { id: 'g_stray_flow', type: 'concept', objectIds: ['text_b1'] },
    { id: 'g_notes', type: 'notes', objectIds: ['shape_note'] },
    { id: 'g_free', type: 'freeform', objectIds: ['stroke_h1', 'stroke_h2', 'stroke_h3'] },
    { id: 'g_plain', type: 'concept', objectIds: ['shape_plain'] },
    { id: 'g_stray_contained', type: 'concept', objectIds: ['text_inside'] },
    { id: 'g_independent', type: 'concept', objectIds: ['text_free'] }
  ],
  readingOrder: [
    'g_hex', 'g_circle', 'g_tri', 'g_stray_labels', 'g_flow', 'g_stray_flow',
    'g_notes', 'g_free', 'g_plain', 'g_stray_contained', 'g_independent'
  ],
  relationships: [],
  annotations: []
};

export const weldedPairs = [
  ['shape_hex', 'text_hex'],
  ['shape_circle', 'text_circle'],
  ['shape_tri', 'text_tri'],
  ['shape_b1', 'text_b1'],
  ['shape_b2', 'text_b2'],
  ['shape_note', 'text_note'],
  ['shape_plain', 'text_inside']
];

export default { workspaceModel, organizationPlan, weldedPairs };
