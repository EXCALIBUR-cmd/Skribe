
import {
  WORKSPACE_TYPES,
  SECTION_TYPES,
  LAYOUT_HINTS,
  RELATIONSHIP_TYPES
} from './organizationTypes.js';

const VALID_WORKSPACE_TYPES = new Set(Object.values(WORKSPACE_TYPES));
const VALID_SECTION_TYPES = new Set(Object.values(SECTION_TYPES));
const VALID_LAYOUT_HINTS = new Set(Object.values(LAYOUT_HINTS));
const VALID_RELATIONSHIP_TYPES = new Set(Object.values(RELATIONSHIP_TYPES));

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a).localeCompare(String(b)));

export const validateOrganizationPlan = (workspaceModel, rawPlan) => {
  const modelObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const validObjectIds = new Set(modelObjects.map((o) => o?.id).filter(Boolean));

 
  const linkedTextToShape = new Map();
  const linkedShapeToText = new Map();

  modelObjects.forEach((object) => {
    if (!object || !object.id) return;
    const attachedTextId = object.relationshipMetadata?.attachedTextId;
    const parentShapeId = object.relationshipMetadata?.parentShapeId;

    if (attachedTextId && validObjectIds.has(attachedTextId)) {
      linkedShapeToText.set(object.id, attachedTextId);
      linkedTextToShape.set(attachedTextId, object.id);
    }
    if (parentShapeId && validObjectIds.has(parentShapeId)) {
      linkedTextToShape.set(object.id, parentShapeId);
      linkedShapeToText.set(parentShapeId, object.id);
    }
  });

  let rawSections = [];
  let rootTitleObjId = null;

  if (rawPlan?.document && typeof rawPlan.document === 'object') {
    if (Array.isArray(rawPlan.document.sections)) {
      rawSections = rawPlan.document.sections;
    }
    if (rawPlan.document.titleObjectId && validObjectIds.has(rawPlan.document.titleObjectId)) {
      rootTitleObjId = String(rawPlan.document.titleObjectId);
    }
  } else if (Array.isArray(rawPlan?.sections)) {
    rawSections = rawPlan.sections;
  }

  const assignedObjectIds = new Set();
  const sanitizedSections = [];

  rawSections.forEach((section, index) => {
    if (!section || typeof section !== 'object') return;

    const sectionId = section.id && typeof section.id === 'string' ? section.id : `section_${index + 1}`;
    const secType = VALID_SECTION_TYPES.has(section.type) ? section.type : 'mixed';
    const layoutHint = VALID_LAYOUT_HINTS.has(section.layoutHint) ? section.layoutHint : 'flow';

    const titleObjId = section.titleObjectId && validObjectIds.has(section.titleObjectId)
      ? String(section.titleObjectId)
      : null;

    const rawIds = Array.isArray(section.objectIds) ? section.objectIds : [];
    const validSecIds = [];

    rawIds.forEach((id) => {
      const strId = String(id);
      if (validObjectIds.has(strId) && !assignedObjectIds.has(strId)) {
        validSecIds.push(strId);
        assignedObjectIds.add(strId);
      }
    });

    if (titleObjId && !validSecIds.includes(titleObjId)) {
      if (validObjectIds.has(titleObjId) && !assignedObjectIds.has(titleObjId)) {
        validSecIds.unshift(titleObjId);
        assignedObjectIds.add(titleObjId);
      }
    }

    const children = Array.isArray(section.children)
      ? section.children.filter((c) => typeof c === 'string')
      : [];

    sanitizedSections.push({
      id: sectionId,
      type: secType,
      titleObjectId: titleObjId,
      purpose: typeof section.purpose === 'string' ? section.purpose : '',
      layoutHint,
      objectIds: validSecIds,
      children
    });
  });

  const sectionMapByObjId = new Map();
  sanitizedSections.forEach((sec) => {
    sec.objectIds.forEach((objId) => sectionMapByObjId.set(objId, sec));
  });

  modelObjects.forEach((object) => {
    if (!object || !object.id) return;
    const shapeId = object.id;
    const textId = linkedShapeToText.get(shapeId);

    if (textId) {
      const shapeSection = sectionMapByObjId.get(shapeId);
      const textSection = sectionMapByObjId.get(textId);

      if (shapeSection && !textSection) {
        shapeSection.objectIds.push(textId);
        shapeSection.objectIds = sortIds(shapeSection.objectIds);
        assignedObjectIds.add(textId);
        sectionMapByObjId.set(textId, shapeSection);
      } else if (!shapeSection && textSection) {
        textSection.objectIds.push(shapeId);
        textSection.objectIds = sortIds(textSection.objectIds);
        assignedObjectIds.add(shapeId);
        sectionMapByObjId.set(shapeId, textSection);
      } else if (shapeSection && textSection && shapeSection !== textSection) {
        textSection.objectIds = textSection.objectIds.filter((id) => id !== textId);
        shapeSection.objectIds.push(textId);
        shapeSection.objectIds = sortIds(shapeSection.objectIds);
        sectionMapByObjId.set(textId, shapeSection);
      }
    }
  });

  sanitizedSections.forEach((sec) => {
    sec.objectIds = sortIds(sec.objectIds);
  });

  const unassignedObjectIds = [];
  modelObjects.forEach((object) => {
    if (object && object.id && !assignedObjectIds.has(object.id)) {
      unassignedObjectIds.push(object.id);
    }
  });
  unassignedObjectIds.sort((a, b) => String(a).localeCompare(String(b)));

  const rawRelationships = Array.isArray(rawPlan?.relationships) ? rawPlan.relationships : [];
  const sanitizedRelationships = [];

  rawRelationships.forEach((rel) => {
    if (!rel || typeof rel !== 'object') return;
    if (!VALID_RELATIONSHIP_TYPES.has(rel.type)) return;

    const sourceId = String(rel.sourceObjectId || '');
    if (!validObjectIds.has(sourceId)) return;

    const rawTargets = Array.isArray(rel.targetObjectIds) ? rel.targetObjectIds : [];
    const validTargets = sortIds(rawTargets.filter((id) => validObjectIds.has(String(id)) && String(id) !== sourceId));

    if (validTargets.length === 0) return;

    const evidence = Array.isArray(rel.evidence)
      ? rel.evidence.filter((e) => typeof e === 'string')
      : [];

    sanitizedRelationships.push({
      sourceObjectId: sourceId,
      targetObjectIds: validTargets,
      type: rel.type,
      confidence: typeof rel.confidence === 'number' && Number.isFinite(rel.confidence)
        ? Math.max(0, Math.min(1, rel.confidence))
        : null,
      evidence
    });
  });

  const rawAnnotations = Array.isArray(rawPlan?.annotations) ? rawPlan.annotations : [];
  const sanitizedAnnotations = [];

  rawAnnotations.forEach((ann) => {
    if (!ann || typeof ann !== 'object') return;
    const objectId = String(ann.objectId || ann.strokeId || '');
    if (!validObjectIds.has(objectId)) return;

    const rawTargets = Array.isArray(ann.targetObjectIds) ? ann.targetObjectIds : (ann.targetId ? [ann.targetId] : []);
    const validTargets = sortIds(rawTargets.filter((id) => validObjectIds.has(String(id))));

    sanitizedAnnotations.push({
      objectId,
      targetObjectIds: validTargets,
      type: typeof ann.type === 'string' ? ann.type : 'annotation',
      confidence: typeof ann.confidence === 'number' && Number.isFinite(ann.confidence)
        ? Math.max(0, Math.min(1, ann.confidence))
        : null
    });
  });

  const rawWorkspaceType = String(rawPlan?.workspaceType || '');
  const workspaceType = VALID_WORKSPACE_TYPES.has(rawWorkspaceType) ? rawWorkspaceType : 'mixed';

  const validSectionIds = new Set(sanitizedSections.map((s) => s.id));
  let legacyHierarchy = [];

  if (Array.isArray(rawPlan?.hierarchy)) {
    legacyHierarchy = rawPlan.hierarchy;
  } else {
    legacyHierarchy = [
      {
        type: 'document_root',
        titleObjectId: rootTitleObjId,
        sections: Array.from(validSectionIds)
      }
    ];
  }

  return {
    version: 2,
    source: {
      engine: 'nemotron-omni',
      model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'
    },
    workspaceType,
    ...(Array.isArray(rawPlan?.groups) ? { groups: rawPlan.groups } : {}),
    ...(Array.isArray(rawPlan?.readingOrder) ? { readingOrder: rawPlan.readingOrder } : {}),
    document: {
      titleObjectId: rootTitleObjId,
      sections: sanitizedSections
    },

    sections: sanitizedSections,

    hierarchy: legacyHierarchy,

    relationships: sanitizedRelationships,
    annotations: sanitizedAnnotations,
    unassignedObjectIds
  };
};

export default validateOrganizationPlan;
