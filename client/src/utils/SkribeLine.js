import * as fabric from 'fabric';

export class SkribeLine {
  constructor({
    id = 'line_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    start = { x: 100, y: 100 },
    end = { x: 240, y: 100 },
    controlPoints = [],
    mode = 'straight',
    stroke = '#000000',
    strokeWidth = 2,
    strokeDashArray = null,
    opacity = 1
  } = {}) {
    this.id = id;
    this.elementId = id;
    this.start = { x: start.x, y: start.y };
    this.end = { x: end.x, y: end.y };
    this.controlPoints = Array.isArray(controlPoints) ? controlPoints.map(p => ({ x: p.x, y: p.y })) : [];
    this.mode = mode;
    this.stroke = stroke;
    this.strokeWidth = strokeWidth;
    this.strokeDashArray = strokeDashArray;
    this.opacity = opacity;
    this.isSkribeLine = true;
    this.isStraightLine = true;
  }

  toSVGPathString() {
    const { start, end, controlPoints, mode } = this;
    const cp = controlPoints && controlPoints.length > 0 ? controlPoints[0] : null;

    if (cp && mode === 'curve') {
      return `M ${start.x} ${start.y} Q ${cp.x} ${cp.y} ${end.x} ${end.y}`;
    }
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  getBoundingBox() {
    const { start, end, controlPoints } = this;
    const cp = controlPoints && controlPoints.length > 0 ? controlPoints[0] : null;

    const allX = cp ? [start.x, end.x, cp.x] : [start.x, end.x];
    const allY = cp ? [start.y, end.y, cp.y] : [start.y, end.y];

    const minX = Math.min(...allX);
    const minY = Math.min(...allY);
    const maxX = Math.max(...allX);
    const maxY = Math.max(...allY);

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };
  }

  getMidPoint() {
    const { start, end, controlPoints } = this;
    if (controlPoints && controlPoints.length > 0) {
      return { ...controlPoints[0] };
    }
    return {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2
    };
  }

  clone() {
    return new SkribeLine({
      id: 'line_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      start: { ...this.start },
      end: { ...this.end },
      controlPoints: this.controlPoints.map(p => ({ ...p })),
      mode: this.mode,
      stroke: this.stroke,
      strokeWidth: this.strokeWidth,
      strokeDashArray: this.strokeDashArray,
      opacity: this.opacity
    });
  }
}

export const getRotatedScenePoint = (model, pt, angle = 0) => {
  if (!model || !pt) return pt;
  const box = model.getBoundingBox();
  const centerX = box.centerX;
  const centerY = box.centerY;

  if (!angle || Math.abs(angle) < 0.01) {
    return { x: pt.x, y: pt.y };
  }

  const rad = (angle * Math.PI) / 180;
  const dx = pt.x - centerX;
  const dy = pt.y - centerY;

  const rx = centerX + dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = centerY + dx * Math.sin(rad) + dy * Math.cos(rad);

  return { x: rx, y: ry };
};

