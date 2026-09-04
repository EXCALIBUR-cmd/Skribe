import { getSemanticType, getShapeType } from './cleanupTypes.js';

export const buildMessCleanupInventory = (objects = []) => {
  const connectors = [];
  const lines = [];
  const strokes = [];
  const shapes = [];
  const notes = [];
  const texts = [];

  objects.forEach((obj, idx) => {
    const index = idx + 1;
    const semanticType = obj.semanticType || getSemanticType(obj);
    const id = obj.id || obj.sourceObjectId || (obj.elementId ? `shape_${obj.elementId}` : `obj_${index}`);
    const elementId = obj.elementId || null;

    if (semanticType === 'connector') {
      const connType = obj.connectorType || obj.connector?.connectorType || 'straight';
      const source = obj.sourceShapeId || obj.connector?.sourceShapeId || null;
      const target = obj.targetShapeId || obj.connector?.targetShapeId || null;
      const startArrow = obj.startArrow !== undefined ? obj.startArrow : (obj.connector?.startArrow || false);
      const endArrow = obj.endArrow !== undefined ? obj.endArrow : (obj.connector?.endArrow !== undefined ? obj.connector.endArrow : true);
      const topo = obj.connectorTopology;

      connectors.push({
        '#': index,
        id,
        elementId,
        semanticType,
        connectorType: connType,
        source,
        target,
        confidence: topo ? topo.overallConfidence : (source && target ? 0.99 : 0),
        endpointSource: topo ? topo.endpointSource : (source || target ? 'explicit' : 'none'),
        startArrow,
        endArrow
      });
    } else if (semanticType === 'line') {
      lines.push({
        '#': index,
        id,
        elementId,
        semanticType,
        isSkribeLine: obj.isSkribeLine !== undefined ? obj.isSkribeLine : true,
        isStraightLine: obj.isStraightLine !== undefined ? obj.isStraightLine : true
      });
    } else if (semanticType === 'stroke') {
      strokes.push({
        '#': index,
        id,
        strokeId: obj.strokeId || elementId || null,
        semanticType
      });
    } else if (semanticType === 'shape') {
      shapes.push({
        '#': index,
        id,
        elementId,
        shapeType: getShapeType(obj)
      });
    } else if (semanticType === 'note') {
      notes.push({
        '#': index,
        id,
        elementId,
        isStickyNote: Boolean(obj.isStickyNote),
        isCalloutNote: Boolean(obj.isCalloutNote)
      });
    } else if (semanticType === 'text') {
      texts.push({
        '#': index,
        id,
        elementId,
        text: obj.text || ''
      });
    }
  });

  return {
    connectors,
    lines,
    strokes,
    shapes,
    notes,
    texts,
    totalConnectors: connectors.length,
    totalLines: lines.length,
    totalStrokes: strokes.length,
    totalShapes: shapes.length,
    totalNotes: notes.length,
    totalTexts: texts.length,
    totalObjects: objects.length
  };
};

