import { buildVisualObjectModel, resolveContainerOwnership, reconstructVisualUnits } from './visualUnits.js';

const TIER_NAMES = { 0: 'explicit-metadata', 1: 'shared-element-id', 2: 'geometric-containment' };

const isEnabled = () =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('debugBinding');

const sanitizeId = (id) => (id ? String(id).slice(0, 64) : null);
const roundCoord = (n) => (typeof n === 'number' ? Math.round(n) : null);
const sanitizeBounds = (b) =>
  b ? { x: roundCoord(b.x), y: roundCoord(b.y), w: roundCoord(b.width), h: roundCoord(b.height) } : null;
const sanitizeCenter = (c) => (c ? { x: roundCoord(c.x), y: roundCoord(c.y) } : null);

const isPointInside = (point, box, tolerance = 10) =>
  point.x >= box.x - tolerance &&
  point.x <= box.x + box.width + tolerance &&
  point.y >= box.y - tolerance &&
  point.y <= box.y + box.height + tolerance;

const evaluateTier1Text = (textVo) => {
  const rm = textVo.originalObject?.relationshipMetadata || {};
  if (rm.parentShapeId || textVo.parentObjectId) {
    return {
      pass: true,
      mechanism: rm.parentShapeId ? 'parentShapeId' : 'parentObjectId',
      parentShapeId: sanitizeId(rm.parentShapeId),
      parentObjectId: sanitizeId(textVo.parentObjectId),
    };
  }
  return { pass: false, reason: 'no parentShapeId or parentObjectId on text', parentShapeId: null };
};

const evaluateTier1Container = (containerVo) => {
  const rm = containerVo?.originalObject?.relationshipMetadata || {};
  const atid = rm.attachedTextId || containerVo?.attachedTextIds?.[0] || null;
  return atid
    ? { pass: true, attachedTextId: sanitizeId(atid) }
    : { pass: false, reason: 'no attachedTextId on container', attachedTextId: null };
};

const evaluateTier2 = (textVo, allVos) => {
  const textEid = textVo.originalObject?.elementId;
  if (!textEid) return { pass: false, reason: 'text has no elementId', textElementId: null };
  const sibling = allVos.find(
    (vo) =>
      vo.objectId !== textVo.objectId &&
      (vo.kind === 'shape' || vo.kind === 'sticky-note') &&
      vo.originalObject?.elementId === textEid
  );
  return sibling
    ? { pass: true, textElementId: sanitizeId(textEid), containerObjectId: sanitizeId(sibling.objectId) }
    : { pass: false, reason: 'no container shares elementId', textElementId: sanitizeId(textEid) };
};

const evaluateTier3 = (textVo, containers) => {
  const hits = containers
    .filter((c) => c.objectId !== textVo.objectId && isPointInside(textVo.center, c.bounds))
    .map((c) => ({ containerObjectId: sanitizeId(c.objectId), containerBounds: sanitizeBounds(c.bounds), area: Math.round(c.bounds.width * c.bounds.height) }))
    .sort((a, b) => a.area - b.area);
  if (hits.length > 0) {
    return { pass: true, textCenter: sanitizeCenter(textVo.center), textBounds: sanitizeBounds(textVo.bounds), bestContainer: hits[0], allHits: hits };
  }
  return {
    pass: false,
    reason: 'text center not inside any container bounds',
    textCenter: sanitizeCenter(textVo.center),
    textBounds: sanitizeBounds(textVo.bounds),
    rawPosition: textVo.originalObject?.position ? { x: roundCoord(textVo.originalObject.position.x), y: roundCoord(textVo.originalObject.position.y) } : null,
    nearestContainers: containers.slice(0, 4).map((c) => ({ id: sanitizeId(c.objectId), bounds: sanitizeBounds(c.bounds) })),
  };
};

const evaluateTier4 = (textVo, candidateContainerVo, semanticScene) => {
  if (!semanticScene || !Array.isArray(semanticScene.groups)) return { result: 'no-scene' };
  const textId = textVo.objectId;
  const containerId = candidateContainerVo?.objectId;
  const textGroup = semanticScene.groups.find((g) => g.objectIds?.includes(textId));
  const containerGroup = containerId ? semanticScene.groups.find((g) => g.objectIds?.includes(containerId)) : null;
  if (!textGroup) return { result: 'no-group', textGroupId: null, containerGroupId: sanitizeId(containerGroup?.id) };
  if (!containerId) return { result: 'text-in-group-no-candidate', textGroupId: sanitizeId(textGroup.id) };
  if (textGroup.id === containerGroup?.id) return { result: 'same-group', groupId: sanitizeId(textGroup.id) };
  return { result: 'different-groups', textGroupId: sanitizeId(textGroup.id), containerGroupId: sanitizeId(containerGroup?.id) };
};