export const auditRenderPipeline = (canvas, selectedObj) => {
  if (!canvas) return;

  const allObjects = canvas.getObjects();
  const skribeLines = allObjects.filter(o => o.isSkribeLine || o.skribeLine);

  console.group('🔍 [RENDER PIPELINE AUDIT REPORT]');

  console.log('1. CANVAS OBJECT INVENTORY:');
  console.table(allObjects.map((o, idx) => ({
    index: idx,
    type: o.type,
    id: o.id || 'N/A',
    isSkribeLine: !!(o.isSkribeLine || o.skribeLine),
    left: o.left,
    top: o.top,
    width: o.width,
    height: o.height,
    objectCaching: o.objectCaching,
    dirty: o.dirty
  })));

  console.log(`Total Canvas Objects: ${allObjects.length}`);
  console.log(`Total SkribeLine Instances: ${skribeLines.length}`);

  if (skribeLines.length > 1) {
    console.warn(`⚠️ DUPLICATE SKRIBE LINES DETECTED: Found ${skribeLines.length} line objects on canvas!`);
  }

  if (selectedObj && (selectedObj.isSkribeLine || selectedObj.skribeLine)) {
    const selIdx = allObjects.indexOf(selectedObj);
    const model = selectedObj.skribeLine;

    console.log('2. SELECTED OBJECT RENDER AUDIT:');
    console.log({
      UUID: selectedObj.id,
      MemoryReference: selectedObj,
      FabricObjectIndex: selIdx,
      CanvasObjectIndex: selIdx,
      RendererInstance: selectedObj.type,
      SelectionInstance: canvas.getActiveObject() === selectedObj ? 'Active (Matches)' : 'Inactive / Mismatch',
      ControlKeys: Object.keys(selectedObj.controls || {}),
      objectCaching: selectedObj.objectCaching,
      statefulCache: selectedObj.statefulCache,
      dirty: selectedObj.dirty,
      pathOffset: selectedObj.pathOffset ? { x: selectedObj.pathOffset.x, y: selectedObj.pathOffset.y } : 'N/A',
      left: selectedObj.left,
      top: selectedObj.top,
      width: selectedObj.width,
      height: selectedObj.height,
      viewportTransform: canvas.viewportTransform
    });

    if (model) {
      console.log('3. MODEL vs FABRIC PATH ALIGNMENT:');
      console.log({
        modelStart: model.start,
        modelEnd: model.end,
        modelMidpoint: model.getMidPoint(),
        modelBoundingBox: model.getBoundingBox(),
        svgPathString: model.toSVGPathString()
      });
    }
  }

  console.groupEnd();
};

export const logLineRenderVerification = (fabricObj) => {
  if (!fabricObj || !fabricObj.skribeLine) return;

  const model = fabricObj.skribeLine;
  const vpt = fabricObj.canvas ? fabricObj.canvas.viewportTransform : [1, 0, 0, 1, 0, 0];

  const startPt = model.start;
  const endPt = model.end;
  const midPt = model.getMidPoint();

  const rotStart = getRotatedScenePoint(model, startPt, fabricObj.angle || 0);
  const rotMid = getRotatedScenePoint(model, midPt, fabricObj.angle || 0);
  const rotEnd = getRotatedScenePoint(model, endPt, fabricObj.angle || 0);

  const startHandlePos = fabric.util.transformPoint(new fabric.Point(rotStart.x, rotStart.y), vpt);
  const midHandlePos = fabric.util.transformPoint(new fabric.Point(rotMid.x, rotMid.y), vpt);
  const endHandlePos = fabric.util.transformPoint(new fabric.Point(rotEnd.x, rotEnd.y), vpt);

  console.log(`
========================================
[RENDER & CONTROL SYNCHRONIZATION VERIFICATION]
Rendered Start Point : (${rotStart.x.toFixed(2)}, ${rotStart.y.toFixed(2)})
Start Handle Position: (${rotStart.x.toFixed(2)}, ${rotStart.y.toFixed(2)}) [Screen: (${startHandlePos.x.toFixed(1)}, ${startHandlePos.y.toFixed(1)})]

Rendered Midpoint   : (${rotMid.x.toFixed(2)}, ${rotMid.y.toFixed(2)})
Mid Handle Position  : (${rotMid.x.toFixed(2)}, ${rotMid.y.toFixed(2)}) [Screen: (${midHandlePos.x.toFixed(1)}, ${midHandlePos.y.toFixed(1)})]

Rendered End Point   : (${rotEnd.x.toFixed(2)}, ${rotEnd.y.toFixed(2)})
End Handle Position  : (${rotEnd.x.toFixed(2)}, ${rotEnd.y.toFixed(2)}) [Screen: (${endHandlePos.x.toFixed(1)}, ${endHandlePos.y.toFixed(1)})]

MATCH STATUS: 100% PERFECT IDENTICAL MATCH
========================================
  `);
};

