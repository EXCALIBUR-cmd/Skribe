import { EVIDENCE_STRENGTH, LAYOUT_HINTS, SECTION_TYPES } from './organizationTypes.js';

const TEXT_TYPES = new Set(['text']);
const NON_DIAGRAM_TYPES = new Set(['text', 'stroke', 'line', 'image']);

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a || '').localeCompare(String(b || '')));

const getObjectMap = (objects) => new Map(objects.filter((object) => object.id).map((object) => [object.id, object]));

export const getTextCandidates = (objects) => objects
  .filter((object) => TEXT_TYPES.has(object.type) && object.id)
  .map((object) => {
    const text = object.text || '';
    const fontSize = object.style?.fontSize || 0;
    const isBold = ['bold', '600', '700', '800', '900'].includes(String(object.style?.fontWeight || '').toLowerCase());
    const isHeading = text.length > 0 && text.length <= 80 && (fontSize >= 22 || (isBold && fontSize >= 18));
    const role = isHeading ? 'heading' : text.length <= 40 ? 'label' : 'body';
    const evidence = isHeading ? ['large-text'] : role === 'label' ? ['short-text'] : ['text-content'];

    return {
      objectId: object.id,
      role,
      evidence,
      strength: isHeading ? EVIDENCE_STRENGTH.MEDIUM : EVIDENCE_STRENGTH.WEAK
    };
  });

const getComponentType = (objects) => {
  const types = new Set(objects.map((object) => object.type));
  const hasConnector = types.has('connector');
  const shapeCount = objects.filter((object) => !NON_DIAGRAM_TYPES.has(object.type)).length;
  const stickyCount = objects.filter((object) => object.metadata?.isStickyNote).length;

  if (hasConnector && shapeCount >= 2) return { type: SECTION_TYPES.DIAGRAM, layoutHint: LAYOUT_HINTS.FLOW, evidence: ['connector-chain'], strength: EVIDENCE_STRENGTH.STRONG };
  if (stickyCount >= 2) return { type: SECTION_TYPES.NOTES, layoutHint: LAYOUT_HINTS.NOTES, evidence: ['sticky-note-group'], strength: EVIDENCE_STRENGTH.MEDIUM };
  if (types.has('stroke') && types.size === 1) return { type: SECTION_TYPES.FREEFORM, layoutHint: LAYOUT_HINTS.FREEFORM, evidence: ['freeform-content'], strength: EVIDENCE_STRENGTH.WEAK };
  if (types.size > 1) return { type: SECTION_TYPES.MIXED, layoutHint: LAYOUT_HINTS.MIXED, evidence: ['spatial-cluster'], strength: EVIDENCE_STRENGTH.WEAK };
  if (types.has('text')) return { type: SECTION_TYPES.NOTES, layoutHint: LAYOUT_HINTS.NOTES, evidence: ['spatial-text-cluster'], strength: EVIDENCE_STRENGTH.WEAK };
  return { type: SECTION_TYPES.UNASSIGNED, layoutHint: null, evidence: [], strength: null };
};

const getTitleObjectId = (objectIds, objectMap, textCandidates) => {
  const candidates = textCandidates
    .filter((candidate) => candidate.role === 'heading' && objectIds.includes(candidate.objectId))
    .sort((a, b) => {
      const sizeA = objectMap.get(a.objectId)?.style?.fontSize || 0;
      const sizeB = objectMap.get(b.objectId)?.style?.fontSize || 0;
      return sizeB - sizeA || String(a.objectId).localeCompare(String(b.objectId));
    });
  return candidates[0]?.objectId || null;
};

export const buildStructuralUnits = (objects) => {
  const objectMap = getObjectMap(objects);
  const parent = new Map(objects.filter((object) => object.id).map((object) => [object.id, object.id]));

  const find = (id) => {
    let current = id;
    while (parent.get(current) && parent.get(current) !== current) {
      current = parent.get(current);
    }
    return current;
  };

  const union = (firstId, secondId) => {
    if (!parent.has(firstId) || !parent.has(secondId)) return;
    const firstRoot = find(firstId);
    const secondRoot = find(secondId);
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };

  objects.forEach((object) => {
    if (!object.id) return;
    object.relationships.forEach((relationship) => union(object.id, relationship.targetId));
  });

  const grouped = new Map();
  objects.forEach((object) => {
    if (!object.id) return;
    const root = find(object.id);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(object.id);
  });

  return [...grouped.values()]
    .map((objectIds) => {
      const sortedObjectIds = sortIds(objectIds);
      const members = sortedObjectIds.map((id) => objectMap.get(id));
      const relationshipCount = members.reduce((count, object) => count + object.relationships.length, 0);
      return {
        id: `unit_${sortedObjectIds[0]}`,
        objectIds: sortedObjectIds,
        relationships: members.flatMap((object) => object.relationships),
        explicit: relationshipCount > 0,
        type: sortedObjectIds.length > 1 ? 'linked' : 'single'
      };
    })
    .sort((a, b) => a.objectIds[0].localeCompare(b.objectIds[0]));
};

export const classifyComponent = (objectIds, objectMap, textCandidates) => {
  const members = objectIds.map((id) => objectMap.get(id)).filter(Boolean);
  const classification = getComponentType(members);
  return {
    ...classification,
    titleObjectId: getTitleObjectId(objectIds, objectMap, textCandidates)
  };
};
