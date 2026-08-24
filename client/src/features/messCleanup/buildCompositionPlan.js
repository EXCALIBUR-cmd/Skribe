/**
 * CompositionPlan Builder
 *
 * Phase 4F.10 Step 3: Converts a SemanticScene into a CompositionPlan.
 *
 * RULES:
 * - SemanticScene answers: "What belongs together?"
 * - CompositionPlan answers: "How should those semantic groups be composed as an organized notebook page?"
 * - Layout engine will answer: "Where exactly should each object go?"
 * - CompositionPlan MUST NOT contain any physical coordinates (x, y, width, height, margins, offsets).
 * - Preserves exact object identity and explicit relationships.
 * - Produces deterministic output given identical inputs.
 * - Input models remain strictly immutable.
 */

import {
  COMPOSITION_ROLES,
  COMPOSITION_STRATEGIES,
  CANVAS_ORIENTATIONS,
  CANVAS_STYLES
} from './compositionPlanTypes.js';
import {
  SEMANTIC_GROUP_TYPES,
  SEMANTIC_OBJECT_ROLES
} from './semanticSceneTypes.js';

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a || '').localeCompare(String(b || '')));

const FORBIDDEN_COORDINATE_KEYS = new Set([
  'x', 'y', 'left', 'top', 'width', 'height', 'margin', 'gap',
  'row', 'column', 'canvasWidth', 'canvasHeight', 'placement',
  'layoutCoordinates', 'bounds', 'position'
]);

const determineStrategyAndRole = (group, objectMap) => {
  const type = group?.type;
  const objectIds = group?.objectIds || [];
  const objects = objectIds.map((id) => objectMap.get(id)).filter(Boolean);

  // If a group consists purely of text objects, classify as text-block
  const allText = objects.length > 0 && objects.every((o) => o.type === 'text' && !o.relationshipMetadata?.parentShapeId);
  if (allText && type !== SEMANTIC_GROUP_TYPES.NOTES) {
    return { role: COMPOSITION_ROLES.TEXT, strategy: COMPOSITION_STRATEGIES.TEXT_BLOCK };
  }

  if (type === SEMANTIC_GROUP_TYPES.FLOWCHART) {
    return { role: COMPOSITION_ROLES.FLOWCHART, strategy: COMPOSITION_STRATEGIES.FLOWCHART };
  }

  if (type === SEMANTIC_GROUP_TYPES.DIAGRAM) {
    return { role: COMPOSITION_ROLES.DIAGRAM, strategy: COMPOSITION_STRATEGIES.DIAGRAM_EXPLANATION };
  }

  if (type === SEMANTIC_GROUP_TYPES.NOTES) {
    return { role: COMPOSITION_ROLES.NOTES, strategy: COMPOSITION_STRATEGIES.NOTE_GRID };
  }

  if (type === SEMANTIC_GROUP_TYPES.FREEFORM) {
    return { role: COMPOSITION_ROLES.FREEFORM, strategy: COMPOSITION_STRATEGIES.FREEFORM_GROUP };
  }

  if (type === SEMANTIC_GROUP_TYPES.ANNOTATED_DIAGRAM) {
    return { role: COMPOSITION_ROLES.ANNOTATION, strategy: COMPOSITION_STRATEGIES.ANNOTATED_TARGET };
  }

  return { role: COMPOSITION_ROLES.CONCEPT, strategy: COMPOSITION_STRATEGIES.NOTEBOOK_STACK };
};

/**
 * Validates that a CompositionPlan has no forbidden coordinate properties.
 */
