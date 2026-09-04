export const TEXT_TYPES = new Set(['textbox', 'text', 'i-text']);

export const isTextObject = (object) => TEXT_TYPES.has(String(object?.type || '').toLowerCase());

export const isTemporaryObject = (object) => (
  object?.isTemporaryDrawPath === true ||
  String(object?.type || '').toLowerCase() === 'activeselection'
);

export const isConnectorPath = (object) => {
  const typeLower = String(object?.type || '').toLowerCase();
  if (!object || typeLower !== 'path') return false;
  if (
    object.isConnector === true ||
    object.connectorType ||
    object.startArrow ||
    object.endArrow ||
    object.sourceShapeId ||
    object.targetShapeId ||
    object.relationshipMetadata?.sourceShapeId ||
    object.relationshipMetadata?.targetShapeId
  ) {
    return true;
  }

  if (
    object.isVectorStroke ||
    object.strokeId ||
    object.isSkribeLine ||
    object.skribeLine ||
    object.isStraightLine ||
    (typeof object.id === 'string' && (object.id.startsWith('line_') || object.id.startsWith('shape_line_'))) ||
    (typeof object.elementId === 'string' && object.elementId.startsWith('line_'))
  ) {
    return false;
  }

  const path = object.path;
  if (!Array.isArray(path) || path.length === 0) return false;

  const hasClose = path.some((cmd) => cmd[0] === 'Z' || cmd[0] === 'z');
  if (hasClose) return false;

  const isUnfilled = !object.fill || object.fill === 'transparent' || object.fill === 'none' || object.fill === '';
  if (!isUnfilled) return false;

  const mCount = path.filter((cmd) => cmd[0] === 'M' || cmd[0] === 'm').length;
  if (mCount >= 2) return true;

  return false;
};

export const detectConnectorTypeFromPath = (object) => {
  if (object?.connectorType) return object.connectorType;
  if (object?.connector?.connectorType) return object.connector.connectorType;
  if (object?.metadata?.connectorType) return object.metadata.connectorType;

  const path = object?.path;
  if (!Array.isArray(path) || path.length === 0) return 'straight';

  const hasCurves = path.some((cmd) => cmd[0] === 'C' || cmd[0] === 'c' || cmd[0] === 'Q' || cmd[0] === 'q');
  if (hasCurves) return 'curved';

  const firstMIndex = path.findIndex((cmd) => cmd[0] === 'M' || cmd[0] === 'm');
  const nextMIndex = path.findIndex((cmd, idx) => idx > firstMIndex && (cmd[0] === 'M' || cmd[0] === 'm'));
  const mainSegment = nextMIndex !== -1 ? path.slice(firstMIndex, nextMIndex) : path;

  const mainLCount = mainSegment.filter((cmd) => cmd[0] === 'L' || cmd[0] === 'l').length;
  if (mainLCount >= 2) return 'elbow';

  return 'straight';
};

