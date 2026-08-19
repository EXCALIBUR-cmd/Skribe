import { SECTION_TYPES } from './organizationTypes.js';
import { LAYOUT_CONSTANTS, LAYOUT_FALLBACKS } from './layoutTypes.js';
import {
  createObjectPlacement,
  createUnitPlacement,
  getAnchor,
  getObjectDimensions,
  positionDiagramUnits,
  positionUnitsInGrid,
  unionBounds
} from './layoutStrategies.js';

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a).localeCompare(String(b)));

const getPlanObjectIds = (organizationPlan) => sortIds([
  ...(organizationPlan?.structuralUnits || []).flatMap((unit) => unit.objectIds || []),
  ...(organizationPlan?.sections || []).flatMap((section) => section.objectIds || []),
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

const getStructuralUnits = (organizationPlan, objectMap) => {
  const units = (organizationPlan?.structuralUnits || []).map((unit) => ({
    ...unit,
    objectIds: sortIds((unit.objectIds || []).filter((id) => objectMap.has(id)))
  })).filter((unit) => unit.objectIds.length > 0);
  const knownIds = new Set(units.flatMap((unit) => unit.objectIds));

  getPlanObjectIds(organizationPlan).forEach((id) => {
    if (!knownIds.has(id)) units.push({ id: `unit_${id}`, objectIds: [id], relationships: [], explicit: false, type: 'single' });
  });

  return units.sort((a, b) => a.objectIds[0].localeCompare(b.objectIds[0]));
};

const getSectionUnits = (section, units, objectMap) => units.filter((unit) => (
  unit.objectIds.some((objectId) => section.objectIds.includes(objectId)) &&
  unit.objectIds.every((objectId) => objectMap.has(objectId))
));

const getTitleUnit = (section, sectionUnits) => sectionUnits.find((unit) => section.titleObjectId && unit.objectIds.includes(section.titleObjectId));

const getDiagramUnits = (section, objectMap) => {
  const nodeIds = section.objectIds.filter((objectId) => objectMap.get(objectId)?.type !== 'connector');
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
  if (!titleUnit) return { titleUnit, placements: [] };
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

const layoutSection = (section, sectionUnits, objectMap, unitsByObjectId, origin) => {
  const heading = addHeadingPlacement(section, sectionUnits, objectMap, origin);
  const contentUnits = getContentUnits(sectionUnits, heading.titleUnit);
  const contentOrigin = {
    x: origin.x,
    y: origin.y + (heading.placements.length > 0 ? LAYOUT_CONSTANTS.HEADING_GAP : 0)
  };
  let strategy;

  if (section.type === SECTION_TYPES.DIAGRAM || section.layoutHint === 'flow') {
    const diagramUnits = getDiagramUnits(section, objectMap);
    const diagramUnitsByObjectId = new Map();
    diagramUnits.forEach((unit) => unit.objectIds.forEach((objectId) => diagramUnitsByObjectId.set(objectId, unit)));
    strategy = positionDiagramUnits(section, diagramUnits, objectMap, diagramUnitsByObjectId, contentOrigin);
  } else if (section.type === SECTION_TYPES.NOTES) {
    strategy = positionUnitsInGrid(contentUnits, objectMap, contentOrigin);
  } else if (section.type === SECTION_TYPES.FREEFORM) {
    strategy = positionUnitsInGrid(contentUnits, objectMap, contentOrigin, 1);
  } else {
    strategy = positionUnitsInGrid(contentUnits, objectMap, contentOrigin, LAYOUT_CONSTANTS.OTHER_COLUMNS);
    if (section.type !== SECTION_TYPES.MIXED && section.type !== SECTION_TYPES.HEADING) {
      strategy.fallback = LAYOUT_FALLBACKS.UNSUPPORTED_SECTION;
    }
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

export const createLayoutProposal = (organizationPlan, workspaceModel = null) => {
  const objectMap = getObjectMap(organizationPlan, workspaceModel);
  const structuralUnits = getStructuralUnits(organizationPlan, objectMap);
  const unitsByObjectId = new Map();
  structuralUnits.forEach((unit) => unit.objectIds.forEach((objectId) => unitsByObjectId.set(objectId, unit)));

  const sections = [];
  let cursorY = LAYOUT_CONSTANTS.SECTION_PADDING;
  const plannedObjectIds = new Set();

  [...(organizationPlan?.sections || [])]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .forEach((section) => {
      const sectionUnits = getSectionUnits(section, structuralUnits, objectMap);
      if (sectionUnits.length === 0) return;
      const layout = layoutSection(
        section,
        sectionUnits,
        objectMap,
        unitsByObjectId,
        { x: LAYOUT_CONSTANTS.SECTION_PADDING, y: cursorY + LAYOUT_CONSTANTS.SECTION_PADDING }
      );
      sections.push(layout);
      layout.objectIds.forEach((objectId) => plannedObjectIds.add(objectId));
      cursorY = layout.bounds.y + layout.bounds.height + LAYOUT_CONSTANTS.SECTION_GAP;
    });

  const unassignedObjectIds = sortIds((organizationPlan?.unassignedObjectIds || []).filter((id) => objectMap.has(id)));
  const unassignedUnits = structuralUnits.filter((unit) => unit.objectIds.some((id) => unassignedObjectIds.includes(id)));
  if (unassignedUnits.length > 0) {
    const strategy = positionUnitsInGrid(
      unassignedUnits,
      objectMap,
      { x: LAYOUT_CONSTANTS.SECTION_PADDING, y: cursorY + LAYOUT_CONSTANTS.SECTION_PADDING },
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

  const placements = sections.flatMap((section) => section.placements);
  const bounds = unionBounds([
    ...sections.map((section) => section.bounds),
    ...placements.map((placement) => placement.bounds)
  ]);

  return {
    version: 1,
    sourceOrganizationVersion: organizationPlan?.version || null,
    canvasBounds: bounds,
    sections: sections.map(({ placements: sectionPlacements, ...section }) => ({
      ...section,
      placementObjectIds: sectionPlacements.map((placement) => placement.objectId).sort()
    })),
    placements: placements.sort((a, b) => a.objectId.localeCompare(b.objectId)),
    unassignedObjectIds,
    metadata: {
      layoutConstants: { ...LAYOUT_CONSTANTS },
      plannedObjectIds: [...plannedObjectIds].sort(),
      requiresWorkspaceModel: !workspaceModel
    }
  };
};

export default createLayoutProposal;