export const validateCompositionPlan = (plan, workspaceModel = null) => {
  const errors = [];

  if (!plan || typeof plan !== 'object') {
    return { valid: false, errors: ['CompositionPlan must be a non-null object'] };
  }

  if (plan.version !== 1) {
    errors.push(`Invalid version: expected 1, got ${plan.version}`);
  }

  const modelObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const validObjectIds = new Set(modelObjects.map((o) => o?.id).filter(Boolean));
  const hasWorkspaceModel = validObjectIds.size > 0;

  if (!Array.isArray(plan.blocks)) {
    errors.push('blocks must be an array');
  } else {
    const blockIds = new Set();
    const validRoles = new Set(Object.values(COMPOSITION_ROLES));
    const validStrategies = new Set(Object.values(COMPOSITION_STRATEGIES));

    plan.blocks.forEach((block, idx) => {
      if (!block || typeof block !== 'object') {
        errors.push(`blocks[${idx}] must be an object`);
        return;
      }
      if (!block.id || typeof block.id !== 'string') {
        errors.push(`blocks[${idx}].id must be a non-empty string`);
      } else {
        if (blockIds.has(block.id)) {
          errors.push(`Duplicate block id: "${block.id}"`);
        }
        blockIds.add(block.id);
      }
      if (!validRoles.has(block.role)) {
        errors.push(`blocks[${idx}].role "${block.role}" is invalid`);
      }
      if (!validStrategies.has(block.strategy)) {
        errors.push(`blocks[${idx}].strategy "${block.strategy}" is invalid`);
      }
      if (!Array.isArray(block.objectIds)) {
        errors.push(`blocks[${idx}].objectIds must be an array`);
      } else if (hasWorkspaceModel) {
        block.objectIds.forEach((oid) => {
          if (!validObjectIds.has(oid)) {
            errors.push(`blocks[${idx}].objectIds contains unknown ID "${oid}"`);
          }
        });
      }
    });
  }

  // Strict check: No physical coordinates anywhere in the CompositionPlan
  const checkForCoordinates = (obj, path = '') => {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach((key) => {
      if (FORBIDDEN_COORDINATE_KEYS.has(key)) {
        errors.push(`Forbidden physical coordinate field "${path ? path + '.' : ''}${key}" found in CompositionPlan`);
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        checkForCoordinates(obj[key], `${path ? path + '.' : ''}${key}`);
      }
    });
  };
  checkForCoordinates(plan);

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Builds a deterministic CompositionPlan from a validated SemanticScene and WorkspaceModel.
 *
 * @param {object} semanticScene - The source SemanticScene
 * @param {object} workspaceModel - The source WorkspaceModel
 * @returns {object} Deterministic CompositionPlan
 */
export const buildCompositionPlan = (semanticScene, workspaceModel) => {
  if (!semanticScene || typeof semanticScene !== 'object') {
    throw new Error('Invalid or missing SemanticScene input');
  }
  if (!workspaceModel || typeof workspaceModel !== 'object') {
    throw new Error('Invalid or missing WorkspaceModel input');
  }

  const modelObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const validObjectIds = new Set(modelObjects.map((o) => o?.id).filter(Boolean));
  const objectMap = new Map(modelObjects.filter((o) => o?.id).map((o) => [o.id, o]));

  const assignedObjectIds = new Set();
  const rawGroups = Array.isArray(semanticScene.groups) ? semanticScene.groups : [];

  // Determine reading order map for order assignment
  const readingOrderIndices = new Map();
  (semanticScene.readingOrder || []).forEach((id, idx) => {
    readingOrderIndices.set(id, idx + 1);
  });

  // Extract document title
  const rootTitleId = semanticScene.hierarchy?.rootTitleObjectId && validObjectIds.has(semanticScene.hierarchy.rootTitleObjectId)
    ? semanticScene.hierarchy.rootTitleObjectId
    : null;

  const title = {
    objectId: rootTitleId,
    role: 'document-title'
  };

  // Convert SemanticScene groups into CompositionBlocks
  const blocks = [];
  const blockIdMap = new Map();

  rawGroups.forEach((group, idx) => {
    if (!group || typeof group !== 'object') return;

    const groupObjectIds = Array.isArray(group.objectIds)
      ? group.objectIds.map(String).filter((id) => validObjectIds.has(id))
      : [];

    if (groupObjectIds.length === 0) return;

    const { role, strategy } = determineStrategyAndRole(group, objectMap);
    const blockId = group.id ? `block_${group.id}` : `block_${idx + 1}`;
    const order = readingOrderIndices.get(group.id) ?? (idx + 1);

    const sortedObjectIds = sortIds(groupObjectIds);
    sortedObjectIds.forEach((id) => assignedObjectIds.add(id));

    // Collect relationships that are internal to this block
    const blockObjectSet = new Set(sortedObjectIds);
    const blockRelationships = (semanticScene.relationships || []).filter((rel) =>
      blockObjectSet.has(rel.sourceObjectId) &&
      (rel.targetObjectIds || []).every((tid) => blockObjectSet.has(tid))
    );

    const block = {
      id: blockId,
      role,
      strategy,
      order,
      objectIds: sortedObjectIds,
      parentBlockId: null,
      titleObjectId: group.titleObjectId && validObjectIds.has(group.titleObjectId) ? group.titleObjectId : null,
      relationships: blockRelationships
    };

    blocks.push(block);
    blockIdMap.set(group.id, blockId);
  });

  // Check for any unassigned valid WorkspaceModel objects
  const unassignedObjectIds = [...validObjectIds].filter((id) => !assignedObjectIds.has(id) && id !== rootTitleId);
  if (unassignedObjectIds.length > 0) {
    const unassignedText = unassignedObjectIds.filter((id) => objectMap.get(id)?.type === 'text');
    const unassignedNotes = unassignedObjectIds.filter((id) => objectMap.get(id)?.type === 'note' || objectMap.get(id)?.metadata?.isStickyNote);
    const unassignedStrokes = unassignedObjectIds.filter((id) => objectMap.get(id)?.type === 'stroke');
    const unassignedOther = unassignedObjectIds.filter((id) =>
      !unassignedText.includes(id) && !unassignedNotes.includes(id) && !unassignedStrokes.includes(id)
    );

    let nextOrder = blocks.length + 1;

    if (unassignedText.length > 0) {
      unassignedText.forEach((txtId) => {
        blocks.push({
          id: `block_text_${txtId}`,
          role: COMPOSITION_ROLES.TEXT,
          strategy: COMPOSITION_STRATEGIES.TEXT_BLOCK,
          order: nextOrder++,
          objectIds: [txtId],
          parentBlockId: null,
          titleObjectId: null,
          relationships: []
        });
        assignedObjectIds.add(txtId);
      });
    }

    if (unassignedNotes.length > 0) {
      blocks.push({
        id: `block_notes_unassigned`,
        role: COMPOSITION_ROLES.NOTES,
        strategy: COMPOSITION_STRATEGIES.NOTE_GRID,
        order: nextOrder++,
        objectIds: sortIds(unassignedNotes),
        parentBlockId: null,
        titleObjectId: null,
        relationships: []
      });
      unassignedNotes.forEach((id) => assignedObjectIds.add(id));
    }

    if (unassignedStrokes.length > 0) {
      blocks.push({
        id: `block_freeform_unassigned`,
        role: COMPOSITION_ROLES.FREEFORM,
        strategy: COMPOSITION_STRATEGIES.FREEFORM_GROUP,
        order: nextOrder++,
        objectIds: sortIds(unassignedStrokes),
        parentBlockId: null,
        titleObjectId: null,
        relationships: []
      });
      unassignedStrokes.forEach((id) => assignedObjectIds.add(id));
    }

    if (unassignedOther.length > 0) {
      blocks.push({
        id: `block_concept_unassigned`,
        role: COMPOSITION_ROLES.CONCEPT,
        strategy: COMPOSITION_STRATEGIES.NOTEBOOK_STACK,
        order: nextOrder++,
        objectIds: sortIds(unassignedOther),
        parentBlockId: null,
        titleObjectId: null,
        relationships: []
      });
      unassignedOther.forEach((id) => assignedObjectIds.add(id));
    }
  }

  // Sort blocks deterministically by order, then by id
  blocks.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  // Determine top-level reading order of blocks
  const readingOrder = blocks.map((b) => b.id);

  // Collect global relationships
  const globalRelationships = (semanticScene.relationships || []).filter((rel) =>
    validObjectIds.has(rel.sourceObjectId) &&
    (rel.targetObjectIds || []).every((tid) => validObjectIds.has(tid))
  );

  // Collect global annotations
  const globalAnnotations = (semanticScene.annotations || []).filter((ann) =>
    validObjectIds.has(ann.objectId) &&
    (ann.targetObjectIds || []).every((tid) => validObjectIds.has(tid))
  );

  // Strategy count diagnostics
  const strategyCounts = {};
  blocks.forEach((b) => {
    strategyCounts[b.strategy] = (strategyCounts[b.strategy] || 0) + 1;
  });

  // Calculate unresolved objects and relationships
  const remainingUnresolvedObjects = [...validObjectIds].filter((id) => !assignedObjectIds.has(id) && id !== rootTitleId);
  const unresolvedRelationships = (semanticScene.relationships || []).filter((rel) =>
    !validObjectIds.has(rel.sourceObjectId) ||
    !(rel.targetObjectIds || []).every((tid) => validObjectIds.has(tid))
  );

  const canvasOrientation = semanticScene.workspaceType === 'document'
    ? CANVAS_ORIENTATIONS.PORTRAIT
    : CANVAS_ORIENTATIONS.ADAPTIVE;

  const plan = {
    version: 1,
    canvas: {
      orientation: canvasOrientation,
      style: CANVAS_STYLES.NOTEBOOK
    },
    title,
    blocks,
    relationships: globalRelationships,
    annotations: globalAnnotations,
    readingOrder,
    diagnostics: {
      blockCount: blocks.length,
      strategyCounts,
      unresolvedObjectIds: remainingUnresolvedObjects,
      unresolvedRelationships
    }
  };

  return plan;
};

export default {
  validateCompositionPlan,
  buildCompositionPlan
};