export const logObjectDiagnostic = (object, index = 0, totalCount = 1, normalized = null) => {
  const objNum = index + 1;
  const semanticType = normalized?.semanticType || getSemanticType(object);
  const id = object?.id || normalized?.id || '(no-id)';
  const elementId = object?.elementId || normalized?.elementId || '(none)';
  const fabricType = object?.type || normalized?.originalType || 'unknown';

  const path = object?.path || normalized?.connector?.path || normalized?.path;
  const pathPresent = Array.isArray(path) && path.length > 0;
  const pathLength = pathPresent ? path.length : 0;

  const posX = object?.left !== undefined ? object.left : normalized?.position?.x;
  const posY = object?.top !== undefined ? object.top : normalized?.position?.y;
  const width = object?.width !== undefined ? object.width : normalized?.dimensions?.width;
  const height = object?.height !== undefined ? object.height : normalized?.dimensions?.height;

  console.group(`[MessCleanup Diagnostic] OBJECT ${objNum} / ${totalCount}`);
  console.log('id:', id);
  console.log('elementId:', elementId);
  console.log('fabricType:', fabricType);
  console.log('semanticType:', semanticType);
  console.log(`SEMANTIC TYPE: ${semanticType}`);

  if (semanticType === 'line') {
    console.log('--- LINE DETECTED ---');
    console.log('isSkribeLine:', object?.isSkribeLine !== undefined ? object.isSkribeLine : normalized?.isSkribeLine);
    console.log('isStraightLine:', object?.isStraightLine !== undefined ? object.isStraightLine : normalized?.isStraightLine);
    console.log('elementId:', elementId);
    console.log('pathPresent:', pathPresent);
    console.log('pathLength:', pathLength);
    console.log('position:', { x: posX, y: posY });
    console.log('bounds:', { width, height });
    if (object?.sourceShapeId !== undefined) console.log('sourceShapeId:', object.sourceShapeId);
    if (object?.targetShapeId !== undefined) console.log('targetShapeId:', object.targetShapeId);
  } else if (semanticType === 'connector') {
    console.log('*** CONNECTOR DETECTED ***');
    console.log('id:', id);
    console.log('elementId:', elementId);
    console.log('connectorType:', object?.connectorType || normalized?.connector?.connectorType || 'straight');
    console.log('isConnector:', object?.isConnector !== undefined ? object.isConnector : true);
    console.log('startArrow:', object?.startArrow !== undefined ? object.startArrow : (normalized?.connector?.startArrow || false));
    console.log('endArrow:', object?.endArrow !== undefined ? object.endArrow : (normalized?.connector?.endArrow !== undefined ? normalized.connector.endArrow : true));
    console.log('sourceShapeId:', object?.sourceShapeId || normalized?.connector?.sourceShapeId || null);
    console.log('targetShapeId:', object?.targetShapeId || normalized?.connector?.targetShapeId || null);
    console.log('pathPresent:', pathPresent);
    console.log('pathLength:', pathLength);
    console.log('position:', { x: posX, y: posY });
    console.log('bounds:', { width, height });
  } else if (semanticType === 'stroke') {
    console.log('--- STROKE DETECTED ---');
    console.log('id:', id);
    console.log('elementId:', elementId);
    console.log('strokeId:', object?.strokeId || normalized?.strokeId || elementId);
    console.log('isVectorStroke:', object?.isVectorStroke !== undefined ? object.isVectorStroke : true);
    console.log('pathPresent:', pathPresent);
    console.log('position:', { x: posX, y: posY });
    console.log('bounds:', { width, height });
  } else if (semanticType === 'shape') {
    console.log('--- SHAPE DETECTED ---');
    console.log('id:', id);
    console.log('elementId:', elementId);
    console.log('shapeType:', getShapeType(object));
    console.log('fill:', object?.fill);
    console.log('stroke:', object?.stroke);
    console.log('width:', width);
    console.log('height:', height);
  } else if (semanticType === 'note') {
    console.log('--- NOTE DETECTED ---');
    console.log('id:', id);
    console.log('elementId:', elementId);
    console.log('isStickyNote:', Boolean(object?.isStickyNote || normalized?.isStickyNote));
    console.log('isCalloutNote:', Boolean(object?.isCalloutNote || normalized?.isCalloutNote));
    console.log('width:', width);
    console.log('height:', height);
  } else if (semanticType === 'text') {
    console.log('--- TEXT DETECTED ---');
    console.log('id:', id);
    console.log('elementId:', elementId);
    console.log('parentShapeId:', object?.parentShapeId || normalized?.parentShapeId || null);
    console.log('attachedTextId:', object?.attachedTextId || normalized?.attachedTextId || null);
    console.log('text:', object?.text || normalized?.text || '');
    console.log('rotation:', object?.angle || normalized?.rotation || 0);
    console.log('bounds:', { width, height });
  }

  console.groupEnd();
};

export const logMessCleanupInventory = (objects = []) => {
  const inventory = buildMessCleanupInventory(objects);

  console.log('\n================================================================================');
  console.log('CONNECTOR INVENTORY');
  console.log('================================================================================');
  if (inventory.connectors.length > 0) {
    if (typeof console.table === 'function') {
      console.table(inventory.connectors);
    } else {
      inventory.connectors.forEach((c) => {
        console.log(`| #${c['#']} | id: ${c.id} | elementId: ${c.elementId} | type: ${c.connectorType} | source: ${c.source} | target: ${c.target} | startArrow: ${c.startArrow} | endArrow: ${c.endArrow} |`);
      });
    }
  } else {
    console.log('(No connectors detected)');
  }
  console.log(`TOTAL CONNECTORS: ${inventory.totalConnectors}`);
  console.log('================================================================================\n');

  console.log('================================================================================');
  console.log('LINE INVENTORY');
  console.log('================================================================================');
  if (inventory.lines.length > 0) {
    if (typeof console.table === 'function') {
      console.table(inventory.lines);
    } else {
      inventory.lines.forEach((l) => {
        console.log(`| #${l['#']} | id: ${l.id} | elementId: ${l.elementId} | isSkribeLine: ${l.isSkribeLine} | isStraightLine: ${l.isStraightLine} |`);
      });
    }
  } else {
    console.log('(No straight lines detected)');
  }
  console.log(`TOTAL LINES: ${inventory.totalLines}`);
  console.log('================================================================================\n');

  console.log('================================================================================');
  console.log('STROKE INVENTORY');
  console.log('================================================================================');
  if (inventory.strokes.length > 0) {
    if (typeof console.table === 'function') {
      console.table(inventory.strokes);
    } else {
      inventory.strokes.forEach((s) => {
        console.log(`| #${s['#']} | id: ${s.id} | strokeId: ${s.strokeId} | semanticType: ${s.semanticType} |`);
      });
    }
  } else {
    console.log('(No freehand strokes detected)');
  }
  console.log(`TOTAL STROKES: ${inventory.totalStrokes}`);
  console.log('================================================================================\n');

  return inventory;
};
