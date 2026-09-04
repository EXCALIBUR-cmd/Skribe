const sortById = (items) => [...items].sort((a, b) => String(a.objectId).localeCompare(String(b.objectId)));

export const worldToPreview = (point, renderBounds, scale, padding = 24) => ({
  x: (point.x - renderBounds.x) * scale + padding,
  y: (point.y - renderBounds.y) * scale + padding
});

export const buildPreviewRenderModel = (workspaceModel, layoutProposal) => {
  const objects = workspaceModel?.board?.objects || [];
  const objectMap = new Map(objects.filter((object) => object?.id).map((object) => [object.id, object]));
  const placements = sortById(layoutProposal?.placements || []);

  return {
    bounds: layoutProposal?.canvasBounds || { x: 0, y: 0, width: 1, height: 1 },
    objects: placements.map((placement) => {
      const source = objectMap.get(placement.objectId) || {};
      return {
        sourceObjectId: placement.sourceObjectId || placement.objectId,
        originalObjectId: placement.objectId,
        elementId: source.elementId || placement.elementId || null,
        type: source.type || placement.type || 'unsupported',
        semanticType: source.semanticType || source.type || placement.type || 'unsupported',
        shapeType: source.shapeType || null,
        text: source.text || '',
        noteColor: source.metadata?.noteColor || '#fff3a0',
        isStickyNote: Boolean(source.isStickyNote || source.metadata?.isStickyNote),
        isCalloutNote: Boolean(source.isCalloutNote || source.metadata?.isCalloutNote || source.shapeType === 'callout'),
        position: placement.position,
        bounds: placement.bounds,
        center: placement.center || (placement.bounds ? { x: placement.bounds.x + placement.bounds.width / 2, y: placement.bounds.y + placement.bounds.height / 2 } : null),
        originX: source.originX || placement.originX || 'left',
        originY: source.originY || placement.originY || 'top',
        size: placement.size,
        rotation: placement.rotation,
        scale: placement.scale,
        anchor: placement.anchor,
        relationshipMetadata: {
          ...(source.relationshipMetadata || {}),
          ...(placement.relationshipMetadata || {})
        },
        fill: placement.fill || source.visual?.fill || source.fill || null,
        visual: placement.visual || source.visual || null,
        style: placement.style || source.style || null,
        vector: source.vector || null,
        path: placement.path || source.path || null,
        worldPath: placement.worldPath || source.worldPath || placement.path || source.path || null,
        worldPathCommands: placement.worldPathCommands || source.worldPathCommands || placement.pathCommands || source.pathCommands || null,
        pathData: placement.pathData || source.pathData || source.connector?.pathData || (Array.isArray(placement.path || source.path) ? (placement.path || source.path).map((c) => c.join(' ')).join(' ') : null),
        pathCommands: placement.pathCommands || source.pathCommands || source.connector?.pathCommands || (Array.isArray(placement.path || source.path) ? (placement.path || source.path) : null),
        stroke: placement.stroke || source.visual?.stroke || source.stroke || null,
        strokeWidth: placement.strokeWidth !== undefined && placement.strokeWidth !== null ? placement.strokeWidth : (source.visual?.strokeWidth !== undefined ? source.visual.strokeWidth : (source.strokeWidth !== undefined ? source.strokeWidth : null)),
        strokeDashArray: placement.strokeDashArray || source.visual?.strokeDashArray || source.strokeDashArray || null,
        strokeLineCap: placement.strokeLineCap || source.visual?.strokeLineCap || source.strokeLineCap || 'butt',
        strokeLineJoin: placement.strokeLineJoin || source.visual?.strokeLineJoin || source.strokeLineJoin || 'miter',
        opacity: placement.opacity !== undefined && placement.opacity !== null ? placement.opacity : (source.visual?.opacity !== undefined ? source.visual.opacity : (source.opacity !== undefined ? source.opacity : 1)),
        visible: placement.visible !== undefined ? placement.visible : (source.visual?.visible !== undefined ? source.visual.visible : (source.visible !== undefined ? source.visible : true)),
        shadow: placement.shadow || source.visual?.shadow || source.shadow || null,
        backgroundColor: placement.backgroundColor || source.visual?.backgroundColor || source.backgroundColor || null,
        startArrow: placement.startArrow !== undefined ? placement.startArrow : (source.startArrow !== undefined ? source.startArrow : (source.connector?.startArrow || false)),
        endArrow: placement.endArrow !== undefined ? placement.endArrow : (source.endArrow !== undefined ? source.endArrow : (source.connector?.endArrow !== undefined ? source.connector.endArrow : (source.type === 'connector'))),
        connectorType: placement.connectorType || source.connectorType || source.connector?.connectorType || source.metadata?.connectorType || null,
        isSkribeLine: source.isSkribeLine !== undefined ? source.isSkribeLine : source.metadata?.isSkribeLine,
        isStraightLine: source.isStraightLine !== undefined ? source.isStraightLine : source.metadata?.isStraightLine,
        points: placement.points || source.points || null,
        geometry: source.geometry || null,
        metadata: source.metadata || {}
      };
    })
  };
};

export default buildPreviewRenderModel;
