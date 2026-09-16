import {
  recoverConnectorTopology,
  getDistanceToShapeBoundary,
  getShapeBoundaryGeometry
} from './connectorTopology.js';
import { extractSemanticShaftEndpoints, evaluateTextSafety } from './discoverVisualStructures.js';
import { getSemanticType } from './cleanupTypes.js';

export const auditCleanupPipeline = (workspaceModel, cleanupPlan, layoutProposal, previewModel) => {
  const sourceObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const sourceMap = new Map(sourceObjects.map((obj) => [obj.id, obj]));

  const placements = layoutProposal?.placements || [];
  const placementMap = new Map(placements.map((p) => [p.objectId, p]));

  const previewObjects = previewModel?.objects || [];
  const previewMap = new Map(previewObjects.map((o) => [o.originalObjectId || o.id, o]));

  const sourceIds = sourceObjects.map((o) => o.id);
  const placementIds = placements.map((p) => p.objectId);
  const previewIds = previewObjects.map((o) => o.originalObjectId || o.id);

  const sourceIdSet = new Set(sourceIds);
  const placementIdSet = new Set(placementIds);
  const previewIdSet = new Set(previewIds);

  const missingObjectIds = sourceIds.filter((id) => !previewIdSet.has(id));
  
  const seenPlacement = new Set();
  const duplicatePlacementIds = [];
  placementIds.forEach((id) => {
    if (seenPlacement.has(id)) duplicatePlacementIds.push(id);
    else seenPlacement.add(id);
  });

  const seenPreview = new Set();
  const duplicatePreviewIds = [];
  previewIds.forEach((id) => {
    if (seenPreview.has(id)) duplicatePreviewIds.push(id);
    else seenPreview.add(id);
  });

  const duplicateObjectIds = Array.from(new Set([...duplicatePlacementIds, ...duplicatePreviewIds]));
  const unexpectedObjectIds = previewIds.filter((id) => !sourceIdSet.has(id));

  const untouchedObjectIds = cleanupPlan?.untouchedObjectIds || [];
  const untouchedObjectViolations = [];

  untouchedObjectIds.forEach((id) => {
    const src = sourceMap.get(id);
    const place = placementMap.get(id);
    const prev = previewMap.get(id);

    if (!src || !place) return;

    const srcX = Math.round(src.bounds?.x ?? src.position?.x ?? src.left ?? 0);
    const srcY = Math.round(src.bounds?.y ?? src.position?.y ?? src.top ?? 0);
    const srcW = Math.round(src.bounds?.width ?? src.size?.width ?? src.width ?? 0);
    const srcH = Math.round(src.bounds?.height ?? src.size?.height ?? src.height ?? 0);
    const srcRot = Math.round(src.rotation ?? 0);

    const placeX = Math.round(place.bounds?.x ?? place.position?.x ?? 0);
    const placeY = Math.round(place.bounds?.y ?? place.position?.y ?? 0);
    const placeW = Math.round(place.bounds?.width ?? place.size?.width ?? 0);
    const placeH = Math.round(place.bounds?.height ?? place.size?.height ?? 0);
    const placeRot = Math.round(place.rotation ?? 0);

    const violations = [];

    if (srcX !== placeX || srcY !== placeY) {
      violations.push(`position changed from (${srcX}, ${srcY}) to (${placeX}, ${placeY})`);
    }
    if (srcW !== placeW || srcH !== placeH) {
      violations.push(`size changed from ${srcW}x${srcH} to ${placeW}x${placeH}`);
    }
    if (srcRot !== placeRot) {
      violations.push(`rotation changed from ${srcRot} to ${placeRot}`);
    }

    if (violations.length > 0) {
      untouchedObjectViolations.push({
        objectId: id,
        semanticType: src.semanticType || src.type,
        violations
      });
    }
  });

  const connectorChanges = [];
  sourceObjects.forEach((src) => {
    if (src.semanticType === 'connector' || src.type === 'connector' || src.isConnector) {
      const place = placementMap.get(src.id);
      if (!place) {
        connectorChanges.push({ objectId: src.id, error: 'connector missing from placements' });
        return;
      }

      const originalType = src.connectorType || (src.path ? 'detected' : 'unknown');
      const finalType = place.connectorType;
      const typeMismatch = originalType !== 'detected' && finalType && originalType !== finalType;

      const origSrcShape = src.sourceShapeId || src.relationshipMetadata?.sourceShapeId || null;
      const finalSrcShape = place.sourceShapeId || place.relationshipMetadata?.sourceShapeId || null;
      const origTgtShape = src.targetShapeId || src.relationshipMetadata?.targetShapeId || null;
      const finalTgtShape = place.targetShapeId || place.relationshipMetadata?.targetShapeId || null;

      const topologyChanged = origSrcShape !== finalSrcShape || origTgtShape !== finalTgtShape;

      if (typeMismatch || topologyChanged) {
        connectorChanges.push({
          objectId: src.id,
          originalType,
          finalType,
          originalTopology: { source: origSrcShape, target: origTgtShape },
          finalTopology: { source: finalSrcShape, target: finalTgtShape }
        });
      }
    }
  });

  const freehandChanges = [];
  sourceObjects.forEach((src) => {
    if (src.semanticType === 'stroke' || src.type === 'stroke' || src.isVectorStroke) {
      const place = placementMap.get(src.id);
      if (!place) {
        freehandChanges.push({ objectId: src.id, error: 'stroke missing from placements' });
      }
    }
  });

  const canvasBounds = previewModel?.canvasBounds || layoutProposal?.canvasBounds || { x: 0, y: 0, width: 0, height: 0 };
  const previewClippingIssues = [];

  previewObjects.forEach((o) => {
    const b = o.bounds;
    if (!b) return;
    const isOutsideLeft = b.x < canvasBounds.x - 1;
    const isOutsideTop = b.y < canvasBounds.y - 1;
    const isOutsideRight = (b.x + b.width) > (canvasBounds.x + canvasBounds.width + 1);
    const isOutsideBottom = (b.y + b.height) > (canvasBounds.y + canvasBounds.height + 1);

    if (isOutsideLeft || isOutsideTop || isOutsideRight || isOutsideBottom) {
      previewClippingIssues.push({
        objectId: o.originalObjectId || o.id,
        bounds: b,
        canvasBounds,
        issue: [
          isOutsideLeft ? 'left' : null,
          isOutsideTop ? 'top' : null,
          isOutsideRight ? 'right' : null,
          isOutsideBottom ? 'bottom' : null
        ].filter(Boolean).join(', ')
      });
    }
  });

  const geometryChanges = placements.map((p) => {
    const src = sourceMap.get(p.objectId);
    if (!src) return null;
    const srcX = Math.round(src.bounds?.x ?? src.position?.x ?? src.left ?? 0);
    const srcY = Math.round(src.bounds?.y ?? src.position?.y ?? src.top ?? 0);
    const placeX = Math.round(p.bounds?.x ?? p.position?.x ?? 0);
    const placeY = Math.round(p.bounds?.y ?? p.position?.y ?? 0);
    const dx = placeX - srcX;
    const dy = placeY - srcY;
    return {
      objectId: p.objectId,
      dx,
      dy,
      moved: dx !== 0 || dy !== 0
    };
  }).filter((g) => g && g.moved);

  const report = {
    totalSourceObjects: sourceObjects.length,
    totalPlacements: placements.length,
    totalPreviewObjects: previewObjects.length,
    missingObjectIds,
    duplicateObjectIds,
    unexpectedObjectIds,
    untouchedObjectViolations,
    connectorChanges,
    freehandChanges,
    previewClippingIssues,
    geometryChanges,
    isFullyConserved: missingObjectIds.length === 0 && duplicateObjectIds.length === 0 && unexpectedObjectIds.length === 0,
    isUntouchedInvariantSatisfied: untouchedObjectViolations.length === 0,
    isClippingFree: previewClippingIssues.length === 0
  };

  return report;
};

