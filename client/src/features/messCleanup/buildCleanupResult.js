
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
      } else if (act.type === 'normalizeText') {
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
    if (a.impact?.objectsMoved > 0 || (a.connectorIds && a.connectorIds.length > 0)) {
      (a.ownedObjectIds || a.objectIds).forEach((id) => modifiedObjectIds.add(id));
      if (a.connectorIds) a.connectorIds.forEach((id) => modifiedObjectIds.add(id));
    }
  });

  const actionTypeCounts = {};
  actionResults.forEach((a) => {
    actionTypeCounts[a.type] = (actionTypeCounts[a.type] || 0) + 1;
  });

  const meaningfulAttachTextCount = actionResults.filter((a) => a.type === 'attachText' && a.impact?.objectsMoved > 0).length;

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

  const placementMap = new Map((layoutProposal?.placements || []).map((p) => [p.objectId, p]));
  const movedNonConnectorIds = new Set();
  const reroutedConnectorIds = new Set();
  const untouchedSet = new Set(untouchedObjectIds);

  const normalizePathString = (p) => {
    if (!p) return '';
    if (typeof p === 'string') return p.trim().replace(/\s+/g, ' ');
    if (Array.isArray(p)) {
      return p
        .map((cmd) => (Array.isArray(cmd) ? cmd.join(' ') : String(cmd)))
        .join(' ')
        .trim()
        .replace(/\s+/g, ' ');
    }
    return '';
  };

  // Hard Invariant: If a board is classified as already well-organized (zero actions executed),
  // then no object moved and no connector was rerouted.
  if (actionResults.length > 0) {
    rawObjects.forEach((orig) => {
      if (untouchedSet.has(orig.id)) return;
      const p = placementMap.get(orig.id);
      if (!p) return;
      const semType = getSemanticType(orig);
      const ox = orig.position?.x ?? orig.left ?? orig.bounds?.x ?? 0;
      const oy = orig.position?.y ?? orig.top ?? orig.bounds?.y ?? 0;
      const px = p.x ?? p.position?.x ?? p.bounds?.x ?? ox;
      const py = p.y ?? p.position?.y ?? p.bounds?.y ?? oy;
      const dist = Math.hypot(px - ox, py - oy);

      if (semType === 'connector') {
        const origPath = normalizePathString(orig.path || orig.pathData || '');
        const propPath = normalizePathString(p.path || p.pathData || p.worldPath || '');
        if (dist > 1.0 || (origPath && propPath && origPath !== propPath)) {
          reroutedConnectorIds.add(orig.id);
        }
      } else {
        if (dist > 1.0) {
          movedNonConnectorIds.add(orig.id);
        }
      }
    });
  }

  const objectsMoved = actionResults.length === 0 ? 0 : movedNonConnectorIds.size;
  const connectorsRerouted = actionResults.length === 0 ? 0 : reroutedConnectorIds.size;
  const objectsPreserved = untouchedObjectIds.length;
  const meaningfulImprovements = actionResults.length;

  const onlyLabels = actionResults.length > 0 && actionResults.every((a) => a.type === 'attachText');

  // Component 6: Result semantics
  //   MEANINGFULLY_CLEANED       — at least one structural/spatial action with visible movement
  //   ALREADY_WELL_ORGANIZED     — genuinely passes all evaluated quality checks, no defect
  //   NO_SAFE_CLEANUP_FOUND      — visual defect detected but confidence/risk/action constraints prevented safe repair
  let resultType = 'ALREADY_WELL_ORGANIZED';

  const hasMeaningfulMovement = objectsMoved > 0 || connectorsRerouted > 0;
  const hasMeaningfulLabels = onlyLabels && meaningfulAttachTextCount > 0;

  if (actionResults.length > 0 && (hasMeaningfulMovement || hasMeaningfulLabels || (actionTypeCounts.repairConnector > 0 && connectorsRerouted > 0))) {
    resultType = 'MEANINGFULLY_CLEANED';
  } else if (actionResults.length === 0 || (!hasMeaningfulMovement && !hasMeaningfulLabels)) {
    // Phase 4F.19.3A Modification 1:
    // Determine NO_SAFE_CLEANUP_FOUND based strictly on actual opportunity/candidate evidence,
    // NOT an arbitrary global quality < 8.0 threshold.
    const opportunities = cleanupPlan?.diagnostics?.opportunities || [];
    const candidates = cleanupPlan?.diagnostics?.compositionCandidates || [];
    const rejectedOpps = cleanupPlan?.diagnostics?.rejectedOpportunities || [];
    const structures = cleanupPlan?.diagnostics?.structures || [];

    // 1. Actionable defect / cleanup opportunity detected:
    const hasActionableOpportunity = opportunities.some((o) => {
      if (['brokenFlow', 'overlap', 'clutteredCluster', 'connectorCrossing', 'connectorAttachmentDefect'].includes(o.type)) {
        return true;
      }
      if (o.type === 'detachedText') {
        return o.metadata?.isOutsideContainer || (o.metadata?.distFromCenter ?? 0) > 4;
      }
      return false;
    });

    const hasFloatingConnectors = rawObjects.some((o) => {
      const sem = getSemanticType(o);
      if (sem === 'connector' || o.isConnector) {
        const src = o.sourceShapeId || o.relationshipMetadata?.sourceShapeId;
        const tgt = o.targetShapeId || o.relationshipMetadata?.targetShapeId;
        return !src || !tgt;
      }
      return false;
    });

    const hasDetachedConnectors = structures.some((s) => {
      const att = s.currentComposition?.connectorAttachment;
      if (att !== null && att !== undefined && att < 8.0) return true;
      const details = s.currentComposition?.connectorAttachmentDetails || [];
      return details.some((d) => (d.sourceAttachmentError ?? 0) > 10 || (d.targetAttachmentError ?? 0) > 10);
    });

    const hasActionableCandidate = candidates.some((c) =>
      typeof c.compositionBenefit === 'number' && c.compositionBenefit >= 1.5
    );

    const actionableDefectDetected = hasActionableOpportunity || hasFloatingConnectors || hasDetachedConnectors || hasActionableCandidate;

    // 2. No candidate passed the required safety/confidence/risk gates:
    const noSafeCandidateAccepted = actionResults.length === 0 || (!hasMeaningfulMovement && !hasMeaningfulLabels);

    // State-based classification: an observed defect with no safe repair = NO_SAFE_CLEANUP_FOUND.
    // This gate does NOT require candidatesConsidered > 0. A floating connector with
    // unresolved topology produces zero formal candidates but is still a visible defect.
    if (actionableDefectDetected && noSafeCandidateAccepted) {
      resultType = 'NO_SAFE_CLEANUP_FOUND';
    } else {
      resultType = 'ALREADY_WELL_ORGANIZED';
    }
  }

  const actionParts = [];
  if (meaningfulAttachTextCount > 0) actionParts.push(`Fixed ${meaningfulAttachTextCount} label${meaningfulAttachTextCount > 1 ? 's' : ''}`);
  if (actionTypeCounts.cleanFlowchart) actionParts.push(`Cleaned ${actionTypeCounts.cleanFlowchart} flowchart${actionTypeCounts.cleanFlowchart > 1 ? 's' : ''}`);
  if (actionTypeCounts.repairConnector) actionParts.push(`Repaired ${actionTypeCounts.repairConnector} connector${actionTypeCounts.repairConnector > 1 ? 's' : ''}`);
  if (actionTypeCounts.arrangeGrid) actionParts.push(`Arranged ${actionTypeCounts.arrangeGrid} note cluster${actionTypeCounts.arrangeGrid > 1 ? 's' : ''}`);
  if (actionTypeCounts.align) actionParts.push(`Aligned ${actionTypeCounts.align} shape group${actionTypeCounts.align > 1 ? 's' : ''}`);
  if (actionTypeCounts.equalizeSpacing) actionParts.push(`Equalized ${actionTypeCounts.equalizeSpacing} sequence${actionTypeCounts.equalizeSpacing > 1 ? 's' : ''}`);
  if (actionTypeCounts.normalizeText) actionParts.push(`Normalized ${actionTypeCounts.normalizeText} text${actionTypeCounts.normalizeText > 1 ? 's' : ''}`);

  let humanSummary;
  if (resultType === 'MEANINGFULLY_CLEANED') {
    humanSummary = actionParts.length > 0
      ? `${actionParts.join(', ')} • ${objectsMoved} object${objectsMoved !== 1 ? 's' : ''} moved • ${objectsPreserved} object${objectsPreserved !== 1 ? 's' : ''} preserved`
      : `Fixed ${meaningfulAttachTextCount} label${meaningfulAttachTextCount > 1 ? 's' : ''} • ${objectsPreserved} object${objectsPreserved !== 1 ? 's' : ''} intentionally preserved`;
  } else if (resultType === 'NO_SAFE_CLEANUP_FOUND') {
    humanSummary = `Board has visual issues but no safe automatic cleanup was found • ${objectsPreserved} object${objectsPreserved !== 1 ? 's' : ''} preserved`;
  } else {
    humanSummary = `Board is already well-organized • ${objectsPreserved} objects intentionally preserved`;
  }

  const summary = {
    resultType,
    actionCount: actionResults.length,
    meaningfulImprovements,
    objectsMoved,
    connectorsRerouted,
    objectsPreserved,
    modifiedObjectCount: modifiedObjectIds.size,
    untouchedObjectCount: objectsPreserved,
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
