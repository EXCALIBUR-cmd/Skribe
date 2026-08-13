import * as fabric from 'fabric';

export class EraserManager {
  constructor() {
    this.activeHoverTarget = null;
    this.originalStyles = new Map();

    this.isBatching = false;
    this.batchedObjects = new Set();

    this.audioEnabled = false;
    this.onEraseCallback = null;
  }

  setEraseCallback(cb) {
    this.onEraseCallback = cb;
  }

  playEraseSound(type = 'wipe') {
    if (!this.audioEnabled) return;
  }

  startBatchErase() {
    this.isBatching = true;
    this.batchedObjects = new Set();
    console.log('[HierarchicalEraser] Batch erase transaction started');
  }

  isObjectHit(obj, pt, pointer) {
    if (!obj || obj.isTemporaryDrawPath || obj.system) return false;

    if (typeof obj.containsPoint === 'function' && obj.containsPoint(pt)) {
      return true;
    }

    if (typeof obj.getBoundingRect === 'function') {
      const rect = obj.getBoundingRect(true);
      const isPathOrStroke = obj.type === 'path' || obj.isVectorStroke || obj.isSkribeLine || obj.isStraightLine;
      const strokeW = obj.strokeWidth || 4;

      const hitMargin = isPathOrStroke
        ? Math.max(strokeW / 2 + 12, 14)
        : Math.max(strokeW / 2 + 8, 10);

      const inExpandedRect =
        pointer.x >= rect.left - hitMargin &&
        pointer.x <= rect.left + rect.width + hitMargin &&
        pointer.y >= rect.top - hitMargin &&
        pointer.y <= rect.top + rect.height + hitMargin;

      if (inExpandedRect) {

        if (rect.width < 16 || rect.height < 16) {
          return true;
        }

        if (isPathOrStroke) {
          const points = obj.vectorStrokeData?.points;
          if (Array.isArray(points) && points.length > 0) {
            for (let i = 0; i < points.length; i++) {
              const p = points[i];
              const dist = Math.hypot(pointer.x - p.x, pointer.y - p.y);
              if (dist <= hitMargin) {
                return true;
              }
            }
          }

          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const centerDist = Math.hypot(pointer.x - centerX, pointer.y - centerY);
          if (centerDist <= Math.max(rect.width / 2, rect.height / 2) + hitMargin) {
            return true;
          }
        } else {
          return true;
        }
      }
    }

    return false;
  }

  findTopTarget(canvas, opt) {
    if (!canvas) return null;
    const e = opt ? (opt.e || opt) : null;
    if (!e) return null;

    const pointer = canvas.getPointer ? canvas.getPointer(e) : { x: e.clientX, y: e.clientY };
    const pt = new fabric.Point(pointer.x, pointer.y);
    const objects = canvas.getObjects().slice().reverse();

    for (const obj of objects) {
      if (obj.isTemporaryDrawPath || obj.system) continue;

      const isTextNode = !!(obj.parentShapeId || obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'text');
      if (!isTextNode) continue;

      if (this.isObjectHit(obj, pt, pointer)) {
        console.log(`[HierarchicalEraser] Step 1 Child Hit: ${obj.type} (ID: ${obj.id}, ParentID: ${obj.parentShapeId || 'none'})`);
        return obj;
      }
    }

    for (const obj of objects) {
      if (obj.isTemporaryDrawPath || obj.system) continue;

      if (this.isObjectHit(obj, pt, pointer)) {
        console.log(`[HierarchicalEraser] Step 2 Target Hit: ${obj.type} (ID: ${obj.id})`);
        return obj;
      }
    }

    return null;
  }

  evaluateHover(canvas, opt) {
    if (!canvas) return { isLocked: false, hasTarget: false };

    const e = opt ? (opt.e || opt) : null;
    const clientX = e ? e.clientX : 0;
    const clientY = e ? e.clientY : 0;
    const pointer = canvas.getPointer ? canvas.getPointer(e) : { x: 0, y: 0 };

    const target = this.findTopTarget(canvas, opt);

    console.log(`[HierarchicalEraser] MouseMove | Cursor: (${clientX}, ${clientY}) | Scene: (${pointer.x.toFixed(1)}, ${pointer.y.toFixed(1)}) | Target: ${target ? `${target.type} (ID: ${target.id || 'none'})` : 'NONE'}`);

    if (!target) {
      this.clearHoverPreview(canvas);
      return { isLocked: false, hasTarget: false };
    }

    const isLocked = !!(target.locked || target.protected);

    if (isLocked) {
      this.clearHoverPreview(canvas);
      return { isLocked: true, hasTarget: true, target };
    }

    if (this.activeHoverTarget !== target) {
      this.clearHoverPreview(canvas);
      this.applyHoverPreview(target, canvas);
    }

    return { isLocked: false, hasTarget: true, target };
  }

