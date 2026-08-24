/**
 * SemanticScene Adapter
 *
 * Phase 4F.10 Step 2: Adapts raw Nemotron Omni responses and WorkspaceModel
 * into the clean SemanticScene intermediate representation.
 *
 * RULES:
 * - Nemotron determines semantic meaning and relationships.
 * - Skribe layout engine determines physical coordinates.
 * - SemanticScene MUST NOT contain any physical layout geometry (x, y, width, height, etc.).
 * - Explicit Fabric relationships have Priority 1 over AI inference.
 * - Unknown object IDs are rejected / filtered safely without inventing new objects.
 * - Immutable treatment of inputs. Output is strictly JSON-serializable and deterministic.
 */

import {
  SEMANTIC_WORKSPACE_TYPES,
  SEMANTIC_GROUP_TYPES,
  SEMANTIC_OBJECT_ROLES,
  SEMANTIC_RELATIONSHIP_TYPES,
  RELATIONSHIP_VOCABULARY_MAP
} from './semanticSceneTypes.js';

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a || '').localeCompare(String(b || '')));

const FORBIDDEN_COORDINATE_KEYS = new Set([
  'x', 'y', 'left', 'top', 'width', 'height', 'margin', 'gap',
  'row', 'column', 'canvasWidth', 'canvasHeight', 'placement',
  'layoutCoordinates', 'bounds', 'position'
]);

