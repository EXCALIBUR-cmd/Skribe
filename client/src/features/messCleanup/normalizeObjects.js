import { getSemanticType, getShapeType, isTextObject, detectConnectorTypeFromPath } from './cleanupTypes.js';
import { translatePathCommands } from './connectorGeometry.js';

export const getPathWorldDelta = (object) => {
  if (!object || !Array.isArray(object.path) || object.path.length === 0) {
    return { dx: 0, dy: 0 };
  }

  if (object.pathOffset && typeof object.pathOffset.x === 'number' && typeof object.pathOffset.y === 'number') {
    const originX = object.originX || 'left';
    const originY = object.originY || 'top';
    const left = object.left ?? 0;
    const top = object.top ?? 0;

    const targetX = originX === 'center' ? left : left + (object.width ?? 0) / 2;
    const targetY = originY === 'center' ? top : top + (object.height ?? 0) / 2;

    const dx = targetX - object.pathOffset.x;
    const dy = targetY - object.pathOffset.y;
    return { dx, dy };
  }

  if (object.originX === 'center' && object.originY === 'center' && (object.type === 'Path' || object.type === 'path' || object.isConnector)) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    object.path.forEach((cmd) => {
      const type = cmd[0];
      if (type === 'M' || type === 'm' || type === 'L' || type === 'l') {
        const x = Number(cmd[1]), y = Number(cmd[2]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      } else if (type === 'C' || type === 'c') {
        [Number(cmd[1]), Number(cmd[3]), Number(cmd[5])].forEach((x) => {
          if (Number.isFinite(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
        });
        [Number(cmd[2]), Number(cmd[4]), Number(cmd[6])].forEach((y) => {
          if (Number.isFinite(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        });
      } else if (type === 'Q' || type === 'q') {
        [Number(cmd[1]), Number(cmd[3])].forEach((x) => {
          if (Number.isFinite(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
        });
        [Number(cmd[2]), Number(cmd[4])].forEach((y) => {
          if (Number.isFinite(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        });
      }
    });

    const pathOffsetX = minX + (maxX - minX) / 2;
    const pathOffsetY = minY + (maxY - minY) / 2;

    const dx = (object.left ?? 0) - pathOffsetX;
    const dy = (object.top ?? 0) - pathOffsetY;
    return { dx, dy };
  }

  return { dx: 0, dy: 0 };
};

export const computePathBounds = (pathCommands) => {
  if (!Array.isArray(pathCommands) || pathCommands.length === 0) {
    return null;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pathCommands.forEach((cmd) => {
    const type = cmd[0];
    if (type === 'M' || type === 'm' || type === 'L' || type === 'l') {
      const x = Number(cmd[1]), y = Number(cmd[2]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    } else if (type === 'C' || type === 'c') {
      [Number(cmd[1]), Number(cmd[3]), Number(cmd[5])].forEach((x) => {
        if (Number.isFinite(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      });
      [Number(cmd[2]), Number(cmd[4]), Number(cmd[6])].forEach((y) => {
        if (Number.isFinite(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      });
    } else if (type === 'Q' || type === 'q') {
      [Number(cmd[1]), Number(cmd[3])].forEach((x) => {
        if (Number.isFinite(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      });
      [Number(cmd[2]), Number(cmd[4])].forEach((y) => {
        if (Number.isFinite(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      });
    } else if (type === 'A' || type === 'a') {
      const x = Number(cmd[6]), y = Number(cmd[7]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
};

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
  else if (object.metadata?.isStickyNote !== undefined) result.isStickyNote = !!object.metadata.isStickyNote;
  else if (semanticType === 'note') result.isStickyNote = true;

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

  let width = getNumber(object.width !== undefined ? object.width : object.size?.width);
  let height = getNumber(object.height !== undefined ? object.height : object.size?.height);
  const scaleX = getNumber(object.scaleX !== undefined ? object.scaleX : object.scale?.x, 1);
  const scaleY = getNumber(object.scaleY !== undefined ? object.scaleY : object.scale?.y, 1);
  let left = getNumber(object.left !== undefined ? object.left : object.position?.x);
  let top = getNumber(object.top !== undefined ? object.top : object.position?.y);

  if (object.x1 !== undefined && object.x2 !== undefined && object.y1 !== undefined && object.y2 !== undefined) {
    if (left === 0 && top === 0 && width === 0 && height === 0) {
      left = Math.min(object.x1, object.x2);
      top = Math.min(object.y1, object.y2);
      width = Math.max(1, Math.abs(object.x2 - object.x1));
      height = Math.max(1, Math.abs(object.y2 - object.y1));
    }
  }

  const originX = object.originX || 'left';
  const originY = object.originY || 'top';
  const renderedWidth = width * scaleX;
  const renderedHeight = height * scaleY;

  const worldLeft =
    originX === 'center'
      ? left - renderedWidth / 2
      : originX === 'right'
        ? left - renderedWidth
        : left;

  const worldTop =
    originY === 'center'
      ? top - renderedHeight / 2
      : originY === 'bottom'
        ? top - renderedHeight
        : top;

  const center = {
    x: worldLeft + renderedWidth / 2,
    y: worldTop + renderedHeight / 2
  };

  const attachedTextId = object.attachedTextId ?? object.relationshipMetadata?.attachedTextId ?? null;
  const parentShapeId = object.parentShapeId ?? object.relationshipMetadata?.parentShapeId ?? null;
  const sourceShapeId = object.sourceShapeId ?? object.relationshipMetadata?.sourceShapeId ?? null;
  const targetShapeId = object.targetShapeId ?? object.relationshipMetadata?.targetShapeId ?? null;

  let id = object.id;
  if (typeof id === 'string') {
    if (id.startsWith('shape_line_')) id = id.replace(/^shape_line_/, 'line_');
    else if (id.startsWith('shape_conn_')) id = id.replace(/^shape_conn_/, 'conn_');
    else if (id.startsWith('shape_connector_')) id = id.replace(/^shape_connector_/, 'conn_');
    else if (id.startsWith('shape_stroke_')) id = id.replace(/^shape_stroke_/, 'stroke_');
  }

  if (!id) {
    id = (typeof object?.name === 'string' && object.name ? object.name : undefined)
      || (object.elementId ? (
          object.elementId.startsWith('line_') || object.elementId.startsWith('conn_') || object.elementId.startsWith('stroke_')
            ? object.elementId
            : semanticType === 'text'
            ? (object.elementId.startsWith('text_') ? object.elementId : `text_${object.elementId}`)
            : semanticType === 'line'
            ? (object.elementId.startsWith('line_') ? object.elementId : `line_${object.elementId}`)
            : semanticType === 'connector'
            ? (object.elementId.startsWith('conn_') ? object.elementId : `conn_${object.elementId}`)
            : semanticType === 'stroke'
            ? (object.elementId.startsWith('stroke_') ? object.elementId : `stroke_${object.elementId}`)
            : (object.elementId.startsWith('shape_') ? object.elementId : `shape_${object.elementId}`)
         ) : undefined)
      || (object.strokeId ? (object.strokeId.startsWith('stroke_') ? object.strokeId : `stroke_${object.strokeId}`) : undefined);
  }

  const normalized = {
    id,
    sourceObjectId: id,
    elementId: object.elementId || null,
    strokeId: object.strokeId || null,
    type: semanticType,
    semanticType,
    originalType: object.type,
    text: isTextObject(object) ? String(object.text || '') : null,
    position: {
      x: worldLeft,
      y: worldTop
    },
    bounds: {
      x: worldLeft,
      y: worldTop,
      width: renderedWidth,
      height: renderedHeight
    },
    size: {
      width,
      height
    },
    rotation: getNumber(object.angle !== undefined ? object.angle : object.rotation),
    scale: {
      x: scaleX,
      y: scaleY
    },
    originX,
    originY,
    center,
    zIndex: getNumber(zIndex, 0),
    fill: getColorString(object.fill),
    stroke: getColorString(object.stroke),
    strokeWidth: object.strokeWidth !== undefined && object.strokeWidth !== null ? getNumber(object.strokeWidth) : null,
    strokeDashArray: Array.isArray(object.strokeDashArray) ? object.strokeDashArray.map((d) => getNumber(d)) : (object.visual?.strokeDashArray || null),
    strokeLineCap: object.strokeLineCap || object.visual?.strokeLineCap || 'butt',
    strokeLineJoin: object.strokeLineJoin || object.visual?.strokeLineJoin || 'miter',
    opacity: object.opacity !== undefined && object.opacity !== null ? getNumber(object.opacity, 1) : 1,
    visible: object.visible !== false,
    shadow: object.shadow ? cloneJsonValue(object.shadow) : null,
    backgroundColor: getColorString(object.backgroundColor),
    startArrow: object.startArrow || object.connector?.startArrow || false,
    endArrow: object.endArrow !== undefined ? !!object.endArrow : (object.connector?.endArrow !== undefined ? !!object.connector.endArrow : (semanticType === 'connector')),
    connectorType: object.connectorType || object.connector?.connectorType || object.metadata?.connectorType || (semanticType === 'connector' ? detectConnectorTypeFromPath(object) : null),
    isConnector: semanticType === 'connector' || object.isConnector === true,
    isSkribeLine: object.isSkribeLine === true || object.metadata?.isSkribeLine === true || undefined,
    isStraightLine: object.isStraightLine === true || object.metadata?.isStraightLine === true || undefined,
    sourceShapeId: sourceShapeId || null,
    targetShapeId: targetShapeId || null,
    attachedTextId: attachedTextId || null,
    parentShapeId: parentShapeId || null,
    relationshipMetadata: {
      attachedTextId,
      parentShapeId,
      sourceShapeId,
      targetShapeId
    },
    relationships: [],
    visual: {
      fill: getColorString(object.fill),
      stroke: getColorString(object.stroke),
      strokeWidth: object.strokeWidth !== undefined && object.strokeWidth !== null ? getNumber(object.strokeWidth) : null,
      strokeDashArray: Array.isArray(object.strokeDashArray) ? object.strokeDashArray.map((d) => getNumber(d)) : (object.visual?.strokeDashArray || null),
      strokeLineCap: object.strokeLineCap || object.visual?.strokeLineCap || 'butt',
      strokeLineJoin: object.strokeLineJoin || object.visual?.strokeLineJoin || 'miter',
      opacity: object.opacity !== undefined && object.opacity !== null ? getNumber(object.opacity, 1) : 1,
      visible: object.visible !== false,
      shadow: object.shadow ? cloneJsonValue(object.shadow) : null,
      backgroundColor: getColorString(object.backgroundColor)
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
      charSpacing: object.charSpacing !== undefined && object.charSpacing !== null ? getNumber(object.charSpacing) : 0,
      underline: Boolean(object.underline),
      linethrough: Boolean(object.linethrough),
      overline: Boolean(object.overline),
      color: getColorString(object.fill) || (object.color ? String(object.color) : null),
      stroke: getColorString(object.stroke),
      strokeWidth: object.strokeWidth !== undefined && object.strokeWidth !== null ? getNumber(object.strokeWidth) : 0,
      opacity: object.opacity !== undefined && object.opacity !== null ? getNumber(object.opacity, 1) : 1
    };
  }

  const vectorSummary = getVectorSummary(object);
  if (vectorSummary) normalized.vector = vectorSummary;

  const lineGeometry = getLineGeometry(object);
  if (lineGeometry) normalized.geometry = lineGeometry;

  if (object.points && Array.isArray(object.points)) {
    normalized.points = object.points.map((p) => ({
      x: getNumber(p.x),
      y: getNumber(p.y)
    }));
  }

  if (object.path && Array.isArray(object.path)) {
    const { dx, dy } = getPathWorldDelta(object);
    normalized.path = (dx !== 0 || dy !== 0)
      ? translatePathCommands(object.path, dx, dy)
      : cloneJsonValue(object.path);

    normalized.worldPath = normalized.path;
    normalized.worldPathCommands = normalized.path;
  }

  if (semanticType === 'connector') {
    const connType = object.connectorType || object.connector?.connectorType || detectConnectorTypeFromPath(object) || 'straight';
    normalized.connectorType = connType;
    normalized.connector = {
      sourceShapeId,
      targetShapeId,
      connectorType: connType,
      stroke: getColorString(object.stroke),
      strokeWidth: object.strokeWidth !== undefined && object.strokeWidth !== null ? getNumber(object.strokeWidth) : null,
      startArrow: !!(object.startArrow || object.connector?.startArrow),
      endArrow: object.endArrow !== undefined ? !!object.endArrow : (object.connector?.endArrow !== undefined ? !!object.connector.endArrow : true),
      path: Array.isArray(normalized.path) ? cloneJsonValue(normalized.path) : undefined
    };
    if (normalized.path) {
      normalized.connector.worldPath = cloneJsonValue(normalized.path);
      normalized.connector.worldPathCommands = cloneJsonValue(normalized.path);
    }
    if (normalized.strokeDashArray) normalized.connector.strokeDashArray = normalized.strokeDashArray;
    if (normalized.strokeLineCap && normalized.strokeLineCap !== 'butt') normalized.connector.strokeLineCap = normalized.strokeLineCap;
    if (normalized.strokeLineJoin && normalized.strokeLineJoin !== 'miter') normalized.connector.strokeLineJoin = normalized.strokeLineJoin;
    if (normalized.opacity !== undefined && normalized.opacity !== 1) normalized.connector.opacity = normalized.opacity;
    if (!normalized.metadata) normalized.metadata = {};
    normalized.metadata.connectorType = connType;
  }

  return normalized;
};
