import { EVIDENCE_STRENGTH, LAYOUT_HINTS, SECTION_TYPES, TEXT_ROLES } from './organizationTypes.js';

const TEXT_TYPES = new Set(['text']);
const NON_DIAGRAM_TYPES = new Set(['text', 'stroke', 'line', 'image']);

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a || '').localeCompare(String(b || '')));

const getObjectMap = (objects) => new Map(objects.filter((object) => object && object.id).map((object) => [object.id, object]));

export const getTextCandidates = (objects) => {
  const textObjects = objects.filter((object) => object && TEXT_TYPES.has(object.type) && object.id);
  if (textObjects.length === 0) return [];

  const fontSizes = textObjects.map((o) => o.style?.fontSize || 16).sort((a, b) => b - a);
  const maxFontSize = fontSizes[0] || 16;
  const minY = Math.min(...textObjects.map((o) => o.position?.y || 0));

  return textObjects.map((object) => {
    const text = object.text || '';
    const fontSize = object.style?.fontSize || 16;
    const isBold = ['bold', '600', '700', '800', '900'].includes(String(object.style?.fontWeight || '').toLowerCase());
    const isAttachedToShape = Boolean(object.relationshipMetadata?.parentShapeId || object.relationshipMetadata?.attachedTextId || object.elementId);
    const isConnectorLabel = Boolean(object.relationshipMetadata?.sourceShapeId || object.relationshipMetadata?.targetShapeId);

    const evidence = [];
    let role = TEXT_ROLES.BODY;
    let strength = EVIDENCE_STRENGTH.WEAK;
    let confidence = 0.5;

    if (isAttachedToShape) {
      role = TEXT_ROLES.LABEL;
      evidence.push('attached-to-shape');
      confidence = 0.9;
    } else if (isConnectorLabel) {
      role = TEXT_ROLES.LABEL;
      evidence.push('connector-label');
      confidence = 0.9;
    } else if (text.length > 0 && text.length <= 100) {
      const isTopRegion = Math.abs((object.position?.y || 0) - minY) <= 150;
      const isLargestFont = fontSize >= maxFontSize && maxFontSize >= 30;

      if (fontSize >= 30 || (isLargestFont && isTopRegion && fontSize >= 30)) {
        role = TEXT_ROLES.TITLE;
        evidence.push('largest-relative-font', 'top-region');
        if (isBold) evidence.push('bold-weight');
        strength = EVIDENCE_STRENGTH.STRONG;
        confidence = 0.95;
      } else if (fontSize >= 22 || (isBold && fontSize >= 20) || (fontSize >= maxFontSize * 0.75 && maxFontSize >= 24)) {
        role = TEXT_ROLES.HEADING;
        evidence.push('large-font');
        if (isBold) evidence.push('bold-weight');
        strength = EVIDENCE_STRENGTH.MEDIUM;
        confidence = 0.85;
      } else if (fontSize >= 18 || (isBold && fontSize >= 16)) {
        role = TEXT_ROLES.SUBHEADING;
        evidence.push('medium-font');
        if (isBold) evidence.push('bold-weight');
        strength = EVIDENCE_STRENGTH.MEDIUM;
        confidence = 0.75;
      } else if (text.length <= 40) {
        role = TEXT_ROLES.LABEL;
        evidence.push('short-text');
        confidence = 0.6;
      }
    }

    if (object.style?.textAlign) evidence.push(`align-${object.style.textAlign}`);

    return {
      objectId: object.id,
      role,
      evidence,
      strength,
      confidence
    };
  });
};

export const detectAnnotations = (strokeObjects, targetObjects) => {
  const annotations = [];
  strokeObjects.forEach((stroke) => {
    const sPos = stroke.position || { x: 0, y: 0 };
    const sWidth = Math.abs((stroke.size?.width || 50) * (stroke.scale?.x || 1));
    const sHeight = Math.abs((stroke.size?.height || 50) * (stroke.scale?.y || 1));
    const sBounds = {
      left: sPos.x - sWidth / 2,
      right: sPos.x + sWidth / 2,
      top: sPos.y - sHeight / 2,
      bottom: sPos.y + sHeight / 2
    };

    let bestTarget = null;
    let minDistance = 150;

    targetObjects.forEach((target) => {
      if (target.id === stroke.id || target.type === 'stroke') return;
      const tPos = target.position || { x: 0, y: 0 };
      const tWidth = Math.abs((target.size?.width || 100) * (target.scale?.x || 1));
      const tHeight = Math.abs((target.size?.height || 80) * (target.scale?.y || 1));
      const tBounds = {
        left: tPos.x - tWidth / 2,
        right: tPos.x + tWidth / 2,
        top: tPos.y - tHeight / 2,
        bottom: tPos.y + tHeight / 2
      };

      const hGap = Math.max(sBounds.left - tBounds.right, tBounds.left - sBounds.right, 0);
      const vGap = Math.max(sBounds.top - tBounds.bottom, tBounds.top - sBounds.bottom, 0);
      const dist = Math.hypot(hGap, vGap);

      if (dist < minDistance) {
        minDistance = dist;
        bestTarget = target;
      }
    });

    if (bestTarget) {
      annotations.push({
        strokeId: stroke.id,
        targetId: bestTarget.id,
        confidence: minDistance < 50 ? 0.9 : 0.7,
        evidence: ['freehand-proximity', minDistance < 50 ? 'bounding-overlap' : 'adjacent-placement']
      });
    }
  });
  return annotations;
};

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
    .filter((candidate) => (candidate.role === TEXT_ROLES.TITLE || candidate.role === TEXT_ROLES.HEADING || candidate.role === TEXT_ROLES.SUBHEADING) && objectIds.includes(candidate.objectId))
    .sort((a, b) => {
      const sizeA = objectMap.get(a.objectId)?.style?.fontSize || 0;
      const sizeB = objectMap.get(b.objectId)?.style?.fontSize || 0;
      return sizeB - sizeA || String(a.objectId).localeCompare(String(b.objectId));
    });
  return candidates[0]?.objectId || null;
};

export const buildStructuralUnits = (objects) => {
  const objectMap = getObjectMap(objects);
  const parent = new Map(objects.filter((object) => object && object.id).map((object) => [object.id, object.id]));

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
    if (!object || !object.id) return;
    (object.relationships || []).forEach((relationship) => union(object.id, relationship.targetId));
  });

  const grouped = new Map();
  objects.forEach((object) => {
    if (!object || !object.id) return;
    const root = find(object.id);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(object.id);
  });

  return [...grouped.values()]
    .map((objectIds) => {
      const sortedObjectIds = sortIds(objectIds);
      const members = sortedObjectIds.map((id) => objectMap.get(id)).filter(Boolean);
      const relationshipCount = members.reduce((count, object) => count + (object.relationships ? object.relationships.length : 0), 0);
      return {
        id: `unit_${sortedObjectIds[0]}`,
        objectIds: sortedObjectIds,
        relationships: members.flatMap((object) => object.relationships || []),
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