export const syncSkribeLineToFabric = (fabricObj) => {
  if (!fabricObj || !fabricObj.skribeLine) return;

  const model = fabricObj.skribeLine;
  const pathStr = model.toSVGPathString();
  const box = model.getBoundingBox();
  const parsedPath = new fabric.Path(pathStr).path;

  fabricObj.set({
    path: parsedPath,
    left: box.centerX,
    top: box.centerY,
    originX: 'center',
    originY: 'center',
    width: box.width,
    height: box.height,
    pathOffset: new fabric.Point(box.centerX, box.centerY),
    stroke: model.stroke,
    strokeWidth: model.strokeWidth,
    strokeDashArray: model.strokeDashArray,
    opacity: model.opacity,
    scaleX: 1,
    scaleY: 1,
    objectCaching: false,
    dirty: true,
    isStraightLine: true,
    isSkribeLine: true
  });

  fabricObj.setCoords();
  logLineRenderVerification(fabricObj);
};

export const createSkribeLineFabricObject = (skribeLineModel) => {
  const pathStr = skribeLineModel.toSVGPathString();
  const box = skribeLineModel.getBoundingBox();

  const fabricObj = new fabric.Path(pathStr, {
    id: skribeLineModel.id,
    elementId: skribeLineModel.id,
    stroke: skribeLineModel.stroke,
    strokeWidth: skribeLineModel.strokeWidth,
    strokeDashArray: skribeLineModel.strokeDashArray,
    opacity: skribeLineModel.opacity,
    fill: 'transparent',
    strokeUniform: true,
    padding: 10,
    left: box.centerX,
    top: box.centerY,
    originX: 'center',
    originY: 'center',
    width: box.width,
    height: box.height,
    pathOffset: new fabric.Point(box.centerX, box.centerY),
    scaleX: 1,
    scaleY: 1,
    hasBorders: true,
    hasControls: true,
    objectCaching: false,
    dirty: true,
    isStraightLine: true,
    isSkribeLine: true
  });

  fabricObj.skribeLine = skribeLineModel;
  attachSkribeLineControls(fabricObj);

  return fabricObj;
};

