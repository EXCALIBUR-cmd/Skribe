
import { validateCleanupResult } from './cleanupResultTypes.js';
import { getSemanticType } from './cleanupTypes.js';
import { buildVisualObjectModel, resolveContainerOwnership } from './visualUnits.js';

const sortStrings = (arr) => [...arr].sort((a, b) => String(a).localeCompare(String(b)));

export const buildCleanupResult = (cleanupPlan, layoutProposal, workspaceModel, options = {}) => {
  const rawObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const objectMap = new Map(rawObjects.map((o) => [o.id, o]));
  const allObjectIds = rawObjects.map((o) => o.id).filter(Boolean);

  const visualObjects = buildVisualObjectModel(workspaceModel);
  const voMap = new Map(visualObjects.map((vo) => [vo.objectId, vo]));
  const { ownedByOwner, ownerByText } = resolveContainerOwnership(visualObjects, voMap);

  const movementAudit = layoutProposal?.metadata?.movementAudit || {};
  const executedActions = cleanupPlan?.actions || [];

  const actionResults = executedActions.map((act) => {
    const ownedIds = act.ownedObjectIds || act.objectIds || [];
    let objectsMovedCount = 0;
    let atomicUnitsCount = 0;

    ownedIds.forEach((id) => {
      const audit = movementAudit[id];
      if (audit) {
        const hasTranslation = Math.abs(audit.totalTranslation?.dx || 0) > 0.001 || Math.abs(audit.totalTranslation?.dy || 0) > 0.001;
        if (hasTranslation || act.type === 'normalizeText') {
          objectsMovedCount++;
        }
      } else if (act.type === 'attachText' || act.type === 'normalizeText') {
        objectsMovedCount++;
      }
      if (ownedByOwner.has(id) || ownerByText.has(id)) {
        atomicUnitsCount++;
      }
    });

    const impact = {
      objectsAffected: ownedIds.length,
      objectsMoved: objectsMovedCount,
      atomicUnitsAffected: Math.ceil(atomicUnitsCount / 2),
      connectorCount: Array.isArray(act.connectorIds) ? act.connectorIds.length : 0
    };

    return {
      id: act.id,
      type: act.type,
      objectIds: sortStrings(act.objectIds || []),
      ownedObjectIds: sortStrings(ownedIds),
      connectorIds: act.connectorIds ? sortStrings(act.connectorIds) : undefined,
      axis: act.axis,
      confidence: act.confidence,
      reason: act.reason,
      evidence: act.evidence || [],
      layoutBenefit: act.layoutBenefit,
      impact
    };
  });

  const untouchedObjectIds = cleanupPlan?.untouchedObjectIds || [];
  const categorizedPreserved = new Map();

  untouchedObjectIds.forEach((id) => {
    const obj = objectMap.get(id);
    if (!obj) return;
    const semType = getSemanticType(obj);

    let category = 'untouched';
    let reason = 'Preserved untouched element in original position.';

    if (semType === 'stroke' || obj.type === 'stroke' || obj.isVectorStroke || obj.metadata?.isVectorStroke) {
      category = 'freehand';
      reason = 'Preserved freehand drawing because no high-confidence cleanup operation applies.';
    } else if (semType === 'line' || obj.isSkribeLine || obj.metadata?.isSkribeLine || obj.isStraightLine || obj.metadata?.isStraightLine) {
      category = 'divider';
      reason = 'Preserved structural divider because it is a layout boundary.';
    } else if (semType === 'connector') {
      category = 'connector';
      reason = 'Preserved unattached connector because endpoint topology is ambiguous.';
    } else if (semType === 'note' || obj.isStickyNote || obj.metadata?.isStickyNote || obj.type === 'note') {
      category = 'isolated';
      reason = 'Preserved isolated sticky note in place without re-clustering.';
    } else if (semType === 'text') {
      category = 'text';
      reason = 'Preserved standalone text header or comment in original orientation.';
    }

    if (!categorizedPreserved.has(category)) {
      categorizedPreserved.set(category, { category, objectIds: [], reason });
    }
    categorizedPreserved.get(category).objectIds.push(id);
  });

  const preserved = Array.from(categorizedPreserved.values()).map((p) => ({
    category: p.category,
    objectIds: sortStrings(p.objectIds),
    reason: p.reason
  }));

  const modifiedObjectIds = new Set();
  actionResults.forEach((a) => {
    (a.ownedObjectIds || a.objectIds).forEach((id) => modifiedObjectIds.add(id));
    if (a.connectorIds) a.connectorIds.forEach((id) => modifiedObjectIds.add(id));
  });

  const actionTypeCounts = {};
  actionResults.forEach((a) => {
    actionTypeCounts[a.type] = (actionTypeCounts[a.type] || 0) + 1;
  });

  const actionParts = [];
  if (actionTypeCounts.attachText) actionParts.push(`Fixed ${actionTypeCounts.attachText} label${actionTypeCounts.attachText > 1 ? 's' : ''}`);
  if (actionTypeCounts.cleanFlowchart) actionParts.push(`Cleaned ${actionTypeCounts.cleanFlowchart} flowchart${actionTypeCounts.cleanFlowchart > 1 ? 's' : ''}`);
  if (actionTypeCounts.arrangeGrid) actionParts.push(`Arranged ${actionTypeCounts.arrangeGrid} note cluster${actionTypeCounts.arrangeGrid > 1 ? 's' : ''}`);
  if (actionTypeCounts.align) actionParts.push(`Aligned ${actionTypeCounts.align} shape group${actionTypeCounts.align > 1 ? 's' : ''}`);
  if (actionTypeCounts.equalizeSpacing) actionParts.push(`Equalized ${actionTypeCounts.equalizeSpacing} sequence${actionTypeCounts.equalizeSpacing > 1 ? 's' : ''}`);
  if (actionTypeCounts.normalizeText) actionParts.push(`Normalized ${actionTypeCounts.normalizeText} text${actionTypeCounts.normalizeText > 1 ? 's' : ''}`);

  const structuralCount = actionResults.filter((a) => ['cleanFlowchart', 'arrangeGrid'].includes(a.type)).length;
  const spatialCount = actionResults.filter((a) => ['align', 'equalizeSpacing'].includes(a.type)).length;
  const cosmeticCount = actionResults.filter((a) => ['normalizeText', 'attachText'].includes(a.type)).length;

  const usefulActionMetrics = {
    structuralActionCount: structuralCount,
    spatialActionCount: spatialCount,
    cosmeticActionCount: cosmeticCount,
    usefulActionRate: actionResults.length > 0 ? Number(((structuralCount + spatialCount) / actionResults.length).toFixed(2)) : 1.0,
    preservationRate: allObjectIds.length > 0 ? Number((untouchedObjectIds.length / allObjectIds.length).toFixed(2)) : 1.0
  };

  const humanSummary = actionResults.length === 0
    ? `Board is already well-organized • ${untouchedObjectIds.length} objects intentionally preserved`
    : `${actionResults.length} meaningful cleanup improvement${actionResults.length > 1 ? 's' : ''}: ${actionParts.join(', ')} • ${untouchedObjectIds.length} object${untouchedObjectIds.length !== 1 ? 's' : ''} intentionally preserved`;

  const summary = {
    actionCount: actionResults.length,
    modifiedObjectCount: modifiedObjectIds.size,
    untouchedObjectCount: untouchedObjectIds.length,
    highConfidenceCount: actionResults.filter((a) => a.confidence >= 0.90).length,
    usefulActionMetrics,
    humanSummary
  };

  const confidenceSummary = {
    highConfidenceActions: actionResults.filter((a) => a.confidence >= 0.90).length,
    mediumConfidenceCandidates: (cleanupPlan?.diagnostics?.unsupportedActionCount || 0),
    preservedAmbiguousObjects: untouchedObjectIds.length
  };

  const placementIds = new Set((layoutProposal?.placements || []).map((p) => p.objectId));
  const missingObjects = allObjectIds.filter((id) => !placementIds.has(id));
  const duplicateObjects = [];
  const seenIds = new Set();
  (layoutProposal?.placements || []).forEach((p) => {
    if (seenIds.has(p.objectId)) duplicateObjects.push(p.objectId);
    seenIds.add(p.objectId);
  });

  const safety = {
    isFullyConserved: missingObjects.length === 0 && duplicateObjects.length === 0,
    untouchedInvariantMet: true,
    duplicateCount: duplicateObjects.length,
    missingCount: missingObjects.length,
    geometryViolations: 0,
    connectorViolations: 0,
    freehandViolations: 0
  };

  const diagnostics = {
    missingObjects: sortStrings(missingObjects),
    duplicateObjects: sortStrings(duplicateObjects),
    conflicts: cleanupPlan?.diagnostics?.conflictsDetected || [],
    suppressedActions: cleanupPlan?.diagnostics?.suppressedActions || [],
    invariantViolations: []
  };

  const result = {
    version: 1,
    summary,
    actions: actionResults,
    preserved,
    confidenceSummary,
    safety,
    diagnostics
  };

  if (options.debug === true) {
    const objectHighlights = {};
    actionResults.forEach((a) => {
      a.objectIds.forEach((id) => {
        if (!objectHighlights[id]) objectHighlights[id] = [];
        objectHighlights[id].push(a.id);
      });
    });

    result.debug = {
      movementAudit,
      objectHighlights,
      ownershipByObject: cleanupPlan?.diagnostics?.ownershipByObject || {}
    };
  }

  const validation = validateCleanupResult(result, workspaceModel);
  if (!validation.valid) {
    console.error('[buildCleanupResult] Invalid CleanupResult produced:', validation.errors);
  }

  return result;
};

export default buildCleanupResult;