const buildTextReport = (textVo, ownerByText, ownerTierByText, allVos, semanticScene) => {
  const containers = allVos.filter((vo) => vo.kind === 'shape' || vo.kind === 'sticky-note');
  const winningTier = ownerTierByText.get(textVo.objectId);
  const resolvedOwnerId = ownerByText.get(textVo.objectId) || null;
  const candidateVo = resolvedOwnerId ? allVos.find((v) => v.objectId === resolvedOwnerId) : null;
  const winningTierName = TIER_NAMES[winningTier] ?? 'standalone';
  return {
    textObjectId: sanitizeId(textVo.objectId),
    textContent: typeof textVo.text === 'string' ? textVo.text.slice(0, 80) : null,
    textBounds: sanitizeBounds(textVo.bounds),
    textCenter: sanitizeCenter(textVo.center),
    rawPosition: textVo.originalObject?.position ? { x: roundCoord(textVo.originalObject.position.x), y: roundCoord(textVo.originalObject.position.y) } : null,
    rotation: textVo.originalRotation,
    rotationNormalized: textVo.rotation !== textVo.originalRotation,
    tier1ExplicitMetadata: evaluateTier1Text(textVo),
    tier2SharedElementId: evaluateTier2(textVo, allVos),
    tier3GeometricContainment: evaluateTier3(textVo, containers),
    tier4SemanticGroup: evaluateTier4(textVo, candidateVo, semanticScene),
    winningTier: winningTierName,
    winningOwnerObjectId: sanitizeId(resolvedOwnerId),
  };
};

const buildContainerReport = (containerVo, ownerByText) => {
  const rm = containerVo.originalObject?.relationshipMetadata || {};
  const resolvedTextIds = Array.from(ownerByText.entries())
    .filter(([, ownerId]) => ownerId === containerVo.objectId)
    .map(([textId]) => sanitizeId(textId));
  return {
    containerObjectId: sanitizeId(containerVo?.objectId),
    containerKind: containerVo?.kind || null,
    containerShapeType: containerVo?.shapeType || null,
    containerBounds: sanitizeBounds(containerVo?.bounds),
    containerCenter: sanitizeCenter(containerVo?.center),
    rawPosition: containerVo?.originalObject?.position ? { x: roundCoord(containerVo.originalObject.position.x), y: roundCoord(containerVo.originalObject.position.y) } : null,
    elementId: sanitizeId(containerVo?.originalObject?.elementId),
    tier1ExplicitMetadata: evaluateTier1Container(containerVo),
    metadataAttachedTextIds: containerVo?.attachedTextIds?.map(sanitizeId) || [],
    resolvedTextIds,
  };
};

const buildConnectorReport = (connVo, atomicUnits) => {
  const cm = connVo.connectorMetadata || {};
  const rm = connVo.originalObject?.relationshipMetadata || {};
  const ownerUnit = atomicUnits?.find((u) => u.objectIds?.includes(connVo.objectId));
  return {
    connectorObjectId: sanitizeId(connVo.objectId),
    detectedSourceId: sanitizeId(cm.sourceObjectId),
    detectedTargetId: sanitizeId(cm.targetObjectId),
    metadataSourceShapeId: sanitizeId(rm.sourceShapeId),
    metadataTargetShapeId: sanitizeId(rm.targetShapeId),
    connectorType: cm.connectorType || null,
    inGraphUnit: !!ownerUnit,
    graphUnitId: sanitizeId(ownerUnit?.unitId),
  };
};

const buildFreeformReport = (freeformUnit) => ({
  unitId: sanitizeId(freeformUnit.unitId),
  strokeCount: freeformUnit.objectIds?.length || 0,
  strokeObjectIds: (freeformUnit.objectIds || []).map(sanitizeId),
  bounds: sanitizeBounds(freeformUnit.originalBounds),
  isAtomic: true,
});

