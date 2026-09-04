
import { validateCleanupPlan } from './cleanupPlanTypes.js';
import { getSemanticType, getShapeType } from './cleanupTypes.js';
import { buildVisualObjectModel, resolveContainerOwnership } from './visualUnits.js';
import { translatePathCommands, transformConnectorGeometry, parseConnectorPath } from './connectorGeometry.js';

const cloneDeep = (obj) => {
  if (obj === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return { ...obj };
  }
};

const unionBounds = (boundsList, padding = 40, rawObjects = []) => {
  if (!boundsList || boundsList.length === 0) {
    return { x: 0, y: 0, width: 800, height: 600 };
  }

  const isMeaningful = (b, idx) => {
    if (!b) return false;
    if ((b.width || 0) >= 5 || (b.height || 0) >= 5) return true;
    const raw = rawObjects[idx];
    if (raw && raw.text && String(raw.text).trim().length > 0) return true;
    return false;
  };

  const meaningful = boundsList.filter((b, idx) => isMeaningful(b, idx));
  const activeList = meaningful.length > 0 ? meaningful : boundsList.filter(Boolean);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  activeList.forEach((b) => {
    if (!b) return;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + (b.width || 0));
    maxY = Math.max(maxY, b.y + (b.height || 0));
  });

  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 800, height: 600 };

  const x = minX - padding;
  const y = minY - padding;
  const width = Math.max(100, maxX - minX + padding * 2);
  const height = Math.max(100, maxY - minY + padding * 2);

  return { x, y, width, height };
};

const ACTION_PRIORITY = Object.freeze({
  attachText: 1,
  cleanFlowchart: 2,
  arrangeGrid: 3,
  align: 4,
  equalizeSpacing: 5,
  normalizeText: 6,
  preserve: 7
});

