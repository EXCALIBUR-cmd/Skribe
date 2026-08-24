import { getSemanticType, getShapeType, isTextObject } from './cleanupTypes.js';

const cloneJsonValue = (value) => {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
};

const getNumber = (value, fallback = 0) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

const getColorString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.color) return String(value.color);
  return null;
};

const getMetadata = (object, semanticType) => {
  const metadata = cloneJsonValue(object.metadata);
  const result = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};

  if (object.isStickyNote !== undefined) result.isStickyNote = !!object.isStickyNote;
  if (object.isChecklistNote !== undefined) result.isChecklistNote = !!object.isChecklistNote;
  if (object.isCalloutNote !== undefined) result.isCalloutNote = !!object.isCalloutNote;
  if (object.noteColor !== undefined) result.noteColor = object.noteColor;
  if (object.isVectorStroke !== undefined) result.isVectorStroke = !!object.isVectorStroke;
  if (object.isSkribeLine !== undefined) result.isSkribeLine = !!object.isSkribeLine;
  if (object.isStraightLine !== undefined) result.isStraightLine = !!object.isStraightLine;
  if (object.isConnector !== undefined) result.isConnector = !!object.isConnector;
  if (object.connectorType !== undefined) result.connectorType = object.connectorType;
  if (semanticType === 'image') result.identityWarning = 'image-unsupported';

  return result;
};

const getVectorSummary = (object) => {
  const vectorData = object.vectorStrokeData || {};
  const summary = {};
  ['color', 'width', 'opacity', 'style'].forEach((property) => {
    if (vectorData[property] !== undefined) summary[property] = vectorData[property];
  });
  if (object.stroke !== undefined) summary.stroke = getColorString(object.stroke);
  if (object.strokeWidth !== undefined) summary.strokeWidth = getNumber(object.strokeWidth);
  return Object.keys(summary).length > 0 ? summary : undefined;
};

const getLineGeometry = (object) => {
  const model = object.skribeLine;
  if (!model) return undefined;

  return {
    mode: model.mode || 'straight',
    start: {
      x: getNumber(model.start?.x),
      y: getNumber(model.start?.y)
    },
    end: {
      x: getNumber(model.end?.x),
      y: getNumber(model.end?.y)
    },
    controlPoints: Array.isArray(model.controlPoints)
      ? model.controlPoints.map((point) => ({ x: getNumber(point.x), y: getNumber(point.y) }))
      : []
  };
};

export const normalizeObject = (object, zIndex = 0) => {
  const semanticType = getSemanticType(object);
  const width = getNumber(object.width);
  const height = getNumber(object.height);
  const scaleX = getNumber(object.scaleX, 1);
  const scaleY = getNumber(object.scaleY, 1);
  const left = getNumber(object.left);
  const top = getNumber(object.top);

  const normalized = {
    id: object.id,
    elementId: object.elementId,
    strokeId: object.strokeId,
    type: semanticType,
    text: isTextObject(object) ? String(object.text || '') : null,
    position: {
      x: left,
      y: top
    },
    size: {
      width,
      height
    },
    rotation: getNumber(object.angle),
    scale: {
      x: scaleX,
      y: scaleY
    },
    center: {
      x: left + (width * scaleX) / 2,
      y: top + (height * scaleY) / 2
    },
    zIndex: getNumber(zIndex, 0),
    relationshipMetadata: {
      attachedTextId: object.attachedTextId ?? null,
      parentShapeId: object.parentShapeId ?? null,
      sourceShapeId: object.sourceShapeId ?? null,
      targetShapeId: object.targetShapeId ?? null
    },
    relationships: [],
    visual: {
      fill: getColorString(object.fill),
      stroke: getColorString(object.stroke),
      strokeWidth: object.strokeWidth !== undefined && object.strokeWidth !== null ? getNumber(object.strokeWidth) : null,
      opacity: object.opacity !== undefined && object.opacity !== null ? getNumber(object.opacity, 1) : 1
    },
    metadata: getMetadata(object, semanticType)
  };

  if (!normalized.id) normalized.identityWarning = 'missing-id';
  if (object.elementId !== undefined) normalized.elementId = object.elementId;
  if (object.strokeId !== undefined) normalized.strokeId = object.strokeId;

  if (semanticType === 'shape' || semanticType === 'note') {
    normalized.shapeType = getShapeType(object);
  }

  if (isTextObject(object)) {
    normalized.style = {
      fontSize: getNumber(object.fontSize),
      fontFamily: object.fontFamily || null,
      fontWeight: object.fontWeight ? String(object.fontWeight) : null,
      fontStyle: object.fontStyle ? String(object.fontStyle) : null,
      textAlign: object.textAlign ? String(object.textAlign) : null,
      lineHeight: object.lineHeight !== undefined && object.lineHeight !== null ? getNumber(object.lineHeight, 1) : null,
      color: getColorString(object.fill) || (object.color ? String(object.color) : null)
    };
  }

  const vectorSummary = getVectorSummary(object);
  if (vectorSummary) normalized.vector = vectorSummary;

  const lineGeometry = getLineGeometry(object);
  if (lineGeometry) normalized.geometry = lineGeometry;

  if (semanticType === 'connector') {
    normalized.connector = {
      sourceShapeId: object.sourceShapeId ?? null,
      targetShapeId: object.targetShapeId ?? null,
      connectorType: object.connectorType || 'straight',
      stroke: getColorString(object.stroke),
      strokeWidth: object.strokeWidth !== undefined && object.strokeWidth !== null ? getNumber(object.strokeWidth) : null
    };
  }

  return normalized;
};