export const getSemanticType = (object) => {
  const typeLower = String(object?.type || '').toLowerCase();
  if (isTextObject(object)) return 'text';
  if (
    object?.isVectorStroke === true ||
    typeLower === 'stroke' ||
    object?.metadata?.isVectorStroke === true ||
    object?.strokeId ||
    (typeof object?.id === 'string' && object.id.startsWith('stroke_')) ||
    (typeof object?.elementId === 'string' && object.elementId.startsWith('stroke_'))
  ) return 'stroke';
  if (
    object?.isSkribeLine === true ||
    object?.skribeLine !== undefined ||
    object?.isStraightLine === true ||
    typeLower === 'line' ||
    object?.metadata?.isSkribeLine === true ||
    object?.metadata?.isStraightLine === true ||
    (typeof object?.id === 'string' && (object.id.startsWith('line_') || object.id.startsWith('shape_line_'))) ||
    (typeof object?.elementId === 'string' && object.elementId.startsWith('line_'))
  ) {
    if (object?.sourceShapeId || object?.targetShapeId || object?.relationshipMetadata?.sourceShapeId || object?.relationshipMetadata?.targetShapeId) {
      return 'connector';
    }
    return 'line';
  }
  if (
    object?.isConnector === true ||
    typeLower === 'connector' ||
    object?.connectorType ||
    object?.connectorMetadata?.connectorType ||
    object?.metadata?.connectorType ||
    object?.connector?.startArrow === true ||
    object?.connector?.endArrow === true ||
    (object?.x1 !== undefined && object?.x2 !== undefined && object?.y1 !== undefined && object?.y2 !== undefined && (object?.sourceShapeId || object?.targetShapeId || object?.connectorType || object?.endArrow || object?.startArrow)) ||
    (Boolean(object?.sourceShapeId)) ||
    (Boolean(object?.targetShapeId)) ||
    (Boolean(object?.relationshipMetadata?.sourceShapeId)) ||
    (Boolean(object?.relationshipMetadata?.targetShapeId)) ||
    (typeof object?.id === 'string' && (object.id.startsWith('conn_') || object.id.startsWith('connector_') || object.id.startsWith('arrow_') || object.id.startsWith('shape_conn_') || object.id.startsWith('shape_arrow_'))) ||
    (typeof object?.elementId === 'string' && (object.elementId.startsWith('conn_') || object.elementId.startsWith('connector_') || object.elementId.startsWith('arrow_'))) ||
    isConnectorPath(object)
  ) return 'connector';
  if (
    object?.isStickyNote === true ||
    object?.isChecklistNote === true ||
    object?.isCalloutNote === true ||
    typeLower === 'note' ||
    object?.metadata?.isStickyNote === true ||
    object?.metadata?.isChecklistNote === true ||
    object?.metadata?.isCalloutNote === true
  ) return 'note';
  if (['rect', 'circle', 'triangle', 'polygon', 'ellipse', 'path', 'shape'].includes(typeLower)) return 'shape';
  if (typeLower === 'image') return 'image';
  return 'unsupported';
};

export const getShapeType = (object) => {
  if (object?.isCalloutNote) return 'callout';
  if (object?.shapeType && object.shapeType !== 'shape' && object.shapeType !== 'path') return object.shapeType;
  const typeLower = String(object?.type || '').toLowerCase();
  if (typeLower === 'rect') return object.rx || object.ry ? 'rounded_rect' : 'rect';
  if (typeLower === 'circle') return 'circle';
  if (typeLower === 'triangle') return 'triangle';
  if (typeLower === 'ellipse') return 'ellipse';
  if (typeLower === 'polygon') {
    const pointCount = Array.isArray(object.points) ? object.points.length : 0;
    if (pointCount === 6) return 'hexagon';
    if (pointCount === 4) return 'diamond';
    return 'diamond';
  }
  if (typeLower === 'path') return 'path';
  return object?.type || null;
};

export const NOTEBOOK_CONSTANTS = Object.freeze({
  VERTICAL_DIVIDER_MIN_HEIGHT: 120,
  VERTICAL_DIVIDER_MIN_ASPECT_RATIO: 2.5
});

export const isVerticalDividerUnit = (u, options = {}) => {
  if (u?.type !== 'line-unit' && u?.type !== 'line') return false;
  const minHeight = typeof options?.verticalDividerMinHeight === 'number'
    ? options.verticalDividerMinHeight
    : NOTEBOOK_CONSTANTS.VERTICAL_DIVIDER_MIN_HEIGHT;
  const minAspect = typeof options?.verticalDividerMinAspect === 'number'
    ? options.verticalDividerMinAspect
    : NOTEBOOK_CONSTANTS.VERTICAL_DIVIDER_MIN_ASPECT_RATIO;
  return u.height >= minHeight && (u.height / Math.max(1, u.width)) >= minAspect;
};
