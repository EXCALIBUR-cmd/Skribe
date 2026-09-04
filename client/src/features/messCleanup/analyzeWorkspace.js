import { detectSpatialClusters } from './detectClusters.js';
import { buildStructuralUnits, classifyComponent, detectAnnotations, getTextCandidates } from './classifySections.js';
import { EVIDENCE_STRENGTH, RELATIONSHIP_TYPES, SECTION_TYPES, TEXT_ROLES } from './organizationTypes.js';
import { analyzeWorkspaceWithOmni } from './omniClient.js';
import { validateOrganizationPlan } from './validateOrganizationPlan.js';

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a || '').localeCompare(String(b || '')));

const getObjectMap = (objects) => new Map(objects.filter((object) => object && object.id).map((object) => [object.id, object]));

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

export const runLocalSemanticAnalysis = (workspaceModel) => {
  const objects = [...(workspaceModel?.board?.objects || [])]
    .filter((object) => object && object.id)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const objectMap = getObjectMap(objects);
  const textCandidates = getTextCandidates(objects);
  const structuralUnits = buildStructuralUnits(objects);
  const unitsByObjectId = new Map();
  structuralUnits.forEach((unit) => unit.objectIds.forEach((objectId) => unitsByObjectId.set(objectId, unit)));

  const sections = [];
  const relationships = [];
  const annotationsResult = [];
  const assignedObjectIds = new Set();

  const strokeObjects = objects.filter((o) => o.type === 'stroke');
  const nonStrokeObjects = objects.filter((o) => o.type !== 'stroke');
  const detectedAnns = detectAnnotations(strokeObjects, nonStrokeObjects);
  const strokeAnnotationMap = new Map();
  detectedAnns.forEach((ann) => strokeAnnotationMap.set(ann.strokeId, ann));

  const attachAnnotationsToSection = (section) => {
    const targetIdsInSection = new Set(section.objectIds);
    detectedAnns.forEach((ann) => {
      if (assignedObjectIds.has(ann.strokeId)) return;
      if (targetIdsInSection.has(ann.targetId)) {
        section.objectIds.push(ann.strokeId);
        section.objectIds = sortIds(section.objectIds);
        if (!section.evidence.includes('freehand-annotation')) {
          section.evidence.push('freehand-annotation');
        }
        assignedObjectIds.add(ann.strokeId);
        annotationsResult.push({
          strokeId: ann.strokeId,
          targetId: ann.targetId,
          confidence: ann.confidence,
          evidence: ann.evidence
        });
        relationships.push({
          sourceObjectId: ann.strokeId,
          targetObjectIds: [ann.targetId],
          relationship: RELATIONSHIP_TYPES.ANNOTATION_TARGET,
          confidence: ann.confidence,
          evidence: ann.evidence
        });
      }
    });
  };

  structuralUnits
    .filter((unit) => unit.explicit && unit.objectIds.some((objectId) => objectMap.get(objectId)?.type === 'connector'))
    .forEach((unit) => {
      const objectIds = getComponentObjectIds(unit, objectMap);
      const classification = classifyComponent(objectIds, objectMap, textCandidates);
      if (classification.type === SECTION_TYPES.UNASSIGNED) return;

      const diagramPos = objectMap.get(objectIds[0])?.position || { x: 0, y: 0 };
      const nearbyHeading = textCandidates
        .filter((tc) => {
          if (assignedObjectIds.has(tc.objectId)) return false;
          if (tc.role !== TEXT_ROLES.TITLE && tc.role !== TEXT_ROLES.HEADING && tc.role !== TEXT_ROLES.SUBHEADING) return false;
          const hObj = objectMap.get(tc.objectId);
          if (!hObj) return false;
          const dy = diagramPos.y - (hObj.position?.y || 0);
          return dy >= 0 && dy <= 250;
        })
        .sort((a, b) => {
          const dyA = diagramPos.y - (objectMap.get(a.objectId)?.position?.y || 0);
          const dyB = diagramPos.y - (objectMap.get(b.objectId)?.position?.y || 0);
          return dyA - dyB;
        })[0] || null;

      const finalObjectIds = [...objectIds];
      let titleId = classification.titleObjectId;

      if (nearbyHeading) {
        finalObjectIds.push(nearbyHeading.objectId);
        titleId = nearbyHeading.objectId;
        assignedObjectIds.add(nearbyHeading.objectId);
        relationships.push({
          sourceObjectId: nearbyHeading.objectId,
          targetObjectIds: sortIds(objectIds),
          relationship: RELATIONSHIP_TYPES.DIAGRAM_TITLE,
          confidence: 0.85,
          evidence: ['associated-heading', 'spatial-proximity']
        });
      }

      const sec = createSection({
        index: sections.length,
        objectIds: finalObjectIds,
        classification: { ...classification, titleObjectId: titleId },
        evidence: [...classification.evidence, 'explicit-relationship', ...(nearbyHeading ? ['associated-heading'] : [])],
        strength: classification.strength || EVIDENCE_STRENGTH.STRONG
      });
      objectIds.forEach((objectId) => assignedObjectIds.add(objectId));
      attachAnnotationsToSection(sec);
      sections.push(sec);
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
      const objectIds = cluster.objectIds.filter((objectId) => {
        if (assignedObjectIds.has(objectId)) return false;
        const candidate = textCandidates.find((tc) => tc.objectId === objectId);
        return candidate?.role !== TEXT_ROLES.TITLE;
      });
      if (objectIds.length < 2) return;

      const clusterObjects = objectIds.map((id) => objectMap.get(id)).filter(Boolean);
      const isPureTextCluster = clusterObjects.every((o) => o.type === 'text' && !o.metadata?.isStickyNote);
      if (isPureTextCluster) return;

      const classification = classifyComponent(objectIds, objectMap, textCandidates);
      if (classification.type === SECTION_TYPES.UNASSIGNED) return;

      const clusterY = Math.min(...objectIds.map((id) => objectMap.get(id)?.position?.y || 0));
      const nearbyHeading = textCandidates
        .filter((tc) => {
          if (assignedObjectIds.has(tc.objectId)) return false;
          if (tc.role !== TEXT_ROLES.TITLE && tc.role !== TEXT_ROLES.HEADING && tc.role !== TEXT_ROLES.SUBHEADING) return false;
          const hObj = objectMap.get(tc.objectId);
          if (!hObj) return false;
          const dy = clusterY - (hObj.position?.y || 0);
          return dy >= 0 && dy <= 200;
        })
        .sort((a, b) => {
          const dyA = clusterY - (objectMap.get(a.objectId)?.position?.y || 0);
          const dyB = clusterY - (objectMap.get(b.objectId)?.position?.y || 0);
          return dyA - dyB;
        })[0] || null;

      const finalObjectIds = [...objectIds];
      let titleId = classification.titleObjectId;

      if (nearbyHeading) {
        finalObjectIds.push(nearbyHeading.objectId);
        titleId = nearbyHeading.objectId;
        assignedObjectIds.add(nearbyHeading.objectId);
        relationships.push({
          sourceObjectId: nearbyHeading.objectId,
          targetObjectIds: sortIds(objectIds),
          relationship: RELATIONSHIP_TYPES.NOTES_HEADING,
          confidence: 0.85,
          evidence: ['associated-heading', 'spatial-proximity']
        });
      }

      const secEvidence = [...cluster.evidence, ...(nearbyHeading ? ['associated-heading'] : [])];

      const strokeIdsInCluster = finalObjectIds.filter((id) => objectMap.get(id)?.type === 'stroke');
      const nonStrokeObjectsInCluster = finalObjectIds.map((id) => objectMap.get(id)).filter((o) => o && o.type !== 'stroke');
      if (strokeIdsInCluster.length > 0 && nonStrokeObjectsInCluster.length > 0) {
        const clusterStrokes = strokeIdsInCluster.map((id) => objectMap.get(id)).filter(Boolean);
        const annMatches = detectAnnotations(clusterStrokes, nonStrokeObjectsInCluster);
        annMatches.forEach((ann) => {
          if (!secEvidence.includes('freehand-annotation')) {
            secEvidence.push('freehand-annotation');
          }
          annotationsResult.push({
            strokeId: ann.strokeId,
            targetId: ann.targetId,
            confidence: ann.confidence,
            evidence: ann.evidence
          });
          relationships.push({
            sourceObjectId: ann.strokeId,
            targetObjectIds: [ann.targetId],
            relationship: RELATIONSHIP_TYPES.ANNOTATION_TARGET,
            confidence: ann.confidence,
            evidence: ann.evidence
          });
        });
      }

      const sec = createSection({
        index: sections.length,
        objectIds: finalObjectIds,
        classification: { ...classification, titleObjectId: titleId },
        evidence: secEvidence,
        strength: cluster.strength
      });
      objectIds.forEach((objectId) => assignedObjectIds.add(objectId));
      sections.push(sec);
    });

  const headingCandidates = textCandidates
    .filter((tc) => (tc.role === TEXT_ROLES.TITLE || tc.role === TEXT_ROLES.HEADING || tc.role === TEXT_ROLES.SUBHEADING) && !assignedObjectIds.has(tc.objectId))
    .sort((a, b) => (objectMap.get(a.objectId)?.position?.y || 0) - (objectMap.get(b.objectId)?.position?.y || 0));

  headingCandidates.forEach((heading) => {
    if (assignedObjectIds.has(heading.objectId)) return;
    const hObj = objectMap.get(heading.objectId);
    if (!hObj) return;

    const sectionObjectIds = [heading.objectId];
    assignedObjectIds.add(heading.objectId);

    const bodyCandidates = textCandidates.filter((tc) => {
      if (assignedObjectIds.has(tc.objectId)) return false;
      if (tc.role !== TEXT_ROLES.BODY && tc.role !== TEXT_ROLES.LABEL) return false;
      const bObj = objectMap.get(tc.objectId);
      if (!bObj) return false;
      const dy = (bObj.position?.y || 0) - (hObj.position?.y || 0);
      if (dy <= 0 || dy > 350) return false;

      const hasInterveningHeading = textCandidates.some((otherTc) => {
        if (otherTc.objectId === heading.objectId || otherTc.objectId === tc.objectId) return false;
        if (otherTc.role !== TEXT_ROLES.TITLE && otherTc.role !== TEXT_ROLES.HEADING && otherTc.role !== TEXT_ROLES.SUBHEADING) return false;
        const otherObj = objectMap.get(otherTc.objectId);
        if (!otherObj) return false;
        const otherY = otherObj.position?.y || 0;
        return otherY > (hObj.position?.y || 0) && otherY < (bObj.position?.y || 0);
      });

      return !hasInterveningHeading;
    });

    const addedBodyIds = [];
    bodyCandidates.forEach((body) => {
      sectionObjectIds.push(body.objectId);
      addedBodyIds.push(body.objectId);
      assignedObjectIds.add(body.objectId);
    });

    if (addedBodyIds.length > 0) {
      relationships.push({
        sourceObjectId: heading.objectId,
        targetObjectIds: sortIds(addedBodyIds),
        relationship: RELATIONSHIP_TYPES.HEADING_BODY,
        confidence: 0.9,
        evidence: ['aligned-left', 'vertical-proximity', 'heading-before-body']
      });
    }

    const sec = createSection({
      index: sections.length,
      objectIds: sectionObjectIds,
      classification: {
        type: SECTION_TYPES.HEADING,
        layoutHint: 'flow',
        titleObjectId: heading.objectId
      },
      evidence: ['heading-body-association'],
      strength: EVIDENCE_STRENGTH.STRONG
    });
    attachAnnotationsToSection(sec);
    sections.push(sec);
  });

  structuralUnits
    .filter((unit) => unit.explicit)
    .forEach((unit) => {
      const objectIds = getComponentObjectIds(unit, objectMap).filter((objectId) => !assignedObjectIds.has(objectId));
      if (objectIds.length === 0) return;
      const classification = classifyComponent(objectIds, objectMap, textCandidates);
      const sec = createSection({
        index: sections.length,
        objectIds,
        classification,
        evidence: ['explicit-relationship'],
        strength: EVIDENCE_STRENGTH.STRONG
      });
      objectIds.forEach((objectId) => assignedObjectIds.add(objectId));
      attachAnnotationsToSection(sec);
      sections.push(sec);
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

  const mainTitleCandidate = textCandidates.find((c) => c.role === TEXT_ROLES.TITLE) || textCandidates.find((c) => c.role === TEXT_ROLES.HEADING);

  const hierarchy = [
    {
      id: 'doc_root',
      type: 'document',
      titleObjectId: mainTitleCandidate?.objectId || null,
      childSectionIds: candidateSections.map((s) => s.id),
      childIds: candidateSections.map((s) => s.id),
      contentObjectIds: sortIds(candidateSections.flatMap((s) => s.objectIds)),
      confidence: mainTitleCandidate ? 0.95 : 0.75,
      evidence: mainTitleCandidate ? ['title-detected', 'hierarchical-sections'] : ['implicit-sections']
    }
  ];

  return {
    version: 1,
    sourceModelVersion: workspaceModel?.version || null,
    structuralUnits,
    textCandidates,
    spatialClusterCandidates: spatialClusters,
    sections: candidateSections,
    relationships,
    hierarchy,
    annotations: annotationsResult,
    unassignedObjectIds
  };
};

export const analyzeWorkspace = (workspaceModel, screenshot = null) => {
  if (screenshot && typeof screenshot === 'string' && screenshot.trim()) {
    return (async () => {
      try {
        const rawPlan = await analyzeWorkspaceWithOmni(workspaceModel, screenshot);
        return validateOrganizationPlan(workspaceModel, rawPlan);
      } catch (err) {
        console.warn(
          `[MessCleanup] External AI semantic analysis unavailable (${err.message}). Falling back gracefully to deterministic local semantic engine.`
        );
        return runLocalSemanticAnalysis(workspaceModel);
      }
    })();
  }

  return runLocalSemanticAnalysis(workspaceModel);
};

export default analyzeWorkspace;