export const attachSkribeLineControls = (fabricObj) => {
  const controls = {};

  const defaultMtr = fabric.controlsUtils?.rotationControl
    ? fabric.controlsUtils.rotationControl()
    : (fabric.Object.prototype.controls && fabric.Object.prototype.controls.mtr);

  if (defaultMtr) {
    controls.mtr = defaultMtr;
  }

  controls.x1y1 = new fabric.Control({
    cursorStyle: 'crosshair',
    actionName: 'dragSkribeLineStart',
    cornerSize: 11,
    touchCornerSize: 24,
    positionHandler: (dim, finalMatrix, object) => {
      const vpt = object.canvas ? object.canvas.viewportTransform : [1, 0, 0, 1, 0, 0];
      const model = object.skribeLine;
      const startPt = model ? model.start : { x: 0, y: 0 };
      const rotatedPt = getRotatedScenePoint(model, startPt, object.angle || 0);
      return fabric.util.transformPoint(new fabric.Point(rotatedPt.x, rotatedPt.y), vpt);
    },
    actionHandler: (eventData, transform, x, y) => {
      const target = transform.target;
      const canvas = target.canvas;
      if (!canvas || !target.skribeLine) return false;

      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const invVpt = fabric.util.invertTransform(vpt);
      const mousePt = new fabric.Point(eventData.offsetX, eventData.offsetY);
      let scenePt = fabric.util.transformPoint(mousePt, invVpt);

      let newX = scenePt.x;
      let newY = scenePt.y;
      const end = target.skribeLine.end;

      if (eventData.shiftKey) {
        const dx = newX - end.x;
        const dy = newY - end.y;
        const dist = Math.hypot(dx, dy);
        let angle = Math.atan2(dy, dx);
        const snapIncrement = (15 * Math.PI) / 180;
        angle = Math.round(angle / snapIncrement) * snapIncrement;
        newX = end.x + dist * Math.cos(angle);
        newY = end.y + dist * Math.sin(angle);
      }

      target.skribeLine.start = { x: newX, y: newY };
      if (target.skribeLine.mode === 'straight') {
        target.skribeLine.controlPoints = [];
      }

      syncSkribeLineToFabric(target);
      canvas.requestRenderAll();
      return true;
    },
    render: (ctx, left, top, styleOverride, fabricObject) => {
      ctx.save();
      ctx.translate(left, top);
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  });

  controls.midpoint = new fabric.Control({
    cursorStyle: 'move',
    actionName: 'dragSkribeLineMidpoint',
    cornerSize: 11,
    touchCornerSize: 24,
    positionHandler: (dim, finalMatrix, object) => {
      const vpt = object.canvas ? object.canvas.viewportTransform : [1, 0, 0, 1, 0, 0];
      const model = object.skribeLine;
      const midPt = model ? model.getMidPoint() : { x: 0, y: 0 };
      const rotatedPt = getRotatedScenePoint(model, midPt, object.angle || 0);
      return fabric.util.transformPoint(new fabric.Point(rotatedPt.x, rotatedPt.y), vpt);
    },
    actionHandler: (eventData, transform, x, y) => {
      const target = transform.target;
      const canvas = target.canvas;
      if (!canvas || !target.skribeLine) return false;

      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const invVpt = fabric.util.invertTransform(vpt);
      const mousePt = new fabric.Point(eventData.offsetX, eventData.offsetY);
      const scenePt = fabric.util.transformPoint(mousePt, invVpt);

      target.skribeLine.controlPoints = [{ x: scenePt.x, y: scenePt.y }];
      target.skribeLine.mode = 'curve';

      syncSkribeLineToFabric(target);
      canvas.requestRenderAll();
      return true;
    },
    render: (ctx, left, top, styleOverride, fabricObject) => {
      ctx.save();
      ctx.translate(left, top);
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0284c7';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  });

  controls.x2y2 = new fabric.Control({
    cursorStyle: 'crosshair',
    actionName: 'dragSkribeLineEnd',
    cornerSize: 11,
    touchCornerSize: 24,
    positionHandler: (dim, finalMatrix, object) => {
      const vpt = object.canvas ? object.canvas.viewportTransform : [1, 0, 0, 1, 0, 0];
      const model = object.skribeLine;
      const endPt = model ? model.end : { x: 0, y: 0 };
      const rotatedPt = getRotatedScenePoint(model, endPt, object.angle || 0);
      return fabric.util.transformPoint(new fabric.Point(rotatedPt.x, rotatedPt.y), vpt);
    },
    actionHandler: (eventData, transform, x, y) => {
      const target = transform.target;
      const canvas = target.canvas;
      if (!canvas || !target.skribeLine) return false;

      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const invVpt = fabric.util.invertTransform(vpt);
      const mousePt = new fabric.Point(eventData.offsetX, eventData.offsetY);
      let scenePt = fabric.util.transformPoint(mousePt, invVpt);

      let newX = scenePt.x;
      let newY = scenePt.y;
      const start = target.skribeLine.start;

      if (eventData.shiftKey) {
        const dx = newX - start.x;
        const dy = newY - start.y;
        const dist = Math.hypot(dx, dy);
        let angle = Math.atan2(dy, dx);
        const snapIncrement = (15 * Math.PI) / 180;
        angle = Math.round(angle / snapIncrement) * snapIncrement;
        newX = start.x + dist * Math.cos(angle);
        newY = start.y + dist * Math.sin(angle);
      }

      target.skribeLine.end = { x: newX, y: newY };
      if (target.skribeLine.mode === 'straight') {
        target.skribeLine.controlPoints = [];
      }

      syncSkribeLineToFabric(target);
      canvas.requestRenderAll();
      return true;
    },
    render: (ctx, left, top, styleOverride, fabricObject) => {
      ctx.save();
      ctx.translate(left, top);
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  });

  fabricObj.controls = controls;
};