/**
 * Validates a SemanticScene object against the schema and workspaceModel.
 *
 * @param {object} scene - The SemanticScene object to validate
 * @param {object} workspaceModel - The WorkspaceModel source of truth for object IDs
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateSemanticScene = (scene, workspaceModel = null) => {
  const errors = [];

  if (!scene || typeof scene !== 'object') {
    return { valid: false, errors: ['SemanticScene must be a non-null object'] };
  }

  if (scene.version !== 1) {
    errors.push(`Invalid version: expected 1, got ${scene.version}`);
  }

  const validWorkspaceTypes = new Set(Object.values(SEMANTIC_WORKSPACE_TYPES));
  if (!validWorkspaceTypes.has(scene.workspaceType)) {
    errors.push(`Invalid workspaceType: "${scene.workspaceType}"`);
  }

  const modelObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const validObjectIds = new Set(modelObjects.map((o) => o?.id).filter(Boolean));
  const hasWorkspaceModel = validObjectIds.size > 0;

  // Validate objects array
  if (!Array.isArray(scene.objects)) {
    errors.push('objects must be an array');
  } else {
    const validRoles = new Set(Object.values(SEMANTIC_OBJECT_ROLES));
    scene.objects.forEach((obj, idx) => {
      if (!obj || typeof obj !== 'object') {
        errors.push(`objects[${idx}] must be an object`);
        return;
      }
      if (!obj.objectId || typeof obj.objectId !== 'string') {
        errors.push(`objects[${idx}].objectId must be a non-empty string`);
      } else if (hasWorkspaceModel && !validObjectIds.has(obj.objectId)) {
        errors.push(`objects[${idx}].objectId "${obj.objectId}" does not exist in WorkspaceModel`);
      }
      if (!validRoles.has(obj.semanticRole)) {
        errors.push(`objects[${idx}].semanticRole "${obj.semanticRole}" is invalid`);
      }
    });
  }

  // Validate groups array
  const groupIds = new Set();
  const validGroupTypes = new Set(Object.values(SEMANTIC_GROUP_TYPES));
  if (!Array.isArray(scene.groups)) {
    errors.push('groups must be an array');
  } else {
    scene.groups.forEach((grp, idx) => {
      if (!grp || typeof grp !== 'object') {
        errors.push(`groups[${idx}] must be an object`);
        return;
      }
      if (!grp.id || typeof grp.id !== 'string') {
        errors.push(`groups[${idx}].id must be a non-empty string`);
      } else {
        if (groupIds.has(grp.id)) {
          errors.push(`Duplicate group id: "${grp.id}"`);
        }
        groupIds.add(grp.id);
      }
      if (!validGroupTypes.has(grp.type)) {
        errors.push(`groups[${idx}].type "${grp.type}" is invalid`);
      }
      if (!Array.isArray(grp.objectIds)) {
        errors.push(`groups[${idx}].objectIds must be an array`);
      } else if (hasWorkspaceModel) {
        grp.objectIds.forEach((oid) => {
          if (!validObjectIds.has(oid)) {
            errors.push(`groups[${idx}].objectIds contains unknown ID "${oid}"`);
          }
        });
      }
    });
  }

  // Validate relationships array
  const validRelTypes = new Set(Object.values(SEMANTIC_RELATIONSHIP_TYPES));
  if (!Array.isArray(scene.relationships)) {
    errors.push('relationships must be an array');
  } else {
    scene.relationships.forEach((rel, idx) => {
      if (!rel || typeof rel !== 'object') {
        errors.push(`relationships[${idx}] must be an object`);
        return;
      }
      if (hasWorkspaceModel && !validObjectIds.has(rel.sourceObjectId)) {
        errors.push(`relationships[${idx}].sourceObjectId "${rel.sourceObjectId}" does not exist in WorkspaceModel`);
      }
      if (Array.isArray(rel.targetObjectIds)) {
        rel.targetObjectIds.forEach((tid) => {
          if (hasWorkspaceModel && !validObjectIds.has(tid)) {
            errors.push(`relationships[${idx}].targetObjectIds contains unknown ID "${tid}"`);
          }
        });
      }
      if (!validRelTypes.has(rel.type)) {
        errors.push(`relationships[${idx}].type "${rel.type}" is invalid`);
      }
    });
  }

  // Validate annotations array
  if (!Array.isArray(scene.annotations)) {
    errors.push('annotations must be an array');
  } else {
    scene.annotations.forEach((ann, idx) => {
      if (!ann || typeof ann !== 'object') {
        errors.push(`annotations[${idx}] must be an object`);
        return;
      }
      if (hasWorkspaceModel && !validObjectIds.has(ann.objectId)) {
        errors.push(`annotations[${idx}].objectId "${ann.objectId}" does not exist in WorkspaceModel`);
      }
      if (Array.isArray(ann.targetObjectIds)) {
        ann.targetObjectIds.forEach((tid) => {
          if (hasWorkspaceModel && !validObjectIds.has(tid)) {
            errors.push(`annotations[${idx}].targetObjectIds contains unknown ID "${tid}"`);
          }
        });
      }
    });
  }

  // Validate readingOrder
  if (!Array.isArray(scene.readingOrder)) {
    errors.push('readingOrder must be an array');
  }

  // Validate hierarchy
  if (!scene.hierarchy || typeof scene.hierarchy !== 'object') {
    errors.push('hierarchy must be an object');
  }

  // Strict check: No physical coordinates anywhere in the scene
  const checkForCoordinates = (obj, path = '') => {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach((key) => {
      if (FORBIDDEN_COORDINATE_KEYS.has(key)) {
        errors.push(`Forbidden physical coordinate field "${path ? path + '.' : ''}${key}" found in SemanticScene`);
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        checkForCoordinates(obj[key], `${path ? path + '.' : ''}${key}`);
      }
    });
  };
  checkForCoordinates(scene);

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Infers initial semantic role from WorkspaceModel object properties.
 */
const inferObjectRole = (object) => {
  if (!object) return SEMANTIC_OBJECT_ROLES.UNKNOWN;
  if (object.type === 'connector') return SEMANTIC_OBJECT_ROLES.CONNECTOR;
  if (object.type === 'stroke') return SEMANTIC_OBJECT_ROLES.FREEFORM_STROKE;
  if (object.type === 'note' || object.metadata?.isStickyNote) return SEMANTIC_OBJECT_ROLES.STICKY_NOTE;
  if (object.type === 'image') return SEMANTIC_OBJECT_ROLES.IMAGE;
  if (object.type === 'shape') return SEMANTIC_OBJECT_ROLES.DIAGRAM_NODE;
  if (object.type === 'text') {
    if (object.relationshipMetadata?.parentShapeId) return SEMANTIC_OBJECT_ROLES.LABEL;
    if (object.metadata?.isHeading || object.style?.fontSize >= 24) return SEMANTIC_OBJECT_ROLES.HEADING;
    return SEMANTIC_OBJECT_ROLES.BODY;
  }
  return SEMANTIC_OBJECT_ROLES.UNKNOWN;
};

