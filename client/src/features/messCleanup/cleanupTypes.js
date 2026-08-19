export const TEXT_TYPES = new Set(['textbox', 'text', 'i-text']);

export const isTextObject = (object) => TEXT_TYPES.has(object?.type);

export const isTemporaryObject = (object) => (
  object?.isTemporaryDrawPath === true ||
  object?.type === 'activeSelection'
);

export const getSemanticType = (object) => {
  if (isTextObject(object)) return 'text';
  if (object?.isConnector) return 'connector';
  if (object?.isVectorStroke) return 'stroke';
  if (object?.isSkribeLine || object?.skribeLine || object?.isStraightLine || object?.type === 'line') return 'line';
  if (object?.isStickyNote || object?.isChecklistNote || object?.isCalloutNote) return 'note';
  if (['rect', 'circle', 'triangle', 'polygon', 'ellipse', 'path'].includes(object?.type)) return 'shape';
  if (object?.type === 'image') return 'image';
  return 'unsupported';
};

export const getShapeType = (object) => {
  if (object?.isCalloutNote) return 'callout';
  if (object?.type === 'rect') return object.rx || object.ry ? 'rounded_rect' : 'rect';
  if (object?.type === 'circle') return 'circle';
  if (object?.type === 'triangle') return 'triangle';
  if (object?.type === 'ellipse') return 'ellipse';
  if (object?.type === 'polygon') {
    const pointCount = Array.isArray(object.points) ? object.points.length : 0;
    if (pointCount === 4) return 'diamond';
    if (pointCount === 6) return 'hexagon';
  }
  if (object?.type === 'path') return 'path';
  return object?.type || null;
};