  applyHoverPreview(target, canvas) {
    if (!target) return;

    this.activeHoverTarget = target;

    this.originalStyles.set(target, {
      stroke: target.stroke,
      strokeWidth: target.strokeWidth,
      strokeDashArray: target.strokeDashArray,
      shadow: target.shadow,
      opacity: target.opacity
    });

    target.set({
      stroke: '#ef4444',
      strokeWidth: Math.max(3, (target.strokeWidth || 1) + 2),
      opacity: 0.85,
      shadow: new fabric.Shadow({
        color: 'rgba(239, 68, 68, 0.6)',
        blur: 12,
        offsetX: 0,
        offsetY: 0
      })
    });

    if (canvas) canvas.requestRenderAll();
  }

  clearHoverPreview(canvas) {
    if (!this.activeHoverTarget) return;

    const target = this.activeHoverTarget;
    const orig = this.originalStyles.get(target);

    if (orig && canvas && canvas.getObjects().includes(target)) {
      target.set({
        stroke: orig.stroke,
        strokeWidth: orig.strokeWidth,
        strokeDashArray: orig.strokeDashArray,
        shadow: orig.shadow,
        opacity: orig.opacity
      });
    }

    this.originalStyles.delete(target);
    this.activeHoverTarget = null;
    if (canvas) canvas.requestRenderAll();
  }

  eraseTargetInBatch(canvas, target, onSelectionClear, screenPos = null) {
    if (!canvas || !target) return false;
    if (target.locked || target.protected) return false;
    if (this.batchedObjects.has(target)) return false;

    const countBefore = canvas.getObjects().length;
    console.log(`[HierarchicalEraser] Deleting Target | ID: ${target.id} | Type: ${target.type} | IsChildText: ${!!target.parentShapeId}`);

    this.clearHoverPreview(canvas);

    const objectsToRemove = new Set([target]);

    if (target.parentShapeId) {
      const parentShape = canvas.getObjects().find((o) => o.id === target.parentShapeId);
      if (parentShape) {
        parentShape.attachedTextId = null;
      }
    } else {

      if (target.attachedTextId) {
        const textObj = canvas.getObjects().find((o) => o.id === target.attachedTextId);
        if (textObj) objectsToRemove.add(textObj);
      }
      if (target.elementId) {
        const linked = canvas.getObjects().filter((o) => o.elementId === target.elementId);
        linked.forEach((o) => objectsToRemove.add(o));
      }
    }

    const activeObj = canvas.getActiveObject();
    if (activeObj) {
      const activeObjects = canvas.getActiveObjects();
      const isActiveTarget = activeObjects.some((o) => objectsToRemove.has(o)) || objectsToRemove.has(activeObj);

      if (isActiveTarget) {
        canvas.discardActiveObject();
        if (onSelectionClear) onSelectionClear();
      }
    }

    objectsToRemove.forEach((obj) => {
      this.batchedObjects.add(obj);
      canvas.remove(obj);
    });

    const remainingConnectors = canvas.getObjects().filter((o) => o.isConnector);
    remainingConnectors.forEach((conn) => {
      const isSourceDeleted = Array.from(objectsToRemove).some((o) => o.id === conn.sourceShapeId);
      const isTargetDeleted = Array.from(objectsToRemove).some((o) => o.id === conn.targetShapeId);

      if (isSourceDeleted || isTargetDeleted) {
        this.batchedObjects.add(conn);
        canvas.remove(conn);
      }
    });

    canvas.requestRenderAll();
    const countAfter = canvas.getObjects().length;
    console.log(`[HierarchicalEraser] Deletion Complete | Count Before: ${countBefore} -> After: ${countAfter}`);

    this.playEraseSound('wipe');
    if (this.onEraseCallback && screenPos) {
      this.onEraseCallback(screenPos);
    }

    return true;
  }

  eraseTarget(canvas, target, onSelectionClear, saveStateCallback, screenPos = null) {
    this.startBatchErase();
    const erased = this.eraseTargetInBatch(canvas, target, onSelectionClear, screenPos);
    if (erased) {
      this.commitBatchErase(canvas, saveStateCallback);
    } else {
      this.isBatching = false;
    }
    return erased;
  }

  commitBatchErase(canvas, saveStateCallback) {
    if (this.isBatching && this.batchedObjects.size > 0) {
      if (canvas) canvas.requestRenderAll();
      if (saveStateCallback) saveStateCallback();
      console.log(`[HierarchicalEraser] Undo Recorded | Batched Objects Deleted: ${this.batchedObjects.size}`);
    }
    this.isBatching = false;
    this.batchedObjects.clear();
  }
}

export const eraserManager = new EraserManager();
export default eraserManager;