const executeCleanFlowchart = ({
  action,
  placementMap,
  objectMap,
  translationDeltas,
  translatePlacement
}) => {
  const nodeIds = action.objectIds || [];
  const connectorIds = action.connectorIds || [];

  if (nodeIds.length === 0) {
    return { valid: false, failedActionId: action.id, reason: 'Flowchart action must contain at least one node' };
  }

  for (const nId of nodeIds) {
    if (!placementMap.has(nId)) {
      return {
        valid: false,
        failedActionId: action.id,
        reason: `Missing node '${nId}' in workspace model`
      };
    }
  }

  const nodeSet = new Set(nodeIds);
  for (const cId of connectorIds) {
    if (!placementMap.has(cId)) {
      return {
        valid: false,
        failedActionId: action.id,
        reason: `Missing connector '${cId}' in workspace model`
      };
    }
    const cObj = objectMap.get(cId) || placementMap.get(cId);
    const semType = getSemanticType(cObj);
    if (semType !== 'connector') {
      return {
        valid: false,
        failedActionId: action.id,
        reason: `Object '${cId}' is not a connector (type: '${semType}')`
      };
    }

    const meta = cObj.relationshipMetadata || cObj.connectorMetadata || cObj.connector || {};
    const srcId = meta.sourceShapeId || meta.sourceObjectId || cObj.sourceShapeId;
    const tgtId = meta.targetShapeId || meta.targetObjectId || cObj.targetShapeId;

    if (srcId && !nodeSet.has(srcId)) {
      return {
        valid: false,
        failedActionId: action.id,
        errorType: 'externalEndpointDependency',
        reason: `External endpoint dependency detected: connector '${cId}' source '${srcId}' is outside flowchart nodes`
      };
    }
    if (tgtId && !nodeSet.has(tgtId)) {
      return {
        valid: false,
        failedActionId: action.id,
        errorType: 'externalEndpointDependency',
        reason: `External endpoint dependency detected: connector '${cId}' target '${tgtId}' is outside flowchart nodes`
      };
    }
  }

  const adj = new Map();
  const inDegree = new Map();
  nodeIds.forEach((id) => {
    adj.set(id, []);
    inDegree.set(id, 0);
  });

  const connectorEndpoints = new Map();
  connectorIds.forEach((cId) => {
    const cObj = objectMap.get(cId) || placementMap.get(cId);
    const meta = cObj.relationshipMetadata || cObj.connectorMetadata || cObj.connector || {};
    let srcId = meta.sourceShapeId || meta.sourceObjectId || cObj.sourceShapeId;
    let tgtId = meta.targetShapeId || meta.targetObjectId || cObj.targetShapeId;

    if ((!srcId || !tgtId) && (cObj.path || cObj.pathCommands)) {
      const parsed = parseConnectorPath(cObj.path || cObj.pathCommands);
      if (parsed) {
        const cLeft = cObj.position?.x ?? cObj.left ?? 0;
        const cTop = cObj.position?.y ?? cObj.top ?? 0;
        const worldStart = { x: parsed.startPt.x + cLeft, y: parsed.startPt.y + cTop };
        const worldEnd = { x: parsed.endPt.x + cLeft, y: parsed.endPt.y + cTop };

        if (!srcId) {
          let bestDist = Infinity;
          nodeIds.forEach((nId) => {
            const p = placementMap.get(nId);
            const center = { x: p.bounds.x + p.bounds.width / 2, y: p.bounds.y + p.bounds.height / 2 };
            const dist = Math.hypot(center.x - worldStart.x, center.y - worldStart.y);
            if (dist < bestDist) {
              bestDist = dist;
              srcId = nId;
            }
          });
        }
        if (!tgtId) {
          let bestDist = Infinity;
          nodeIds.forEach((nId) => {
            const p = placementMap.get(nId);
            const center = { x: p.bounds.x + p.bounds.width / 2, y: p.bounds.y + p.bounds.height / 2 };
            const dist = Math.hypot(center.x - worldEnd.x, center.y - worldEnd.y);
            if (dist < bestDist) {
              bestDist = dist;
              tgtId = nId;
            }
          });
        }
      }
    }

    if (srcId && tgtId && nodeSet.has(srcId) && nodeSet.has(tgtId) && srcId !== tgtId) {
      adj.get(srcId).push(tgtId);
      inDegree.set(tgtId, inDegree.get(tgtId) + 1);
      connectorEndpoints.set(cId, { srcId, tgtId });
    }
  });

  let totalDx = 0;
  let totalDy = 0;
  connectorEndpoints.forEach(({ srcId, tgtId }) => {
    const srcP = placementMap.get(srcId);
    const tgtP = placementMap.get(tgtId);
    totalDx += Math.abs((tgtP.bounds.x + tgtP.bounds.width / 2) - (srcP.bounds.x + srcP.bounds.width / 2));
    totalDy += Math.abs((tgtP.bounds.y + tgtP.bounds.height / 2) - (srcP.bounds.y + srcP.bounds.height / 2));
  });

  let isVertical = false;
  if (connectorEndpoints.size > 0) {
    isVertical = totalDy > totalDx * 1.1;
  } else {
    const minX = Math.min(...nodeIds.map((id) => placementMap.get(id).bounds.x));
    const maxX = Math.max(...nodeIds.map((id) => placementMap.get(id).bounds.x + placementMap.get(id).bounds.width));
    const minY = Math.min(...nodeIds.map((id) => placementMap.get(id).bounds.y));
    const maxY = Math.max(...nodeIds.map((id) => placementMap.get(id).bounds.y + placementMap.get(id).bounds.height));
    isVertical = (maxY - minY) > (maxX - minX) * 1.1;
  }

  const levelMap = new Map();
  const roots = nodeIds.filter((id) => inDegree.get(id) === 0);

  if (roots.length === 0) {
    const sorted = [...nodeIds].sort((a, b) => {
      const pA = placementMap.get(a);
      const pB = placementMap.get(b);
      return isVertical
        ? (pA.bounds.y - pB.bounds.y || pA.bounds.x - pB.bounds.x)
        : (pA.bounds.x - pB.bounds.x || pA.bounds.y - pB.bounds.y);
    });
    roots.push(sorted[0]);
  }

  const queue = roots.map((r) => {
    levelMap.set(r, 0);
    return r;
  });

  const visited = new Set();
  while (queue.length > 0) {
    const u = queue.shift();
    const curLevel = levelMap.get(u);
    const neighbors = adj.get(u) || [];
    neighbors.forEach((v) => {
      const nextLevel = curLevel + 1;
      if (!levelMap.has(v) || levelMap.get(v) < nextLevel) {
        levelMap.set(v, nextLevel);
      }
      if (!visited.has(v)) {
        visited.add(v);
        queue.push(v);
      }
    });
  }

  nodeIds.forEach((id) => {
    if (!levelMap.has(id)) {
      levelMap.set(id, 0);
    }
  });

  const maxLevel = Math.max(...Array.from(levelMap.values()), 0);
  const levels = [];
  for (let l = 0; l <= maxLevel; l++) {
    levels.push([]);
  }
  nodeIds.forEach((id) => {
    const l = levelMap.get(id);
    levels[l].push(id);
  });

  levels.forEach((lvlNodes) => {
    lvlNodes.sort((a, b) => {
      const pA = placementMap.get(a);
      const pB = placementMap.get(b);
      const centA = { x: pA.bounds.x + pA.bounds.width / 2, y: pA.bounds.y + pA.bounds.height / 2 };
      const centB = { x: pB.bounds.x + pB.bounds.width / 2, y: pB.bounds.y + pB.bounds.height / 2 };
      if (!isVertical) {
        if (Math.abs(centA.y - centB.y) > 1) return centA.y - centB.y;
        if (Math.abs(centA.x - centB.x) > 1) return centA.x - centB.x;
        return String(a).localeCompare(String(b));
      } else {
        if (Math.abs(centA.x - centB.x) > 1) return centA.x - centB.x;
        if (Math.abs(centA.y - centB.y) > 1) return centA.y - centB.y;
        return String(a).localeCompare(String(b));
      }
    });
  });

  const LEVEL_GAP = 80;
  const SIBLING_GAP = 40;
  const origMinX = Math.min(...nodeIds.map((id) => placementMap.get(id).bounds.x));
  const origMinY = Math.min(...nodeIds.map((id) => placementMap.get(id).bounds.y));

  if (!isVertical) {
    const colWidths = levels.map((lvlNodes) => Math.max(...lvlNodes.map((id) => placementMap.get(id).bounds.width), 100));
    const colHeights = levels.map((lvlNodes) => {
      const heights = lvlNodes.map((id) => placementMap.get(id).bounds.height);
      return heights.reduce((sum, h) => sum + h, 0) + (lvlNodes.length - 1) * SIBLING_GAP;
    });
    const maxGraphHeight = Math.max(...colHeights, 100);

    let curLevelX = origMinX;
    levels.forEach((lvlNodes, lIdx) => {
      const colW = colWidths[lIdx];
      const colH = colHeights[lIdx];
      let curY = origMinY + (maxGraphHeight - colH) / 2;

      lvlNodes.forEach((id) => {
        const p = placementMap.get(id);
        const targetX = curLevelX + (colW - p.bounds.width) / 2;
        const targetY = curY;
        const dx = targetX - p.bounds.x;
        const dy = targetY - p.bounds.y;
        translatePlacement(id, dx, dy, action.id, 'cleanFlowchart');
        curY += p.bounds.height + SIBLING_GAP;
      });

      curLevelX += colW + LEVEL_GAP;
    });
  } else {
    const rowHeights = levels.map((lvlNodes) => Math.max(...lvlNodes.map((id) => placementMap.get(id).bounds.height), 80));
    const rowWidths = levels.map((lvlNodes) => {
      const widths = lvlNodes.map((id) => placementMap.get(id).bounds.width);
      return widths.reduce((sum, w) => sum + w, 0) + (lvlNodes.length - 1) * SIBLING_GAP;
    });
    const maxGraphWidth = Math.max(...rowWidths, 100);

    let curLevelY = origMinY;
    levels.forEach((lvlNodes, lIdx) => {
      const rowH = rowHeights[lIdx];
      const rowW = rowWidths[lIdx];
      let curX = origMinX + (maxGraphWidth - rowW) / 2;

      lvlNodes.forEach((id) => {
        const p = placementMap.get(id);
        const targetX = curX;
        const targetY = curLevelY + (rowH - p.bounds.height) / 2;
        const dx = targetX - p.bounds.x;
        const dy = targetY - p.bounds.y;
        translatePlacement(id, dx, dy, action.id, 'cleanFlowchart');
        curX += p.bounds.width + SIBLING_GAP;
      });

      curLevelY += rowH + LEVEL_GAP;
    });
  }

  connectorIds.forEach((cId) => {
    const connP = placementMap.get(cId);
    if (!connP) return;

    let endpoints = connectorEndpoints.get(cId);
    if (!endpoints) {
      const meta = connP.relationshipMetadata || {};
      const srcId = meta.sourceShapeId || meta.sourceObjectId;
      const tgtId = meta.targetShapeId || meta.targetObjectId;
      if (srcId && tgtId) endpoints = { srcId, tgtId };
    }

    if (endpoints) {
      const srcP = placementMap.get(endpoints.srcId);
      const tgtP = placementMap.get(endpoints.tgtId);
      if (srcP && tgtP) {
        const srcBounds = srcP.bounds;
        const tgtBounds = tgtP.bounds;
        const srcCenter = { x: srcBounds.x + srcBounds.width / 2, y: srcBounds.y + srcBounds.height / 2 };
        const tgtCenter = { x: tgtBounds.x + tgtBounds.width / 2, y: tgtBounds.y + tgtBounds.height / 2 };

        let newStart, newEnd;
        if (Math.abs(tgtCenter.x - srcCenter.x) >= Math.abs(tgtCenter.y - srcCenter.y)) {
          if (tgtCenter.x >= srcCenter.x) {
            newStart = { x: srcBounds.x + srcBounds.width, y: srcCenter.y };
            newEnd = { x: tgtBounds.x, y: tgtCenter.y };
          } else {
            newStart = { x: srcBounds.x, y: srcCenter.y };
            newEnd = { x: tgtBounds.x + tgtBounds.width, y: tgtCenter.y };
          }
        } else {
          if (tgtCenter.y >= srcCenter.y) {
            newStart = { x: srcCenter.x, y: srcBounds.y + srcBounds.height };
            newEnd = { x: tgtCenter.x, y: tgtBounds.y };
          } else {
            newStart = { x: srcCenter.x, y: srcBounds.y };
            newEnd = { x: tgtCenter.x, y: tgtBounds.y + tgtBounds.height };
          }
        }

        const origObj = objectMap.get(cId) || connP;
        const connType = origObj.connectorType || origObj.metadata?.connectorType || connP.connectorType || 'straight';

        const transformed = transformConnectorGeometry({
          originalObject: origObj,
          connectorType: connType,
          newStart,
          newEnd,
          startArrow: connP.startArrow,
          endArrow: connP.endArrow,
          strokeWidth: connP.strokeWidth || 3
        });

        if (transformed && transformed.pathCommands) {
          const xVals = transformed.pathCommands.flatMap((c) => [c[1], c[3], c[5]].filter(Number.isFinite));
          const yVals = transformed.pathCommands.flatMap((c) => [c[2], c[4], c[6]].filter(Number.isFinite));
          const minX = Math.min(...xVals, newStart.x, newEnd.x);
          const maxX = Math.max(...xVals, newStart.x, newEnd.x);
          const minY = Math.min(...yVals, newStart.y, newEnd.y);
          const maxY = Math.max(...yVals, newStart.y, newEnd.y);

          connP.position = { x: minX, y: minY };
          connP.bounds = {
            x: minX,
            y: minY,
            width: Math.max(2, maxX - minX),
            height: Math.max(2, maxY - minY)
          };
          connP.pathCommands = transformed.pathCommands;
          connP.pathData = transformed.pathStr;
          connP.path = transformed.pathCommands;
        }
      }
    }
  });

  return { valid: true };
};