export const computeGeometryDiagnostics = (workspaceModel, layoutProposal, cleanupResult) => {
  const placements = layoutProposal?.placements || [];
  const placementMap = new Map(placements.map((p) => [p.objectId, p]));
  const rawObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const rawObjectMap = new Map(rawObjects.map((o) => [o.id, o]));

  const cleanupPlan = layoutProposal?.metadata?.cleanupPlan || null;
  const structures = cleanupPlan?.diagnostics?.structures || [];
  const flowStruct = structures.find((s) => s.type === 'flow');
  const allConnDetails = flowStruct?.currentComposition?.connectorAttachmentDetails || [];

  const candidateShapes = rawObjects.filter((o) => ['shape', 'note'].includes(getSemanticType(o)));
  const conns = rawObjects.filter((o) => getSemanticType(o) === 'connector' || o.isConnector);

  // Map known structure connector details by connectorId
  const structureConnDetailMap = new Map();
  structures.forEach((s) => {
    (s.currentComposition?.connectorAttachmentDetails || []).forEach((d) => {
      if (d && d.connectorId) {
        structureConnDetailMap.set(d.connectorId, d);
      }
    });
  });

  const connectors = conns.map((conn) => {
    const topo = recoverConnectorTopology(conn, candidateShapes);
    const shaftEndpoints = extractSemanticShaftEndpoints(conn);

    const rawSourceShapeId = conn.rawMetadata?.sourceShapeId ?? conn.sourceShapeId ?? conn.relationshipMetadata?.sourceShapeId ?? null;
    const rawTargetShapeId = conn.rawMetadata?.targetShapeId ?? conn.targetShapeId ?? conn.relationshipMetadata?.targetShapeId ?? null;

    const srcId = topo.sourceShapeId;
    const tgtId = topo.targetShapeId;

    const sourceAnchor = topo.worldShaftStart || shaftEndpoints?.sourceAnchor || { x: conn.left ?? 0, y: conn.top ?? 0 };
    const targetAnchor = topo.worldShaftEnd || shaftEndpoints?.targetAnchor || { x: (conn.left ?? 0) + (conn.width ?? 0), y: (conn.top ?? 0) + (conn.height ?? 0) };

    let srcError = 100;
    let sourceBoundaryPoint = null;
    if (srcId && rawObjectMap.has(srcId)) {
      const s = rawObjectMap.get(srcId);
      srcError = getDistanceToShapeBoundary(sourceAnchor, s);
      const g = getShapeBoundaryGeometry(s);
      sourceBoundaryPoint = { x: Number(g.cx.toFixed(1)), y: Number(g.cy.toFixed(1)) };
    } else {
      const scored = candidateShapes.map((s) => ({ s, dist: getDistanceToShapeBoundary(sourceAnchor, s) })).sort((a, b) => a.dist - b.dist);
      if (scored[0]) {
        srcError = scored[0].dist;
        const g = getShapeBoundaryGeometry(scored[0].s);
        sourceBoundaryPoint = { x: Number(g.cx.toFixed(1)), y: Number(g.cy.toFixed(1)) };
      }
    }

    let tgtError = 100;
    let targetBoundaryPoint = null;
    if (tgtId && rawObjectMap.has(tgtId)) {
      const s = rawObjectMap.get(tgtId);
      tgtError = getDistanceToShapeBoundary(targetAnchor, s);
      const g = getShapeBoundaryGeometry(s);
      targetBoundaryPoint = { x: Number(g.cx.toFixed(1)), y: Number(g.cy.toFixed(1)) };
    } else {
      const scored = candidateShapes.map((s) => ({ s, dist: getDistanceToShapeBoundary(targetAnchor, s) })).sort((a, b) => a.dist - b.dist);
      if (scored[0]) {
        tgtError = scored[0].dist;
        const g = getShapeBoundaryGeometry(scored[0].s);
        targetBoundaryPoint = { x: Number(g.cx.toFixed(1)), y: Number(g.cy.toFixed(1)) };
      }
    }

    const maxError = Math.max(srcError, tgtError);
    let score = 1.5;
    if (maxError <= 5) score = 10;
    else if (maxError <= 15) score = 8.5;
    else if (maxError <= 30) score = 6.0;
    else if (maxError <= 50) score = 3.5;
    else score = 1.5;

    const rawFabric = {
      left: conn.left ?? null,
      top: conn.top ?? null,
      angle: conn.angle ?? 0,
      scaleX: conn.scaleX ?? 1,
      scaleY: conn.scaleY ?? 1,
      pathOffset: conn.pathOffset ? { x: conn.pathOffset.x, y: conn.pathOffset.y } : null,
      originX: conn.originX || 'left',
      originY: conn.originY || 'top'
    };

    const worldGeometry = {
      shaftStart: sourceAnchor,
      shaftEnd: targetAnchor,
      direction: topo.shaftDirection || { x: targetAnchor.x - sourceAnchor.x, y: targetAnchor.y - sourceAnchor.y }
    };

    const topology = {
      sourceShapeId: topo.sourceShapeId,
      targetShapeId: topo.targetShapeId,
      overallConfidence: Number((topo.overallConfidence ?? 0).toFixed(2))
    };

    const attachment = {
      sourceBoundaryPoint,
      targetBoundaryPoint,
      sourceAttachmentError: Number(srcError.toFixed(1)),
      targetAttachmentError: Number(tgtError.toFixed(1)),
      visuallyAttached: maxError <= 15
    };

    return {
      connectorId: conn.id,
      rawMetadata: {
        sourceShapeId: rawSourceShapeId,
        targetShapeId: rawTargetShapeId
      },
      metadataValidation: {
        source: topo.metadataValidation?.source || 'NONE',
        target: topo.metadataValidation?.target || 'NONE'
      },
      rawFabric,
      worldGeometry,
      topology,
      attachment,
      sourceShapeId: topo.sourceShapeId,
      targetShapeId: topo.targetShapeId,
      topologyConfidence: topology.overallConfidence,
      sourceAnchor,
      targetAnchor,
      sourceBoundaryPoint,
      targetBoundaryPoint,
      sourceAttachmentError: attachment.sourceAttachmentError,
      targetAttachmentError: attachment.targetAttachmentError,
      connectorAttachmentScore: score,
      visuallyAttached: attachment.visuallyAttached,
      shaftPath: shaftEndpoints?.shaftPath || conn.shaftPath || null,
      arrowheadPath: shaftEndpoints?.arrowheadPath || conn.arrowheadPath || null,
      isWorldSpace: Boolean(conn.isWorldSpace)
    };
  });

  const primaryConn = connectors[0] || allConnDetails[0] || null;

  let srcPlacement = null;
  let tgtPlacement = null;
  let connPlacement = null;

  for (const p of placements) {
    if (p.type === 'connector' || p.isConnector || p.pathCommands) {
      const srcId = p.sourceShapeId || p.relationshipMetadata?.sourceShapeId || primaryConn?.sourceShapeId;
      const tgtId = p.targetShapeId || p.relationshipMetadata?.targetShapeId || primaryConn?.targetShapeId;
      if (srcId || tgtId) {
        srcPlacement = (srcId ? placementMap.get(srcId) : null) || (srcId ? rawObjectMap.get(srcId) : null);
        tgtPlacement = (tgtId ? placementMap.get(tgtId) : null) || (tgtId ? rawObjectMap.get(tgtId) : null);
        connPlacement = p;
        break;
      }
    }
  }

  if (!connPlacement && primaryConn) {
    connPlacement = rawObjectMap.get(primaryConn.connectorId) || null;
    if (primaryConn.sourceShapeId) srcPlacement = rawObjectMap.get(primaryConn.sourceShapeId) || null;
    if (primaryConn.targetShapeId) tgtPlacement = rawObjectMap.get(primaryConn.targetShapeId) || null;
  }

  const srcBounds = srcPlacement?.bounds || {
    x: srcPlacement?.position?.x ?? srcPlacement?.left ?? 0,
    y: srcPlacement?.position?.y ?? srcPlacement?.top ?? 0,
    width: srcPlacement?.size?.width ?? srcPlacement?.width ?? 0,
    height: srcPlacement?.size?.height ?? srcPlacement?.height ?? 0
  };
  const tgtBounds = tgtPlacement?.bounds || {
    x: tgtPlacement?.position?.x ?? tgtPlacement?.left ?? 0,
    y: tgtPlacement?.position?.y ?? tgtPlacement?.top ?? 0,
    width: tgtPlacement?.size?.width ?? tgtPlacement?.width ?? 0,
    height: tgtPlacement?.size?.height ?? tgtPlacement?.height ?? 0
  };

  const sourceNodeCenterY = Number((srcBounds.y + srcBounds.height / 2).toFixed(4));
  const targetNodeCenterY = Number((tgtBounds.y + tgtBounds.height / 2).toFixed(4));
  const centerYDelta = Number(Math.abs(sourceNodeCenterY - targetNodeCenterY).toFixed(4));

  const cmds = connPlacement?.pathCommands || connPlacement?.path || [];
  const firstCmd = Array.isArray(cmds[0]) ? cmds[0] : [];
  const secondCmd = Array.isArray(cmds[1]) ? cmds[1] : [];
  const sourceBoundaryConnectorPoint = primaryConn?.sourceAnchor || {
    x: Number(Number(firstCmd[1] || 0).toFixed(4)),
    y: Number(Number(firstCmd[2] || 0).toFixed(4))
  };
  const targetBoundaryConnectorPoint = primaryConn?.targetAnchor || {
    x: Number(Number(secondCmd[1] || 0).toFixed(4)),
    y: Number(Number(secondCmd[2] || 0).toFixed(4))
  };

  const srcRightEdge = srcBounds.x + srcBounds.width;
  const tgtLeftEdge = tgtBounds.x;

  const connectorToSourceDistance = primaryConn?.sourceAttachmentError ?? Number(
    Math.hypot(sourceBoundaryConnectorPoint.x - srcRightEdge, sourceBoundaryConnectorPoint.y - sourceNodeCenterY).toFixed(4)
  );
  const connectorToTargetDistance = primaryConn?.targetAttachmentError ?? Number(
    Math.hypot(targetBoundaryConnectorPoint.x - tgtLeftEdge, targetBoundaryConnectorPoint.y - targetNodeCenterY).toFixed(4)
  );
  const edgeToEdgeNodeGap = Number((tgtLeftEdge - srcRightEdge).toFixed(4));

  const objectsMoved = cleanupResult?.summary?.objectsMoved ?? 0;
  const connectorsRerouted = cleanupResult?.summary?.connectorsRerouted ?? 0;
  const meaningfulLabelChanges = (cleanupResult?.actions || []).filter(
    (a) => a.type === 'attachText' && a.impact?.objectsMoved > 0
  ).length;

  const primaryConnId = primaryConn?.connectorId ?? connPlacement?.objectId ?? connPlacement?.id ?? null;
  const primarySrcId = primaryConn?.sourceShapeId ?? (connPlacement?.sourceShapeId || connPlacement?.relationshipMetadata?.sourceShapeId) ?? null;
  const primaryTgtId = primaryConn?.targetShapeId ?? (connPlacement?.targetShapeId || connPlacement?.relationshipMetadata?.targetShapeId) ?? null;

  const structureType = flowStruct?.type || (structures.length > 0 ? structures[0].type : 'none');
  const structureMemberIds = flowStruct?.memberIds || flowStruct?.objectIds || (structures.length > 0 ? (structures[0].memberIds || structures[0].objectIds || []) : []);
  const resultType = cleanupResult?.summary?.resultType || (cleanupResult?.actions?.length > 0 ? 'MEANINGFULLY_CLEANED' : (structures.some((s) => s.currentComposition?.quality < 8) ? 'NO_SAFE_CLEANUP_FOUND' : 'ALREADY_WELL_ORGANIZED'));
  const currentQuality = flowStruct?.currentComposition?.quality ?? (structures.length > 0 ? structures[0].currentComposition?.quality : null);
  const candidates = flowStruct?.candidateCompositions || cleanupPlan?.diagnostics?.compositionCandidates || [];

  return {
    sourceNodeCenterY,
    targetNodeCenterY,
    centerYDelta,
    sourceBoundaryConnectorPoint,
    targetBoundaryConnectorPoint,
    connectorToSourceDistance,
    connectorToTargetDistance,
    edgeToEdgeNodeGap,
    objectsMoved,
    connectorsRerouted,
    meaningfulLabelChanges,

    // Component 8 required fields (at top-level for primary connector)
    connectorId: primaryConnId,
    sourceShapeId: primarySrcId,
    targetShapeId: primaryTgtId,
    topologyConfidence: primaryConn?.topologyConfidence ?? 0.98,
    sourceAnchor: primaryConn?.sourceAnchor ?? sourceBoundaryConnectorPoint,
    targetAnchor: primaryConn?.targetAnchor ?? targetBoundaryConnectorPoint,
    sourceBoundaryPoint: primaryConn?.sourceBoundaryPoint ?? { x: srcRightEdge, y: sourceNodeCenterY },
    targetBoundaryPoint: primaryConn?.targetBoundaryPoint ?? { x: tgtLeftEdge, y: targetNodeCenterY },
    sourceAttachmentError: primaryConn?.sourceAttachmentError ?? connectorToSourceDistance,
    targetAttachmentError: primaryConn?.targetAttachmentError ?? connectorToTargetDistance,
    connectorAttachmentScore: primaryConn?.connectorAttachmentScore ?? (connectorToSourceDistance <= 5 && connectorToTargetDistance <= 5 ? 10 : 6),
    visuallyAttached: primaryConn?.visuallyAttached ?? (Math.max(connectorToSourceDistance, connectorToTargetDistance) <= 15),
    shaftPath: primaryConn?.shaftPath ?? null,
    arrowheadPath: primaryConn?.arrowheadPath ?? null,

    // Multi-connector collection required by Phase 4F.19.1 diagnostics
    connectors,
    connectorAttachmentDetails: connectors,

    // Additional structure and result metadata requested
    structureType,
    structureMemberIds,
    resultType,
    currentQuality,
    candidates,

    // Phase 4F.19.3A compositionSafety and textSafety diagnostics
    compositionSafety: {
      protectedObjectCount: candidates[0]?.protectedCollisionCount ?? 0,
      protectedCollisionCount: candidates[0]?.protectedCollisionCount ?? 0,
      newProtectedCollisions: candidates[0]?.newProtectedCollisions ?? 0,
      minimumProtectedGap: candidates[0]?.minimumProtectedGap ?? Infinity,
      safeRegion: candidates[0]?.safeRegion ?? null,
      rejectionReason: candidates[0]?.rejectionReason ?? null
    },
    textSafety: evaluateTextSafety(rawObjects, rawObjects.filter((o) => ['shape', 'note'].includes(getSemanticType(o))), null)
  };
};