/**
 * Normalizes a raw relationship type string via the vocabulary map.
 */
export const normalizeRelationshipType = (rawType) => {
  if (typeof rawType !== 'string') return null;
  const key = rawType.trim().toLowerCase();
  return RELATIONSHIP_VOCABULARY_MAP[key] || null;
};

/**
 * Builds a validated, normalized SemanticScene from WorkspaceModel and raw Nemotron output.
 *
 * @param {object} workspaceModel - Source of truth for objects and explicit Fabric metadata
 * @param {object} rawPlan - Raw JSON from Nemotron Omni or legacy formats
 * @returns {object} Normalized SemanticScene
 */
export const buildSemanticScene = (workspaceModel, rawPlan = {}) => {
  const modelObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const validObjectIds = new Set(modelObjects.map((o) => o?.id).filter(Boolean));
  const objectMap = new Map(modelObjects.filter((o) => o?.id).map((o) => [o.id, o]));

  // 1. Collect explicit Fabric relationships (Priority 1)
  const explicitRelationships = [];
  const linkedShapeToText = new Map();
  const linkedTextToShape = new Map();

  modelObjects.forEach((object) => {
    if (!object || !object.id) return;

    const attachedTextId = object.relationshipMetadata?.attachedTextId;
    if (attachedTextId && validObjectIds.has(attachedTextId)) {
      linkedShapeToText.set(object.id, attachedTextId);
      linkedTextToShape.set(attachedTextId, object.id);
      explicitRelationships.push({
        sourceObjectId: object.id,
        targetObjectIds: [attachedTextId],
        type: SEMANTIC_RELATIONSHIP_TYPES.ATTACHED_TEXT,
        confidence: 1.0,
        evidence: ['Fabric relationshipMetadata.attachedTextId']
      });
    }

    const parentShapeId = object.relationshipMetadata?.parentShapeId;
    if (parentShapeId && validObjectIds.has(parentShapeId)) {
      linkedTextToShape.set(object.id, parentShapeId);
      linkedShapeToText.set(parentShapeId, object.id);
      explicitRelationships.push({
        sourceObjectId: parentShapeId,
        targetObjectIds: [object.id],
        type: SEMANTIC_RELATIONSHIP_TYPES.ATTACHED_TEXT,
        confidence: 1.0,
        evidence: ['Fabric relationshipMetadata.parentShapeId']
      });
    }

    if (object.type === 'connector') {
      const srcId = object.relationshipMetadata?.sourceShapeId;
      const tgtId = object.relationshipMetadata?.targetShapeId;
      if (srcId && tgtId && validObjectIds.has(srcId) && validObjectIds.has(tgtId)) {
        explicitRelationships.push({
          sourceObjectId: srcId,
          targetObjectIds: [tgtId],
          type: SEMANTIC_RELATIONSHIP_TYPES.CONNECTS_TO,
          confidence: 1.0,
          evidence: ['Fabric connector relationshipMetadata']
        });
      }
    }
  });

  // 2. Parse workspaceType
  const validWorkspaceTypes = new Set(Object.values(SEMANTIC_WORKSPACE_TYPES));
  let workspaceType = SEMANTIC_WORKSPACE_TYPES.MIXED;
  if (rawPlan?.workspaceType && validWorkspaceTypes.has(rawPlan.workspaceType)) {
    workspaceType = rawPlan.workspaceType;
  }

  // 3. Extract and normalize groups
  let rawGroupList = [];
  if (Array.isArray(rawPlan?.groups)) {
    rawGroupList = rawPlan.groups;
  } else if (Array.isArray(rawPlan?.document?.sections)) {
    rawGroupList = rawPlan.document.sections;
  } else if (Array.isArray(rawPlan?.sections)) {
    rawGroupList = rawPlan.sections;
  }

  const assignedObjectIds = new Set();
  const groups = [];

  rawGroupList.forEach((rawGroup, idx) => {
    if (!rawGroup || typeof rawGroup !== 'object') return;

    const rawIds = Array.isArray(rawGroup.objectIds) ? rawGroup.objectIds : [];
    const validGroupIds = rawIds
      .map(String)
      .filter((id) => validObjectIds.has(id) && !assignedObjectIds.has(id));

    if (validGroupIds.length === 0) return;

    validGroupIds.forEach((id) => assignedObjectIds.add(id));

    // Determine group type
    let groupType = SEMANTIC_GROUP_TYPES.CONCEPT;
    const rawType = String(rawGroup.type || '').toLowerCase();
    if (rawType === 'flowchart') {
      groupType = SEMANTIC_GROUP_TYPES.FLOWCHART;
    } else if (rawType === 'diagram') {
      groupType = SEMANTIC_GROUP_TYPES.DIAGRAM;
    } else if (rawType === 'notes') {
      groupType = SEMANTIC_GROUP_TYPES.NOTES;
    } else if (rawType === 'freeform') {
      groupType = SEMANTIC_GROUP_TYPES.FREEFORM;
    } else if (rawType === 'annotated-diagram' || rawType === 'annotation') {
      groupType = SEMANTIC_GROUP_TYPES.ANNOTATED_DIAGRAM;
    } else if (rawType === 'concept') {
      groupType = SEMANTIC_GROUP_TYPES.CONCEPT;
    } else if (rawGroup.layoutHint === 'horizontal-flow' || rawGroup.layoutHint === 'flowchart') {
      groupType = SEMANTIC_GROUP_TYPES.FLOWCHART;
    } else if (rawGroup.layoutHint === 'notes' || rawGroup.layoutHint === 'grid') {
      groupType = SEMANTIC_GROUP_TYPES.NOTES;
    } else if (rawGroup.layoutHint === 'freeform') {
      groupType = SEMANTIC_GROUP_TYPES.FREEFORM;
    }

    const titleObjId = rawGroup.titleObjectId && validObjectIds.has(String(rawGroup.titleObjectId))
      ? String(rawGroup.titleObjectId)
      : null;

    const groupId = rawGroup.id && typeof rawGroup.id === 'string'
      ? rawGroup.id
      : `group_${idx + 1}`;

    groups.push({
      id: groupId,
      type: groupType,
      titleObjectId: titleObjId,
      objectIds: sortIds(validGroupIds),
      purpose: typeof rawGroup.purpose === 'string' ? rawGroup.purpose : null
    });
  });

  // 4. Enforce group integrity: colocate linked shape/text pairs
  const groupMapByObjId = new Map();
  groups.forEach((grp) => {
    grp.objectIds.forEach((oid) => groupMapByObjId.set(oid, grp));
  });

  modelObjects.forEach((object) => {
    if (!object || !object.id) return;
    const shapeId = object.id;
    const textId = linkedShapeToText.get(shapeId);

    if (textId) {
      const shapeGrp = groupMapByObjId.get(shapeId);
      const textGrp = groupMapByObjId.get(textId);

      if (shapeGrp && !textGrp) {
        shapeGrp.objectIds.push(textId);
        shapeGrp.objectIds = sortIds(shapeGrp.objectIds);
        assignedObjectIds.add(textId);
        groupMapByObjId.set(textId, shapeGrp);
      } else if (!shapeGrp && textGrp) {
        textGrp.objectIds.push(shapeId);
        textGrp.objectIds = sortIds(textGrp.objectIds);
        assignedObjectIds.add(shapeId);
        groupMapByObjId.set(shapeId, textGrp);
      } else if (shapeGrp && textGrp && shapeGrp !== textGrp) {
        textGrp.objectIds = textGrp.objectIds.filter((id) => id !== textId);
        shapeGrp.objectIds.push(textId);
        shapeGrp.objectIds = sortIds(shapeGrp.objectIds);
        groupMapByObjId.set(textId, shapeGrp);
      }
    }
  });

  // 5. Group unassigned objects into semantic groups
  const unassignedIds = [...validObjectIds].filter((id) => !assignedObjectIds.has(id));
  if (unassignedIds.length > 0) {
    const unassignedStrokes = unassignedIds.filter((id) => objectMap.get(id)?.type === 'stroke');
    const unassignedNotes = unassignedIds.filter((id) => objectMap.get(id)?.type === 'note' || objectMap.get(id)?.metadata?.isStickyNote);
    const unassignedOther = unassignedIds.filter((id) => !unassignedStrokes.includes(id) && !unassignedNotes.includes(id));

    if (unassignedStrokes.length > 0) {
      groups.push({
        id: `group_freeform_unassigned`,
        type: SEMANTIC_GROUP_TYPES.FREEFORM,
        titleObjectId: null,
        objectIds: sortIds(unassignedStrokes),
        purpose: 'Freehand strokes'
      });
    }

    if (unassignedNotes.length > 0) {
      groups.push({
        id: `group_notes_unassigned`,
        type: SEMANTIC_GROUP_TYPES.NOTES,
        titleObjectId: null,
        objectIds: sortIds(unassignedNotes),
        purpose: 'Sticky notes'
      });
    }

    if (unassignedOther.length > 0) {
      groups.push({
        id: `group_concept_unassigned`,
        type: SEMANTIC_GROUP_TYPES.CONCEPT,
        titleObjectId: null,
        objectIds: sortIds(unassignedOther),
        purpose: 'Unassigned content'
      });
    }
  }

  // Refresh group map
  groupMapByObjId.clear();
  groups.forEach((grp) => {
    grp.objectIds.forEach((oid) => groupMapByObjId.set(oid, grp));
  });

  // 6. Normalize relationships
  const allRelationships = [...explicitRelationships];
  const rawRelationships = Array.isArray(rawPlan?.relationships) ? rawPlan.relationships : [];

  rawRelationships.forEach((rawRel) => {
    if (!rawRel || typeof rawRel !== 'object') return;
    const srcId = String(rawRel.sourceObjectId || '');
    if (!validObjectIds.has(srcId)) return;

    const rawTargets = Array.isArray(rawRel.targetObjectIds) ? rawRel.targetObjectIds : (rawRel.targetObjectId ? [rawRel.targetObjectId] : []);
    const validTargets = rawTargets.map(String).filter((id) => validObjectIds.has(id));
    if (validTargets.length === 0) return;

    const normalizedType = normalizeRelationshipType(rawRel.type || rawRel.relationship);
    if (!normalizedType) return;

    const confidence = typeof rawRel.confidence === 'number' && rawRel.confidence >= 0 && rawRel.confidence <= 1
      ? rawRel.confidence
      : 0.8;

    const evidence = Array.isArray(rawRel.evidence) ? rawRel.evidence.map(String) : [];

    allRelationships.push({
      sourceObjectId: srcId,
      targetObjectIds: sortIds(validTargets),
      type: normalizedType,
      confidence,
      evidence
    });
  });

  // Deduplicate relationships
  const relSeen = new Set();
  const uniqueRelationships = [];
  allRelationships.forEach((rel) => {
    const key = `${rel.sourceObjectId}->${rel.targetObjectIds.join(',')}:${rel.type}`;
    if (!relSeen.has(key)) {
      relSeen.add(key);
      uniqueRelationships.push(rel);
    }
  });

  // 7. Normalize annotations
  const annotations = [];
  const rawAnnotations = Array.isArray(rawPlan?.annotations) ? rawPlan.annotations : [];
  rawAnnotations.forEach((rawAnn) => {
    if (!rawAnn || typeof rawAnn !== 'object') return;
    const annId = String(rawAnn.objectId || rawAnn.strokeId || '');
    if (!validObjectIds.has(annId)) return;

    const rawTargets = Array.isArray(rawAnn.targetObjectIds) ? rawAnn.targetObjectIds : (rawAnn.targetId ? [rawAnn.targetId] : []);
    const validTargets = rawTargets.map(String).filter((id) => validObjectIds.has(id));

    const confidence = typeof rawAnn.confidence === 'number' ? rawAnn.confidence : 0.8;
    const evidence = Array.isArray(rawAnn.evidence) ? rawAnn.evidence.map(String) : [];

    annotations.push({
      objectId: annId,
      targetObjectIds: sortIds(validTargets),
      type: typeof rawAnn.type === 'string' ? rawAnn.type : 'freehand-annotation',
      confidence,
      evidence
    });
  });

  // 8. Build objects list with semantic roles and group associations
  const semanticObjects = modelObjects
    .filter((o) => o?.id)
    .map((obj) => {
      const parentObjectId = linkedTextToShape.get(obj.id) || null;
      const grp = groupMapByObjId.get(obj.id);
      const inferredRole = inferObjectRole(obj);

      return {
        objectId: obj.id,
        type: obj.type || 'shape',
        semanticRole: inferredRole,
        groupId: grp ? grp.id : null,
        parentObjectId
      };
    })
    .sort((a, b) => a.objectId.localeCompare(b.objectId));

  // 9. Determine reading order
  let readingOrder = [];
  if (Array.isArray(rawPlan?.readingOrder) && rawPlan.readingOrder.length > 0) {
    readingOrder = rawPlan.readingOrder.filter((id) => groups.some((g) => g.id === id) || validObjectIds.has(id));
  }
  if (readingOrder.length === 0) {
    // Default semantic reading order: title -> concept -> flowchart -> diagram -> notes -> freeform
    const typePriority = {
      [SEMANTIC_GROUP_TYPES.CONCEPT]: 1,
      [SEMANTIC_GROUP_TYPES.FLOWCHART]: 2,
      [SEMANTIC_GROUP_TYPES.DIAGRAM]: 3,
      [SEMANTIC_GROUP_TYPES.NOTES]: 4,
      [SEMANTIC_GROUP_TYPES.ANNOTATED_DIAGRAM]: 5,
      [SEMANTIC_GROUP_TYPES.FREEFORM]: 6
    };
    readingOrder = [...groups]
      .sort((a, b) => (typePriority[a.type] || 99) - (typePriority[b.type] || 99))
      .map((g) => g.id);
  }

  // 10. Extract hierarchy
  const rootTitleObjectId = rawPlan?.document?.titleObjectId && validObjectIds.has(String(rawPlan.document.titleObjectId))
    ? String(rawPlan.document.titleObjectId)
    : (rawPlan?.hierarchy?.rootTitleObjectId && validObjectIds.has(String(rawPlan.hierarchy.rootTitleObjectId)) ? String(rawPlan.hierarchy.rootTitleObjectId) : null);

  const mainConceptIds = groups
    .filter((g) => g.type === SEMANTIC_GROUP_TYPES.CONCEPT || g.type === SEMANTIC_GROUP_TYPES.FLOWCHART)
    .map((g) => g.id);

  const hierarchy = {
    rootTitleObjectId,
    mainConceptIds
  };

  const scene = {
    version: 1,
    workspaceType,
    objects: semanticObjects,
    groups,
    relationships: uniqueRelationships,
    annotations,
    readingOrder,
    hierarchy
  };

  // Development diagnostic log
  if (process.env.NODE_ENV !== 'production' && typeof console !== 'undefined') {
    console.log(`[SemanticScene] Objects: ${scene.objects.length}, Groups: ${scene.groups.length}, Relationships: ${scene.relationships.length}, Annotations: ${scene.annotations.length}, Reading order: [${scene.readingOrder.join(', ')}]`);
  }

  return scene;
};

export default {
  validateSemanticScene,
  normalizeRelationshipType,
  buildSemanticScene
};