export const executeCleanupPlan = (cleanupPlan, workspaceModel, options = {}) => {
  const validation = validateCleanupPlan(cleanupPlan, workspaceModel);
  if (!validation.valid) {
    return {
      version: 1,
      valid: false,
      failedActionId: 'pre_validation_failed',
      error: `CleanupPlan validation failed: ${validation.errors.join('; ')}`,
      diagnostics: { errors: validation.errors, warnings: validation.warnings }
    };
  }

  const rawObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const objectMap = new Map(rawObjects.map((o) => [o.id, o]));

  const visualObjects = buildVisualObjectModel(workspaceModel);
  const voMap = new Map(visualObjects.map((vo) => [vo.objectId, vo]));
  const { ownedByOwner, ownerByText } = resolveContainerOwnership(visualObjects, voMap);

  const originalSnapshots = new Map();
  const placementMap = new Map();
  const translationDeltas = new Map();
  const transformationHistory = new Map();

  rawObjects.forEach((raw) => {
    const vo = voMap.get(raw.id);
    const bounds = raw.bounds || (vo ? vo.bounds : {
      x: raw.position?.x ?? raw.left ?? 0,
      y: raw.position?.y ?? raw.top ?? 0,
      width: (raw.size?.width ?? raw.width ?? 0) * (raw.scale?.x ?? raw.scaleX ?? 1),
      height: (raw.size?.height ?? raw.height ?? 0) * (raw.scale?.y ?? raw.scaleY ?? 1)
    });

    const pos = { x: bounds.x, y: bounds.y };
    const size = { width: bounds.width, height: bounds.height };
    const rotation = typeof raw.rotation === 'number' ? raw.rotation : (typeof raw.angle === 'number' ? raw.angle : (vo?.rotation || 0));

    originalSnapshots.set(raw.id, {
      position: { ...pos },
      bounds: { ...bounds },
      size: { ...size },
      rotation
    });

    const placement = {
      objectId: raw.id,
      sourceObjectId: raw.sourceObjectId || raw.id,
      elementId: raw.elementId || null,
      unitId: `unit_${raw.id}`,
      type: raw.type || getSemanticType(raw),
      semanticType: raw.semanticType || getSemanticType(raw),
      shapeType: raw.shapeType || getShapeType(raw),
      position: { x: pos.x, y: pos.y },
      bounds: { ...bounds },
      center: raw.center ? { ...raw.center } : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      originX: raw.originX || 'left',
      originY: raw.originY || 'top',
      size: { ...size },
      rotation,
      scale: { x: raw.scale?.x ?? raw.scaleX ?? 1, y: raw.scale?.y ?? raw.scaleY ?? 1 },
      anchor: 'top-left',
      fill: raw.visual?.fill || raw.fill || null,
      stroke: raw.visual?.stroke || raw.stroke || null,
      strokeWidth: raw.visual?.strokeWidth !== undefined && raw.visual?.strokeWidth !== null ? raw.visual.strokeWidth : (raw.strokeWidth !== undefined ? raw.strokeWidth : null),
      strokeDashArray: raw.visual?.strokeDashArray || raw.strokeDashArray || null,
      strokeLineCap: raw.visual?.strokeLineCap || raw.strokeLineCap || 'butt',
      strokeLineJoin: raw.visual?.strokeLineJoin || raw.strokeLineJoin || 'miter',
      opacity: raw.visual?.opacity !== undefined && raw.visual?.opacity !== null ? raw.visual.opacity : (raw.opacity !== undefined ? raw.opacity : 1),
      visible: raw.visual?.visible !== undefined ? raw.visual.visible : (raw.visible !== undefined ? raw.visible : true),
      shadow: raw.visual?.shadow || raw.shadow || null,
      backgroundColor: raw.visual?.backgroundColor || raw.backgroundColor || null,
      style: raw.style ? cloneDeep(raw.style) : null,
      visual: raw.visual ? cloneDeep(raw.visual) : null,
      startArrow: raw.startArrow ?? raw.connector?.startArrow ?? false,
      endArrow: raw.endArrow ?? raw.connector?.endArrow ?? (raw.type === 'connector'),
      connectorType: raw.connectorType || raw.metadata?.connectorType || raw.connector?.connectorType || raw.connectorMetadata?.connectorType || (vo ? vo.connectorMetadata?.connectorType : null),
      path: raw.path ? cloneDeep(raw.path) : null,
      worldPath: raw.worldPath ? cloneDeep(raw.worldPath) : (raw.path ? cloneDeep(raw.path) : null),
      worldPathCommands: raw.worldPathCommands ? cloneDeep(raw.worldPathCommands) : (raw.pathCommands ? cloneDeep(raw.pathCommands) : (Array.isArray(raw.path) ? cloneDeep(raw.path) : null)),
      pathData: raw.pathData || raw.connector?.pathData || null,
      pathCommands: raw.pathCommands || raw.connector?.pathCommands || (Array.isArray(raw.path) ? cloneDeep(raw.path) : null),
      points: raw.points ? cloneDeep(raw.points) : null,
      relationshipMetadata: cloneDeep(raw.relationshipMetadata || {})
    };

    placementMap.set(raw.id, placement);
    translationDeltas.set(raw.id, { dx: 0, dy: 0 });
    transformationHistory.set(raw.id, []);
  });

  const translatePlacement = (objectId, dx, dy, actionId = null, actionType = 'generic') => {
    const hist = transformationHistory.get(objectId) || [];
    hist.push({ actionId, type: actionType, dx, dy });

    const ownedChildren = ownedByOwner.get(objectId) || [];
    ownedChildren.forEach((childId) => {
      if (childId !== objectId && placementMap.has(childId)) {
        const cHist = transformationHistory.get(childId) || [];
        cHist.push({ actionId, type: `${actionType}_child_transfer`, dx, dy });
      }
    });

    if (dx === 0 && dy === 0) return;
    const p = placementMap.get(objectId);
    if (!p) return;

    p.position.x += dx;
    p.position.y += dy;
    p.bounds.x += dx;
    p.bounds.y += dy;
    if (p.center) {
      p.center.x += dx;
      p.center.y += dy;
    }
    if (Array.isArray(p.path)) {
      p.path = translatePathCommands(p.path, dx, dy);
    }
    if (Array.isArray(p.pathCommands)) {
      p.pathCommands = translatePathCommands(p.pathCommands, dx, dy);
    }
    if (Array.isArray(p.worldPath)) {
      p.worldPath = translatePathCommands(p.worldPath, dx, dy);
    }
    if (Array.isArray(p.worldPathCommands)) {
      p.worldPathCommands = translatePathCommands(p.worldPathCommands, dx, dy);
    }

    const curDelta = translationDeltas.get(objectId) || { dx: 0, dy: 0 };
    translationDeltas.set(objectId, { dx: curDelta.dx + dx, dy: curDelta.dy + dy });

    ownedChildren.forEach((childId) => {
      if (childId !== objectId && placementMap.has(childId)) {
        const childP = placementMap.get(childId);
        childP.position.x += dx;
        childP.position.y += dy;
        childP.bounds.x += dx;
        childP.bounds.y += dy;
        if (childP.center) {
          childP.center.x += dx;
          childP.center.y += dy;
        }
        if (Array.isArray(childP.path)) {
          childP.path = translatePathCommands(childP.path, dx, dy);
        }
        if (Array.isArray(childP.pathCommands)) {
          childP.pathCommands = translatePathCommands(childP.pathCommands, dx, dy);
        }
        if (Array.isArray(childP.worldPath)) {
          childP.worldPath = translatePathCommands(childP.worldPath, dx, dy);
        }
        if (Array.isArray(childP.worldPathCommands)) {
          childP.worldPathCommands = translatePathCommands(childP.worldPathCommands, dx, dy);
        }
        const cDelta = translationDeltas.get(childId) || { dx: 0, dy: 0 };
        translationDeltas.set(childId, { dx: cDelta.dx + dx, dy: cDelta.dy + dy });
      }
    });
  };

  const executedActions = [];

  const sortedActions = [...(cleanupPlan.actions || [])].sort((a, b) => {
    const pA = ACTION_PRIORITY[a.type] || 99;
    const pB = ACTION_PRIORITY[b.type] || 99;
    if (pA !== pB) return pA - pB;
    return String(a.id).localeCompare(String(b.id));
  });

  for (const action of sortedActions) {
    if (action.type === 'attachText') {
      const [shapeId, textId] = action.objectIds || [];
      const pShape = placementMap.get(shapeId);
      const pText = placementMap.get(textId);

      if (pShape && pText) {
        const targetX = pShape.bounds.x + (pShape.bounds.width - pText.size.width) / 2;
        const targetY = pShape.bounds.y + (pShape.bounds.height - pText.size.height) / 2;

        const dx = targetX - pText.bounds.x;
        const dy = targetY - pText.bounds.y;

        pText.position.x = targetX;
        pText.position.y = targetY;
        pText.bounds.x = targetX;
        pText.bounds.y = targetY;
        pText.rotation = 0;

        pShape.relationshipMetadata = pShape.relationshipMetadata || {};
        pText.relationshipMetadata = pText.relationshipMetadata || {};
        pShape.relationshipMetadata.attachedTextId = textId;
        pText.relationshipMetadata.parentShapeId = shapeId;

        translationDeltas.set(textId, { dx, dy });
        const hist = transformationHistory.get(textId) || [];
        hist.push({ actionId: action.id, type: 'attachText', dx, dy });
        executedActions.push(action);
      }
    }

    else if (action.type === 'cleanFlowchart') {
      const flowchartResult = executeCleanFlowchart({
        action,
        placementMap,
        objectMap,
        translationDeltas,
        translatePlacement
      });

      if (!flowchartResult.valid) {
        return {
          version: 1,
          valid: false,
          failedActionId: flowchartResult.failedActionId,
          errorType: flowchartResult.errorType,
          reason: flowchartResult.reason,
          error: flowchartResult.reason
        };
      }
      executedActions.push(action);
    }

    else if (action.type === 'arrangeGrid') {
      const targetObjects = (action.objectIds || []).map((id) => placementMap.get(id)).filter(Boolean);
      if (targetObjects.length >= 2) {
        const minX = Math.min(...targetObjects.map((p) => p.bounds.x));
        const minY = Math.min(...targetObjects.map((p) => p.bounds.y));
        const cols = Math.ceil(Math.sqrt(targetObjects.length));
        const cellWidth = Math.max(...targetObjects.map((p) => p.bounds.width));
        const cellHeight = Math.max(...targetObjects.map((p) => p.bounds.height));
        const gap = 24;

        targetObjects.forEach((p, idx) => {
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const targetX = minX + col * (cellWidth + gap);
          const targetY = minY + row * (cellHeight + gap);

          const dx = targetX - p.bounds.x;
          const dy = targetY - p.bounds.y;
          translatePlacement(p.objectId, dx, dy, action.id, 'arrangeGrid');
        });
        executedActions.push(action);
      }
    }

    else if (action.type === 'align') {
      const targetObjects = (action.objectIds || []).map((id) => placementMap.get(id)).filter(Boolean);
      if (targetObjects.length >= 2) {
        const axis = action.axis;

        if (axis === 'centerY') {
          const avgCenterY = targetObjects.reduce((sum, p) => sum + (p.bounds.y + p.bounds.height / 2), 0) / targetObjects.length;
          targetObjects.forEach((p) => {
            const curCenterY = p.bounds.y + p.bounds.height / 2;
            const dy = avgCenterY - curCenterY;
            translatePlacement(p.objectId, 0, dy, action.id, 'align');
          });
        } else if (axis === 'centerX') {
          const avgCenterX = targetObjects.reduce((sum, p) => sum + (p.bounds.x + p.bounds.width / 2), 0) / targetObjects.length;
          targetObjects.forEach((p) => {
            const curCenterX = p.bounds.x + p.bounds.width / 2;
            const dx = avgCenterX - curCenterX;
            translatePlacement(p.objectId, dx, 0, action.id, 'align');
          });
        } else if (axis === 'x') {
          const minLeft = Math.min(...targetObjects.map((p) => p.bounds.x));
          targetObjects.forEach((p) => {
            const dx = minLeft - p.bounds.x;
            translatePlacement(p.objectId, dx, 0, action.id, 'align');
          });
        } else if (axis === 'y') {
          const minTop = Math.min(...targetObjects.map((p) => p.bounds.y));
          targetObjects.forEach((p) => {
            const dy = minTop - p.bounds.y;
            translatePlacement(p.objectId, 0, dy, action.id, 'align');
          });
        }
        executedActions.push(action);
      }
    }

    else if (action.type === 'equalizeSpacing') {
      const targetObjects = (action.objectIds || []).map((id) => placementMap.get(id)).filter(Boolean);
      if (targetObjects.length >= 3) {
        const axis = action.axis || 'x';
        if (axis === 'x') {
          targetObjects.sort((a, b) => a.bounds.x - b.bounds.x);
          const first = targetObjects[0];
          const last = targetObjects[targetObjects.length - 1];
          const totalWidth = targetObjects.reduce((sum, p) => sum + p.bounds.width, 0);
          const totalSpan = (last.bounds.x + last.bounds.width) - first.bounds.x;
          const availableGapSpace = totalSpan - totalWidth;
          const gap = Math.max(20, availableGapSpace / (targetObjects.length - 1));

          let curX = first.bounds.x;
          targetObjects.forEach((p) => {
            const dx = curX - p.bounds.x;
            translatePlacement(p.objectId, dx, 0, action.id, 'equalizeSpacing');
            curX += p.bounds.width + gap;
          });
        } else if (axis === 'y') {
          targetObjects.sort((a, b) => a.bounds.y - b.bounds.y);
          const first = targetObjects[0];
          const last = targetObjects[targetObjects.length - 1];
          const totalHeight = targetObjects.reduce((sum, p) => sum + p.bounds.height, 0);
          const totalSpan = (last.bounds.y + last.bounds.height) - first.bounds.y;
          const availableGapSpace = totalSpan - totalHeight;
          const gap = Math.max(20, availableGapSpace / (targetObjects.length - 1));

          let curY = first.bounds.y;
          targetObjects.forEach((p) => {
            const dy = curY - p.bounds.y;
            translatePlacement(p.objectId, 0, dy, action.id, 'equalizeSpacing');
            curY += p.bounds.height + gap;
          });
        }
        executedActions.push(action);
      }
    }

    else if (action.type === 'normalizeText') {
      (action.objectIds || []).forEach((id) => {
        const p = placementMap.get(id);
        if (p && p.type === 'text') {
          p.rotation = 0;
          const hist = transformationHistory.get(id) || [];
          hist.push({ actionId: action.id, type: 'normalizeText', dx: 0, dy: 0 });
        }
      });
      executedActions.push(action);
    }

    else if (action.type === 'preserve') {
      executedActions.push(action);
    }
  }

  const allPlacements = Array.from(placementMap.values());
  const connectors = allPlacements.filter((p) => p.type === 'connector');

  connectors.forEach((conn) => {
    const meta = conn.relationshipMetadata || {};
    const srcId = meta.sourceShapeId || meta.sourceObjectId;
    const tgtId = meta.targetShapeId || meta.targetObjectId;

    const srcDelta = srcId ? translationDeltas.get(srcId) : null;
    const tgtDelta = tgtId ? translationDeltas.get(tgtId) : null;

    if (srcDelta && tgtDelta && srcDelta.dx === tgtDelta.dx && srcDelta.dy === tgtDelta.dy) {
      if (srcDelta.dx !== 0 || srcDelta.dy !== 0) {
        translatePlacement(conn.objectId, srcDelta.dx, srcDelta.dy, 'connector_sync', 'connector_sync');
      }
    }
  });

  const untouchedObjectIds = cleanupPlan.untouchedObjectIds || [];
  const untouchedViolations = [];

  untouchedObjectIds.forEach((id) => {
    const parentContainerId = ownerByText ? ownerByText.get(id) : null;
    if (parentContainerId) {
      const parentDelta = translationDeltas.get(parentContainerId);
      if (parentDelta && (parentDelta.dx !== 0 || parentDelta.dy !== 0)) {
        return;
      }
    }

    const orig = originalSnapshots.get(id);
    const finalP = placementMap.get(id);
    if (orig && finalP) {
      const dx = Math.abs(finalP.position.x - orig.position.x);
      const dy = Math.abs(finalP.position.y - orig.position.y);
      const dW = Math.abs(finalP.bounds.width - orig.bounds.width);
      const dH = Math.abs(finalP.bounds.height - orig.bounds.height);
      const dRot = Math.abs(finalP.rotation - orig.rotation);

      if (dx > 0.001 || dy > 0.001 || dW > 0.001 || dH > 0.001 || dRot > 0.001) {
        untouchedViolations.push({
          objectId: id,
          dx,
          dy,
          dW,
          dH,
          dRot
        });
      }
    }
  });

  if (untouchedViolations.length > 0) {
    return {
      version: 1,
      valid: false,
      failedActionId: 'untouched_invariant_violation',
      errorType: 'untouchedObjectViolation',
      reason: `Untouched invariant violated for ${untouchedViolations.length} objects: ${untouchedViolations.map((v) => v.objectId).join(', ')}`,
      error: `Untouched invariant violated for ${untouchedViolations.length} objects`
    };
  }

  const movementAudit = {};
  rawObjects.forEach((raw) => {
    const orig = originalSnapshots.get(raw.id);
    const finalP = placementMap.get(raw.id);
    const hist = transformationHistory.get(raw.id) || [];
    const totalDx = finalP.position.x - orig.position.x;
    const totalDy = finalP.position.y - orig.position.y;
    const owningActions = Array.from(new Set(hist.map((h) => h.actionId).filter(Boolean)));

    const distinctLayoutTypes = new Set(
      hist.filter((h) => h.type !== 'attachText' && !h.type.endsWith('_child_transfer')).map((h) => h.type)
    );
    const unexpectedMultiTransform = distinctLayoutTypes.size > 1;

    movementAudit[raw.id] = {
      objectId: raw.id,
      originalPosition: { ...orig.position },
      finalPosition: { ...finalP.position },
      totalTranslation: { dx: totalDx, dy: totalDy },
      owningActions,
      transformationCount: hist.length,
      unexpectedMultiTransform
    };
  });

  const boundsList = allPlacements.map((p) => p.bounds);
  const canvasBounds = unionBounds(boundsList, 40, rawObjects);

  return {
    version: 1,
    valid: true,
    canvasBounds,
    sections: [],
    placements: allPlacements,
    metadata: {
      strategy: 'conservative_cleanup',
      executedActionCount: executedActions.length,
      untouchedObjectCount: untouchedObjectIds.length,
      movementAudit,
      diagnostics: {
        orphanConnectors: [],
        detachedLinkedObjects: [],
        ...(cleanupPlan.diagnostics || {})
      }
    }
  };
};

export default executeCleanupPlan;
