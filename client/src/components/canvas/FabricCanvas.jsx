import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import * as fabric from 'fabric';
import anime from 'animejs';
import { isReducedMotion } from '../../animations/config';
import {
  createConnectorObject,
  generateConnectorPathData,
  getNearestShapeAnchor
} from '../../utils/connectorUtils';
import {
  smoothStrokePoints,
  renderVectorStroke,
  createVectorStrokeData
} from '../../utils/strokeUtils';
import {
  SkribeLine,
  createSkribeLineFabricObject,
  syncSkribeLineToFabric,
  attachSkribeLineControls,
  auditRenderPipeline
} from '../../utils/SkribeLine';
import eraserManager from '../../utils/EraserManager';

const logChecklistMutation = ({ functionName, lineNo, reason, prevItems, nextItems }) => {
  const stack = new Error().stack;
  console.log(`
----------------------------------------
[MUTATION LOG]
Timestamp: ${new Date().toISOString()}
Function: ${functionName}
File: FabricCanvas.jsx
Line Number: ${lineNo}
Reason: ${reason}
Previous checklistItems: ${JSON.stringify(prevItems)}
Next checklistItems: ${JSON.stringify(nextItems)}
Call Stack:
${stack}
----------------------------------------
  `);
};

export const FabricCanvas = forwardRef(({
  activeTool = 'select',
  penConfig = { color: '#000000', width: 4, opacity: 1.0, brushType: 'standard' },
  activeColor = '#000000',
  onZoomChange,
  onSelectionChange,
  onToolComplete,
  onContextMenu,
  onHistoryChange,
  onCanvasChange,
  className = ''
}, ref) => {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);
  const [rotationBadge, setRotationBadge] = useState(null);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const zoomAnimationRef = useRef(null);
  const newObjectOffsetRef = useRef(0);
  const activeToolRef = useRef(activeTool);
  const activeColorRef = useRef(activeColor);
  const penConfigRef = useRef(penConfig);

  const isSpacePanRef = useRef(false);
  const isPanningRef = useRef(false);

  const strokePointsRef = useRef([]);
  const activeDrawPathRef = useRef(null);
  const isDrawingStrokeRef = useRef(false);
  const animFrameRequestedRef = useRef(false);

  const isDrawingLineRef = useRef(false);
  const activeLineRef = useRef(null);
  const lineStartPointRef = useRef({ x: 0, y: 0 });

  const isErasingDragRef = useRef(false);

  useEffect(() => {
    activeToolRef.current = activeTool;
    activeColorRef.current = activeColor;
    penConfigRef.current = penConfig;
  }, [activeTool, activeColor, penConfig]);

  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const isHistoryProcessingRef = useRef(false);
  const isLoadingFromJSONRef = useRef(false);

  const onCanvasChangeRef = useRef(onCanvasChange);
  useEffect(() => {
    onCanvasChangeRef.current = onCanvasChange;
  }, [onCanvasChange]);

  const syncLinkedPosition = (opt) => {
    const canvas = fabricCanvasRef.current;
    const target = opt ? opt.target : null;
    if (!target || !canvas) return;

    if (target.attachedTextId) {
      const text = canvas.getObjects().find((o) => o.id === target.attachedTextId);
      if (text) {
        const isNoteCard = !!(target.isStickyNote || target.isChecklistNote || target.isCalloutNote);
        if (isNoteCard) {
          const padding = 18;
          const angleRad = ((target.angle || 0) * Math.PI) / 180;
          const offsetX = - (target.width / 2) + padding;
          const offsetY = - (target.height / 2) + padding;
          const rotatedX = offsetX * Math.cos(angleRad) - offsetY * Math.sin(angleRad);
          const rotatedY = offsetX * Math.sin(angleRad) + offsetY * Math.cos(angleRad);

          text.set({
            left: target.left + rotatedX,
            top: target.top + rotatedY,
            angle: target.angle
          });
        } else {
          text.set({
            left: target.left,
            top: target.top,
            angle: target.angle
          });
        }
        text.setCoords();
      }
    }

    const allObjects = canvas.getObjects();
    const connectors = allObjects.filter((o) => o.isConnector);

    connectors.forEach((conn) => {
      if (conn.sourceShapeId === target.id || conn.targetShapeId === target.id) {
        const sourceObj = allObjects.find((o) => o.id === conn.sourceShapeId);
        const targetObj = allObjects.find((o) => o.id === conn.targetShapeId);

        if (sourceObj && targetObj) {
          const p2Center = targetObj.getCenterPoint ? targetObj.getCenterPoint() : { x: targetObj.left, y: targetObj.top };
          const p1Center = sourceObj.getCenterPoint ? sourceObj.getCenterPoint() : { x: sourceObj.left, y: sourceObj.top };

          const a1 = getNearestShapeAnchor(sourceObj, p2Center);
          const a2 = getNearestShapeAnchor(targetObj, p1Center);

          const newPathData = generateConnectorPathData({
            x1: a1.x,
            y1: a1.y,
            x2: a2.x,
            y2: a2.y,
            connectorType: conn.connectorType || 'straight',
            strokeWidth: conn.strokeWidth || 3,
            startArrow: conn.startArrow,
            endArrow: conn.endArrow !== false
          });

          conn.set({
            path: newPathData,
            x1: a1.x,
            y1: a1.y,
            x2: a2.x,
            y2: a2.y
          });
          conn.setCoords();
        }
      }
    });

    canvas.requestRenderAll();
  };

  const handleObjectMoving = (opt) => {
    const target = opt ? opt.target : null;
    if (!target || !target.skribeLine) {
      syncLinkedPosition(opt);
      return;
    }

    const box = target.skribeLine.getBoundingBox();
    const dx = target.left - box.centerX;
    const dy = target.top - box.centerY;

    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      target.skribeLine.start.x += dx;
      target.skribeLine.start.y += dy;
      target.skribeLine.end.x += dx;
      target.skribeLine.end.y += dy;
      if (target.skribeLine.controlPoints) {
        target.skribeLine.controlPoints.forEach((cp) => {
          cp.x += dx;
          cp.y += dy;
        });
      }
      syncSkribeLineToFabric(target);
    }

    syncLinkedPosition(opt);
  };

  const updatePanCursorAndSelection = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const isPanActive = activeToolRef.current === 'pan' || isSpacePanRef.current || isPanningRef.current;

    if (isPanningRef.current) {
      canvas.defaultCursor = 'grabbing';
      canvas.hoverCursor = 'grabbing';
      canvas.moveCursor = 'grabbing';
      canvas.setCursor('grabbing');
      canvas.selection = false;
      canvas.skipTargetFind = true;
    } else if (isPanActive) {
      canvas.defaultCursor = 'grab';
      canvas.hoverCursor = 'grab';
      canvas.moveCursor = 'grab';
      canvas.setCursor('grab');
      canvas.selection = false;
      canvas.skipTargetFind = true;
    } else {
      canvas.skipTargetFind = false;
      const currentTool = activeToolRef.current;
      if (currentTool === 'draw' || currentTool === 'line') {
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';
        canvas.hoverCursor = 'crosshair';
        canvas.setCursor('crosshair');
      } else if (currentTool === 'eraser') {
        const eraserCursor = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='%23ef4444' stroke='%23ffffff' stroke-width='1.5'><path d='M16.24 3.56l4.95 4.95a2 2 0 0 1 0 2.83L11.8 20.73a2 2 0 0 1-2.83 0l-4.95-4.95a2 2 0 0 1 0-2.83L13.41 3.56a2 2 0 0 1 2.83 0z'/><path d='M18 13l-4 4'/></svg>\") 4 20, pointer";
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.defaultCursor = eraserCursor;
        canvas.hoverCursor = eraserCursor;
        canvas.setCursor(eraserCursor);
      } else {
        eraserManager.clearHoverPreview(canvas);
        canvas.isDrawingMode = false;
        canvas.selection = currentTool === 'select';
        const cursorStyle = ['rect', 'circle', 'sticky', 'checklist', 'callout', 'text', 'line'].includes(currentTool)
          ? 'crosshair'
          : 'default';
        canvas.defaultCursor = cursorStyle;
        canvas.hoverCursor = null;
        canvas.moveCursor = 'move';
        canvas.setCursor(cursorStyle);
      }
    }
    canvas.requestRenderAll();
  };

  useEffect(() => {
    const handleGlobalSpaceDown = (e) => {
      if (e.code === 'Space' || e.key === ' ') {
        const activeEl = document.activeElement;
        const isInputEditing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
        const canvas = fabricCanvasRef.current;
        const activeObj = canvas?.getActiveObject();
        const isFabricTextEditing = activeObj && activeObj.isEditing;

        if (isInputEditing || isFabricTextEditing) return;

        if (!isSpacePanRef.current) {
          isSpacePanRef.current = true;
          e.preventDefault();
          updatePanCursorAndSelection();
        }
      }
    };

    const handleGlobalSpaceUp = (e) => {
      if (e.code === 'Space' || e.key === ' ') {
        if (isSpacePanRef.current) {
          isSpacePanRef.current = false;
          updatePanCursorAndSelection();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalSpaceDown, { capture: true });
    window.addEventListener('keyup', handleGlobalSpaceUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleGlobalSpaceDown, { capture: true });
      window.removeEventListener('keyup', handleGlobalSpaceUp, { capture: true });
    };
  }, []);

  const ensureObjectId = (obj) => {
    if (!obj) return;
    if (!obj.id) {
      obj.id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    }
    if (!obj.elementId) {
      obj.elementId = obj.id;
    }
  };

  const createRuledPaperFill = (bgColor) => {
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = 40;
    patternCanvas.height = 24;
    const ctx = patternCanvas.getContext('2d');

    ctx.fillStyle = bgColor || '#fff3a0';
    ctx.fillRect(0, 0, 40, 24);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 23.5);
    ctx.lineTo(40, 23.5);
    ctx.stroke();

    return new fabric.Pattern({
      source: patternCanvas,
      repeat: 'repeat'
    });
  };

  const formatChecklistItems = (items = []) => {
    if (!items || items.length === 0) {
      return '☐ ';
    }
    return items
      .map((item) => {
        const prefix = item.checked ? '☑' : '☐';
        const itemText = item.text !== undefined ? item.text : '';
        return `${prefix} ${itemText}`;
      })
      .join('\n');
  };

  const saveState = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || isHistoryProcessingRef.current) return;

    canvas.getObjects().forEach((o) => ensureObjectId(o));

    const canvasObjects = canvas.getObjects();
    console.log('[BOARD SAVE DEBUG] Canvas change detected');
    console.log('[BOARD SAVE DEBUG] Object count:', canvasObjects.length);

    const serialized = canvas.toJSON([
      'id',
      'elementId',
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
      'angle',
      'padding'
    ]);

    console.log('[BOARD SAVE DEBUG] Serialized object count:', serialized.objects?.length);

    const json = JSON.stringify(serialized);
    const stack = undoStackRef.current;
    if (stack.length === 0 || stack[stack.length - 1] !== json) {
      stack.push(json);
      if (stack.length > 30) stack.shift();
      redoStackRef.current = [];
      if (onHistoryChange) {
        onHistoryChange(stack.length > 1, false);
      }
      if (!isLoadingFromJSONRef.current && onCanvasChangeRef.current) {
        console.log('[BOARD SAVE DEBUG] Notifying MainCanvasPage (isLoadingFromJSON=false)');
        onCanvasChangeRef.current();
      } else {
        console.log('[BOARD SAVE DEBUG] onCanvasChange suppressed — isLoadingFromJSON:', isLoadingFromJSONRef.current, '| hasCallback:', !!onCanvasChangeRef.current);
      }
    } else {
      console.log('[BOARD SAVE DEBUG] State unchanged — skipping notification');
    }
  };

  const getViewportCenterPoint = (canvas) => {
    if (!canvas) return { x: 200, y: 200 };
    const vpt = canvas.viewportTransform;
    if (!vpt) return { x: 200, y: 200 };

    const invVpt = fabric.util.invertTransform(vpt);
    const centerViewportPoint = new fabric.Point(canvas.width / 2, canvas.height / 2);
    const centerCanvasPoint = fabric.util.transformPoint(centerViewportPoint, invVpt);

    return {
      x: centerCanvasPoint.x,
      y: centerCanvasPoint.y
    };
  };

  const getNextViewportPosition = (canvas) => {
    const center = getViewportCenterPoint(canvas);
    const offset = (newObjectOffsetRef.current % 5) * 16;
    newObjectOffsetRef.current += 1;
    return {
      x: center.x + offset,
      y: center.y + offset
    };
  };

  const createLinkedElement = (shape, textObj, left, top, angle = 0) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return null;

    const elementId = 'elem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    shape.set({
      left,
      top,
      angle,
      originX: 'center',
      originY: 'center',
      elementId,
      id: 'shape_' + elementId,
      attachedTextId: 'text_' + elementId,
      contrastResolved: false,
      metadata: { elementId, role: 'shape' }
    });

    textObj.set({
      left: shape.isStickyNote || shape.isChecklistNote || shape.isCalloutNote ? left - (shape.width / 2) + 18 : left,
      top: shape.isStickyNote || shape.isChecklistNote || shape.isCalloutNote ? top - (shape.height / 2) + 18 : top,
      angle,
      originX: shape.isStickyNote || shape.isChecklistNote || shape.isCalloutNote ? 'left' : 'center',
      originY: shape.isStickyNote || shape.isChecklistNote || shape.isCalloutNote ? 'top' : 'center',
      elementId,
      id: 'text_' + elementId,
      parentShapeId: 'shape_' + elementId,
      contrastResolved: false,
      metadata: { elementId, role: 'text' }
    });

    canvas.add(shape, textObj);
    if (typeof canvas.bringObjectToFront === 'function') {
      canvas.bringObjectToFront(textObj);
    } else if (typeof canvas.bringToFront === 'function') {
      canvas.bringToFront(textObj);
    }

    canvas.setActiveObject(shape);
    saveState();
    return { shape, textObj, elementId };
  };

  const attachNewTextToShape = (shape) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !shape) return null;

    const isNoteCard = !!(shape.isStickyNote || shape.isChecklistNote || shape.isCalloutNote);
    const padding = 18;

    const text = new fabric.Textbox('Type text...', {
      left: isNoteCard ? shape.left - (shape.width / 2) + padding : shape.left,
      top: isNoteCard ? shape.top - (shape.height / 2) + padding : shape.top,
      width: isNoteCard ? shape.width - (padding * 2) : Math.max(100, (shape.width || 120) * 0.8),
      fontSize: 16,
      fontFamily: 'Nunito Sans',
      fontWeight: '600',
      fill: '#1e293b',
      textAlign: isNoteCard ? 'left' : 'center',
      originX: isNoteCard ? 'left' : 'center',
      originY: isNoteCard ? 'top' : 'center',
      contrastResolved: false
    });

    ensureObjectId(text);

    if (!shape.elementId) {
      shape.elementId = 'elem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      shape.id = 'shape_' + shape.elementId;
    }

    text.elementId = shape.elementId;
    text.id = 'text_' + shape.elementId;
    text.parentShapeId = shape.id;
    shape.attachedTextId = text.id;

    canvas.add(text);
    if (typeof canvas.bringObjectToFront === 'function') {
      canvas.bringObjectToFront(text);
    }

    saveState();
    return text;
  };

  const addSticky = (pos = null, initialText = 'New Sticky Note', customColor = null) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const { x, y } = pos || getNextViewportPosition(canvas);
    const randomAngle = (Math.random() * 4 - 2).toFixed(1);
    const paperColor = customColor || activeColor || '#fff3a0';

    const stickyShape = new fabric.Rect({
      width: 180,
      height: 180,
      fill: createRuledPaperFill(paperColor),
      noteColor: paperColor,
      rx: 10,
      ry: 10,
      stroke: 'rgba(0,0,0,0.12)',
      strokeWidth: 1,
      shadow: new fabric.Shadow({
        color: 'rgba(0, 0, 0, 0.12)',
        blur: 14,
        offsetX: 3,
        offsetY: 6
      }),
      isStickyNote: true,
      contrastResolved: false
    });

    const text = new fabric.Textbox(initialText, {
      width: 144,
      fontSize: 16,
      fontFamily: 'Nunito Sans',
      fontWeight: 'bold',
      fill: '#1e293b',
      textAlign: 'left',
      contrastResolved: false
    });

    const result = createLinkedElement(stickyShape, text, x, y, Number(randomAngle));

    if (result && result.shape && !isReducedMotion()) {
      const animState = { scale: 0.9, opacity: 0 };
      result.shape.set({ scaleX: 0.9, scaleY: 0.9, opacity: 0 });
      result.textObj.set({ scaleX: 0.9, scaleY: 0.9, opacity: 0 });
      canvas.requestRenderAll();

      anime({
        targets: animState,
        scale: 1,
        opacity: 1,
        duration: 350,
        easing: 'easeOutBack',
        update: () => {
          result.shape.set({ scaleX: animState.scale, scaleY: animState.scale, opacity: animState.opacity });
          result.textObj.set({ scaleX: animState.scale, scaleY: animState.scale, opacity: animState.opacity });
          canvas.requestRenderAll();
        }
      });
    }

    if (onToolComplete) onToolComplete();
  };

  const addChecklist = (pos = null) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const { x, y } = pos || getNextViewportPosition(canvas);

    const initialItems = [
      { id: 'c_' + Date.now() + '_1', checked: false, text: '' }
    ];

    logChecklistMutation({
      functionName: 'addChecklist',
      lineNo: 345,
      reason: 'Initialization of new Checklist Note',
      prevItems: [],
      nextItems: initialItems
    });

    const checklistShape = new fabric.Rect({
      width: 230,
      height: 180,
      fill: '#ffffff',
      rx: 12,
      ry: 12,
      stroke: '#cbd5e1',
      strokeWidth: 2,
      shadow: new fabric.Shadow({
        color: 'rgba(0, 0, 0, 0.08)',
        blur: 16,
        offsetX: 2,
        offsetY: 4
      }),
      isChecklistNote: true,
      checklistItems: initialItems,
      contrastResolved: false
    });

    const text = new fabric.Textbox(formatChecklistItems(initialItems), {
      width: 194,
      fontSize: 15,
      fontFamily: 'Nunito Sans',
      fontWeight: '600',
      fill: '#1e293b',
      textAlign: 'left',
      lineHeight: 1.35,
      contrastResolved: false
    });

    createLinkedElement(checklistShape, text, x, y);
    if (onToolComplete) onToolComplete();
  };

  const addCallout = (pos = null, initialText = '💡 Important: Verify database schema before deployment.') => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const { x, y } = pos || getNextViewportPosition(canvas);

    const bubblePath = 'M 10 0 L 170 0 C 180 0, 180 0, 180 10 L 180 80 C 180 90, 180 90, 170 90 L 50 90 L 25 115 L 35 90 L 10 90 C 0 90, 0 90, 0 80 L 0 10 C 0 0, 0 0, 10 0 Z';

    const calloutShape = new fabric.Path(bubblePath, {
      width: 180,
      height: 115,
      fill: '#fef3c7',
      stroke: '#f59e0b',
      strokeWidth: 2,
      strokeLineJoin: 'round',
      shadow: new fabric.Shadow({
        color: 'rgba(245, 158, 11, 0.25)',
        blur: 14,
        offsetX: 2,
        offsetY: 4
      }),
      isCalloutNote: true,
      contrastResolved: false
    });

    const text = new fabric.Textbox(initialText, {
      width: 144,
      fontSize: 14,
      fontFamily: 'Quicksand',
      fontWeight: 'bold',
      fill: '#92400e',
      textAlign: 'left',
      contrastResolved: false
    });

    createLinkedElement(calloutShape, text, x, y);
    if (onToolComplete) onToolComplete();
  };

  const addRect = (pos = null) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const { x, y } = pos || getNextViewportPosition(canvas);

    const shape = new fabric.Rect({
      width: 160,
      height: 110,
      fill: activeColor,
      rx: 8,
      ry: 8,
      stroke: '#000000',
      strokeWidth: 2,
      contrastResolved: false
    });

    const text = new fabric.Textbox('Rectangle', {
      width: 140,
      fontSize: 16,
      fontFamily: 'Quicksand',
      fontWeight: 'bold',
      fill: '#ffffff',
      textAlign: 'center',
      contrastResolved: false
    });

    createLinkedElement(shape, text, x, y);
    if (onToolComplete) onToolComplete();
  };

  const addRoundedRect = (pos = null) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const { x, y } = pos || getNextViewportPosition(canvas);

    const shape = new fabric.Rect({
      width: 160,
      height: 110,
      fill: activeColor,
      rx: 24,
      ry: 24,
      stroke: '#000000',
      strokeWidth: 2,
      contrastResolved: false
    });

    const text = new fabric.Textbox('Rounded Rect', {
      width: 140,
      fontSize: 16,
      fontFamily: 'Quicksand',
      fontWeight: 'bold',
      fill: '#ffffff',
      textAlign: 'center',
      contrastResolved: false
    });

    createLinkedElement(shape, text, x, y);
    if (onToolComplete) onToolComplete();
  };

  const addCircle = (pos = null) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const { x, y } = pos || getNextViewportPosition(canvas);

    const shape = new fabric.Circle({
      radius: 60,
      fill: '#79f3ea',
      stroke: '#000000',
      strokeWidth: 2,
      contrastResolved: false
    });

    const text = new fabric.Textbox('Circle', {
      width: 100,
      fontSize: 16,
      fontFamily: 'Quicksand',
      fontWeight: 'bold',
      fill: '#006f69',
      textAlign: 'center',
      contrastResolved: false
    });

    createLinkedElement(shape, text, x, y);
    if (onToolComplete) onToolComplete();
  };

  const addTriangle = (pos = null) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const { x, y } = pos || getNextViewportPosition(canvas);

    const shape = new fabric.Triangle({
      width: 140,
      height: 120,
      fill: '#ffd600',
      stroke: '#000000',
      strokeWidth: 2,
      contrastResolved: false
    });

    const text = new fabric.Textbox('Triangle', {
      width: 90,
      fontSize: 15,
      fontFamily: 'Quicksand',
      fontWeight: 'bold',
      fill: '#3b2f2f',
      textAlign: 'center',
      contrastResolved: false
    });

    createLinkedElement(shape, text, x, y);
    if (onToolComplete) onToolComplete();
  };

  const addDiamond = (pos = null) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const { x, y } = pos || getNextViewportPosition(canvas);

    const points = [
      { x: 70, y: 0 },
      { x: 140, y: 70 },
      { x: 70, y: 140 },
      { x: 0, y: 70 }
    ];

    const shape = new fabric.Polygon(points, {
      fill: '#e0f2fe',
      stroke: '#000000',
      strokeWidth: 2,
      contrastResolved: false
    });

    const text = new fabric.Textbox('Decision', {
      width: 100,
      fontSize: 15,
      fontFamily: 'Quicksand',
      fontWeight: 'bold',
      fill: '#0369a1',
      textAlign: 'center',
      contrastResolved: false
    });

    createLinkedElement(shape, text, x, y);
    if (onToolComplete) onToolComplete();
  };

  const addHexagon = (pos = null) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const { x, y } = pos || getNextViewportPosition(canvas);

    const points = [
      { x: 40, y: 0 },
      { x: 120, y: 0 },
      { x: 160, y: 70 },
      { x: 120, y: 140 },
      { x: 40, y: 140 },
      { x: 0, y: 70 }
    ];

    const shape = new fabric.Polygon(points, {
      fill: '#f3e8ff',
      stroke: '#000000',
      strokeWidth: 2,
      contrastResolved: false
    });

    const text = new fabric.Textbox('Process', {
      width: 110,
      fontSize: 15,
      fontFamily: 'Quicksand',
      fontWeight: 'bold',
      fill: '#6b21a8',
      textAlign: 'center',
      contrastResolved: false
    });

    createLinkedElement(shape, text, x, y);
    if (onToolComplete) onToolComplete();
  };

  const addLine = (pos = null) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const { x, y } = pos || getNextViewportPosition(canvas);

    const skribeLineModel = new SkribeLine({
      start: { x: x - 70, y },
      end: { x: x + 70, y },
      stroke: activeColorRef.current || '#000000',
      strokeWidth: 2,
      mode: 'straight'
    });

    const pathObj = createSkribeLineFabricObject(skribeLineModel);
    ensureObjectId(pathObj);
    canvas.add(pathObj);
    canvas.setActiveObject(pathObj);
    canvas.requestRenderAll();
    saveState();
    if (onToolComplete) onToolComplete();
  };

  const addConnector = (typeOrOptions = 'straight', options = {}) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    let connectorType = typeof typeOrOptions === 'string' ? typeOrOptions : typeOrOptions.connectorType || 'straight';
    const styleOptions = typeof typeOrOptions === 'object' ? typeOrOptions : options;
    if (styleOptions.connectorType) connectorType = styleOptions.connectorType;

    const activeObjects = canvas.getActiveObjects();
    let x1, y1, x2, y2;
    let sourceShapeId = null;
    let targetShapeId = null;

    if (activeObjects && activeObjects.length >= 2) {
      const s1 = activeObjects[0];
      const s2 = activeObjects[1];

      const p2Center = s2.getCenterPoint ? s2.getCenterPoint() : { x: s2.left, y: s2.top };
      const p1Center = s1.getCenterPoint ? s1.getCenterPoint() : { x: s1.left, y: s1.top };

      const a1 = getNearestShapeAnchor(s1, p2Center);
      const a2 = getNearestShapeAnchor(s2, p1Center);

      x1 = a1.x;
      y1 = a1.y;
      x2 = a2.x;
      y2 = a2.y;
      sourceShapeId = s1.id;
      targetShapeId = s2.id;
    } else if (activeObjects && activeObjects.length === 1) {
      const s1 = activeObjects[0];
      const p1Center = s1.getCenterPoint ? s1.getCenterPoint() : { x: s1.left, y: s1.top };
      const a1 = getNearestShapeAnchor(s1, { x: p1Center.x + 200, y: p1Center.y });

      x1 = a1.x;
      y1 = a1.y;
      x2 = a1.x + 140;
      y2 = a1.y;
      sourceShapeId = s1.id;
    } else {
      const center = getViewportCenterPoint(canvas);
      x1 = center.x - 70;
      y1 = center.y;
      x2 = center.x + 70;
      y2 = center.y;
    }

    const strokeDashArray = styleOptions.strokeDashArray || (connectorType === 'dashed' ? [6, 6] : connectorType === 'dotted' ? [2, 4] : null);
    const startArrow = styleOptions.startArrow || connectorType === 'bidirectional';
    const baseType = ['elbow', 'curved'].includes(connectorType) ? connectorType : 'straight';

    const connectorObj = createConnectorObject({
      x1,
      y1,
      x2,
      y2,
      connectorType: baseType,
      stroke: '#000000',
      strokeWidth: 3,
      strokeDashArray,
      startArrow,
      endArrow: true,
      sourceShapeId,
      targetShapeId
    });

    ensureObjectId(connectorObj);
    canvas.add(connectorObj);
    canvas.setActiveObject(connectorObj);
    canvas.requestRenderAll();
    saveState();
    if (onToolComplete) onToolComplete();
  };

  const addText = (pos = null) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const { x, y } = pos || getNextViewportPosition(canvas);

    const text = new fabric.Textbox('Click to edit text', {
      left: x,
      top: y,
      width: 200,
      fontSize: 22,
      fontFamily: 'Quicksand',
      fontWeight: 'bold',
      fill: activeColor || '#000000',
      contrastResolved: false
    });

    ensureObjectId(text);
    canvas.add(text);
    canvas.setActiveObject(text);
    saveState();
    if (onToolComplete) onToolComplete();
  };

  const generateAIStickyCluster = (ideas = []) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const center = getViewportCenterPoint(canvas);
    const presets = ['#fff3a0', '#dcfce7', '#e0f2fe', '#f3e8ff', '#ffe4e6'];

    ideas.forEach((text, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const pos = {
        x: center.x + (col - 1) * 210,
        y: center.y + (row - 0.5) * 210
      };
      const color = presets[i % presets.length];
      addSticky(pos, text, color);
    });
  };

  const undo = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || undoStackRef.current.length <= 1) return;
    isHistoryProcessingRef.current = true;

    const current = undoStackRef.current.pop();
    redoStackRef.current.push(current);

    const prevJson = undoStackRef.current[undoStackRef.current.length - 1];
    Promise.resolve(canvas.loadFromJSON(JSON.parse(prevJson))).then(() => {
      canvas.requestRenderAll();
      isHistoryProcessingRef.current = false;
      if (onHistoryChange) {
        onHistoryChange(undoStackRef.current.length > 1, true);
      }
    }).catch((err) => {
      console.error('[FabricCanvas] undo load error:', err);
      isHistoryProcessingRef.current = false;
    });
  };

  const redo = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || redoStackRef.current.length === 0) return;
    isHistoryProcessingRef.current = true;

    const nextJson = redoStackRef.current.pop();
    undoStackRef.current.push(nextJson);

    Promise.resolve(canvas.loadFromJSON(JSON.parse(nextJson))).then(() => {
      canvas.requestRenderAll();
      isHistoryProcessingRef.current = false;
      if (onHistoryChange) {
        onHistoryChange(undoStackRef.current.length > 1, redoStackRef.current.length > 0);
      }
    }).catch((err) => {
      console.error('[FabricCanvas] redo load error:', err);
      isHistoryProcessingRef.current = false;
    });
  };

  const applyProperty = (prop, val) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const activeObj = canvas.getActiveObject();
    if (!activeObj) return;

    if (prop === 'fill') activeObj.set({ fill: val });
    if (prop === 'stroke') activeObj.set({ stroke: val });
    if (prop === 'strokeWidth') activeObj.set({ strokeWidth: Number(val) });
    if (prop === 'opacity') activeObj.set({ opacity: Number(val) });
    if (prop === 'fontSize') activeObj.set({ fontSize: Number(val) });
    if (prop === 'fontFamily') activeObj.set({ fontFamily: val });

    canvas.requestRenderAll();
    saveState();
  };

  const duplicateSelected = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const activeObj = canvas.getActiveObject();
    if (!activeObj) return;

    activeObj.clone().then((cloned) => {
      ensureObjectId(cloned);
      cloned.set({
        left: cloned.left + 20,
        top: cloned.top + 20
      });
      canvas.add(cloned);
      canvas.setActiveObject(cloned);
      canvas.requestRenderAll();
      saveState();
    });
  };

  const deleteSelected = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const activeObj = canvas.getActiveObject();
    if (!activeObj) return;

    if (activeObj.type === 'activeSelection') {
      activeObj.forEachObject((obj) => canvas.remove(obj));
      canvas.discardActiveObject();
    } else {
      canvas.remove(activeObj);
    }
    canvas.requestRenderAll();
    saveState();
  };

  const bringToFront = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const activeObj = canvas.getActiveObject();
    if (!activeObj) return;
    if (typeof canvas.bringObjectToFront === 'function') {
      canvas.bringObjectToFront(activeObj);
    } else if (typeof canvas.bringToFront === 'function') {
      canvas.bringToFront(activeObj);
    }
    canvas.requestRenderAll();
    saveState();
  };

  const sendToBack = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const activeObj = canvas.getActiveObject();
    if (!activeObj) return;
    if (typeof canvas.sendObjectToBack === 'function') {
      canvas.sendObjectToBack(activeObj);
    } else if (typeof canvas.sendToBack === 'function') {
      canvas.sendToBack(activeObj);
    }
    canvas.requestRenderAll();
    saveState();
  };

  const deleteSelectedObjects = (mode = 'auto') => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const activeObj = canvas.getActiveObject();
    const activeObjects = canvas.getActiveObjects();

    if ((!activeObjects || activeObjects.length === 0) && !activeObj) return;

    if (mode === 'textOnly') {
      let textTarget = activeObj;
      if (activeObj && activeObj.attachedTextId) {
        textTarget = canvas.getObjects().find((o) => o.id === activeObj.attachedTextId);
      }
      if (textTarget && (textTarget.type === 'textbox' || textTarget.type === 'i-text' || textTarget.type === 'text')) {
        const parentShape = canvas.getObjects().find((o) => o.attachedTextId === textTarget.id);
        if (parentShape) parentShape.attachedTextId = null;
        canvas.remove(textTarget);
      }
    } else if (mode === 'shapeOnly') {
      let shapeTarget = activeObj;
      if (activeObj && activeObj.parentShapeId) {
        shapeTarget = canvas.getObjects().find((o) => o.id === activeObj.parentShapeId);
      }
      if (shapeTarget) {
        const attachedText = canvas.getObjects().find((o) => o.parentShapeId === shapeTarget.id);
        if (attachedText) attachedText.parentShapeId = null;
        canvas.remove(shapeTarget);
      }
    } else if (mode === 'entireElement') {
      const elementId = activeObj?.elementId;
      if (elementId) {
        const linkedObjects = canvas.getObjects().filter((o) => o.elementId === elementId);
        canvas.discardActiveObject();
        linkedObjects.forEach((o) => canvas.remove(o));
      } else if (activeObj) {
        canvas.remove(activeObj);
      }
    } else {
      const objectsToDelete = new Set();

      if (activeObjects && activeObjects.length > 0) {
        activeObjects.forEach((obj) => {
          if (!obj.locked && !obj.protected && !obj.system) {
            objectsToDelete.add(obj);
          }
        });
      }

      if (activeObj) {
        if (!activeObj.locked && !activeObj.protected && !activeObj.system) {
          objectsToDelete.add(activeObj);
        }
      }

      if (objectsToDelete.size === 0) return;

      canvas.discardActiveObject();
      objectsToDelete.forEach((obj) => {
        if (obj.attachedTextId) {
          const text = canvas.getObjects().find((o) => o.id === obj.attachedTextId);
          if (text) text.parentShapeId = null;
        }
        if (obj.parentShapeId) {
          const shape = canvas.getObjects().find((o) => o.id === obj.parentShapeId);
          if (shape) shape.attachedTextId = null;
        }
        canvas.remove(obj);
      });
    }

    canvas.requestRenderAll();
    updateSelectionState();
    saveState();
  };

  const duplicateSelectedObjects = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const activeObj = canvas.getActiveObject();
    if (!activeObj || activeObj.locked || activeObj.protected || activeObj.system) return;

    const elementId = activeObj.elementId;
    if (elementId) {
      const shapeObj = canvas.getObjects().find((o) => o.elementId === elementId && o.attachedTextId);
      const textObj = canvas.getObjects().find((o) => o.elementId === elementId && o.parentShapeId);

      if (shapeObj && textObj) {
        Promise.all([shapeObj.clone(), textObj.clone()]).then(([clonedShape, clonedText]) => {
          canvas.discardActiveObject();

          const newElementId = 'elem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
          const offsetX = 20;
          const offsetY = 20;

          clonedShape.set({
            left: shapeObj.left + offsetX,
            top: shapeObj.top + offsetY,
            elementId: newElementId,
            id: 'shape_' + newElementId,
            attachedTextId: 'text_' + newElementId,
            contrastResolved: shapeObj.contrastResolved || false,
            evented: true,
            selectable: true
          });

          if (shapeObj.isStickyNote) {
            clonedShape.set('fill', createRuledPaperFill(shapeObj.noteColor || '#fff3a0'));
          }

          clonedText.set({
            left: textObj.left + offsetX,
            top: textObj.top + offsetY,
            elementId: newElementId,
            id: 'text_' + newElementId,
            parentShapeId: 'shape_' + newElementId,
            contrastResolved: textObj.contrastResolved || false,
            evented: true,
            selectable: true
          });

          canvas.add(clonedShape, clonedText);
          if (typeof canvas.bringObjectToFront === 'function') {
            canvas.bringObjectToFront(clonedText);
          }

          canvas.setActiveObject(clonedShape);
          canvas.requestRenderAll();
          updateSelectionState();
          saveState();
        });
        return;
      }
    }

    if (activeObj.skribeLine) {
      canvas.discardActiveObject();
      const clonedModel = activeObj.skribeLine.clone();
      clonedModel.start.x += 20;
      clonedModel.start.y += 20;
      clonedModel.end.x += 20;
      clonedModel.end.y += 20;
      if (clonedModel.controlPoints && clonedModel.controlPoints.length > 0) {
        clonedModel.controlPoints[0].x += 20;
        clonedModel.controlPoints[0].y += 20;
      }
      const clonedObj = createSkribeLineFabricObject(clonedModel);
      ensureObjectId(clonedObj);
      canvas.add(clonedObj);
      canvas.setActiveObject(clonedObj);
      canvas.requestRenderAll();
      updateSelectionState();
      saveState();
      return;
    }

    activeObj.clone().then((cloned) => {
      canvas.discardActiveObject();
      ensureObjectId(cloned);
      cloned.set({
        left: activeObj.left + 20,
        top: activeObj.top + 20,
        evented: true,
        selectable: true
      });
      canvas.add(cloned);
      canvas.setActiveObject(cloned);
      canvas.requestRenderAll();
      updateSelectionState();
      saveState();
    });
  };

  const applyZoom = (targetZoom, point = null, animate = true) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const clampedZoom = Math.min(Math.max(targetZoom, 0.2), 5.0);
    const centerPoint = point || new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2);

    if (zoomAnimationRef.current) {
      zoomAnimationRef.current.pause();
    }

    if (animate && !isReducedMotion()) {
      const currentZoom = { value: canvas.getZoom() };
      zoomAnimationRef.current = anime({
        targets: currentZoom,
        value: clampedZoom,
        duration: 200,
        easing: 'easeOutQuad',
        update: () => {
          canvas.zoomToPoint(centerPoint, currentZoom.value);
          canvas.requestRenderAll();
          if (onZoomChange) {
            onZoomChange(Math.round(currentZoom.value * 100));
          }
        }
      });
    } else {
      canvas.zoomToPoint(centerPoint, clampedZoom);
      canvas.requestRenderAll();
      if (onZoomChange) {
        onZoomChange(Math.round(clampedZoom * 100));
      }
    }
  };

  const updateSelectionState = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const activeObj = canvas.getActiveObject();
    if (!activeObj) {
      if (isHistoryProcessingRef.current) return;
      if (onSelectionChange) onSelectionChange(null);
      return;
    }

    ensureObjectId(activeObj);

    let targetShape = activeObj.parentShapeId
      ? canvas.getObjects().find((o) => o.id === activeObj.parentShapeId)
      : activeObj;

    if (!targetShape) targetShape = activeObj;

    let textChild = null;
    if (activeObj.attachedTextId) {
      textChild = canvas.getObjects().find((o) => o.id === activeObj.attachedTextId);
    }

    const contrastResolved = !!(targetShape.contrastResolved || (textChild && textChild.contrastResolved));

    let props = {
      hasSelection: true,
      id: targetShape.id,
      elementId: targetShape.elementId,
      type: targetShape.type,
      fill: targetShape.noteColor || targetShape.fill || '#fff3a0',
      noteColor: targetShape.noteColor,
      stroke: targetShape.skribeLine ? targetShape.skribeLine.stroke : (targetShape.stroke || targetShape.vectorStrokeData?.color || '#000000'),
      strokeWidth: targetShape.skribeLine ? targetShape.skribeLine.strokeWidth : (targetShape.strokeWidth !== undefined ? targetShape.strokeWidth : (targetShape.vectorStrokeData?.width || 3)),
      opacity: targetShape.skribeLine ? targetShape.skribeLine.opacity : (targetShape.opacity !== undefined ? targetShape.opacity : (targetShape.vectorStrokeData?.opacity || 1)),
      strokeDashArray: targetShape.strokeDashArray
        ? (Array.isArray(targetShape.strokeDashArray) && targetShape.strokeDashArray[0] === 2 ? 'dotted' : 'dashed')
        : (targetShape.vectorStrokeData?.style === 'dotted' ? 'dotted' : targetShape.vectorStrokeData?.style === 'dashed' ? 'dashed' : 'solid'),
      angle: Math.round((targetShape.angle || 0) % 360 + 360) % 360,
      hasText: false,
      isStickyNote: !!(targetShape.isStickyNote || activeObj.isStickyNote),
      isChecklistNote: !!(targetShape.isChecklistNote || activeObj.isChecklistNote),
      isCalloutNote: !!(targetShape.isCalloutNote || activeObj.isCalloutNote),
      isLinkedElement: !!targetShape.elementId,
      isConnector: !!targetShape.isConnector,
      isVectorStroke: !!(targetShape.isVectorStroke || activeObj.isVectorStroke),
      isStraightLine: !!(targetShape.isSkribeLine || targetShape.isStraightLine || targetShape.type === 'line' || targetShape.isCurved || activeObj.isStraightLine),
      connectorType: targetShape.connectorType || 'straight',
      contrastResolved
    };

    if (textChild) {
      props.hasText = true;
      props.textColor = textChild.fill || '#1e293b';
      props.fontSize = textChild.fontSize || 16;
      props.fontFamily = textChild.fontFamily || 'Nunito Sans';
      props.fontWeight = textChild.fontWeight || 'bold';
      props.textAlign = textChild.textAlign || 'left';
    } else if (activeObj.type === 'textbox' || activeObj.type === 'i-text' || activeObj.type === 'text') {
      props.hasText = true;
      props.textColor = activeObj.fill || '#1e293b';
      props.fontSize = activeObj.fontSize || 16;
      props.fontFamily = activeObj.fontFamily || 'Nunito Sans';
      props.fontWeight = activeObj.fontWeight || 'bold';
      props.textAlign = activeObj.textAlign || 'left';
    }

    const isTextTarget = !!(activeObj.parentShapeId || activeObj.isEditing || activeObj.type === 'textbox' || activeObj.type === 'i-text');
    props.editingContext = isTextTarget ? 'text' : 'background';

    if (onSelectionChange) onSelectionChange(props);
  };

  const editTextInPlace = () => {
    const canvas = fabricCanvasRef.current;
    const activeObj = canvas?.getActiveObject();
    if (!activeObj) return;

    let textObj = activeObj;
    if (activeObj.attachedTextId) {
      textObj = canvas.getObjects().find((o) => o.id === activeObj.attachedTextId);
    } else if (activeObj.type !== 'textbox' && activeObj.type !== 'i-text') {
      textObj = attachNewTextToShape(activeObj);
    }

    if (textObj && (textObj.type === 'textbox' || textObj.type === 'i-text')) {
      canvas.setActiveObject(textObj);
      if (typeof textObj.enterEditing === 'function') {
        textObj.enterEditing();
      } else {
        const currentText = textObj.text || '';
        const updatedText = window.prompt('Edit text:', currentText);
        if (updatedText !== null) {
          textObj.set('text', updatedText);
          canvas.requestRenderAll();
          saveState();
          updateSelectionState();
        }
      }
    }
  };

  useImperativeHandle(ref, () => ({

    getCanvas: () => fabricCanvasRef.current,

    loadFromJSON: (canvasData, callback) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || !canvasData) {
        if (callback) callback();
        return;
      }
      try {
        isLoadingFromJSONRef.current = true;
        const jsonPayload = typeof canvasData === 'string' ? JSON.parse(canvasData) : canvasData;
        if (!jsonPayload || !Array.isArray(jsonPayload.objects)) {
          isLoadingFromJSONRef.current = false;
          if (callback) callback();
          return;
        }
        Promise.resolve(canvas.loadFromJSON(jsonPayload)).then(() => {
          canvas.getObjects().forEach((o) => {
            ensureObjectId(o);
            if (o.skribeLine) {
              syncSkribeLineToFabric(o);
            }
          });
          canvas.requestRenderAll();
          saveState();
          isLoadingFromJSONRef.current = false;
          if (callback) callback();
        }).catch((err) => {
          console.error('[FabricCanvas] loadFromJSON promise error:', err);
          isLoadingFromJSONRef.current = false;
          if (callback) callback();
        });
      } catch (err) {
        isLoadingFromJSONRef.current = false;
        console.error('[FabricCanvas] loadFromJSON error:', err);
        if (callback) callback();
      }
    },

    toJSON: () => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return { version: '6.5.1', objects: [] };
      return canvas.toJSON([
        'id',
        'elementId',
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
        'angle',
        'padding'
      ]);
    },

    deleteSelected: (mode = 'auto') => {
      deleteSelectedObjects(mode);
    },

    deleteTextOnly: () => {
      deleteSelectedObjects('textOnly');
    },

    deleteShapeOnly: () => {
      deleteSelectedObjects('shapeOnly');
    },

    deleteEntire: () => {
      deleteSelectedObjects('entireElement');
    },

    editText: () => {
      editTextInPlace();
    },

    duplicateSelected: () => {
      duplicateSelectedObjects();
    },

    addShape: (type, options = {}) => {
      if (type === 'sticky' || options.id === 'sticky_yellow' || options.id === 'sticky_pink' || options.id === 'sticky_blue' || options.id === 'sticky_green') {
        addSticky(null, 'New Sticky Note', options.colorDot);
      } else if (type === 'checklist' || options.id === 'sticky_checklist') {
        addChecklist();
      } else if (type === 'callout' || options.id === 'sticky_callout') {
        addCallout();
      } else if (type === 'rect') addRect();
      else if (type === 'rounded_rect') addRoundedRect();
      else if (type === 'circle') addCircle();
      else if (type === 'triangle') addTriangle();
      else if (type === 'diamond') addDiamond();
      else if (type === 'hexagon') addHexagon();
      else if (type === 'line') addLine();
      else if (type === 'arrow' || type === 'connector') addConnector(options.connectorType || 'straight', options);
      else if (type === 'text') addText();
    },

    triggerAIAction: (actionId) => {
      if (actionId === 'brainstorm') {
        generateAIStickyCluster(['Identify key user personas', 'Map onboarding user journey', 'Benchmark competitor flows']);
      } else if (actionId === 'architecture') {
        generateAIStickyCluster(['React Frontend Layer', 'REST/GraphQL API Gateway', 'PostgreSQL Data Store']);
      } else if (actionId === 'summarize') {
        generateAIStickyCluster(['Summary: 3 Core user features identified', 'Action: Finalize API endpoints']);
      } else if (actionId === 'sticky_gen') {
        generateAIStickyCluster(['Feature A: Drag-and-drop', 'Feature B: Realtime Cursor Sync', 'Feature C: Export to PDF']);
      } else if (actionId === 'analyze_diagram') {
        generateAIStickyCluster(['Insight: Highly modular component flow', 'Recommendation: Add caching layer']);
      } else if (actionId === 'generate_flow') {
        generateAIStickyCluster(['Step 1: User Login', 'Step 2: Dashboard View', 'Step 3: Canvas Interaction']);
      }
    },

    zoomIn: () => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      applyZoom(canvas.getZoom() + 0.15, null, true);
    },

    zoomOut: () => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      applyZoom(canvas.getZoom() - 0.15, null, true);
    },

    zoomReset: () => {
      applyZoom(1.0, null, true);
    },

    setZoomPercent: (percent) => {
      applyZoom(percent / 100, null, true);
    },

    applyProperty: (propName, value) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const activeObjects = canvas.getActiveObjects();
      if (!activeObjects || activeObjects.length === 0) return;

      activeObjects.forEach((obj) => {
        let shapeObj = obj.parentShapeId
          ? canvas.getObjects().find((o) => o.id === obj.parentShapeId)
          : obj;

        let textObj = obj.attachedTextId
          ? canvas.getObjects().find((o) => o.id === obj.attachedTextId)
          : obj.type === 'textbox' || obj.type === 'i-text'
          ? obj
          : null;

        if (!shapeObj) shapeObj = obj;

        if (propName === 'autoFixContrast' && textObj) {
          textObj.set('fill', value);
          shapeObj.contrastResolved = true;
          textObj.contrastResolved = true;
        }

        if (propName === 'fill' && shapeObj && shapeObj.type !== 'textbox') {
          shapeObj.contrastResolved = false;
          if (textObj) textObj.contrastResolved = false;

          if (shapeObj.isStickyNote) {
            shapeObj.noteColor = value;
            shapeObj.set('fill', createRuledPaperFill(value));
          } else {
            shapeObj.set('fill', value);
          }
        }

        if (propName === 'textColor' && textObj) {
          shapeObj.contrastResolved = false;
          textObj.contrastResolved = false;
          textObj.set('fill', value);
        }

        if (propName === 'stroke' && shapeObj) {
          shapeObj.set('stroke', value);
          if (shapeObj.skribeLine) {
            shapeObj.skribeLine.stroke = value;
            syncSkribeLineToFabric(shapeObj);
          }
          if (shapeObj.isVectorStroke && shapeObj.vectorStrokeData) {
            shapeObj.vectorStrokeData.color = value;
          }
        }

        if (propName === 'strokeWidth' && shapeObj) {
          if (shapeObj.skribeLine || shapeObj.isSkribeLine || shapeObj.isStraightLine || shapeObj.type === 'line') {
            shapeObj.set({
              strokeWidth: value,
              scaleX: 1,
              scaleY: 1,
              strokeUniform: true
            });
            if (shapeObj.skribeLine) {
              shapeObj.skribeLine.strokeWidth = value;
              syncSkribeLineToFabric(shapeObj);
            }
          } else {
            shapeObj.set('strokeWidth', value);
          }
          if (shapeObj.isVectorStroke && shapeObj.vectorStrokeData) {
            shapeObj.vectorStrokeData.width = value;
          }
        }

        if (propName === 'opacity') {
          shapeObj.set('opacity', value);
          if (shapeObj.skribeLine) {
            shapeObj.skribeLine.opacity = value;
            syncSkribeLineToFabric(shapeObj);
          }
          if (textObj) textObj.set('opacity', value);
          if (shapeObj.isVectorStroke && shapeObj.vectorStrokeData) {
            shapeObj.vectorStrokeData.opacity = value;
          }
        }

        if (propName === 'angle' && shapeObj) {
          shapeObj.set('angle', value);
          if (textObj) {
            textObj.set('angle', value);
          }
          syncLinkedPosition({ target: shapeObj });
        }

        if (textObj) {
          if (propName === 'fontSize') textObj.set('fontSize', value);
          if (propName === 'fontFamily') textObj.set('fontFamily', value);
          if (propName === 'fontWeight') textObj.set('fontWeight', value);
          if (propName === 'textAlign') textObj.set('textAlign', value);
        }

        if (propName === 'strokeDashArray' && shapeObj) {
          const dashArr = value === 'dashed' ? [6, 6] : value === 'dotted' ? [2, 4] : null;
          shapeObj.set('strokeDashArray', dashArr);
          if (shapeObj.skribeLine) {
            shapeObj.skribeLine.strokeDashArray = dashArr;
            syncSkribeLineToFabric(shapeObj);
          }
          if (shapeObj.isVectorStroke && shapeObj.vectorStrokeData) {
            shapeObj.vectorStrokeData.style = value === 'dashed' ? 'dashed' : value === 'dotted' ? 'dotted' : 'solid';
          }
        }
      });

      canvas.requestRenderAll();
      updateSelectionState();
      saveState();
    },

    bringToFront: () => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      const activeObjects = canvas.getActiveObjects();
      if (!activeObjects || activeObjects.length === 0) return;

      activeObjects.forEach((obj) => {
        if (typeof canvas.bringObjectToFront === 'function') {
          canvas.bringObjectToFront(obj);
        } else if (typeof canvas.bringToFront === 'function') {
          canvas.bringToFront(obj);
        }
        if (obj.attachedTextId) {
          const text = canvas.getObjects().find((o) => o.id === obj.attachedTextId);
          if (text) {
            if (typeof canvas.bringObjectToFront === 'function') canvas.bringObjectToFront(text);
            else if (typeof canvas.bringToFront === 'function') canvas.bringToFront(text);
          }
        }
      });

      canvas.requestRenderAll();
      saveState();
    },

    sendToBack: () => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      const activeObjects = canvas.getActiveObjects();
      if (!activeObjects || activeObjects.length === 0) return;

      activeObjects.forEach((obj) => {
        if (typeof canvas.sendObjectToBack === 'function') {
          canvas.sendObjectToBack(obj);
        } else if (typeof canvas.sendToBack === 'function') {
          canvas.sendToBack(obj);
        }
      });

      canvas.requestRenderAll();
      saveState();
    },

    undo: () => {
      const canvas = fabricCanvasRef.current;
      const undoStack = undoStackRef.current;
      const redoStack = redoStackRef.current;
      if (!canvas || undoStack.length <= 1) return;

      const activeObj = canvas.getActiveObject();
      const selectedObjectId = activeObj?.id || activeObj?.elementId;

      isHistoryProcessingRef.current = true;
      const currentState = undoStack.pop();
      redoStack.push(currentState);

      const previousState = undoStack[undoStack.length - 1];
      canvas.loadFromJSON(JSON.parse(previousState)).then(() => {
        const allObjects = canvas.getObjects();

        allObjects.forEach((o) => {
          if (o.isStickyNote) {
            const paperColor = o.noteColor || (typeof o.fill === 'string' ? o.fill : '#fff3a0');
            o.noteColor = paperColor;
            o.set('fill', createRuledPaperFill(paperColor));
          }
          if (o.isSkribeLine || o.skribeLine || o.isStraightLine || o.type === 'line') {
            if (o.skribeLine && !(o.skribeLine instanceof SkribeLine)) {
              o.skribeLine = new SkribeLine(o.skribeLine);
            } else if (!o.skribeLine) {
              const x1 = o.x1 !== undefined ? o.x1 : (o.left || 100);
              const y1 = o.y1 !== undefined ? o.y1 : (o.top || 100);
              const x2 = o.x2 !== undefined ? o.x2 : x1 + 140;
              const y2 = o.y2 !== undefined ? o.y2 : y1;
              o.skribeLine = new SkribeLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, stroke: o.stroke, strokeWidth: o.strokeWidth });
            }
            attachSkribeLineControls(o);
            syncSkribeLineToFabric(o);
          }
        });

        let restoredObj = null;
        if (selectedObjectId) {
          restoredObj = allObjects.find(
            (o) => (o.id && o.id === selectedObjectId) || (o.elementId && o.elementId === selectedObjectId)
          );
        }

        if (restoredObj) {
          canvas.setActiveObject(restoredObj);
        } else {
          canvas.discardActiveObject();
        }

        canvas.requestRenderAll();
        isHistoryProcessingRef.current = false;
        if (onHistoryChange) onHistoryChange(undoStack.length > 1, true);
        updateSelectionState();
      });
    },

    redo: () => {
      const canvas = fabricCanvasRef.current;
      const undoStack = undoStackRef.current;
      const redoStack = redoStackRef.current;
      if (!canvas || redoStack.length === 0) return;

      const activeObj = canvas.getActiveObject();
      const selectedObjectId = activeObj?.id || activeObj?.elementId;

      isHistoryProcessingRef.current = true;
      const nextState = redoStack.pop();
      undoStack.push(nextState);

      canvas.loadFromJSON(JSON.parse(nextState)).then(() => {
        const allObjects = canvas.getObjects();

        allObjects.forEach((o) => {
          if (o.isStickyNote) {
            const paperColor = o.noteColor || (typeof o.fill === 'string' ? o.fill : '#fff3a0');
            o.noteColor = paperColor;
            o.set('fill', createRuledPaperFill(paperColor));
          }
          if (o.isSkribeLine || o.skribeLine || o.isStraightLine || o.type === 'line') {
            if (o.skribeLine && !(o.skribeLine instanceof SkribeLine)) {
              o.skribeLine = new SkribeLine(o.skribeLine);
            } else if (!o.skribeLine) {
              const x1 = o.x1 !== undefined ? o.x1 : (o.left || 100);
              const y1 = o.y1 !== undefined ? o.y1 : (o.top || 100);
              const x2 = o.x2 !== undefined ? o.x2 : x1 + 140;
              const y2 = o.y2 !== undefined ? o.y2 : y1;
              o.skribeLine = new SkribeLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, stroke: o.stroke, strokeWidth: o.strokeWidth });
            }
            attachSkribeLineControls(o);
            syncSkribeLineToFabric(o);
          }
        });

        let restoredObj = null;
        if (selectedObjectId) {
          restoredObj = allObjects.find(
            (o) => (o.id && o.id === selectedObjectId) || (o.elementId && o.elementId === selectedObjectId)
          );
        }

        if (restoredObj) {
          canvas.setActiveObject(restoredObj);
        } else {
          canvas.discardActiveObject();
        }

        canvas.requestRenderAll();
        isHistoryProcessingRef.current = false;
        if (onHistoryChange) onHistoryChange(true, redoStack.length > 0);
        updateSelectionState();
      });
    }
  }));

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    if (fabricCanvasRef.current) {
      fabricCanvasRef.current.dispose();
      fabricCanvasRef.current = null;
    }

    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width,
      height,
      backgroundColor: 'transparent',
      selection: true,
      preserveObjectStacking: true
    });

    fabricCanvasRef.current = canvas;

    saveState();

    const handleObjectScaling = (opt) => {
      const target = opt.target;
      if (!target) return;

      if (target.skribeLine || target.isSkribeLine || target.isStraightLine || target.type === 'line' || target.isCurved) {
        target.set({
          scaleX: 1,
          scaleY: 1
        });
        syncSkribeLineToFabric(target);
      }

      syncLinkedPosition(opt);
    };

    const handleSelectionHighlight = () => {
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;
      canvas.requestRenderAll();
      auditRenderPipeline(canvas, activeObj);
      if (!isHistoryProcessingRef.current) updateSelectionState();
    };

    const handleObjectRotating = (opt) => {
      const target = opt.target;
      if (!target || !canvas) return;

      const evt = opt.e;
      const isShiftPressed = evt && (evt.shiftKey || evt.metaKey);

      if (isShiftPressed) {
        target.snapAngle = 0;
      } else {
        target.snapAngle = 15;
        target.snapThreshold = 6;
      }

      syncLinkedPosition(opt);

      const center = target.getCenterPoint ? target.getCenterPoint() : { x: target.left, y: target.top };
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const screenPoint = fabric.util.transformPoint(center, vpt);

      let currentAngle = Math.round((target.angle || 0) % 360);
      if (currentAngle < 0) currentAngle += 360;

      const cardHeight = target.height ? (target.height * (target.scaleY || 1) * (vpt[0] || 1)) / 2 + 45 : 50;

      setRotationBadge({
        x: screenPoint.x,
        y: screenPoint.y - cardHeight,
        angle: currentAngle
      });

      updateSelectionState();
    };

    const handleChecklistClick = (opt) => {
      const target = opt.target;
      if (!target) return;

      const shapeObj = target.isChecklistNote
        ? target
        : canvas.getObjects().find((o) => o.attachedTextId === target.id && o.isChecklistNote);

      if (!shapeObj || !shapeObj.isChecklistNote) return;

      const textObj = canvas.getObjects().find((o) => o.id === shapeObj.attachedTextId);
      if (!textObj) return;

      const items = shapeObj.checklistItems || [
        { id: 'c_' + Date.now(), checked: false, text: '' }
      ];

      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const invVpt = fabric.util.invertTransform(vpt);
      const clickPoint = new fabric.Point(opt.e.offsetX || 0, opt.e.offsetY || 0);
      const scenePoint = fabric.util.transformPoint(clickPoint, invVpt);

      const isCheckboxColumn = (scenePoint.x >= textObj.left - 10) && (scenePoint.x <= textObj.left + 35);

      if (!isCheckboxColumn) {
        return;
      }

      const relativeY = scenePoint.y - textObj.top;
      const lineHeight = (textObj.fontSize || 15) * (textObj.lineHeight || 1.35);
      const clickedRowIndex = Math.max(0, Math.min(items.length - 1, Math.floor(relativeY / lineHeight)));

      if (items[clickedRowIndex]) {
        const prevItems = JSON.parse(JSON.stringify(items));
        items[clickedRowIndex].checked = !items[clickedRowIndex].checked;
        shapeObj.checklistItems = [...items];

        logChecklistMutation({
          functionName: 'handleChecklistClick',
          lineNo: 1495,
          reason: `Checkbox toggle on row index ${clickedRowIndex}`,
          prevItems,
          nextItems: shapeObj.checklistItems
        });

        const formatted = formatChecklistItems(shapeObj.checklistItems);
        textObj.set('text', formatted);

        canvas.requestRenderAll();
        saveState();
        updateSelectionState();
      }
    };

    const handleDoubleClick = (opt) => {
      const target = opt.target;
      if (!target) return;

      let textObj = null;

      if (target.attachedTextId) {
        textObj = canvas.getObjects().find((o) => o.id === target.attachedTextId);
      } else if (target.type === 'textbox' || target.type === 'i-text') {
        textObj = target;
      } else if (['rect', 'circle', 'polygon', 'path', 'ellipse'].includes(target.type)) {
        textObj = attachNewTextToShape(target);
      }

      if (textObj) {
        canvas.setActiveObject(textObj);
        if (typeof textObj.enterEditing === 'function') {
          textObj.enterEditing();
        } else {
          const currentText = textObj.text || '';
          const updatedText = window.prompt('Edit text:', currentText);
          if (updatedText !== null) {
            textObj.set('text', updatedText);
            canvas.requestRenderAll();
            saveState();
            updateSelectionState();
          }
        }
      }
    };

    const handleKeyDown = (e) => {
      const activeObj = canvas.getActiveObject();
      const isEditingText = activeObj && activeObj.isEditing;

      if (isEditingText && activeObj.parentShapeId) {
        const parentShape = canvas.getObjects().find((o) => o.id === activeObj.parentShapeId && o.isChecklistNote);

        if (parentShape && parentShape.isChecklistNote) {
          const textBeforeCursor = (activeObj.text || '').slice(0, activeObj.selectionStart || 0);
          const currentRowIndex = (textBeforeCursor.match(/\n/g) || []).length;
          const rawLines = (activeObj.text || '').split('\n');
          let items = [...(parentShape.checklistItems || [])];

          items = items.map((item, idx) => {
            if (idx < rawLines.length) {
              const cleanText = rawLines[idx].replace(/^[☐☑]\s?/, '');
              return { ...item, text: cleanText };
            }
            return item;
          });

          if (e.key === 'Enter') {
            if (!e.shiftKey) {
              e.preventDefault();
              const prevItems = JSON.parse(JSON.stringify(parentShape.checklistItems || []));

              const newItem = {
                id: 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                checked: false,
                text: ''
              };

              items.splice(currentRowIndex + 1, 0, newItem);
              parentShape.checklistItems = items;

              logChecklistMutation({
                functionName: 'handleKeyDown (Enter)',
                lineNo: 1585,
                reason: `Enter key pressed at row ${currentRowIndex}: spliced new item at ${currentRowIndex + 1}`,
                prevItems,
                nextItems: parentShape.checklistItems
              });

              const formatted = formatChecklistItems(parentShape.checklistItems);
              activeObj.set('text', formatted);

              const linesUpToNewRow = parentShape.checklistItems.slice(0, currentRowIndex + 1);
              const newCursorPos = formatChecklistItems(linesUpToNewRow).length + 3;
              if (typeof activeObj.setSelectionStartEnd === 'function') {
                activeObj.setSelectionStartEnd(newCursorPos, newCursorPos);
              } else {
                activeObj.selectionStart = newCursorPos;
                activeObj.selectionEnd = newCursorPos;
              }

              canvas.requestRenderAll();
              saveState();
              return;
            }
          }

          if (e.key === 'Backspace') {
            if (items.length > 1 && items[currentRowIndex] && (!items[currentRowIndex].text || items[currentRowIndex].text.trim() === '')) {
              e.preventDefault();
              const prevItems = JSON.parse(JSON.stringify(parentShape.checklistItems || []));

              items.splice(currentRowIndex, 1);
              parentShape.checklistItems = items;

              logChecklistMutation({
                functionName: 'handleKeyDown (Backspace)',
                lineNo: 1615,
                reason: `Backspace key pressed on empty row ${currentRowIndex}: spliced out row`,
                prevItems,
                nextItems: parentShape.checklistItems
              });

              const formatted = formatChecklistItems(parentShape.checklistItems);
              activeObj.set('text', formatted);

              const prevRowIndex = Math.max(0, currentRowIndex - 1);
              const linesUpToPrevRow = parentShape.checklistItems.slice(0, prevRowIndex);
              const newCursorPos = linesUpToPrevRow.length > 0 ? formatChecklistItems(linesUpToPrevRow).length + 3 : 2;
              if (typeof activeObj.setSelectionStartEnd === 'function') {
                activeObj.setSelectionStartEnd(newCursorPos, newCursorPos);
              } else {
                activeObj.selectionStart = newCursorPos;
                activeObj.selectionEnd = newCursorPos;
              }

              canvas.requestRenderAll();
              saveState();
              return;
            }
          }
        }
      }

      if (e.key === 'Escape') {
        if (activeToolRef.current !== 'select') {
          e.preventDefault();
          if (onToolComplete) onToolComplete();
        }
        return;
      }

      const activeEl = document.activeElement;
      const isInputEditing =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable);

      if (isInputEditing || isEditingText) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedObjects();
        return;
      }
    };

    const handleObjectChange = (opt) => {
      const target = opt.target;
      if (target && target.isTemporaryDrawPath) return;

      if (target && target.parentShapeId) {
        const parentShape = canvas.getObjects().find((o) => o.id === target.parentShapeId && o.isChecklistNote);
        if (parentShape && parentShape.isChecklistNote) {
          const rawLines = (target.text || '').split('\n');
          let items = parentShape.checklistItems || [];
          const prevItems = JSON.parse(JSON.stringify(items));

          items = items.map((item, idx) => {
            if (idx < rawLines.length) {
              const cleanText = rawLines[idx].replace(/^[☐☑]\s?/, '');
              return { ...item, text: cleanText };
            }
            return item;
          });

          if (rawLines.length > items.length) {
            for (let i = items.length; i < rawLines.length; i++) {
              const cleanText = rawLines[i].replace(/^[☐☑]\s?/, '');
              items.push({
                id: 'c_' + Date.now() + '_' + i,
                checked: false,
                text: cleanText
              });
            }
          }

          parentShape.checklistItems = items;

          logChecklistMutation({
            functionName: 'handleObjectChange (Typing)',
            lineNo: 1670,
            reason: 'Typing input changed text content',
            prevItems,
            nextItems: parentShape.checklistItems
          });
        }
      }
      updateSelectionState();
      saveState();
    };

    const handleWheel = (opt) => {
      const e = opt.e;
      if (
        window.__skribePopoverHovered ||
        (e && e.target && typeof e.target.closest === 'function' && e.target.closest('#skribe-color-picker-portal, [data-scrollable-popover]'))
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (e.ctrlKey || e.metaKey) {

        let zoom = canvas.getZoom();
        zoom *= 0.999 ** e.deltaY;
        const mousePoint = new fabric.Point(e.offsetX, e.offsetY);
        applyZoom(zoom, mousePoint, false);
      } else {

        const vpt = canvas.viewportTransform;
        vpt[4] -= e.deltaX;
        vpt[5] -= e.deltaY;
        canvas.requestRenderAll();
      }
    };

    const handleMouseDown = (opt) => {
      const evt = opt.e;
      const tool = activeToolRef.current;
      const isPanTrigger = tool === 'pan' || isSpacePanRef.current || evt.button === 1 || evt.altKey;

      if (isPanTrigger) {
        isPanningRef.current = true;
        setIsPanning(true);
        lastPosRef.current = { x: evt.clientX, y: evt.clientY };
        updatePanCursorAndSelection();
        return;
      }

      if (tool === 'eraser') {
        isErasingDragRef.current = true;
        eraserManager.startBatchErase();
        const result = eraserManager.evaluateHover(canvas, opt);
        if (result.hasTarget && !result.isLocked && result.target) {
          eraserManager.eraseTargetInBatch(
            canvas,
            result.target,
            () => {
              if (onSelectionChange) onSelectionChange(null);
            },
            { x: opt.e.clientX, y: opt.e.clientY }
          );
        }
        return;
      }

      if (tool === 'draw') {
        isDrawingStrokeRef.current = true;
        const vpt = canvas.viewportTransform;
        const invVpt = fabric.util.invertTransform(vpt);
        const clickPoint = new fabric.Point(opt.e.offsetX, opt.e.offsetY);
        const scenePoint = fabric.util.transformPoint(clickPoint, invVpt);

        strokePointsRef.current = [scenePoint];

        const pConfig = penConfigRef.current || { color: '#000000', width: 4, opacity: 1.0 };
        const drawColor = pConfig.color || '#000000';
        const strokeWidth = pConfig.width || 4;
        const strokeOpacity = pConfig.opacity ?? 1.0;

        console.log(`[Pen] Using Color: ${drawColor} | Using Width: ${strokeWidth} | Using Opacity: ${strokeOpacity}`);

        const initialPathStr = `M ${scenePoint.x} ${scenePoint.y} L ${scenePoint.x + 0.1} ${scenePoint.y + 0.1}`;

        const tempPath = new fabric.Path(initialPathStr, {
          stroke: drawColor,
          strokeWidth: strokeWidth,
          opacity: strokeOpacity,
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          fill: '',
          selectable: false,
          evented: false,
          objectCaching: false
        });

        tempPath.isTemporaryDrawPath = true;
        canvas.add(tempPath);
        activeDrawPathRef.current = tempPath;
        canvas.requestRenderAll();
        return;
      }

      if (tool === 'line') {
        isDrawingLineRef.current = true;
        const vpt = canvas.viewportTransform;
        const invVpt = fabric.util.invertTransform(vpt);
        const clickPoint = new fabric.Point(opt.e.offsetX, opt.e.offsetY);
        const scenePoint = fabric.util.transformPoint(clickPoint, invVpt);

        lineStartPointRef.current = scenePoint;

        const lineStrokeColor = penConfigRef.current?.color || activeColor || '#000000';
        const lineStrokeWidth = penConfigRef.current?.width || 2;

        const line = new fabric.Line([scenePoint.x, scenePoint.y, scenePoint.x + 0.1, scenePoint.y + 0.1], {
          stroke: lineStrokeColor,
          strokeWidth: lineStrokeWidth,
          strokeUniform: true,
          padding: 10,
          selectable: false,
          evented: false,
          isStraightLine: true
        });

        canvas.add(line);
        activeLineRef.current = line;
        canvas.requestRenderAll();
        return;
      }

      if (opt.target) {
        const isChecklist = opt.target.isChecklistNote || (opt.target.parentShapeId && canvas.getObjects().find((o) => o.id === opt.target.parentShapeId && o.isChecklistNote));
        if (isChecklist) {
          handleChecklistClick(opt);
        }
      }

      if (!opt.target && ['rect', 'circle', 'sticky', 'checklist', 'callout', 'text'].includes(tool)) {
        const vpt = canvas.viewportTransform;
        const invVpt = fabric.util.invertTransform(vpt);
        const clickPoint = new fabric.Point(opt.e.offsetX, opt.e.offsetY);
        const scenePoint = fabric.util.transformPoint(clickPoint, invVpt);

        if (tool === 'rect') addRect(scenePoint);
        if (tool === 'circle') addCircle(scenePoint);
        if (tool === 'sticky') addSticky(scenePoint);
        if (tool === 'checklist') addChecklist(scenePoint);
        if (tool === 'callout') addCallout(scenePoint);
        if (tool === 'text') addText(scenePoint);
      }
    };

    const handleMouseMove = (opt) => {
      if (isPanningRef.current) {
        const e = opt.e;
        const vpt = canvas.viewportTransform;
        vpt[4] += e.clientX - lastPosRef.current.x;
        vpt[5] += e.clientY - lastPosRef.current.y;
        canvas.requestRenderAll();
        lastPosRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      if (activeToolRef.current === 'eraser') {
        const result = eraserManager.evaluateHover(canvas, opt);
        const eraserCursor = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='%23ef4444' stroke='%23ffffff' stroke-width='1.5'><path d='M16.24 3.56l4.95 4.95a2 2 0 0 1 0 2.83L11.8 20.73a2 2 0 0 1-2.83 0l-4.95-4.95a2 2 0 0 1 0-2.83L13.41 3.56a2 2 0 0 1 2.83 0z'/><path d='M18 13l-4 4'/></svg>\") 4 20, pointer";
        if (result.isLocked) {
          canvas.setCursor('not-allowed');
        } else {
          canvas.setCursor(eraserCursor);
          if (isErasingDragRef.current && result.hasTarget && result.target) {
            eraserManager.eraseTargetInBatch(
              canvas,
              result.target,
              () => {
                if (onSelectionChange) onSelectionChange(null);
              },
              { x: opt.e.clientX, y: opt.e.clientY }
            );
          }
        }
        return;
      } else {
        eraserManager.clearHoverPreview(canvas);
      }

      if (isDrawingLineRef.current && activeLineRef.current) {
        const vpt = canvas.viewportTransform;
        const invVpt = fabric.util.invertTransform(vpt);
        const movePoint = new fabric.Point(opt.e.offsetX, opt.e.offsetY);
        let scenePoint = fabric.util.transformPoint(movePoint, invVpt);

        const x1 = lineStartPointRef.current.x;
        const y1 = lineStartPointRef.current.y;
        let x2 = scenePoint.x;
        let y2 = scenePoint.y;

        if (opt.e.shiftKey) {
          const dx = x2 - x1;
          const dy = y2 - y1;
          const dist = Math.hypot(dx, dy);
          let angle = Math.atan2(dy, dx);
          const snapIncrement = (15 * Math.PI) / 180;
          angle = Math.round(angle / snapIncrement) * snapIncrement;
          x2 = x1 + dist * Math.cos(angle);
          y2 = y1 + dist * Math.sin(angle);
        }

        activeLineRef.current.set({ x2, y2 });
        activeLineRef.current.setCoords();
        canvas.requestRenderAll();
        return;
      }

      if (isDrawingStrokeRef.current && activeDrawPathRef.current) {
        const vpt = canvas.viewportTransform;
        const invVpt = fabric.util.invertTransform(vpt);
        const movePoint = new fabric.Point(opt.e.offsetX, opt.e.offsetY);
        const scenePoint = fabric.util.transformPoint(movePoint, invVpt);

        strokePointsRef.current.push(scenePoint);

        if (Array.isArray(activeDrawPathRef.current.path)) {
          activeDrawPathRef.current.path.push(['L', scenePoint.x, scenePoint.y]);
        }

        if (!animFrameRequestedRef.current) {
          animFrameRequestedRef.current = true;
          requestAnimationFrame(() => {
            animFrameRequestedRef.current = false;
            if (fabricCanvasRef.current) {
              fabricCanvasRef.current.requestRenderAll();
            }
          });
        }
      }
    };

    const handleMouseUp = () => {
      setRotationBadge(null);

      if (isErasingDragRef.current) {
        isErasingDragRef.current = false;
        eraserManager.commitBatchErase(canvas, saveState);

        if (canvas.getObjects().length === 0 && activeToolRef.current === 'eraser') {
          console.log('[ToolLifecycle] Canvas is empty - auto-reverting to Select tool');
          eraserManager.clearHoverPreview(canvas);
          if (onToolComplete) onToolComplete();
        }
      }

      if (isPanningRef.current) {
        isPanningRef.current = false;
        setIsPanning(false);
        updatePanCursorAndSelection();
        return;
      }

      if (isDrawingLineRef.current && activeLineRef.current) {
        isDrawingLineRef.current = false;
        const lineObj = activeLineRef.current;
        activeLineRef.current = null;

        const x1 = lineStartPointRef.current.x;
        const y1 = lineStartPointRef.current.y;
        let x2 = lineObj.x2 !== undefined ? lineObj.x2 : x1 + 140;
        let y2 = lineObj.y2 !== undefined ? lineObj.y2 : y1;
        const dist = Math.hypot(x2 - x1, y2 - y1);

        if (dist < 5) {
          x2 = x1 + 140;
          y2 = y1;
        }

        canvas.remove(lineObj);

        const skribeLineModel = new SkribeLine({
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          stroke: penConfigRef.current?.color || activeColor || '#000000',
          strokeWidth: penConfigRef.current?.width || 2,
          mode: 'straight'
        });

        const pathObj = createSkribeLineFabricObject(skribeLineModel);
        ensureObjectId(pathObj);
        pathObj.set({
          selectable: true,
          evented: true
        });

        canvas.add(pathObj);
        canvas.setActiveObject(pathObj);
        canvas.requestRenderAll();
        saveState();
        if (onToolComplete) onToolComplete();
        return;
      }

      if (isDrawingStrokeRef.current && activeDrawPathRef.current) {
        isDrawingStrokeRef.current = false;
        canvas.remove(activeDrawPathRef.current);
        activeDrawPathRef.current = null;

        if (strokePointsRef.current && strokePointsRef.current.length > 0) {
          const pConfig = penConfigRef.current || { color: '#000000', width: 4, opacity: 1.0 };
          const drawColor = pConfig.color || '#000000';
          const strokeWidth = pConfig.width || 4;
          const strokeOpacity = pConfig.opacity ?? 1.0;

          console.log(`[Pen Finalize] Saving stroke with Color: ${drawColor} | Width: ${strokeWidth} | Opacity: ${strokeOpacity}`);

          const vectorData = createVectorStrokeData({
            points: strokePointsRef.current,
            color: drawColor,
            width: strokeWidth,
            opacity: strokeOpacity,
            style: 'solid'
          });

          const finalStrokeObj = renderVectorStroke(vectorData);
          if (finalStrokeObj) {
            canvas.add(finalStrokeObj);
            canvas.setActiveObject(finalStrokeObj);
            canvas.requestRenderAll();
            saveState();
          }
        }
        strokePointsRef.current = [];
      }
    };

    canvas.on('object:moving', handleObjectMoving);
    canvas.on('object:scaling', handleObjectScaling);
    canvas.on('object:rotating', handleObjectRotating);
    canvas.on('mouse:dblclick', handleDoubleClick);
    canvas.on('mouse:wheel', handleWheel);
    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('object:added', handleObjectChange);
    canvas.on('object:modified', (opt) => {
      setRotationBadge(null);
      handleObjectScaling(opt);
      handleObjectChange(opt);
    });
    canvas.on('selection:created', handleSelectionHighlight);
    canvas.on('selection:updated', handleSelectionHighlight);
    canvas.on('selection:cleared', () => {
      setRotationBadge(null);
      canvas.requestRenderAll();
      if (!isHistoryProcessingRef.current && onSelectionChange) onSelectionChange(null);
    });

    window.addEventListener('keydown', handleKeyDown);

    const handleResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      canvas.setDimensions({ width: w, height: h });
      canvas.renderAll();
    };

    window.addEventListener('resize', handleResize);

    const handleContextMenu = (e) => {
      e.preventDefault();
      if (onContextMenu) {
        onContextMenu({ x: e.clientX, y: e.clientY });
      }
    };

    const canvasEl = container;
    if (canvasEl) {
      canvasEl.addEventListener('contextmenu', handleContextMenu);
    }

    return () => {
      if (canvasEl) {
        canvasEl.removeEventListener('contextmenu', handleContextMenu);
      }
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, []);

  useEffect(() => {
    updatePanCursorAndSelection();
  }, [activeTool, activeColor]);

  useEffect(() => {
    if (activeTool === 'rect') addRect();
    if (activeTool === 'circle') addCircle();
    if (activeTool === 'sticky') addSticky();
    if (activeTool === 'checklist') addChecklist();
    if (activeTool === 'callout') addCallout();
    if (activeTool === 'text') addText();
    if (activeTool === 'line') addLine();
  }, [activeTool]);

  return (
    <div ref={containerRef} className={`w-full h-full relative overflow-hidden ${className}`}>
      <canvas ref={canvasRef} />

      {rotationBadge && (
        <div
          style={{
            left: `${rotationBadge.x}px`,
            top: `${rotationBadge.y}px`
          }}
          className="absolute z-50 -translate-x-1/2 -translate-y-full bg-slate-900/90 text-white text-xs font-mono font-bold px-2 py-0.5 rounded-md shadow-lg border border-slate-700 pointer-events-none select-none"
        >
          {rotationBadge.angle}°
        </div>
      )}
    </div>
  );
});

export default FabricCanvas;
