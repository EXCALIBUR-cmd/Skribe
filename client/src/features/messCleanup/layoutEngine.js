import { SECTION_TYPES } from './organizationTypes.js';
import { LAYOUT_CONSTANTS, LAYOUT_FALLBACKS } from './layoutTypes.js';
import {
  createObjectPlacement,
  createUnitPlacement,
  getAnchor,
  getObjectDimensions,
  positionDiagramUnits,
  positionUnitsInGrid,
  positionUnitsVertically,
  unionBounds,
  getPlacementBounds,
  detectCollisions,
  resolveCollisions
} from './layoutStrategies.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildCleanupResult } from './buildCleanupResult.js';

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a).localeCompare(String(b)));

const getSections = (organizationPlan) => {
  if (organizationPlan?.document?.sections && Array.isArray(organizationPlan.document.sections)) {
    return organizationPlan.document.sections;
  }
  if (Array.isArray(organizationPlan?.sections)) {
    return organizationPlan.sections;
  }
  return [];
};

const getPlanObjectIds = (organizationPlan) => sortIds([
  ...(organizationPlan?.structuralUnits || []).flatMap((unit) => unit.objectIds || []),
  ...getSections(organizationPlan).flatMap((section) => section.objectIds || []),
  ...(organizationPlan?.unassignedObjectIds || [])
]);

const createFallbackObject = (id) => ({
  id,
  type: 'shape',
  position: { x: 0, y: 0 },
  size: { width: LAYOUT_CONSTANTS.DEFAULT_WIDTH, height: LAYOUT_CONSTANTS.DEFAULT_HEIGHT },
  scale: { x: 1, y: 1 },
  rotation: 0,
  relationshipMetadata: {}
});

const getObjectMap = (organizationPlan, workspaceModel) => {
  const modelObjects = workspaceModel?.board?.objects || [];
  const objectMap = new Map(modelObjects.filter((object) => object?.id).map((object) => [object.id, object]));
  getPlanObjectIds(organizationPlan).forEach((id) => {
    if (!objectMap.has(id)) objectMap.set(id, createFallbackObject(id));
  });
  return objectMap;
};

