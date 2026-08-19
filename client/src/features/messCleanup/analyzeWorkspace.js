import { detectSpatialClusters } from './detectClusters.js';
import { buildStructuralUnits, classifyComponent, getTextCandidates } from './classifySections.js';
import { EVIDENCE_STRENGTH, SECTION_TYPES } from './organizationTypes.js';

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a || '').localeCompare(String(b || '')));

const getObjectMap = (objects) => new Map(objects.filter((object) => object.id).map((object) => [object.id, object]));

const makeSectionId = (index, objectIds) => `section_${index + 1}_${objectIds[0] || 'unassigned'}`;

const createSection = ({ index, objectIds, classification, evidence, strength }) => ({
  id: makeSectionId(index, objectIds),
  type: classification.type,
  titleObjectId: classification.titleObjectId || null,
  objectIds: sortIds(objectIds),
  evidence: [...new Set(evidence)],
  confidence: strength,
  layoutHint: classification.layoutHint || null
});

const getComponentObjectIds = (unit, objectMap) => unit.objectIds.filter((id) => objectMap.has(id));

const expandClusterToUnits = (cluster, unitsByObjectId) => {
  const expanded = new Set();
  cluster.objectIds.forEach((objectId) => {
    const unit = unitsByObjectId.get(objectId);
    if (unit) unit.objectIds.forEach((id) => expanded.add(id));
  });
  return [...expanded];
};

export const analyzeWorkspace = (workspaceModel) => {
  const objects = [...(workspaceModel?.board?.objects || [])]
    .filter((object) => object && object.id)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const objectMap = getObjectMap(objects);
  const textCandidates = getTextCandidates(objects);
  const structuralUnits = buildStructuralUnits(objects);
  const unitsByObjectId = new Map();
  structuralUnits.forEach((unit) => unit.objectIds.forEach((objectId) => unitsByObjectId.set(objectId, unit)));

  const sections = [];
  const assignedObjectIds = new Set();

  structuralUnits
    .filter((unit) => unit.explicit && unit.objectIds.some((objectId) => objectMap.get(objectId)?.type === 'connector'))
    .forEach((unit) => {
      const objectIds = getComponentObjectIds(unit, objectMap);
      const classification = classifyComponent(objectIds, objectMap, textCandidates);
      if (classification.type === SECTION_TYPES.UNASSIGNED) return;
      sections.push(createSection({
        index: sections.length,
        objectIds,
        classification,
        evidence: [...classification.evidence, 'explicit-relationship'],
        strength: classification.strength || EVIDENCE_STRENGTH.STRONG
      }));
      objectIds.forEach((objectId) => assignedObjectIds.add(objectId));
    });

  const spatialClusters = detectSpatialClusters(objects);
  spatialClusters
    .filter((cluster) => cluster.isCandidate)
    .map((cluster) => ({
      ...cluster,
      objectIds: expandClusterToUnits(cluster, unitsByObjectId)
    }))
    .filter((cluster) => cluster.objectIds.length > 1)
    .sort((a, b) => a.objectIds[0].localeCompare(b.objectIds[0]))
    .forEach((cluster) => {
      const objectIds = cluster.objectIds.filter((objectId) => !assignedObjectIds.has(objectId));
      if (objectIds.length < 2) return;
      const classification = classifyComponent(objectIds, objectMap, textCandidates);
      if (classification.type === SECTION_TYPES.UNASSIGNED) return;
      sections.push(createSection({
        index: sections.length,
        objectIds,
        classification,
        evidence: cluster.evidence,
        strength: cluster.strength
      }));
      objectIds.forEach((objectId) => assignedObjectIds.add(objectId));
    });

  structuralUnits
    .filter((unit) => unit.explicit)
    .forEach((unit) => {
      const objectIds = getComponentObjectIds(unit, objectMap).filter((objectId) => !assignedObjectIds.has(objectId));
      if (objectIds.length === 0) return;
      const classification = classifyComponent(objectIds, objectMap, textCandidates);
      sections.push(createSection({
        index: sections.length,
        objectIds,
        classification,
        evidence: ['explicit-relationship'],
        strength: EVIDENCE_STRENGTH.STRONG
      }));
      objectIds.forEach((objectId) => assignedObjectIds.add(objectId));
    });

  objects
    .filter((object) => object.type === 'stroke' && !assignedObjectIds.has(object.id))
    .forEach((object) => {
      sections.push(createSection({
        index: sections.length,
        objectIds: [object.id],
        classification: {
          type: SECTION_TYPES.FREEFORM,
          layoutHint: 'freeform',
          titleObjectId: null
        },
        evidence: ['freeform-content'],
        strength: EVIDENCE_STRENGTH.WEAK
      }));
      assignedObjectIds.add(object.id);
    });

  const unassignedObjectIds = objects
    .map((object) => object.id)
    .filter((objectId) => !assignedObjectIds.has(objectId));

  const candidateSections = sections.map((section) => ({
    ...section,
    objectIds: sortIds(section.objectIds)
  }));

  return {
    version: 1,
    sourceModelVersion: workspaceModel?.version || null,
    structuralUnits,
    textCandidates,
    spatialClusterCandidates: spatialClusters,
    sections: candidateSections,
    unassignedObjectIds
  };
};

export default analyzeWorkspace;
