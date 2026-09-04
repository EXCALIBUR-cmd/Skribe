
export const WORKSPACE_TYPES = Object.freeze({
  DOCUMENT: 'document',
  DIAGRAM: 'diagram',
  NOTES: 'notes',
  MIXED: 'mixed',
  FREEFORM: 'freeform',
  FLOWCHART: 'flowchart',
  MINDMAP: 'mindmap',
  ARCHITECTURE: 'architecture',
  LECTURE_NOTES: 'lecture_notes',
  BRAINSTORM: 'brainstorm'
});

export const SECTION_TYPES = Object.freeze({
  CONTENT: 'content',
  DIAGRAM: 'diagram',
  NOTES: 'notes',
  HEADING: 'heading',
  TEXT: 'text',
  MIXED: 'mixed',
  FREEFORM: 'freeform',
  UNASSIGNED: 'unassigned'
});

export const TEXT_ROLES = Object.freeze({
  TITLE: 'title',
  HEADING: 'heading',
  SUBHEADING: 'subheading',
  BODY: 'body',
  LABEL: 'label',
  CAPTION: 'caption',
  METADATA: 'metadata',
  ANNOTATION: 'annotation'
});

export const SEMANTIC_ROLES = Object.freeze({
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
  FREEFORM: 'freeform',
  IMAGE: 'image',
  UNKNOWN: 'unknown'
});

export const EVIDENCE_STRENGTH = Object.freeze({
  STRONG: 'strong',
  MEDIUM: 'medium',
  WEAK: 'weak'
});

export const LAYOUT_HINTS = Object.freeze({
  VERTICAL_FLOW: 'vertical-flow',
  GRID: 'grid',
  HORIZONTAL_FLOW: 'horizontal-flow',
  FREEFORM: 'freeform',
  FLOW: 'flow',
  NOTES: 'notes',
  MIXED: 'mixed'
});

export const RELATIONSHIP_TYPES = Object.freeze({
  HEADING_BODY: 'heading-body',
  DIAGRAM_TITLE: 'diagram-title',
  NOTES_HEADING: 'notes-heading',
  ANNOTATION_TARGET: 'annotation-target',
  CONTAINS_TEXT: 'contains_text',
  CONNECTS_TO: 'connects_to',
  CONTAINS_CONTENT: 'contains-content',
  PARENT_CHILD: 'parent-child',
  CONNECTOR_LINK: 'connector-link',
  NOTE_GROUP: 'note-group',
  LABEL_OF: 'label-of',
  RELATED_CONTENT: 'related-content'
});

export const ANNOTATION_TYPES = Object.freeze({
  ANNOTATION: 'annotation',
  FREEHAND_ANNOTATION: 'freehand-annotation',
  HIGHLIGHT: 'highlight',
  CALLOUT: 'callout'
});
