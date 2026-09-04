
import {
  HIGH_CONFIDENCE,
  MEDIUM_CONFIDENCE,
  LOW_CONFIDENCE,
  validateCleanupPlan
} from './cleanupPlanTypes.js';
import { buildSemanticScene } from './semanticSceneAdapter.js';
import { buildVisualObjectModel, resolveContainerOwnership } from './visualUnits.js';
import { getSemanticType } from './cleanupTypes.js';
import { recoverConnectorTopology } from './connectorTopology.js';
import {
  detectCleanupOpportunities,
  rankAndSelectOpportunities
} from './cleanupOpportunities.js';
import { resolveCleanupOpportunities } from './resolveCleanupOpportunity.js';

const sortStrings = (arr) => [...(arr || [])].sort((a, b) => String(a).localeCompare(String(b)));

export const ACTION_PRIORITY = Object.freeze({
  attachText: 1,
  cleanFlowchart: 2,
  arrangeGrid: 3,
  align: 4,
  equalizeSpacing: 5,
  normalizeText: 6,
  preserve: 7
});

export const buildCleanupPlan = (semanticSceneInput, workspaceModel, options = {}) => {
  let sceneInput = semanticSceneInput;
  let wsModel = workspaceModel;

  if (!wsModel && sceneInput && (sceneInput.board || sceneInput.objects || sceneInput.canvas)) {
    wsModel = sceneInput;
    sceneInput = null;
  }

  const rawObjects = wsModel?.board?.objects || wsModel?.objects || [];
  const allObjectIds = rawObjects.map((o) => o.id).filter(Boolean);
  const objectMap = new Map(rawObjects.map((o) => [o.id, o]));

  let semanticScene = sceneInput;
  if (!semanticScene || !Array.isArray(semanticScene.groups)) {
    semanticScene = buildSemanticScene(wsModel, null);
  }

  const visualObjects = buildVisualObjectModel(wsModel);
  const voMap = new Map(visualObjects.map((vo) => [vo.objectId, vo]));
  const ownership = resolveContainerOwnership(visualObjects, voMap);
  const { ownedByOwner } = ownership;

  const connectorObjects = rawObjects.filter((o) => getSemanticType(o) === 'connector');
  const explicitEdges = [];

  connectorObjects.forEach((conn) => {
    let srcId = conn.sourceShapeId || conn.relationshipMetadata?.sourceShapeId || null;
    let tgtId = conn.targetShapeId || conn.relationshipMetadata?.targetShapeId || null;

    if (!srcId || !tgtId) {
      const containers = rawObjects.filter((o) => ['shape', 'note'].includes(getSemanticType(o)));
      const topo = recoverConnectorTopology(conn, containers);
      srcId = topo.sourceShapeId;
      tgtId = topo.targetShapeId;
    }

    if (srcId && tgtId && objectMap.has(srcId) && objectMap.has(tgtId)) {
      const srcObj = objectMap.get(srcId);
      const tgtObj = objectMap.get(tgtId);
      const srcSem = getSemanticType(srcObj);
      const tgtSem = getSemanticType(tgtObj);

      if (srcSem === 'shape' && tgtSem === 'shape') {
        explicitEdges.push({
          connId: conn.id,
          srcId,
          tgtId,
          confidence: 0.96,
          evidence: ['explicit-connector-topology']
        });
      }
    }
  });

  const allOpportunities = detectCleanupOpportunities(wsModel, semanticScene, options);

  const {
    selectedOpportunities,
    rejectedOpportunities: budgetRejected,
    budgetReport
  } = rankAndSelectOpportunities(allOpportunities, {
    totalObjectCount: allObjectIds.length,
    ...options
  });

  const {
    actions: rawActions,
    rejectedOpportunities: resolutionRejected
  } = resolveCleanupOpportunities(selectedOpportunities, {
    objectMap,
    semanticScene,
    explicitEdges,
    ownership
  });

  const prioritizedCandidates = [...rawActions].sort((a, b) => {
    const pA = ACTION_PRIORITY[a.type] || 99;
    const pB = ACTION_PRIORITY[b.type] || 99;
    if (pA !== pB) return pA - pB;
    return String(a.id).localeCompare(String(b.id));
  });

  const ownershipByObject = new Map();
  const layoutOwnership = new Map();
  const attachedToContainer = new Map();
  const containerAttachedTexts = new Map();

  const conflictsDetected = [];
  const suppressedActions = [];
  const suppressionReasons = [];
  const resolvedActions = [];

  ownedByOwner.forEach((textIds, containerId) => {
    textIds.forEach((tId) => {
      attachedToContainer.set(tId, containerId);
      if (!containerAttachedTexts.has(containerId)) {
        containerAttachedTexts.set(containerId, new Set());
      }
      containerAttachedTexts.get(containerId).add(tId);
    });
  });

  for (const action of prioritizedCandidates) {
    if (action.type === 'attachText') {
      const [containerId, textId] = action.objectIds || [];
      const owned = [containerId, textId];
      action.ownedObjectIds = sortStrings(owned);
      resolvedActions.push(action);
      ownershipByObject.set(containerId, action.id);
      ownershipByObject.set(textId, action.id);
      continue;
    }

    if (action.type === 'cleanFlowchart') {
      const nodeIds = action.objectIds || [];
      const connIds = action.connectorIds || [];
      const owned = new Set([...nodeIds, ...connIds]);

      nodeIds.forEach((nId) => {
        const texts = containerAttachedTexts.get(nId) || new Set();
        texts.forEach((tId) => owned.add(tId));
      });

      action.ownedObjectIds = sortStrings(Array.from(owned));
      resolvedActions.push(action);

      action.ownedObjectIds.forEach((id) => {
        layoutOwnership.set(id, action.id);
        ownershipByObject.set(id, action.id);
      });
      continue;
    }

    if (action.type === 'arrangeGrid') {
      const stickyIds = action.objectIds || [];
      const conflictingOwner = stickyIds.find((id) => layoutOwnership.has(id));

      if (conflictingOwner) {
        const ownerActionId = layoutOwnership.get(conflictingOwner);
        suppressedActions.push(action.id);
        suppressionReasons.push({
          actionId: action.id,
          reason: `Object '${conflictingOwner}' is already owned by higher-priority action '${ownerActionId}'`
        });
        conflictsDetected.push(`Conflict: arrangeGrid '${action.id}' subsumed by '${ownerActionId}'`);
        continue;
      }

      const owned = new Set(stickyIds);
      stickyIds.forEach((nId) => {
        const texts = containerAttachedTexts.get(nId) || new Set();
        texts.forEach((tId) => owned.add(tId));
      });

      action.ownedObjectIds = sortStrings(Array.from(owned));
      resolvedActions.push(action);

      action.ownedObjectIds.forEach((id) => {
        layoutOwnership.set(id, action.id);
        ownershipByObject.set(id, action.id);
      });
      continue;
    }

    if (action.type === 'align') {
      const targetIds = action.objectIds || [];
      const conflictingOwner = targetIds.find((id) => layoutOwnership.has(id));

      if (conflictingOwner) {
        const ownerActionId = layoutOwnership.get(conflictingOwner);
        suppressedActions.push(action.id);
        suppressionReasons.push({
          actionId: action.id,
          reason: `Objects in align action are already subsumed by higher-priority action '${ownerActionId}'`
        });
        conflictsDetected.push(`Conflict: align '${action.id}' subsumed by '${ownerActionId}'`);
        continue;
      }

      const owned = new Set(targetIds);
      targetIds.forEach((nId) => {
        const texts = containerAttachedTexts.get(nId) || new Set();
        texts.forEach((tId) => owned.add(tId));
      });

      action.ownedObjectIds = sortStrings(Array.from(owned));
      resolvedActions.push(action);

      action.ownedObjectIds.forEach((id) => {
        layoutOwnership.set(id, action.id);
        ownershipByObject.set(id, action.id);
      });
      continue;
    }

    if (action.type === 'equalizeSpacing') {
      const targetIds = action.objectIds || [];
      const conflictingOwner = targetIds.find((id) => layoutOwnership.has(id));

      if (conflictingOwner) {
        const ownerActionId = layoutOwnership.get(conflictingOwner);
        suppressedActions.push(action.id);
        suppressionReasons.push({
          actionId: action.id,
          reason: `Objects in equalizeSpacing action are already subsumed by higher-priority action '${ownerActionId}'`
        });
        conflictsDetected.push(`Conflict: equalizeSpacing '${action.id}' subsumed by '${ownerActionId}'`);
        continue;
      }

      const owned = new Set(targetIds);
      targetIds.forEach((nId) => {
        const texts = containerAttachedTexts.get(nId) || new Set();
        texts.forEach((tId) => owned.add(tId));
      });

      action.ownedObjectIds = sortStrings(Array.from(owned));
      resolvedActions.push(action);

      action.ownedObjectIds.forEach((id) => {
        layoutOwnership.set(id, action.id);
        ownershipByObject.set(id, action.id);
      });
      continue;
    }

    if (action.type === 'normalizeText') {
      const textId = action.objectIds[0];
      if (attachedToContainer.has(textId)) {
        const parentContainerId = attachedToContainer.get(textId);
        suppressedActions.push(action.id);
        suppressionReasons.push({
          actionId: action.id,
          reason: `Text '${textId}' is attached to container '${parentContainerId}' and cannot be independently normalized`
        });
        conflictsDetected.push(`Conflict: normalizeText '${action.id}' suppressed due to container attachment to '${parentContainerId}'`);
        continue;
      }

      if (layoutOwnership.has(textId)) {
        const ownerActionId = layoutOwnership.get(textId);
        suppressedActions.push(action.id);
        suppressionReasons.push({
          actionId: action.id,
          reason: `Text '${textId}' is already owned by action '${ownerActionId}'`
        });
        conflictsDetected.push(`Conflict: normalizeText '${action.id}' subsumed by '${ownerActionId}'`);
        continue;
      }

      action.ownedObjectIds = [textId];
      resolvedActions.push(action);
      layoutOwnership.set(textId, action.id);
      ownershipByObject.set(textId, action.id);
      continue;
    }

    if (action.type === 'preserve') {
      const targetIds = action.objectIds || [];
      const conflictingOwner = targetIds.find((id) => layoutOwnership.has(id));
      if (conflictingOwner) {
        conflictsDetected.push(`Conflict: preserve action '${action.id}' conflicts with modifying action '${layoutOwnership.get(conflictingOwner)}'`);
        continue;
      }
      action.ownedObjectIds = sortStrings(targetIds);
      resolvedActions.push(action);
      targetIds.forEach((id) => ownershipByObject.set(id, action.id));
    }
  }

  const executableActions = resolvedActions.filter((a) => a.confidence >= HIGH_CONFIDENCE);

  const allModifiedObjectIds = new Set();
  executableActions.forEach((a) => {
    if (a.type !== 'preserve') {
      (a.ownedObjectIds || a.objectIds).forEach((id) => allModifiedObjectIds.add(id));
      if (Array.isArray(a.connectorIds)) {
        a.connectorIds.forEach((id) => allModifiedObjectIds.add(id));
      }
    }
  });

  const untouchedObjectIds = sortStrings(
    allObjectIds.filter((id) => !allModifiedObjectIds.has(id))
  );

  const allSuppressedActions = [...suppressedActions];
  const allSuppressionReasons = [...suppressionReasons];

  (budgetRejected || []).forEach((rej) => {
    if (rej.supersededBy || rej.reason?.includes('subsumed') || rej.reason?.includes('claimed') || rej.reason?.includes('Conflict')) {
      const actId = rej.actionId || (rej.id.startsWith('opp_') ? rej.id.replace(/^opp_/, 'act_') : `act_${rej.id}`);
      if (!allSuppressedActions.includes(actId)) {
        allSuppressedActions.push(actId);
      }
      allSuppressionReasons.push({
        actionId: actId,
        reason: rej.reason.includes('subsumed by higher-priority action')
          ? rej.reason
          : `${rej.reason}: subsumed by higher-priority action`
      });
      conflictsDetected.push(`Conflict: opportunity '${rej.id}' suppressed: ${rej.reason}`);
    }
  });

  const diagnostics = {
    opportunities: allOpportunities,
    selectedOpportunities,
    rejectedOpportunities: [...(budgetRejected || []), ...(resolutionRejected || [])],
    budgetReport,
    usefulActionMetrics: {
      structuralActionCount: executableActions.filter((a) => ['cleanFlowchart', 'arrangeGrid'].includes(a.type)).length,
      spatialActionCount: executableActions.filter((a) => ['align', 'equalizeSpacing'].includes(a.type)).length,
      cosmeticActionCount: executableActions.filter((a) => ['normalizeText', 'attachText'].includes(a.type)).length
    },
    actionCount: executableActions.length,
    highConfidenceActionCount: executableActions.filter((a) => a.confidence >= HIGH_CONFIDENCE).length,
    untouchedObjectCount: untouchedObjectIds.length,
    unsupportedActionCount: allOpportunities.length - executableActions.length,
    actionOrder: executableActions.map((a) => a.id),
    ownershipByObject: Object.fromEntries(ownershipByObject.entries()),
    conflictsDetected,
    suppressedActions: allSuppressedActions,
    suppressionReasons: allSuppressionReasons
  };

  const plan = {
    version: 1,
    actions: executableActions,
    untouchedObjectIds,
    diagnostics
  };

  const validation = validateCleanupPlan(plan, wsModel);
  if (!validation.valid) {
    console.error('[buildCleanupPlan] Generated invalid plan:', validation.errors);
  }

  return plan;
};

export default buildCleanupPlan;
