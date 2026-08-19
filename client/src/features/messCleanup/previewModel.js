const sortById = (items) => [...items].sort((a, b) => String(a.objectId).localeCompare(String(b.objectId)));

export const buildPreviewRenderModel = (workspaceModel, layoutProposal) => {
  const objects = workspaceModel?.board?.objects || [];
  const objectMap = new Map(objects.filter((object) => object?.id).map((object) => [object.id, object]));
  const placements = sortById(layoutProposal?.placements || []);

  return {
    bounds: layoutProposal?.canvasBounds || { x: 0, y: 0, width: 1, height: 1 },
    objects: placements.map((placement) => {
      const source = objectMap.get(placement.objectId) || {};
      return {
        originalObjectId: placement.objectId,
        type: source.type || 'unsupported',
        shapeType: source.shapeType || null,
        text: source.text || '',
        noteColor: source.metadata?.noteColor || '#fff3a0',
        isStickyNote: source.metadata?.isStickyNote === true,
        position: placement.position,
        bounds: placement.bounds,
        size: placement.size,
        rotation: placement.rotation,
        scale: placement.scale,
        anchor: placement.anchor,
        relationshipMetadata: source.relationshipMetadata || {},
        vector: source.vector || null,
        metadata: source.metadata || {}
      };
    })
  };
};

export default buildPreviewRenderModel;
