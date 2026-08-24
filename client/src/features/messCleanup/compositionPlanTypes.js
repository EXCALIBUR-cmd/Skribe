/**
 * CompositionPlan — Type Registry & Constants
 *
 * Phase 4F.10 Step 3: Describes the intended visual composition of the board
 * as a clean notebook page without any physical pixel coordinates.
 */

/** Valid composition block roles */
export const COMPOSITION_ROLES = Object.freeze({
  CONCEPT: 'concept',
  FLOWCHART: 'flowchart',
  DIAGRAM: 'diagram',
  NOTES: 'notes',
  EXPLANATION: 'explanation',
  FREEFORM: 'freeform',
  ANNOTATION: 'annotation',
  TEXT: 'text'
});

/** Valid composition layout strategies */
export const COMPOSITION_STRATEGIES = Object.freeze({
  NOTEBOOK_STACK: 'notebook-stack',
  FLOWCHART: 'flowchart',
  DIAGRAM_EXPLANATION: 'diagram-explanation',
  NOTE_GRID: 'note-grid',
  FREEFORM_GROUP: 'freeform-group',
  ANNOTATED_TARGET: 'annotated-target',
  TEXT_BLOCK: 'text-block'
});

/** Valid canvas orientation hints */
export const CANVAS_ORIENTATIONS = Object.freeze({
  ADAPTIVE: 'adaptive',
  PORTRAIT: 'portrait',
  LANDSCAPE: 'landscape'
});

/** Valid canvas styles */
export const CANVAS_STYLES = Object.freeze({
  NOTEBOOK: 'notebook',
  WHITEBOARD: 'whiteboard'
});