export const runBindingDiagnostic = (workspaceModel, semanticScene, atomicUnits) => {
  if (!isEnabled()) return null;

  try {
    const visualObjects = buildVisualObjectModel(workspaceModel);
    const objectMap = new Map(visualObjects.map((vo) => [vo.objectId, vo]));
    const { ownerByText, ownerTierByText } = resolveContainerOwnership(visualObjects, objectMap);

    const actualAtomicUnits = atomicUnits || reconstructVisualUnits(visualObjects, semanticScene).atomicUnits;

    const textVos = visualObjects.filter((vo) => vo.kind === 'text');
    const containerVos = visualObjects.filter((vo) => vo.kind === 'shape' || vo.kind === 'sticky-note');
    const connectorVos = visualObjects.filter((vo) => vo.kind === 'connector');
    const lineVos = visualObjects.filter((vo) => vo.kind === 'line');
    const freeformUnits = (actualAtomicUnits || []).filter((u) => u.type === 'freeform-unit');

    const textReports = textVos.map((vo) => buildTextReport(vo, ownerByText, ownerTierByText, visualObjects, semanticScene));
    const containerReports = containerVos.map((vo) => buildContainerReport(vo, ownerByText));
    const connectorReports = connectorVos.map((vo) => buildConnectorReport(vo, actualAtomicUnits));
    const lineReports = lineVos.map((vo) => ({
      lineObjectId: sanitizeId(vo.objectId),
      bounds: sanitizeBounds(vo.bounds),
      center: sanitizeCenter(vo.center),
      isVertical: (vo.bounds?.height || 0) > (vo.bounds?.width || 0) * 2,
    }));
    const freeformReports = freeformUnits.map(buildFreeformReport);

    const winnerTally = { 'explicit-metadata': 0, 'shared-element-id': 0, 'geometric-containment': 0, standalone: 0, unresolved: 0 };
    textReports.forEach((r) => {
      if (r.winningTier in winnerTally) winnerTally[r.winningTier]++;
      else winnerTally.unresolved++;
    });

    const rawObjects = workspaceModel?.board?.objects || [];
    const sourceIds = new Set(rawObjects.map((o) => o.id));
    const missingSourceIds = [];
    const duplicateSourceIds = [];

    const unitClaimCount = new Map();
    (actualAtomicUnits || []).forEach((u) => {
      (u.objectIds || []).forEach((id) => {
        unitClaimCount.set(id, (unitClaimCount.get(id) || 0) + 1);
      });
    });

    const conservationTable = rawObjects.map((raw) => {
      const vo = visualObjects.find((v) => v.objectId === raw.id);
      const claims = unitClaimCount.get(raw.id) || 0;
      if (claims === 0) missingSourceIds.push(raw.id);
      else if (claims > 1) duplicateSourceIds.push(raw.id);

      const unit = (actualAtomicUnits || []).find((u) => u.objectIds?.includes(raw.id));
      return {
        sourceObjectId: raw.id,
        rawType: raw.type,
        semanticType: raw.type,
        connectorType: raw.connectorType || raw.connector?.connectorType || null,
        visualObject: vo ? '✓' : '✗ MISSING',
        atomicUnit: unit ? `✓ (${unit.unitId})` : '✗ MISSING',
        claims: claims === 1 ? '1' : `${claims} (VIOLATION)`,
        status: vo && claims === 1 ? '✓ CONSERVED' : '✗ VIOLATION'
      };
    });

    const report = {
      generatedAt: new Date().toISOString(),
      debugFlag: '?debugBinding',
      summary: {
        totalObjects: visualObjects.length,
        textObjects: textVos.length,
        containers: containerVos.length,
        connectors: connectorVos.length,
        lines: lineVos.length,
        freeformUnits: freeformUnits.length,
        ownershipWinnerTally: winnerTally,
      },
      conservationAudit: conservationTable,
      textBindings: textReports,
      containerOwnership: containerReports,
      connectors: connectorReports,
      lines: lineReports,
      freeformGroups: freeformReports,
    };

    const label = '[MessCleanup Object Conservation Audit]';
    console.group(`${label} START`);
    console.log('Summary:', report.summary);
    console.table(conservationTable);
    console.log('Text bindings:', textReports);
    console.log('Container ownership:', containerReports);
    console.log('Connectors:', connectorReports);
    console.log('Freeform groups:', freeformReports);
    console.groupEnd();
    console.log(`${label} END`);

    if (typeof document !== 'undefined') {
      try {
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `binding-diagnostic-${Date.now()}.json`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        console.log(`${label} JSON report downloaded.`);
      } catch (downloadErr) {
        console.warn(`${label} Could not auto-download:`, downloadErr.message);
      }
    }

    return report;
  } catch (err) {
    console.error('[Nemotron Binding Diagnostic] ERROR:', err);
    return null;
  }
};

export default { runBindingDiagnostic, isEnabled };
