
import { SkribeLine, attachSkribeLineControls, syncSkribeLineToFabric } from './SkribeLine.js';
import { isConnectorPath, detectConnectorTypeFromPath } from '../features/messCleanup/cleanupTypes.js';

export const SKRIBE_SERIALIZABLE_PROPERTIES = Object.freeze([
  'id',
  'elementId',
  'strokeId',
  'parentShapeId',
  'attachedTextId',
  'metadata',
  'aiMetadata',
  'isStickyNote',
  'isChecklistNote',
  'isCalloutNote',
  'checklistItems',
  'noteColor',
  'contrastResolved',
  'isConnector',
  'connectorType',
  'startArrow',
  'endArrow',
  'sourceShapeId',
  'targetShapeId',
  'skribeLine',
  'locked',
  'protected',
  'system',
  'isVectorStroke',
  'vectorStrokeData',
  'isStraightLine',
  'isSkribeLine',
  'shapeType',
  'angle',
  'padding',
  'x1',
  'y1',
  'x2',
  'y2'
]);

export const hydrateSkribeFabricObject = (fabricObj, persistedData) => {
  if (!fabricObj || !persistedData) return fabricObj;

  let resolvedId = persistedData.id !== undefined ? persistedData.id : fabricObj.id;
  const elementId = persistedData.elementId !== undefined ? persistedData.elementId : fabricObj.elementId;
  const strokeId = persistedData.strokeId !== undefined ? persistedData.strokeId : fabricObj.strokeId;

  if (typeof resolvedId === 'string') {
    if (resolvedId.startsWith('shape_line_')) {
      resolvedId = resolvedId.replace(/^shape_line_/, 'line_');
    } else if (resolvedId.startsWith('shape_conn_')) {
      resolvedId = resolvedId.replace(/^shape_conn_/, 'conn_');
    } else if (resolvedId.startsWith('shape_connector_')) {
      resolvedId = resolvedId.replace(/^shape_connector_/, 'conn_');
    } else if (resolvedId.startsWith('shape_stroke_')) {
      resolvedId = resolvedId.replace(/^shape_stroke_/, 'stroke_');
    }
  }

  if (!resolvedId) {
    if (typeof elementId === 'string' && elementId.startsWith('line_')) {
      resolvedId = elementId;
    } else if (typeof elementId === 'string' && (elementId.startsWith('conn_') || elementId.startsWith('connector_'))) {
      resolvedId = elementId.startsWith('connector_') ? elementId.replace(/^connector_/, 'conn_') : elementId;
    } else if (strokeId || (typeof elementId === 'string' && elementId.startsWith('stroke_'))) {
      resolvedId = strokeId || elementId;
    }
  }

  if (resolvedId !== undefined) fabricObj.id = resolvedId;
  if (elementId !== undefined) fabricObj.elementId = elementId;
  if (strokeId !== undefined) fabricObj.strokeId = strokeId;

  const isLine = persistedData.isSkribeLine === true ||
                 persistedData.isStraightLine === true ||
                 Boolean(persistedData.skribeLine) ||
                 fabricObj.isSkribeLine === true ||
                 fabricObj.isStraightLine === true ||
                 (typeof elementId === 'string' && elementId.startsWith('line_')) ||
                 (typeof resolvedId === 'string' && resolvedId.startsWith('line_'));

  if (isLine) {
    fabricObj.isSkribeLine = true;
    fabricObj.isStraightLine = true;
    if (!fabricObj.id) {
      fabricObj.id = elementId && elementId.startsWith('line_') ? elementId : `line_${Date.now()}`;
    }

    if (persistedData.skribeLine) {
      fabricObj.skribeLine = persistedData.skribeLine instanceof SkribeLine
        ? persistedData.skribeLine
        : new SkribeLine(persistedData.skribeLine);
    }
  }

  const isConn = persistedData.isConnector === true ||
                 Boolean(persistedData.connectorType) ||
                 persistedData.startArrow !== undefined ||
                 persistedData.endArrow !== undefined ||
                 fabricObj.isConnector === true ||
                 Boolean(fabricObj.connectorType) ||
                 (typeof elementId === 'string' && (elementId.startsWith('conn_') || elementId.startsWith('connector_'))) ||
                 (typeof resolvedId === 'string' && (resolvedId.startsWith('conn_') || resolvedId.startsWith('connector_'))) ||
                 isConnectorPath(persistedData) ||
                 isConnectorPath(fabricObj);

  if (isConn) {
    fabricObj.isConnector = true;
    if (!fabricObj.id) {
      fabricObj.id = elementId && (elementId.startsWith('conn_') || elementId.startsWith('connector_'))
        ? (elementId.startsWith('connector_') ? elementId.replace(/^connector_/, 'conn_') : elementId)
        : (elementId ? (elementId.startsWith('obj_') ? `conn_${elementId}` : `conn_${elementId}`) : `conn_${Date.now()}`);
    }
    const detectedType = detectConnectorTypeFromPath(persistedData) || detectConnectorTypeFromPath(fabricObj) || 'straight';
    fabricObj.connectorType = persistedData.connectorType || fabricObj.connectorType || detectedType;
    if (persistedData.startArrow !== undefined) fabricObj.startArrow = persistedData.startArrow;
    if (persistedData.endArrow !== undefined) fabricObj.endArrow = persistedData.endArrow;
    else if (isConnectorPath(persistedData) || isConnectorPath(fabricObj)) fabricObj.endArrow = true;
    if (persistedData.sourceShapeId !== undefined) fabricObj.sourceShapeId = persistedData.sourceShapeId;
    if (persistedData.targetShapeId !== undefined) fabricObj.targetShapeId = persistedData.targetShapeId;
    if (persistedData.x1 !== undefined) fabricObj.x1 = persistedData.x1;
    if (persistedData.y1 !== undefined) fabricObj.y1 = persistedData.y1;
    if (persistedData.x2 !== undefined) fabricObj.x2 = persistedData.x2;
    if (persistedData.y2 !== undefined) fabricObj.y2 = persistedData.y2;
    if (persistedData.connector !== undefined) fabricObj.connector = persistedData.connector;
  }

  if (persistedData.isStickyNote !== undefined) fabricObj.isStickyNote = persistedData.isStickyNote;
  if (persistedData.isChecklistNote !== undefined) fabricObj.isChecklistNote = persistedData.isChecklistNote;
  if (persistedData.isCalloutNote !== undefined) fabricObj.isCalloutNote = persistedData.isCalloutNote;
  if (persistedData.noteColor !== undefined) fabricObj.noteColor = persistedData.noteColor;
  if (persistedData.checklistItems !== undefined) fabricObj.checklistItems = persistedData.checklistItems;

  if (persistedData.parentShapeId !== undefined) fabricObj.parentShapeId = persistedData.parentShapeId;
  if (persistedData.attachedTextId !== undefined) fabricObj.attachedTextId = persistedData.attachedTextId;

  if (persistedData.isVectorStroke !== undefined) fabricObj.isVectorStroke = persistedData.isVectorStroke;
  if (persistedData.vectorStrokeData !== undefined) fabricObj.vectorStrokeData = persistedData.vectorStrokeData;

  if (persistedData.metadata !== undefined) fabricObj.metadata = persistedData.metadata;
  if (persistedData.aiMetadata !== undefined) fabricObj.aiMetadata = persistedData.aiMetadata;
  if (persistedData.shapeType !== undefined) fabricObj.shapeType = persistedData.shapeType;
  if (persistedData.contrastResolved !== undefined) fabricObj.contrastResolved = persistedData.contrastResolved;
  if (persistedData.locked !== undefined) fabricObj.locked = persistedData.locked;
  if (persistedData.protected !== undefined) fabricObj.protected = persistedData.protected;
  if (persistedData.system !== undefined) fabricObj.system = persistedData.system;
  if (persistedData.padding !== undefined) fabricObj.padding = persistedData.padding;

  return fabricObj;
};

export const hydrateCanvasObjects = (canvas, jsonPayload) => {
  if (!canvas || typeof canvas.getObjects !== 'function') return [];
  const loadedObjects = canvas.getObjects();
  const rawObjects = Array.isArray(jsonPayload)
    ? jsonPayload
    : (jsonPayload?.objects || []);

  loadedObjects.forEach((obj, index) => {
    const persisted = rawObjects[index];
    hydrateSkribeFabricObject(obj, persisted || obj);
    if (obj.isSkribeLine || obj.skribeLine) {
      if (typeof attachSkribeLineControls === 'function') {
        attachSkribeLineControls(obj);
      }
      if (typeof syncSkribeLineToFabric === 'function' && obj.skribeLine) {
        syncSkribeLineToFabric(obj);
      }
    }
  });

  return loadedObjects;
};

export default {
  SKRIBE_SERIALIZABLE_PROPERTIES,
  hydrateSkribeFabricObject,
  hydrateCanvasObjects
};
