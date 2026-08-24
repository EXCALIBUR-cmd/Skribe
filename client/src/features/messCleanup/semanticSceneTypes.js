/**
 * SemanticScene — Type Registry & Controlled Vocabulary
 *
 * Phase 4F.10 Step 2: Pure semantic intermediate representation.
 * Represents what the user drew and how objects relate without ANY physical layout geometry.
 */

/** Valid workspace-level semantic classifications */
export const SEMANTIC_WORKSPACE_TYPES = Object.freeze({
  MIXED: 'mixed',
  DIAGRAM: 'diagram',
  FLOWCHART: 'flowchart',
  NOTES: 'notes',
  DOCUMENT: 'document',
  FREEFORM: 'freeform'
});

/** Valid semantic group types */
export const SEMANTIC_GROUP_TYPES = Object.freeze({
  FLOWCHART: 'flowchart',
  DIAGRAM: 'diagram',
  NOTES: 'notes',
  CONCEPT: 'concept',
  FREEFORM: 'freeform',
  ANNOTATED_DIAGRAM: 'annotated-diagram'
});

/** Object-level semantic roles */
export const SEMANTIC_OBJECT_ROLES = Object.freeze({
  TITLE: 'title',
  HEADING: 'heading',
  SUBHEADING: 'subheading',
  BODY: 'body',
  LABEL: 'label',
  DIAGRAM_NODE: 'diagram-node',
  DIAGRAM_LABEL: 'diagram-label',
  STICKY_NOTE: 'sticky-note',
  ANNOTATION: 'annotation',
  CONNECTOR: 'connector',
  FREEFORM_STROKE: 'freeform-stroke',
  IMAGE: 'image',
  UNKNOWN: 'unknown'
});

/** Controlled relationship vocabulary */
export const SEMANTIC_RELATIONSHIP_TYPES = Object.freeze({
  HEADING_BODY: 'heading-body',
  DIAGRAM_TITLE: 'diagram-title',
  NOTES_HEADING: 'notes-heading',
  ANNOTATION_TARGET: 'annotation-target',
  CONNECTS_TO: 'connects-to',
  ATTACHED_TEXT: 'attached-text',
  CONCEPT_EXPLANATION: 'concept-explanation',
  PARENT_CHILD: 'parent-child',
  NOTE_GROUP: 'note-group',
  LABEL_OF: 'label-of',
  RELATED_CONTENT: 'related-content'
});

/** Controlled vocabulary normalization mapping */
export const RELATIONSHIP_VOCABULARY_MAP = Object.freeze({
  'heading-body': SEMANTIC_RELATIONSHIP_TYPES.HEADING_BODY,
  'heading_body': SEMANTIC_RELATIONSHIP_TYPES.HEADING_BODY,
  'heading_to_body': SEMANTIC_RELATIONSHIP_TYPES.HEADING_BODY,
  'diagram-title': SEMANTIC_RELATIONSHIP_TYPES.DIAGRAM_TITLE,
  'diagram_title': SEMANTIC_RELATIONSHIP_TYPES.DIAGRAM_TITLE,
  'notes-heading': SEMANTIC_RELATIONSHIP_TYPES.NOTES_HEADING,
  'notes_heading': SEMANTIC_RELATIONSHIP_TYPES.NOTES_HEADING,
  'annotation-target': SEMANTIC_RELATIONSHIP_TYPES.ANNOTATION_TARGET,
  'annotation_target': SEMANTIC_RELATIONSHIP_TYPES.ANNOTATION_TARGET,
  'freehand-annotation': SEMANTIC_RELATIONSHIP_TYPES.ANNOTATION_TARGET,
  'connects-to': SEMANTIC_RELATIONSHIP_TYPES.CONNECTS_TO,
  'connects_to': SEMANTIC_RELATIONSHIP_TYPES.CONNECTS_TO,
  'connects_from': SEMANTIC_RELATIONSHIP_TYPES.CONNECTS_TO,
  'connected_to': SEMANTIC_RELATIONSHIP_TYPES.CONNECTS_TO,
  'attached-text': SEMANTIC_RELATIONSHIP_TYPES.ATTACHED_TEXT,
  'attached_text': SEMANTIC_RELATIONSHIP_TYPES.ATTACHED_TEXT,
  'contains_text': SEMANTIC_RELATIONSHIP_TYPES.ATTACHED_TEXT,
  'contained_by': SEMANTIC_RELATIONSHIP_TYPES.ATTACHED_TEXT,
  'concept-explanation': SEMANTIC_RELATIONSHIP_TYPES.CONCEPT_EXPLANATION,
  'concept_explanation': SEMANTIC_RELATIONSHIP_TYPES.CONCEPT_EXPLANATION,
  'parent-child': SEMANTIC_RELATIONSHIP_TYPES.PARENT_CHILD,
  'parent_child': SEMANTIC_RELATIONSHIP_TYPES.PARENT_CHILD,
  'note-group': SEMANTIC_RELATIONSHIP_TYPES.NOTE_GROUP,
  'note_group': SEMANTIC_RELATIONSHIP_TYPES.NOTE_GROUP,
  'label-of': SEMANTIC_RELATIONSHIP_TYPES.LABEL_OF,
  'label_of': SEMANTIC_RELATIONSHIP_TYPES.LABEL_OF,
  'related-content': SEMANTIC_RELATIONSHIP_TYPES.RELATED_CONTENT,
  'related_content': SEMANTIC_RELATIONSHIP_TYPES.RELATED_CONTENT
});
