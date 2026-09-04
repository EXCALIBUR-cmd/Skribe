
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