const resolveStructuralUnits = (objectMap, organizationPlan = null) => {
  const ids = [...objectMap.keys()];
  const parent = new Map(ids.map((id) => [id, id]));

  const find = (id) => {
    let current = id;
    while (parent.get(current) && parent.get(current) !== current) current = parent.get(current);
    return current;
  };

  const union = (firstId, secondId) => {
    if (!parent.has(firstId) || !parent.has(secondId)) return;
    const firstRoot = find(firstId);
    const secondRoot = find(secondId);
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };

  objectMap.forEach((object, objectId) => {
    if (!object) return;

    const attachedTextId = object.relationshipMetadata?.attachedTextId;
    if (attachedTextId && objectMap.has(attachedTextId)) {
      union(objectId, attachedTextId);
    }

    const parentShapeId = object.relationshipMetadata?.parentShapeId;
    if (parentShapeId && objectMap.has(parentShapeId)) {
      union(objectId, parentShapeId);
    }

    const elementId = object.elementId;
    if (elementId) {
      objectMap.forEach((other, otherId) => {
        if (otherId !== objectId && other?.elementId === elementId) {
          union(objectId, otherId);
        }
      });
    }

    (object.relationships || []).forEach((rel) => {
      if (['contains_text', 'contained_by', 'shared_element'].includes(rel.type) && rel.targetId && objectMap.has(rel.targetId)) {
        union(objectId, rel.targetId);
      }
    });
  });

  const strokeIds = ids.filter((id) => objectMap.get(id)?.type === 'stroke');
  if (strokeIds.length > 1) {
    if (organizationPlan) {
      const planSections = getSections(organizationPlan);
      planSections.forEach((sec) => {
        const secStrokes = (sec.objectIds || []).filter((id) => objectMap.get(id)?.type === 'stroke');
        for (let i = 1; i < secStrokes.length; i++) {
          union(secStrokes[0], secStrokes[i]);
        }
      });
    }

    for (let i = 0; i < strokeIds.length; i++) {
      const objA = objectMap.get(strokeIds[i]);
      if (!objA?.position) continue;
      for (let j = i + 1; j < strokeIds.length; j++) {
        const objB = objectMap.get(strokeIds[j]);
        if (!objB?.position) continue;
        const dist = Math.hypot(objA.position.x - objB.position.x, objA.position.y - objB.position.y);
        if (dist < 250) {
          union(strokeIds[i], strokeIds[j]);
        }
      }
    }
  }

  const groups = new Map();
  ids.forEach((id) => {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  });

  return [...groups.values()]
    .map((objectIds) => {
      const sorted = sortIds(objectIds);
      const members = sorted.map((id) => objectMap.get(id)).filter(Boolean);
      const relCount = members.reduce((count, obj) => count + (obj.relationships ? obj.relationships.length : 0), 0);
      const hasStrokes = members.some((m) => m.type === 'stroke');
      const hasShape = members.some((m) => m.type === 'shape' || m.type === 'note');
      const hasText = members.some((m) => m.type === 'text');

      let unitType = 'single';
      if (sorted.length > 1) {
        if (hasShape && hasText) unitType = 'linked-shape-text';
        else if (hasStrokes) unitType = 'freeform-group';
        else unitType = 'linked';
      }

      return {
        id: `unit_${sorted[0]}`,
        objectIds: sorted,
        relationships: members.flatMap((obj) => obj.relationships || []),
        explicit: relCount > 0 || sorted.length > 1,
        type: unitType
      };
    })
    .sort((a, b) => a.objectIds[0].localeCompare(b.objectIds[0]));
};

const getStructuralUnits = (organizationPlan, objectMap) => {
  if (Array.isArray(organizationPlan?.structuralUnits) && organizationPlan.structuralUnits.length > 0) {
    const units = organizationPlan.structuralUnits.map((unit) => ({
      ...unit,
      objectIds: sortIds((unit.objectIds || []).filter((id) => objectMap.has(id)))
    })).filter((unit) => unit.objectIds.length > 0);
    const knownIds = new Set(units.flatMap((unit) => unit.objectIds));

    getPlanObjectIds(organizationPlan).forEach((id) => {
      if (!knownIds.has(id)) units.push({ id: `unit_${id}`, objectIds: [id], relationships: [], explicit: false, type: 'single' });
    });

    return units.sort((a, b) => a.objectIds[0].localeCompare(b.objectIds[0]));
  }

  return resolveStructuralUnits(objectMap, organizationPlan);
};

const getSectionUnits = (section, units, objectMap) => units.filter((unit) => (
  unit.objectIds.some((objectId) => section.objectIds.includes(objectId)) &&
  unit.objectIds.every((objectId) => objectMap.has(objectId))
));

const getTitleUnit = (section, sectionUnits) => sectionUnits.find((unit) => section.titleObjectId && unit.objectIds.includes(section.titleObjectId));

const getDiagramUnits = (section, objectMap) => {
  const nodeIds = section.objectIds.filter((objectId) => (
    objectMap.get(objectId)?.type !== 'connector' &&
    objectId !== section.titleObjectId
  ));
  const parent = new Map(nodeIds.map((id) => [id, id]));
  const find = (id) => {
    let current = id;
    while (parent.get(current) && parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const union = (firstId, secondId) => {
    if (!parent.has(firstId) || !parent.has(secondId)) return;
    const firstRoot = find(firstId);
    const secondRoot = find(secondId);
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };

  nodeIds.forEach((objectId) => {
    const object = objectMap.get(objectId);
    if (!object) return;

    const attachedTextId = object.relationshipMetadata?.attachedTextId;
    if (attachedTextId && nodeIds.includes(attachedTextId)) {
      union(objectId, attachedTextId);
    }

    const parentShapeId = object.relationshipMetadata?.parentShapeId;
    if (parentShapeId && nodeIds.includes(parentShapeId)) {
      union(objectId, parentShapeId);
    }

    const elementId = object.elementId;
    if (elementId) {
      nodeIds.forEach((otherId) => {
        if (otherId !== objectId && objectMap.get(otherId)?.elementId === elementId) {
          union(objectId, otherId);
        }
      });
    }

    (object?.relationships || []).forEach((relationship) => {
      if (['contains_text', 'contained_by', 'shared_element'].includes(relationship.type)) {
        union(objectId, relationship.targetId);
      }
    });
  });

  const groups = new Map();
  nodeIds.forEach((objectId) => {
    const root = find(objectId);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(objectId);
  });

  const nodeUnits = [...groups.values()]
    .map((objectIds) => ({
      id: `unit_${objectIds.sort()[0]}`,
      objectIds: objectIds.sort(),
      relationships: [],
      explicit: objectIds.length > 1,
      type: objectIds.length > 1 ? 'linked' : 'single'
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const connectorUnits = section.objectIds
    .filter((objectId) => objectMap.get(objectId)?.type === 'connector')
    .sort()
    .map((objectId) => ({
      id: `unit_${objectId}`,
      objectIds: [objectId],
      relationships: [],
      explicit: false,
      type: 'single'
    }));

  return [...nodeUnits, ...connectorUnits];
};

const addHeadingPlacement = (section, sectionUnits, objectMap, origin) => {
  const titleUnit = getTitleUnit(section, sectionUnits);
  if (!titleUnit) return { titleUnit: null, placements: [] };
  const titleObject = objectMap.get(section.titleObjectId);
  const titlePosition = titleObject && getAnchor(titleObject) === 'top-left'
    ? origin
    : { x: origin.x, y: origin.y };
  return {
    titleUnit,
    placements: createUnitPlacement(titleUnit, titlePosition, objectMap).placements
  };
};

const getContentUnits = (sectionUnits, titleUnit) => sectionUnits.filter((unit) => unit !== titleUnit);

const flattenPlacements = (unitPlacements) => unitPlacements.flatMap((unitPlacement) => unitPlacement.placements || []);

const getSectionBounds = (placements) => {
  const contentBounds = unionBounds(placements.map((placement) => placement.bounds));
  return {
    x: contentBounds.x - LAYOUT_CONSTANTS.SECTION_PADDING,
    y: contentBounds.y - LAYOUT_CONSTANTS.SECTION_PADDING,
    width: contentBounds.width + LAYOUT_CONSTANTS.SECTION_PADDING * 2,
    height: contentBounds.height + LAYOUT_CONSTANTS.SECTION_PADDING * 2
  };
};

const positionUnitsFreeform = (units, objectMap, origin) => {
  if (units.length === 0) return { placements: [], fallback: null };

  const allPositions = units.flatMap((unit) =>
    unit.objectIds.map((id) => objectMap.get(id)?.position).filter(Boolean)
  );
  const minX = allPositions.length > 0 ? Math.min(...allPositions.map((p) => p.x)) : 0;
  const minY = allPositions.length > 0 ? Math.min(...allPositions.map((p) => p.y)) : 0;

  const placements = units.map((unit) => {
    const representative = unit.objectIds.map((id) => objectMap.get(id)).find((o) => o?.type !== 'text' && o?.type !== 'connector') || objectMap.get(unit.objectIds[0]);
    const pos = representative?.position || { x: 0, y: 0 };
    return createUnitPlacement(unit, {
      x: origin.x + (pos.x - minX),
      y: origin.y + (pos.y - minY)
    }, objectMap);
  });

  return { placements, fallback: null };
};

const selectStrategy = (section) => {
  const hint = section.layoutHint;
  const type = section.type;

  if (hint === 'flow' || hint === 'horizontal-flow' || type === SECTION_TYPES.DIAGRAM) return 'diagram';
  if (hint === 'vertical-flow' || type === SECTION_TYPES.HEADING || type === SECTION_TYPES.TEXT || type === SECTION_TYPES.CONTENT) return 'vertical';
  if (hint === 'grid' || hint === 'notes' || type === SECTION_TYPES.NOTES) return 'grid';
  if (hint === 'freeform' || type === SECTION_TYPES.FREEFORM) return 'freeform';
  if (hint === 'mixed' || type === SECTION_TYPES.MIXED) return 'mixed';
  return 'mixed';
};

const layoutSection = (section, sectionUnits, objectMap, unitsByObjectId, origin) => {
  const heading = addHeadingPlacement(section, sectionUnits, objectMap, origin);
  const contentUnits = getContentUnits(sectionUnits, heading.titleUnit);
  const headingBounds = unionBounds(heading.placements.map((p) => p.bounds));
  const contentOrigin = {
    x: origin.x,
    y: origin.y + (heading.placements.length > 0 ? (headingBounds.height + LAYOUT_CONSTANTS.HEADING_GAP) : 0)
  };
  let strategy;
  const strategyName = selectStrategy(section);

  if (strategyName === 'diagram') {
    const diagramUnits = getDiagramUnits(section, objectMap);
    const diagramUnitsByObjectId = new Map();
    diagramUnits.forEach((unit) => unit.objectIds.forEach((objectId) => diagramUnitsByObjectId.set(objectId, unit)));
    strategy = positionDiagramUnits(section, diagramUnits, objectMap, diagramUnitsByObjectId, contentOrigin);
  } else if (strategyName === 'grid') {
    const noteCount = contentUnits.length;
    const columns = noteCount > 6 ? 4 : LAYOUT_CONSTANTS.NOTES_COLUMNS;
    strategy = positionUnitsInGrid(contentUnits, objectMap, contentOrigin, columns);
  } else if (strategyName === 'vertical') {
    strategy = positionUnitsVertically(contentUnits, objectMap, contentOrigin, LAYOUT_CONSTANTS.CONTENT_GAP);
  } else if (strategyName === 'freeform') {
    strategy = positionUnitsFreeform(contentUnits, objectMap, contentOrigin);
  } else {
    strategy = positionUnitsInGrid(contentUnits, objectMap, contentOrigin, LAYOUT_CONSTANTS.OTHER_COLUMNS);
  }

  const unitPlacements = [
    ...(heading.titleUnit ? [{ unitId: heading.titleUnit.id, objectIds: heading.titleUnit.objectIds, placements: heading.placements }] : []),
    ...(strategy.placements || [])
  ];
  const placements = flattenPlacements(unitPlacements);
  const bounds = getSectionBounds(placements);

  return {
    sectionId: section.id,
    type: section.type,
    titleObjectId: section.titleObjectId || null,
    layoutHint: section.layoutHint || null,
    objectIds: sortIds(section.objectIds),
    bounds,
    evidence: section.evidence || [],
    confidence: section.confidence || null,
    fallback: strategy.fallback || null,
    placements,
    graph: strategy.edges ? { edges: strategy.edges, direction: strategy.direction || null } : null
  };
};

const placeDocumentTitle = (organizationPlan, objectMap, structuralUnits, origin) => {
  const titleObjectId = organizationPlan?.document?.titleObjectId;
  if (!titleObjectId || !objectMap.has(titleObjectId)) return null;

  const titleUnit = structuralUnits.find((unit) => unit.objectIds.includes(titleObjectId));
  if (!titleUnit) return null;

  const titleObject = objectMap.get(titleObjectId);
  const position = titleObject && getAnchor(titleObject) === 'top-left'
    ? origin
    : { x: origin.x, y: origin.y };

  const unitPlacement = createUnitPlacement(titleUnit, position, objectMap);
  return {
    titleObjectId,
    unitId: titleUnit.id,
    objectIds: titleUnit.objectIds,
    placements: unitPlacement.placements,
    bounds: unitPlacement.bounds
  };
};

const applyAnnotationProximity = (allPlacements, organizationPlan, objectMap) => {
  const annotations = organizationPlan?.annotations;
  if (!Array.isArray(annotations) || annotations.length === 0) return;

  const placementMap = new Map(allPlacements.map((p) => [p.objectId, p]));

  annotations.forEach((ann) => {
    const annPlacement = placementMap.get(ann.objectId);
    if (!annPlacement) return;
    if (!Array.isArray(ann.targetObjectIds) || ann.targetObjectIds.length === 0) return;

    const targetPlacement = placementMap.get(ann.targetObjectIds[0]);
    if (!targetPlacement) return;

    const annOriginal = objectMap.get(ann.objectId);
    const targetOriginal = objectMap.get(ann.targetObjectIds[0]);
    if (!annOriginal?.position || !targetOriginal?.position) return;

    const offsetX = annOriginal.position.x - targetOriginal.position.x;
    const offsetY = annOriginal.position.y - targetOriginal.position.y;

    annPlacement.position = {
      x: targetPlacement.position.x + offsetX,
      y: targetPlacement.position.y + offsetY
    };

    const size = getObjectDimensions(annOriginal);
    const anchor = getAnchor(annOriginal);
    const rotation = typeof annOriginal.rotation === 'number' ? annOriginal.rotation : 0;
    annPlacement.bounds = getPlacementBounds(annPlacement.position, size, anchor, rotation);
  });
};

export const createLayoutProposal = (organizationPlan, workspaceModel = null, options = {}) => {
  const cleanupPlan = buildCleanupPlan(organizationPlan, workspaceModel, options);
  const proposal = executeCleanupPlan(cleanupPlan, workspaceModel, options);
  if (proposal && proposal.metadata) {
    proposal.metadata.cleanupExecutionEngine = 'conservative';
    proposal.metadata.cleanupPlan = cleanupPlan;
    proposal.metadata.cleanupResult = buildCleanupResult(cleanupPlan, proposal, workspaceModel, options);
  }
  return proposal;
};

export const createLayoutProposalLegacy = (organizationPlan, workspaceModel = null) => {
  const objectMap = getObjectMap(organizationPlan, workspaceModel);
  const structuralUnits = getStructuralUnits(organizationPlan, objectMap);
  const unitsByObjectId = new Map();
  structuralUnits.forEach((unit) => unit.objectIds.forEach((objectId) => unitsByObjectId.set(objectId, unit)));

  const isV2 = organizationPlan?.version === 2;
  const isDocumentWorkspace = organizationPlan?.workspaceType === 'document';

  const plannedObjectIds = new Set();
  let startY = LAYOUT_CONSTANTS.DOCUMENT_MARGIN;

  const documentTitle = isV2
    ? placeDocumentTitle(
        organizationPlan,
        objectMap,
        structuralUnits,
        { x: LAYOUT_CONSTANTS.DOCUMENT_MARGIN + LAYOUT_CONSTANTS.SECTION_PADDING, y: startY + LAYOUT_CONSTANTS.SECTION_PADDING }
      )
    : null;

  if (documentTitle) {
    documentTitle.objectIds.forEach((id) => plannedObjectIds.add(id));
    startY = documentTitle.bounds.y + documentTitle.bounds.height + LAYOUT_CONSTANTS.TITLE_GAP;
  }

  const getSectionMinY = (sec) => {
    if (sec.titleObjectId && objectMap.get(sec.titleObjectId)) {
      return objectMap.get(sec.titleObjectId).position?.y ?? 0;
    }
    const ys = sec.objectIds.map((id) => objectMap.get(id)?.position?.y).filter((y) => typeof y === 'number');
    return ys.length > 0 ? Math.min(...ys) : 0;
  };

  const planSections = getSections(organizationPlan);

  const orderedSections = isV2
    ? [...planSections]
    : [...planSections].sort((a, b) => getSectionMinY(a) - getSectionMinY(b));

  const localSections = [];
  orderedSections.forEach((section) => {
    const sectionObjectIds = section.objectIds.filter((id) => !plannedObjectIds.has(id));
    if (sectionObjectIds.length === 0 && !section.objectIds.some((id) => !plannedObjectIds.has(id))) {
      if (section.objectIds.every((id) => plannedObjectIds.has(id))) return;
    }

    const effectiveSection = { ...section, objectIds: section.objectIds.filter((id) => !plannedObjectIds.has(id)) };
    if (effectiveSection.objectIds.length === 0) return;

    const sectionUnits = getSectionUnits(effectiveSection, structuralUnits, objectMap);
    if (sectionUnits.length === 0) return;
    const layout = layoutSection(
      effectiveSection,
      sectionUnits,
      objectMap,
      unitsByObjectId,
      { x: LAYOUT_CONSTANTS.SECTION_PADDING, y: LAYOUT_CONSTANTS.SECTION_PADDING }
    );
    localSections.push(layout);
    layout.objectIds.forEach((objectId) => plannedObjectIds.add(objectId));
  });

  const sections = [];
  const rows = [];

  if (localSections.length > 0) {
    if (isDocumentWorkspace) {
      let cursorY = startY;
      localSections.forEach((section) => {
        const dx = LAYOUT_CONSTANTS.DOCUMENT_MARGIN - section.bounds.x;
        const dy = cursorY - section.bounds.y;
        section.placements.forEach((p) => {
          p.position.x += dx;
          p.position.y += dy;
          p.bounds.x += dx;
          p.bounds.y += dy;
        });
        section.bounds = {
          x: LAYOUT_CONSTANTS.DOCUMENT_MARGIN,
          y: cursorY,
          width: section.bounds.width,
          height: section.bounds.height
        };
        sections.push(section);
        cursorY += section.bounds.height + LAYOUT_CONSTANTS.SECTION_GAP;
      });
      rows.push(localSections);
    } else {
      const totalWidth = localSections.reduce((sum, s) => sum + s.bounds.width, 0);
      const maxWidth = Math.max(...localSections.map((s) => s.bounds.width));
      const numSections = localSections.length;

      let targetRowWidth;
      if (numSections === 1) {
        targetRowWidth = maxWidth;
      } else if (numSections === 2) {
        targetRowWidth = totalWidth + LAYOUT_CONSTANTS.SECTION_GAP <= 1400
          ? totalWidth + LAYOUT_CONSTANTS.SECTION_GAP
          : Math.max(maxWidth, 800);
      } else {
        targetRowWidth = Math.max(maxWidth, Math.min(1500, Math.max(900, Math.sqrt(numSections) * 500)));
      }

      let currentRow = [];
      let currentRowWidth = 0;

      localSections.forEach((section) => {
        const sectionW = section.bounds.width;
        const gap = currentRow.length > 0 ? LAYOUT_CONSTANTS.SECTION_GAP : 0;
        if (currentRow.length > 0 && currentRowWidth + gap + sectionW > targetRowWidth) {
          rows.push(currentRow);
          currentRow = [section];
          currentRowWidth = sectionW;
        } else {
          currentRow.push(section);
          currentRowWidth += gap + sectionW;
        }
      });
      if (currentRow.length > 0) {
        rows.push(currentRow);
      }

      let currentY = startY;
      rows.forEach((row) => {
        let currentX = LAYOUT_CONSTANTS.DOCUMENT_MARGIN;
        const rowHeight = Math.max(...row.map((s) => s.bounds.height));
        row.forEach((section) => {
          const dx = currentX - section.bounds.x;
          const dy = currentY - section.bounds.y;
          section.placements.forEach((p) => {
            p.position.x += dx;
            p.position.y += dy;
            p.bounds.x += dx;
            p.bounds.y += dy;
          });
          section.bounds = {
            x: currentX,
            y: currentY,
            width: section.bounds.width,
            height: section.bounds.height
          };
          sections.push(section);
          currentX += section.bounds.width + LAYOUT_CONSTANTS.SECTION_GAP;
        });
        currentY += rowHeight + LAYOUT_CONSTANTS.SECTION_GAP;
      });
    }
  }

  const unassignedObjectIds = sortIds((organizationPlan?.unassignedObjectIds || []).filter((id) => objectMap.has(id)));
  const unassignedUnits = structuralUnits.filter((unit) => unit.objectIds.some((id) => unassignedObjectIds.includes(id)));
  if (unassignedUnits.length > 0) {
    const unassignedOriginY = sections.length > 0
      ? Math.max(...sections.map((s) => s.bounds.y + s.bounds.height)) + LAYOUT_CONSTANTS.SECTION_GAP
      : startY;
    const strategy = positionUnitsInGrid(
      unassignedUnits,
      objectMap,
      { x: LAYOUT_CONSTANTS.DOCUMENT_MARGIN + LAYOUT_CONSTANTS.SECTION_PADDING, y: unassignedOriginY + LAYOUT_CONSTANTS.SECTION_PADDING },
      LAYOUT_CONSTANTS.OTHER_COLUMNS
    );
    const placements = flattenPlacements(strategy.placements);
    const bounds = getSectionBounds(placements);
    sections.push({
      sectionId: 'section_unassigned',
      type: SECTION_TYPES.UNASSIGNED,
      layoutHint: null,
      objectIds: unassignedObjectIds,
      bounds,
      evidence: ['unassigned-fallback'],
      confidence: 'weak',
      fallback: null,
      placements,
      graph: null
    });
    unassignedObjectIds.forEach((objectId) => plannedObjectIds.add(objectId));
  }

  const titlePlacements = documentTitle ? documentTitle.placements : [];
  const sectionPlacements = sections.flatMap((section) => section.placements);
  const allPlacements = [...titlePlacements, ...sectionPlacements];

  if (isV2) {
    applyAnnotationProximity(allPlacements, organizationPlan, objectMap);
  }

  const annotations = organizationPlan?.annotations || [];
  const collisionsBefore = detectCollisions(allPlacements, annotations).length;
  const collisionsResolved = resolveCollisions(allPlacements, annotations);
  const collisionsAfter = detectCollisions(allPlacements, annotations).length;

  const allBoundsList = [
    ...sections.map((section) => section.bounds),
    ...allPlacements.map((placement) => placement.bounds)
  ];
  if (documentTitle) allBoundsList.push(documentTitle.bounds);
  const bounds = unionBounds(allBoundsList);

  const proposalSections = sections.map(({ placements: secPlacements, ...section }) => ({
    ...section,
    placementObjectIds: secPlacements.map((placement) => placement.objectId).sort()
  }));

  if (documentTitle) {
    proposalSections.unshift({
      sectionId: 'section_document_title',
      type: 'heading',
      titleObjectId: documentTitle.titleObjectId,
      layoutHint: null,
      objectIds: sortIds(documentTitle.objectIds),
      bounds: documentTitle.bounds,
      evidence: ['document-title'],
      confidence: null,
      fallback: null,
      graph: null,
      placementObjectIds: documentTitle.placements.map((p) => p.objectId).sort()
    });
  }

  const maxColumns = rows.length > 0 ? Math.max(...rows.map((r) => r.length)) : 1;
  const strategyMap = {};
  sections.forEach((s) => {
    strategyMap[s.sectionId] = s.layoutHint || s.type;
  });

  const placementMap = new Map(allPlacements.map((p) => [p.objectId, p]));
  const unitMapByObjId = new Map();
  structuralUnits.forEach((u) => {
    u.objectIds.forEach((oid) => unitMapByObjId.set(oid, u));
  });

  const detachedLinkedObjects = [];
  objectMap.forEach((obj, objId) => {
    const parentShapeId = obj.relationshipMetadata?.parentShapeId;
    if (parentShapeId && objectMap.has(parentShapeId)) {
      const uText = unitMapByObjId.get(objId);
      const uShape = unitMapByObjId.get(parentShapeId);
      if (!uText || !uShape || uText.id !== uShape.id) {
        detachedLinkedObjects.push({ shapeId: parentShapeId, textId: objId, reason: 'different-units' });
      }
    }
  });

  const orphanConnectors = [];
  objectMap.forEach((obj, objId) => {
    if (obj.type === 'connector') {
      const srcId = obj.relationshipMetadata?.sourceShapeId;
      const tgtId = obj.relationshipMetadata?.targetShapeId;
      if (!srcId || !tgtId || !placementMap.has(srcId) || !placementMap.has(tgtId)) {
        orphanConnectors.push({ connectorId: objId, sourceShapeId: srcId, targetShapeId: tgtId });
      }
    }
  });

  const detachedAnnotations = [];
  (organizationPlan?.annotations || []).forEach((ann) => {
    if (Array.isArray(ann.targetObjectIds)) {
      const missingTargets = ann.targetObjectIds.filter((tid) => !placementMap.has(tid));
      if (missingTargets.length > 0) {
        detachedAnnotations.push({ annotationId: ann.objectId, missingTargets });
      }
    }
  });

  const independentTextObjects = [...objectMap.values()]
    .filter((o) => o.type === 'text' && !o.relationshipMetadata?.parentShapeId)
    .map((o) => o.id);

  const sectionObjectCounts = {};
  sections.forEach((s) => {
    sectionObjectCounts[s.sectionId] = s.objectIds.length;
  });

  const unitsReport = structuralUnits.map((u) => {
    const uPlacements = allPlacements.filter((p) => u.objectIds.includes(p.objectId));
    return {
      unitId: u.id,
      type: u.type,
      objectIds: u.objectIds,
      sectionId: sections.find((s) => s.objectIds.some((oid) => u.objectIds.includes(oid)))?.sectionId || 'unassigned',
      bounds: unionBounds(uPlacements.map((p) => p.bounds))
    };
  });

  const diagnostics = {
    sectionCount: sections.length,
    strategyPerSection: strategyMap,
    linkedUnitCount: structuralUnits.filter((u) => u.type === 'linked' || u.type === 'linked-shape-text').length,
    freeformGroupCount: structuralUnits.filter((u) => u.type === 'freeform-group').length,
    connectorGroupCount: (organizationPlan?.relationships || []).filter((r) =>
      ['connects_to', 'connects_from', 'connected_to'].includes(r.type)
    ).length,
    annotationCount: (organizationPlan?.annotations || []).length,
    outlierCount: unassignedObjectIds.length,
    collisionsBefore,
    collisionsAfter,
    canvasWidth: bounds.width,
    canvasHeight: bounds.height,
    aspectRatio: bounds.width > 0 ? Number((bounds.width / Math.max(1, bounds.height)).toFixed(2)) : 1,
    compositionColumns: maxColumns,
    detachedLinkedObjects,
    orphanConnectors,
    detachedAnnotations,
    independentTextObjects,
    sectionObjectCounts,
    units: unitsReport
  };

  return {
    version: 1,
    sourceOrganizationVersion: organizationPlan?.version || null,
    canvasBounds: bounds,
    sections: proposalSections,
    placements: allPlacements.sort((a, b) => a.objectId.localeCompare(b.objectId)),
    unassignedObjectIds,
    metadata: {
      layoutConstants: { ...LAYOUT_CONSTANTS },
      plannedObjectIds: [...plannedObjectIds].sort(),
      requiresWorkspaceModel: !workspaceModel,
      diagnostics
    }
  };
};

export default createLayoutProposal;
