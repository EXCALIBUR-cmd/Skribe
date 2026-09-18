import { getSemanticType, isConnectorPath } from './cleanupTypes.js';
import { recoverConnectorTopology, getDistanceToShapeBoundary } from './connectorTopology.js';
import { getObjectBounds, segmentsIntersect } from './cleanupOpportunities.js';
import { buildVisualObjectModel, resolveContainerOwnership } from './visualUnits.js';
import { parseConnectorPath } from './connectorGeometry.js';
import { findDetachedFlowAssociation } from './detachedFlowAssociation.js';
import { computeConnectorRepair } from './connectorRepair.js';

export const STRUCTURE_TYPES = Object.freeze({
  FLOW: 'flow',
  SEQUENCE: 'sequence',
  CLUSTER: 'cluster',
  ANNOTATION: 'annotation',
  CONCEPT_GROUP: 'conceptGroup',
  STANDALONE: 'standalone',
  CREATIVE: 'creative',
  STRUCTURAL: 'structural'
});

export const TEMPLATE_TYPES = Object.freeze({
  FLOW_HORIZONTAL: 'flow_horizontal',
  FLOW_VERTICAL: 'flow_vertical',
  FLOW_BRANCH: 'flow_branch',
  FLOW_MERGE: 'flow_merge',
  SEQUENCE_ROW: 'sequence_row',
  SEQUENCE_COLUMN: 'sequence_column',
  CLUSTER_GRID: 'cluster_grid',
  ANNOTATION_CALLOUT: 'annotation_callout',
  PRESERVE: 'preserve'
});

const sortStrings = (arr) => [...(arr || [])].sort((a, b) => String(a).localeCompare(String(b)));


export const extractSemanticShaftEndpoints = (connector) => {
  if (!connector) return null;

  const pathInput = connector.path || connector.pathData || connector.pathCommands;
  if (!pathInput) return null;

  const parsed = parseConnectorPath(pathInput);
  if (!parsed || !parsed.mainCommands || parsed.mainCommands.length === 0) return null;




  const isReversed = Boolean(connector.startArrow && !connector.endArrow);

  return {
    shaftStartPt: parsed.startPt,
    shaftEndPt: parsed.endPt,
    sourceAnchor: isReversed ? parsed.endPt : parsed.startPt,
    targetAnchor: isReversed ? parsed.startPt : parsed.endPt,
    isReversed,
    hasArrowhead: parsed.hasArrowhead,
    shaftPath: parsed.mainCommands,
    arrowheadPath: parsed.hasArrowhead
      ? parsed.allCommands.slice(parsed.mainCommands.length)
      : []
  };
};


export const getBoxesIntersection = (b1, b2) => {
  if (!b1 || !b2) return { xOverlap: 0, yOverlap: 0, area: 0, pct1: 0, pct2: 0 };
  const xOverlap = Math.max(0, Math.min(b1.x + b1.width, b2.x + b2.width) - Math.max(b1.x, b2.x));
  const yOverlap = Math.max(0, Math.min(b1.y + b1.height, b2.y + b2.height) - Math.max(b1.y, b2.y));
  const area = xOverlap * yOverlap;
  const a1 = Math.max(1, b1.width * b1.height);
  const a2 = Math.max(1, b2.width * b2.height);
  return {
    xOverlap,
    yOverlap,
    area,
    pct1: area / a1,
    pct2: area / a2
  };
};


export const getBoxesGap = (b1, b2) => {
  if (!b1 || !b2) return Infinity;
  const dx = Math.max(0, Math.max(b1.x, b2.x) - Math.min(b1.x + b1.width, b2.x + b2.width));
  const dy = Math.max(0, Math.max(b1.y, b2.y) - Math.min(b1.y + b1.height, b2.y + b2.height));
  return Math.hypot(dx, dy);
};


export const segmentIntersectsBox = (p1, p2, box) => {
  if (!p1 || !p2 || !box) return false;
  const inBox = (p) => (
    p.x > box.x && p.x < box.x + box.width &&
    p.y > box.y && p.y < box.y + box.height
  );
  if (inBox(p1) || inBox(p2)) return true;

  const topLeft = { x: box.x, y: box.y };
  const topRight = { x: box.x + box.width, y: box.y };
  const bottomLeft = { x: box.x, y: box.y + box.height };
  const bottomRight = { x: box.x + box.width, y: box.y + box.height };

  return (
    segmentsIntersect(p1, p2, topLeft, topRight) ||
    segmentsIntersect(p1, p2, topRight, bottomRight) ||
    segmentsIntersect(p1, p2, bottomRight, bottomLeft) ||
    segmentsIntersect(p1, p2, bottomLeft, topLeft)
  );
};


export const pointInsideBox = (p, box, margin = 0) => {
  if (!p || !box) return false;
  return (
    p.x >= box.x - margin &&
    p.x <= box.x + box.width + margin &&
    p.y >= box.y - margin &&
    p.y <= box.y + box.height + margin
  );
};


export const buildCompleteCandidateGeometry = ({
  candidateGeometry,
  compObjects,
  compEdges = [],
  ownership = null,
  objectMap = null
}) => {
  const candidateNodes = candidateGeometry?.nodes || [];
  const candidateConnectors = candidateGeometry?.connectors || [];

  const candidateLabels = [];
  const candNodeMap = new Map(candidateNodes.map((n) => [n.id, n]));

  compObjects.forEach((origObj) => {
    const candNode = candNodeMap.get(origObj.id);
    if (!candNode) return;
    const origBounds = getObjectBounds(origObj);
    const dx = candNode.x - origBounds.x;
    const dy = candNode.y - origBounds.y;

    const ownedTextIds = ownership?.ownedByOwner?.get(origObj.id) || [];
    ownedTextIds.forEach((tId) => {
      const textObj = objectMap?.get(tId);
      if (!textObj) return;
      const tBounds = getObjectBounds(textObj);
      const candX = tBounds.x + dx;
      const candY = tBounds.y + dy;
      candidateLabels.push({
        id: tId,
        parentNodeId: origObj.id,
        x: candX,
        y: candY,
        width: tBounds.width,
        height: tBounds.height,
        cx: candX + tBounds.width / 2,
        cy: candY + tBounds.height / 2
      });
    });
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  candidateNodes.forEach((n) => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  });
  candidateLabels.forEach((l) => {
    minX = Math.min(minX, l.x);
    minY = Math.min(minY, l.y);
    maxX = Math.max(maxX, l.x + l.width);
    maxY = Math.max(maxY, l.y + l.height);
  });
  candidateConnectors.forEach((c) => {
    if (c.startPoint) {
      minX = Math.min(minX, c.startPoint.x);
      minY = Math.min(minY, c.startPoint.y);
      maxX = Math.max(maxX, c.startPoint.x);
      maxY = Math.max(maxY, c.startPoint.y);
    }
    if (c.endPoint) {
      minX = Math.min(minX, c.endPoint.x);
      minY = Math.min(minY, c.endPoint.y);
      maxX = Math.max(maxX, c.endPoint.x);
      maxY = Math.max(maxY, c.endPoint.y);
    }
  });

  if (!Number.isFinite(minX)) {
    minX = 0; minY = 0; maxX = 100; maxY = 100;
  }

  const candidateCompleteBounds = {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    cx: minX + (maxX - minX) / 2,
    cy: minY + (maxY - minY) / 2
  };

  return {
    candidateNodeBounds: candidateNodes,
    candidateLabelBounds: candidateLabels,
    candidateConnectorGeometry: candidateConnectors,
    candidateCompleteBounds
  };
};


export const evaluateCompleteGeometryCollisions = ({
  completeGeometry,
  nonMemberObjects = [],
  currentCompleteGeometry = null
}) => {
  const {
    candidateNodeBounds = [],
    candidateLabelBounds = [],
    candidateConnectorGeometry = [],
    candidateCompleteBounds
  } = completeGeometry;

  const collidedObjectIds = [];
  let totalCollisionArea = 0;
  let minGap = Infinity;

  nonMemberObjects.forEach((obs) => {
    const obsBounds = getObjectBounds(obs);
    const obsSem = getSemanticType(obs);
    const isTextObs = obsSem === 'text';
    const isLineObs = obsSem === 'line' || obs.isSkribeLine || obs.isStraightLine;

    if (candidateCompleteBounds) {
      const g = getBoxesGap(candidateCompleteBounds, obsBounds);
      if (g < minGap) minGap = g;
    }

    let collides = false;
    let obsCollisionArea = 0;


    for (const node of candidateNodeBounds) {
      const inter = getBoxesIntersection(node, obsBounds);
      if (obs.id === 'ann_text') {
        console.log('[DEBUG] node:', node.id, 'obsBounds:', obsBounds, 'inter:', inter);
      }
      const isMeaningful = isTextObs
        ? (inter.area > 25 || (inter.xOverlap > 5 && inter.yOverlap > 5))
        : (inter.area > 50 || (inter.xOverlap > 5 && inter.yOverlap > 5));

      if (isMeaningful) {
        collides = true;
        obsCollisionArea += inter.area;
      }
    }


    for (const label of candidateLabelBounds) {
      const inter = getBoxesIntersection(label, obsBounds);
      const isMeaningful = isTextObs
        ? (inter.area > 25 || (inter.xOverlap > 5 && inter.yOverlap > 5))
        : (inter.area > 50 || (inter.xOverlap > 5 && inter.yOverlap > 5));

      if (isMeaningful) {
        collides = true;
        obsCollisionArea += inter.area;
      }
    }


    for (const conn of candidateConnectorGeometry) {
      if (!conn.startPoint || !conn.endPoint) continue;
      if (isLineObs) {
        const dX1 = obsBounds.x;
        const dY1 = obsBounds.y;
        const dX2 = obsBounds.x + obsBounds.width;
        const dY2 = obsBounds.y + obsBounds.height;
        if (segmentsIntersect(conn.startPoint, conn.endPoint, { x: dX1, y: dY1 }, { x: dX2, y: dY2 })) {
          collides = true;
          obsCollisionArea += 100;
        }
      } else {
        if (segmentIntersectsBox(conn.startPoint, conn.endPoint, obsBounds)) {
          collides = true;
          obsCollisionArea += 100;
        }
      }


      if (pointInsideBox(conn.endPoint, obsBounds, 2)) {
        collides = true;
        obsCollisionArea += 50;
      }
    }

    if (collides) {
      collidedObjectIds.push(obs.id);
      totalCollisionArea += obsCollisionArea;
    }
  });

  const candidateProtectedCollisions = collidedObjectIds.length;
  let currentProtectedCollisions = 0;
  let currentCollidedIds = new Set();

  if (currentCompleteGeometry) {
    const currentRes = evaluateCompleteGeometryCollisions({
      completeGeometry: currentCompleteGeometry,
      nonMemberObjects,
      currentCompleteGeometry: null
    });
    currentProtectedCollisions = currentRes.candidateProtectedCollisions;
    currentCollidedIds = new Set(currentRes.collidedObjectIds);
  }

  const newCollidedIds = collidedObjectIds.filter((id) => !currentCollidedIds.has(id));
  const newProtectedCollisions = newCollidedIds.length;
  const resolvedProtectedCollisions = Array.from(currentCollidedIds).filter((id) => !collidedObjectIds.includes(id)).length;

  const candidateIntersectsProtectedObject = candidateProtectedCollisions > 0;
  const safe = newProtectedCollisions === 0 && candidateProtectedCollisions === 0;

  return {
    collidedObjectIds,
    collisionObjectIds: collidedObjectIds,
    candidateProtectedCollisions,
    currentProtectedCollisions,
    newProtectedCollisions,
    resolvedProtectedCollisions,
    protectedCollisionCount: candidateProtectedCollisions,
    protectedCollisionArea: Number(totalCollisionArea.toFixed(1)),
    minimumProtectedGap: Number(minGap.toFixed(2)),
    candidateIntersectsProtectedObject,
    safe,
    rejectionReason: safe ? null : 'protectedObjectCollision'
  };
};


export const computeFlowCandidateGeometry = ({
  compObjects,
  compLevelMap,
  orientation = 'horizontal',
  compEdges = [],
  offsetX = 0,
  offsetY = 0
}) => {
  const isVertical = orientation === 'vertical';
  const LEVEL_GAP = 80;
  const SIBLING_GAP = 40;

  const nodeIds = compObjects.map((o) => o.id);
  const nodeBoundsMap = new Map();
  compObjects.forEach((obj) => {
    nodeBoundsMap.set(obj.id, getObjectBounds(obj));
  });

  const maxLevel = Math.max(...Array.from(compLevelMap.values()), 0);
  const levels = [];
  for (let l = 0; l <= maxLevel; l++) {
    levels.push([]);
  }
  nodeIds.forEach((id) => {
    const lvl = compLevelMap.get(id) ?? 0;
    levels[lvl].push(id);
  });

  levels.forEach((lvlNodes) => {
    lvlNodes.sort((a, b) => {
      const bA = nodeBoundsMap.get(a);
      const bB = nodeBoundsMap.get(b);
      if (!isVertical) {
        if (Math.abs(bA.cy - bB.cy) > 1) return bA.cy - bB.cy;
        if (Math.abs(bA.x - bB.x) > 1) return bA.x - bB.x;
        return String(a).localeCompare(String(b));
      } else {
        if (Math.abs(bA.cx - bB.cx) > 1) return bA.cx - bB.cx;
        if (Math.abs(bA.y - bB.y) > 1) return bA.y - bB.y;
        return String(a).localeCompare(String(b));
      }
    });
  });

  const origMinX = Math.min(...nodeIds.map((id) => nodeBoundsMap.get(id).x)) + offsetX;
  const origMinY = Math.min(...nodeIds.map((id) => nodeBoundsMap.get(id).y)) + offsetY;

  const candidateNodes = [];
  const candBoundsMap = new Map();

  if (!isVertical) {
    const colWidths = levels.map((lvlNodes) =>
      Math.max(...lvlNodes.map((id) => nodeBoundsMap.get(id).width), 100)
    );
    const colHeights = levels.map((lvlNodes) => {
      const heights = lvlNodes.map((id) => nodeBoundsMap.get(id).height);
      return heights.reduce((sum, h) => sum + h, 0) + (lvlNodes.length - 1) * SIBLING_GAP;
    });
    const maxGraphHeight = Math.max(...colHeights, 100);

    let curLevelX = origMinX;
    levels.forEach((lvlNodes, lIdx) => {
      const colW = colWidths[lIdx];
      const colH = colHeights[lIdx];
      let curY = origMinY + (maxGraphHeight - colH) / 2;

      lvlNodes.forEach((id) => {
        const origB = nodeBoundsMap.get(id);
        const targetX = curLevelX + (colW - origB.width) / 2;
        const targetY = curY;
        const candNode = {
          id,
          x: targetX,
          y: targetY,
          width: origB.width,
          height: origB.height,
          cx: targetX + origB.width / 2,
          cy: targetY + origB.height / 2
        };
        candidateNodes.push(candNode);
        candBoundsMap.set(id, candNode);
        curY += origB.height + SIBLING_GAP;
      });

      curLevelX += colW + LEVEL_GAP;
    });
  } else {
    const rowHeights = levels.map((lvlNodes) =>
      Math.max(...lvlNodes.map((id) => nodeBoundsMap.get(id).height), 80)
    );
    const rowWidths = levels.map((lvlNodes) => {
      const widths = lvlNodes.map((id) => nodeBoundsMap.get(id).width);
      return widths.reduce((sum, w) => sum + w, 0) + (lvlNodes.length - 1) * SIBLING_GAP;
    });
    const maxGraphWidth = Math.max(...rowWidths, 100);

    let curLevelY = origMinY;
    levels.forEach((lvlNodes, lIdx) => {
      const rowH = rowHeights[lIdx];
      const rowW = rowWidths[lIdx];
      let curX = origMinX + (maxGraphWidth - rowW) / 2;

      lvlNodes.forEach((id) => {
        const origB = nodeBoundsMap.get(id);
        const targetX = curX + (maxGraphWidth - origB.width) / 2;
        const targetY = curLevelY + (rowH - origB.height) / 2;
        const candNode = {
          id,
          x: targetX,
          y: targetY,
          width: origB.width,
          height: origB.height,
          cx: targetX + origB.width / 2,
          cy: targetY + origB.height / 2
        };
        candidateNodes.push(candNode);
        candBoundsMap.set(id, candNode);
        curX += origB.width + SIBLING_GAP;
      });

      curLevelY += rowH + LEVEL_GAP;
    });
  }

  const candidateConnectors = [];
  compEdges.forEach((edge) => {
    const src = candBoundsMap.get(edge.srcId);
    const tgt = candBoundsMap.get(edge.tgtId);
    if (!src || !tgt) return;

    let startPoint;
    let endPoint;
    if (!isVertical) {
      startPoint = { x: src.x + src.width, y: src.cy };
      endPoint = { x: tgt.x, y: tgt.cy };
    } else {
      startPoint = { x: src.cx, y: src.y + src.height };
      endPoint = { x: tgt.cx, y: tgt.y };
    }
    candidateConnectors.push({
      connId: edge.connId,
      srcId: edge.srcId,
      tgtId: edge.tgtId,
      startPoint,
      endPoint,
      path: `M ${startPoint.x} ${startPoint.y} L ${endPoint.x} ${endPoint.y}`
    });
  });

  return {
    nodes: candidateNodes,
    connectors: candidateConnectors
  };
};


export const findSafeFlowCandidateGeometry = ({
  compObjects,
  compLevelMap,
  orientation = 'horizontal',
  compEdges = [],
  nonMemberObjects = [],
  ownership = null,
  objectMap = null,
  currentCompleteGeometry = null
}) => {

  const nodeBoundsList = compObjects.map((o) => getObjectBounds(o));
  const minX = Math.min(...nodeBoundsList.map((b) => b.x));
  const minY = Math.min(...nodeBoundsList.map((b) => b.y));
  const maxX = Math.max(...nodeBoundsList.map((b) => b.x + b.width));
  const maxY = Math.max(...nodeBoundsList.map((b) => b.y + b.height));
  const safeRegion = {
    minX: Math.max(0, minX - 100),
    minY: Math.max(0, minY - 100),
    maxX: maxX + 100,
    maxY: maxY + 100
  };


  const baselineGeom = computeFlowCandidateGeometry({
    compObjects,
    compLevelMap,
    orientation,
    compEdges,
    offsetX: 0,
    offsetY: 0
  });

  const baselineCompleteGeom = buildCompleteCandidateGeometry({
    candidateGeometry: baselineGeom,
    compObjects,
    compEdges,
    ownership,
    objectMap
  });

  const baselineCollision = evaluateCompleteGeometryCollisions({
    completeGeometry: baselineCompleteGeom,
    nonMemberObjects,
    currentCompleteGeometry
  });

  return {
    candidateGeometry: baselineGeom,
    completeGeometry: baselineCompleteGeom,
    collisionResult: baselineCollision,
    safeRegion
  };
};


export const compareCompositionsGeometry = ({
  currentNodes,
  candidateNodes,
  currentConnectors = [],
  candidateConnectors = []
}) => {
  const nodeDisplacements = {};
  let totalNodeDisplacement = 0;
  let maxNodeDisplacement = 0;

  currentNodes.forEach((orig) => {
    const cand = candidateNodes.find((c) => c.id === orig.id);
    if (!cand) return;
    const dx = cand.x - orig.x;
    const dy = cand.y - orig.y;
    const dist = Math.hypot(dx, dy);
    nodeDisplacements[orig.id] = Number(dist.toFixed(1));
    totalNodeDisplacement += dist;
    if (dist > maxNodeDisplacement) maxNodeDisplacement = dist;
  });

  const connectorDisplacements = {};
  let maxConnectorDisplacement = 0;
  let hasPathChange = false;

  candidateConnectors.forEach((candConn) => {
    const origConn = currentConnectors.find((c) => (c.id || c.connId) === (candConn.id || candConn.connId));
    if (!origConn) return;
    let dStart = 0;
    let dEnd = 0;
    if (origConn.startPoint && candConn.startPoint) {
      dStart = Math.hypot(candConn.startPoint.x - origConn.startPoint.x, candConn.startPoint.y - origConn.startPoint.y);
    }
    if (origConn.endPoint && candConn.endPoint) {
      dEnd = Math.hypot(candConn.endPoint.x - origConn.endPoint.x, candConn.endPoint.y - origConn.endPoint.y);
    }
    const maxD = Math.max(dStart, dEnd);
    connectorDisplacements[candConn.connId] = Number(maxD.toFixed(1));
    if (maxD > maxConnectorDisplacement) maxConnectorDisplacement = maxD;
    if (origConn.path && candConn.path && origConn.path !== candConn.path) {
      hasPathChange = true;
    }
  });

  const hasNodeGeometryChange = maxNodeDisplacement > 1.5;
  const hasConnectorGeometryChange = maxConnectorDisplacement > 1.5 || hasPathChange;
  const hasMeaningfulVisualChange = hasNodeGeometryChange || hasConnectorGeometryChange;

  return {
    nodeDisplacements,
    totalNodeDisplacement: Number(totalNodeDisplacement.toFixed(1)),
    maxNodeDisplacement: Number(maxNodeDisplacement.toFixed(1)),
    connectorDisplacements,
    maxConnectorDisplacement: Number(maxConnectorDisplacement.toFixed(1)),
    hasNodeGeometryChange,
    hasConnectorGeometryChange,
    hasMeaningfulVisualChange
  };
};


export const evaluateCompositionQuality = ({
  objects,
  objectMap,
  explicitEdges = [],
  structureType,
  orientation = 'horizontal',
  levelAssignment = null,
  connectorAttachmentData = null
}) => {
  if (!objects || objects.length === 0) {
    return {
      alignment: 10,
      spacing: 10,
      directionalClarity: 10,
      connectorCrossings: 10,
      relativeOrdering: 10,
      whitespace: 10,
      hierarchy: 10,
      readability: 10,
      quality: 10
    };
  }

  const boundsList = objects.map((obj) => ({ id: obj.id, ...getObjectBounds(obj) }));

  const isVertical = orientation === 'vertical';
  let alignment = 10;
  let spacing = 10;

  const hasLevels = levelAssignment && Object.keys(levelAssignment).length > 0;
  const levelMap = new Map();
  if (hasLevels) {
    boundsList.forEach((b) => {
      const lvl = levelAssignment[b.id] ?? 0;
      if (!levelMap.has(lvl)) levelMap.set(lvl, []);
      levelMap.get(lvl).push(b);
    });
  }

  const hasMultiNodeLevels = hasLevels && Array.from(levelMap.values()).some((arr) => arr.length >= 2);

  if (hasMultiNodeLevels) {


    const intraLevelAlignScores = [];
    levelMap.forEach((lvlNodes) => {
      if (lvlNodes.length >= 2) {
        if (!isVertical) {
          const cxVals = lvlNodes.map((n) => n.cx);
          const deltaCx = Math.max(...cxVals) - Math.min(...cxVals);
          if (deltaCx <= 2) intraLevelAlignScores.push(10);
          else if (deltaCx <= 15) intraLevelAlignScores.push(8.5);
          else if (deltaCx <= 40) intraLevelAlignScores.push(6.0);
          else intraLevelAlignScores.push(3.5);
        } else {
          const cyVals = lvlNodes.map((n) => n.cy);
          const deltaCy = Math.max(...cyVals) - Math.min(...cyVals);
          if (deltaCy <= 2) intraLevelAlignScores.push(10);
          else if (deltaCy <= 15) intraLevelAlignScores.push(8.5);
          else if (deltaCy <= 40) intraLevelAlignScores.push(6.0);
          else intraLevelAlignScores.push(3.5);
        }
      }
    });


    const centeringScores = [];
    const sortedLevels = Array.from(levelMap.keys()).sort((a, b) => a - b);
    for (let i = 0; i < sortedLevels.length - 1; i++) {
      const l1 = levelMap.get(sortedLevels[i]);
      const l2 = levelMap.get(sortedLevels[i + 1]);
      if (l1.length === 1 && l2.length >= 2) {
        const parent = l1[0];
        if (!isVertical) {
          const meanCy = l2.reduce((s, n) => s + n.cy, 0) / l2.length;
          const diff = Math.abs(parent.cy - meanCy);
          if (diff <= 5) centeringScores.push(10);
          else if (diff <= 20) centeringScores.push(8.5);
          else if (diff <= 50) centeringScores.push(6.0);
          else centeringScores.push(3.5);
        } else {
          const meanCx = l2.reduce((s, n) => s + n.cx, 0) / l2.length;
          const diff = Math.abs(parent.cx - meanCx);
          if (diff <= 5) centeringScores.push(10);
          else if (diff <= 20) centeringScores.push(8.5);
          else if (diff <= 50) centeringScores.push(6.0);
          else centeringScores.push(3.5);
        }
      } else if (l1.length >= 2 && l2.length === 1) {
        const child = l2[0];
        if (!isVertical) {
          const meanCy = l1.reduce((s, n) => s + n.cy, 0) / l1.length;
          const diff = Math.abs(child.cy - meanCy);
          if (diff <= 5) centeringScores.push(10);
          else if (diff <= 20) centeringScores.push(8.5);
          else if (diff <= 50) centeringScores.push(6.0);
          else centeringScores.push(3.5);
        } else {
          const meanCx = l1.reduce((s, n) => s + n.cx, 0) / l1.length;
          const diff = Math.abs(child.cx - meanCx);
          if (diff <= 5) centeringScores.push(10);
          else if (diff <= 20) centeringScores.push(8.5);
          else if (diff <= 50) centeringScores.push(6.0);
          else centeringScores.push(3.5);
        }
      }
    }

    const allAlign = [...intraLevelAlignScores, ...centeringScores];
    alignment = allAlign.length > 0 ? allAlign.reduce((s, v) => s + v, 0) / allAlign.length : 10;


    const interLevelGaps = [];
    for (let i = 0; i < sortedLevels.length - 1; i++) {
      const l1 = levelMap.get(sortedLevels[i]);
      const l2 = levelMap.get(sortedLevels[i + 1]);
      if (!isVertical) {
        const maxL1X = Math.max(...l1.map((n) => n.x + n.width));
        const minL2X = Math.min(...l2.map((n) => n.x));
        interLevelGaps.push(minL2X - maxL1X);
      } else {
        const maxL1Y = Math.max(...l1.map((n) => n.y + n.height));
        const minL2Y = Math.min(...l2.map((n) => n.y));
        interLevelGaps.push(minL2Y - maxL1Y);
      }
    }


    const siblingGaps = [];
    sortedLevels.forEach((lvl) => {
      const nodes = levelMap.get(lvl);
      if (nodes.length >= 2) {
        const sortedNodes = !isVertical
          ? [...nodes].sort((a, b) => a.y - b.y)
          : [...nodes].sort((a, b) => a.x - b.x);
        for (let j = 0; j < sortedNodes.length - 1; j++) {
          if (!isVertical) {
            siblingGaps.push(sortedNodes[j + 1].y - (sortedNodes[j].y + sortedNodes[j].height));
          } else {
            siblingGaps.push(sortedNodes[j + 1].x - (sortedNodes[j].x + sortedNodes[j].width));
          }
        }
      }
    });

    let interSpacingScore = 10;
    if (interLevelGaps.length > 0) {
      const maxGap = Math.max(...interLevelGaps);
      const minGap = Math.min(...interLevelGaps);
      if (minGap < 0) interSpacingScore = 2.0;
      else if (maxGap > 250) interSpacingScore = 3.0;
      else if (maxGap > 180) interSpacingScore = 4.5;
      else if (maxGap > 120) interSpacingScore = 6.5;
      else if (maxGap > 90) interSpacingScore = 8.5;
      else interSpacingScore = 10;
    }

    let siblingSpacingScore = 10;
    if (siblingGaps.length > 0) {
      const maxGap = Math.max(...siblingGaps);
      const minGap = Math.min(...siblingGaps);
      if (minGap < 0) siblingSpacingScore = 2.0;
      else if (maxGap > 200) siblingSpacingScore = 2.5;
      else if (maxGap > 140) siblingSpacingScore = 4.5;
      else if (maxGap > 80) siblingSpacingScore = 6.5;
      else if (maxGap > 60) siblingSpacingScore = 8.5;
      else siblingSpacingScore = 10;
    }

    spacing = (interSpacingScore + siblingSpacingScore) / 2;
  } else {

    if (boundsList.length >= 2) {
      if (orientation === 'horizontal') {
        const cyVals = boundsList.map((b) => b.cy);
        const deltaCy = Math.max(...cyVals) - Math.min(...cyVals);
        if (deltaCy <= 2) alignment = 10;
        else if (deltaCy <= 15) alignment = 9.0;
        else if (deltaCy <= 40) alignment = 6.5;
        else if (deltaCy <= 80) alignment = 4.0;
        else alignment = Math.max(1, 4.0 - (deltaCy - 80) / 40);
      } else {
        const cxVals = boundsList.map((b) => b.cx);
        const deltaCx = Math.max(...cxVals) - Math.min(...cxVals);
        if (deltaCx <= 2) alignment = 10;
        else if (deltaCx <= 15) alignment = 9.0;
        else if (deltaCx <= 40) alignment = 6.5;
        else if (deltaCx <= 80) alignment = 4.0;
        else alignment = Math.max(1, 4.0 - (deltaCx - 80) / 40);
      }
    }


    if (boundsList.length >= 3) {
      const sorted = orientation === 'horizontal'
        ? [...boundsList].sort((a, b) => a.x - b.x)
        : [...boundsList].sort((a, b) => a.y - b.y);

      const gaps = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = orientation === 'horizontal'
          ? sorted[i + 1].x - (sorted[i].x + sorted[i].width)
          : sorted[i + 1].y - (sorted[i].y + sorted[i].height);
        gaps.push(gap);
      }

      const minGap = Math.min(...gaps);
      const maxGap = Math.max(...gaps);
      const gapDiff = maxGap - minGap;
      const gapRatio = minGap > 0 ? maxGap / minGap : 1;

      if (minGap < 0) {
        spacing = 2.0;
      } else if (gapDiff <= 6) {
        spacing = 10;
      } else if (gapDiff <= 15) {
        spacing = 8.5;
      } else if (gapDiff <= 30 && gapRatio <= 1.8) {
        spacing = 6.5;
      } else if (gapDiff <= 50) {
        spacing = 4.5;
      } else {
        spacing = Math.max(1, 3.5 - (gapDiff - 50) / 40);
      }
    }
  }


  let directionalClarity = 10;
  if (structureType === STRUCTURE_TYPES.FLOW && explicitEdges.length > 0) {
    let backwardCount = 0;
    let totalChecked = 0;

    explicitEdges.forEach((e) => {
      const bSrc = boundsList.find((b) => b.id === e.srcId);
      const bTgt = boundsList.find((b) => b.id === e.tgtId);
      if (bSrc && bTgt) {
        totalChecked++;
        if (orientation === 'horizontal') {
          if (bTgt.x < bSrc.x - 10) backwardCount++;
        } else {
          if (bTgt.y < bSrc.y - 10) backwardCount++;
        }
      }
    });

    if (totalChecked > 0) {
      const ratio = backwardCount / totalChecked;
      if (ratio === 0) directionalClarity = 10;
      else if (ratio <= 0.3) directionalClarity = 5.5;
      else directionalClarity = 2.0;
    }
  }


  let connectorCrossings = 10;
  if (explicitEdges.length >= 2) {
    let crossings = 0;
    for (let i = 0; i < explicitEdges.length; i++) {
      for (let j = i + 1; j < explicitEdges.length; j++) {
        const e1 = explicitEdges[i];
        const e2 = explicitEdges[j];
        if (e1.srcId === e2.srcId || e1.srcId === e2.tgtId || e1.tgtId === e2.srcId || e1.tgtId === e2.tgtId) {
          continue;
        }
        const bSrc1 = boundsList.find((b) => b.id === e1.srcId);
        const bTgt1 = boundsList.find((b) => b.id === e1.tgtId);
        const bSrc2 = boundsList.find((b) => b.id === e2.srcId);
        const bTgt2 = boundsList.find((b) => b.id === e2.tgtId);
        if (bSrc1 && bTgt1 && bSrc2 && bTgt2) {
          const p1 = { x: bSrc1.cx, y: bSrc1.cy };
          const p2 = { x: bTgt1.cx, y: bTgt1.cy };
          const p3 = { x: bSrc2.cx, y: bSrc2.cy };
          const p4 = { x: bTgt2.cx, y: bTgt2.cy };
          if (segmentsIntersect(p1, p2, p3, p4)) {
            crossings++;
          }
        }
      }
    }
    connectorCrossings = Math.max(1, 10 - crossings * 3.5);
  }


  let relativeOrdering = 10;
  if (boundsList.length >= 2) {
    if (structureType === STRUCTURE_TYPES.SEQUENCE || structureType === STRUCTURE_TYPES.FLOW) {
      if (directionalClarity < 7) {
        relativeOrdering = Math.min(10, directionalClarity + 1.0);
      }
    }
  }


  let whitespace = 10;
  if (boundsList.length >= 2) {
    let maxLocalGap = 0;
    for (let i = 0; i < boundsList.length; i++) {
      for (let j = i + 1; j < boundsList.length; j++) {
        const bA = boundsList[i];
        const bB = boundsList[j];
        const dist = Math.hypot(bA.cx - bB.cx, bA.cy - bB.cy);
        if (dist > maxLocalGap) maxLocalGap = dist;
      }
    }

    if (maxLocalGap > 700) {
      whitespace = 2.0;
    } else if (maxLocalGap > 500) {
      whitespace = 4.0;
    } else if (maxLocalGap > 350) {
      whitespace = 6.0;
    } else if (maxLocalGap > 200) {
      whitespace = 8.0;
    }
  }



  if (boundsList.length === 2 && spacing === 10) {
    const b0 = boundsList[0];
    const b1 = boundsList[1];
    let edgeGap;
    if (orientation === 'horizontal') {
      const left = b0.x <= b1.x ? b0 : b1;
      const right = b0.x <= b1.x ? b1 : b0;
      edgeGap = right.x - (left.x + left.width);
    } else {
      const top = b0.y <= b1.y ? b0 : b1;
      const bot = b0.y <= b1.y ? b1 : b0;
      edgeGap = bot.y - (top.y + top.height);
    }

    if (edgeGap > 500) {
      spacing = 2.5;
    } else if (edgeGap > 300) {
      spacing = 4.0;
    } else if (edgeGap > 150) {
      spacing = 6.5;
    } else if (edgeGap > 80) {
      spacing = 8.5;
    }
  }


  const hierarchy = 9.0;




  let connectorAttachment = null;
  const connectorAttachmentDetails = [];

  if (connectorAttachmentData && connectorAttachmentData.length > 0) {
    const perConnectorScores = [];

    connectorAttachmentData.forEach((cd) => {
      const srcShape = objectMap.get(cd.sourceShapeId);
      const tgtShape = objectMap.get(cd.targetShapeId);

      let srcError = Infinity;
      let tgtError = Infinity;

      if (srcShape && cd.sourceAnchor && Number.isFinite(cd.sourceAnchor.x)) {
        srcError = getDistanceToShapeBoundary(cd.sourceAnchor, srcShape);
      }
      if (tgtShape && cd.targetAnchor && Number.isFinite(cd.targetAnchor.x)) {
        tgtError = getDistanceToShapeBoundary(cd.targetAnchor, tgtShape);
      }

      const maxError = Math.max(
        Number.isFinite(srcError) ? srcError : 100,
        Number.isFinite(tgtError) ? tgtError : 100
      );

      let score;
      if (maxError <= 5) score = 10;
      else if (maxError <= 15) score = 8.5;
      else if (maxError <= 30) score = 6.0;
      else if (maxError <= 50) score = 3.5;
      else score = 1.5;

      perConnectorScores.push(score);


      const srcBoundaryPoint = srcShape ? {
        x: cd.sourceAnchor?.x ?? 0,
        y: cd.sourceAnchor?.y ?? 0
      } : null;
      const tgtBoundaryPoint = tgtShape ? {
        x: cd.targetAnchor?.x ?? 0,
        y: cd.targetAnchor?.y ?? 0
      } : null;

      connectorAttachmentDetails.push({
        connectorId: cd.connId,
        sourceShapeId: cd.sourceShapeId,
        targetShapeId: cd.targetShapeId,
        topologyConfidence: cd.topologyConfidence ?? 0.98,
        sourceAnchor: cd.sourceAnchor,
        targetAnchor: cd.targetAnchor,
        sourceBoundaryPoint: srcBoundaryPoint,
        targetBoundaryPoint: tgtBoundaryPoint,
        sourceAttachmentError: Number((Number.isFinite(srcError) ? srcError : 100).toFixed(1)),
        targetAttachmentError: Number((Number.isFinite(tgtError) ? tgtError : 100).toFixed(1)),
        connectorAttachmentScore: score,
        visuallyAttached: maxError <= 15,
        shaftPath: cd.shaftPath || null,
        arrowheadPath: cd.arrowheadPath || null
      });
    });

    connectorAttachment = perConnectorScores.reduce((s, v) => s + v, 0) / perConnectorScores.length;
  }




  const effectiveAttachment = connectorAttachment !== null ? connectorAttachment : 10;



  const readability = Number((
    alignment * 0.22 +
    spacing * 0.22 +
    directionalClarity * 0.18 +
    connectorCrossings * 0.08 +
    effectiveAttachment * 0.12 +
    whitespace * 0.13 +
    hierarchy * 0.05
  ).toFixed(2));
















  const minCore = Math.min(alignment, spacing, directionalClarity, whitespace, effectiveAttachment);
  const weighted = (
    alignment * 0.20 +
    spacing * 0.20 +
    directionalClarity * 0.16 +
    connectorCrossings * 0.07 +
    effectiveAttachment * 0.15 +
    whitespace * 0.11 +
    hierarchy * 0.03 +
    readability * 0.08
  );

  const maxBoost = hasMultiNodeLevels ? 2.5 : 4.0;
  const quality = Number(Math.min(weighted, minCore + maxBoost).toFixed(2));

  return {
    alignment: Number(alignment.toFixed(2)),
    spacing: Number(spacing.toFixed(2)),
    directionalClarity: Number(directionalClarity.toFixed(2)),
    connectorCrossings: Number(connectorCrossings.toFixed(2)),
    relativeOrdering: Number(relativeOrdering.toFixed(2)),
    whitespace: Number(whitespace.toFixed(2)),
    hierarchy: Number(hierarchy.toFixed(2)),
    connectorAttachment: connectorAttachment !== null ? Number(connectorAttachment.toFixed(2)) : null,
    connectorAttachmentDetails,
    readability,
    quality
  };
};


export const calculateMovementCost = ({
  objectCount,
  currentQuality,
  candidateQuality,
  isBranchingOrMerge = false
}) => {

  let cost = objectCount * 0.35;
  if (isBranchingOrMerge) cost += 0.5;



  if (currentQuality >= 8.5) {
    cost += 2.0;
  }

  return Number(Math.min(5.0, Math.max(0.5, cost)).toFixed(2));
};


export const calculateCompositionRisk = ({
  hasUnknownConnectorEndpoints = false,
  nearCreativeContent = false,
  crossingStructuralBoundary = false,
  structureConfidence = 0.95
}) => {
  let risk = 0.5;
  if (hasUnknownConnectorEndpoints) risk += 2.5;
  if (nearCreativeContent) risk += 1.5;
  return Number(Math.min(5.0, risk).toFixed(2));
};


export const evaluateTextSafety = (rawObjects, compObjects = [], ownership = null) => {
  const structureContainerIds = new Set(compObjects.map((o) => o.id));
  const nodeBoundsList = compObjects.map((o) => ({ id: o.id, ...getObjectBounds(o) }));

  const textSafetyList = [];
  rawObjects.forEach((obj) => {
    if (getSemanticType(obj) !== 'text') return;
    const textBounds = getObjectBounds(obj);
    const containerId = ownership?.ownerByText?.get(obj.id) || null;
    const isOwnedByStructure = containerId && structureContainerIds.has(containerId);

    let minDist = Infinity;
    let bestNode = null;
    nodeBoundsList.forEach((nb) => {
      const gap = getBoxesGap(textBounds, nb);
      if (gap < minDist) {
        minDist = gap;
        bestNode = nb;
      }
    });

    const isInsideNode = bestNode ? (
      textBounds.x >= bestNode.x - 5 &&
      textBounds.x + textBounds.width <= bestNode.x + bestNode.width + 5 &&
      textBounds.y >= bestNode.y - 5 &&
      textBounds.y + textBounds.height <= bestNode.y + bestNode.height + 5
    ) : false;

    const overlapWithNode = bestNode ? getBoxesIntersection(textBounds, bestNode).pct1 : 0;

    let ownershipConfidence = 0.0;
    let attachmentReason = 'External unlinked text; treated as protected/unrelated obstacle.';

    if (isOwnedByStructure) {
      const tier = ownership?.ownerTierByText?.get(obj.id) ?? 0;
      if (tier === 0) {
        ownershipConfidence = 1.0;
        attachmentReason = `Explicitly attached to node '${containerId}' via relationship metadata.`;
      } else if (tier === 1) {
        ownershipConfidence = 0.98;
        attachmentReason = `Shares compound element ID with node '${containerId}'.`;
      } else {
        ownershipConfidence = 0.90;
        attachmentReason = `Spatially contained inside node '${containerId}'.`;
      }
    } else if (containerId) {
      ownershipConfidence = 0.90;
      attachmentReason = `Attached to external container '${containerId}'.`;
    }

    textSafetyList.push({
      textId: obj.id,
      text: obj.text || '',
      containerId,
      distanceToNearestNode: Number(minDist.toFixed(2)),
      insideNode: isInsideNode,
      overlapWithNode: Number(overlapWithNode.toFixed(3)),
      ownershipConfidence,
      attachmentReason,
      isProtected: !isOwnedByStructure
    });
  });

  return textSafetyList;
};


export const discoverVisualStructures = (workspaceModel, semanticScene = null, options = {}) => {
  const rawObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const objectMap = new Map(rawObjects.map((o) => [o.id, o]));

  const visualObjects = buildVisualObjectModel(workspaceModel);
  const voMap = new Map(visualObjects.map((vo) => [vo.objectId, vo]));
  const ownership = resolveContainerOwnership(visualObjects, voMap);

  const structures = [];
  const claimedObjectIds = new Set();
  const claimedConnectorIds = new Set();


  const creativeObjects = rawObjects.filter((o) => {
    const sem = getSemanticType(o);
    if (sem === 'connector' || o.isConnector === true || isConnectorPath(o)) return false;
    return sem === 'stroke' || o.isVectorStroke || o.metadata?.isVectorStroke;
  });

  if (creativeObjects.length > 0) {
    const creativeIds = creativeObjects.map((o) => o.id);
    creativeIds.forEach((id) => claimedObjectIds.add(id));

    structures.push({
      id: `struct_creative_cluster`,
      type: STRUCTURE_TYPES.CREATIVE,
      objectIds: sortStrings(creativeIds),
      connectorIds: [],
      confidence: 0.99,
      evidence: ['vector-stroke-freehand', 'creative-preservation-invariant'],
      currentComposition: { quality: 10, readability: 10 },
      candidateCompositions: [{ template: TEMPLATE_TYPES.PRESERVE, quality: 10 }],
      compositionBenefit: 0.0,
      movementCost: 0.0,
      risk: 0.0,
      reason: `Identified ${creativeIds.length} freehand creative strokes; strictly preserved untouched.`
    });
  }


  const structuralObjects = rawObjects.filter((o) => {
    const sem = getSemanticType(o);
    return sem === 'line' || o.isSkribeLine || o.metadata?.isSkribeLine || o.isStraightLine || o.metadata?.isStraightLine;
  });

  structuralObjects.forEach((div) => {
    claimedObjectIds.add(div.id);
    structures.push({
      id: `struct_structural_${div.id}`,
      type: STRUCTURE_TYPES.STRUCTURAL,
      objectIds: [div.id],
      connectorIds: [],
      confidence: 0.99,
      evidence: ['structural-boundary-line'],
      currentComposition: { quality: 10, readability: 10 },
      candidateCompositions: [{ template: TEMPLATE_TYPES.PRESERVE, quality: 10 }],
      compositionBenefit: 0.0,
      movementCost: 0.0,
      risk: 0.0,
      reason: `Structural layout divider '${div.id}' defines boundary; strictly preserved.`
    });
  });


  const connectorObjects = rawObjects.filter((o) => getSemanticType(o) === 'connector');
  const explicitEdges = [];
  const unknownConnectors = [];

  const candidateContainers = rawObjects.filter((o) => {
    const sem = getSemanticType(o);
    return ['shape', 'note'].includes(sem);
  });

  connectorObjects.forEach((conn) => {
    const topo = recoverConnectorTopology(conn, candidateContainers);
    const isVerified = (topo.overallConfidence ?? topo.confidence ?? 0) >= 0.85;
    const srcId = isVerified ? topo.sourceShapeId : null;
    const tgtId = isVerified ? topo.targetShapeId : null;
    const isRecovered = topo.endpointSource === 'geometric-recovery' || topo.endpointSource === 'hybrid';

    if (srcId && tgtId && objectMap.has(srcId) && objectMap.has(tgtId) && srcId !== tgtId) {
      explicitEdges.push({
        connId: conn.id,
        srcId,
        tgtId,
        confidence: isRecovered ? 0.90 : 0.98,
        isRecovered
      });
    } else {
      unknownConnectors.push(conn.id);
    }
  });


  const adj = new Map();
  const connMap = new Map();
  explicitEdges.forEach((e) => {
    if (!adj.has(e.srcId)) adj.set(e.srcId, new Set());
    if (!adj.has(e.tgtId)) adj.set(e.tgtId, new Set());
    adj.get(e.srcId).add(e.tgtId);
    adj.get(e.tgtId).add(e.srcId);

    const pairKey = [e.srcId, e.tgtId].sort().join('--');
    if (!connMap.has(pairKey)) connMap.set(pairKey, []);
    connMap.get(pairKey).push(e.connId);
  });


  const visited = new Set();
  const sortedGraphNodes = [...adj.keys()].sort((a, b) => String(a).localeCompare(String(b)));

  sortedGraphNodes.forEach((startNode) => {
    if (visited.has(startNode)) return;

    const component = [];
    const q = [startNode];
    visited.add(startNode);

    while (q.length > 0) {
      const cur = q.shift();
      component.push(cur);
      const nbrs = adj.get(cur) || new Set();
      nbrs.forEach((nbr) => {
        if (!visited.has(nbr)) {
          visited.add(nbr);
          q.push(nbr);
        }
      });
    }

    if (component.length >= 2) {
      const compConns = new Set();
      for (let i = 0; i < component.length; i++) {
        for (let j = i + 1; j < component.length; j++) {
          const key = [component[i], component[j]].sort().join('--');
          (connMap.get(key) || []).forEach((cId) => compConns.add(cId));
        }
      }

      const compEdges = explicitEdges.filter(
        (e) => component.includes(e.srcId) && component.includes(e.tgtId)
      );


      let totalDx = 0;
      let totalDy = 0;
      compEdges.forEach((e) => {
        const b1 = getObjectBounds(objectMap.get(e.srcId));
        const b2 = getObjectBounds(objectMap.get(e.tgtId));
        totalDx += Math.abs(b2.cx - b1.cx);
        totalDy += Math.abs(b2.cy - b1.cy);
      });

      const orientation = totalDy > totalDx * 1.2 ? 'vertical' : 'horizontal';


      const outDegrees = new Map();
      const inDegrees = new Map();
      const compAdj = new Map();
      component.forEach((id) => {
        outDegrees.set(id, 0);
        inDegrees.set(id, 0);
        compAdj.set(id, []);
      });
      compEdges.forEach((e) => {
        outDegrees.set(e.srcId, (outDegrees.get(e.srcId) || 0) + 1);
        inDegrees.set(e.tgtId, (inDegrees.get(e.tgtId) || 0) + 1);
        compAdj.get(e.srcId).push(e.tgtId);
      });

      const hasBranch = Array.from(outDegrees.values()).some((d) => d >= 2);
      const hasMerge = Array.from(inDegrees.values()).some((d) => d >= 2);

      let primaryTemplate = orientation === 'horizontal' ? TEMPLATE_TYPES.FLOW_HORIZONTAL : TEMPLATE_TYPES.FLOW_VERTICAL;
      if (hasBranch) primaryTemplate = TEMPLATE_TYPES.FLOW_BRANCH;
      if (hasMerge) primaryTemplate = TEMPLATE_TYPES.FLOW_MERGE;



      let compRoots = component.filter((id) => inDegrees.get(id) === 0);
      if (compRoots.length === 0) {
        compRoots = [[...component].sort((a, b) => (inDegrees.get(a) - inDegrees.get(b)) || String(a).localeCompare(String(b)))[0]];
      }

      const compLevelMap = new Map();
      const levelQueue = [...compRoots];
      compRoots.forEach((r) => compLevelMap.set(r, 0));
      const visitedInBfs = new Set(compRoots);

      while (levelQueue.length > 0) {
        const u = levelQueue.shift();
        const curLevel = compLevelMap.get(u);
        const neighbors = compAdj.get(u) || [];
        neighbors.forEach((v) => {
          const nextLevel = curLevel + 1;
          if (!compLevelMap.has(v) || compLevelMap.get(v) < nextLevel) {
            compLevelMap.set(v, nextLevel);
          }
          if (!visitedInBfs.has(v)) {
            visitedInBfs.add(v);
            levelQueue.push(v);
          }
        });
      }

      component.forEach((id) => {
        if (!compLevelMap.has(id)) compLevelMap.set(id, 0);
      });

      const maxCompLevel = Math.max(...Array.from(compLevelMap.values()), 0);
      const compLevels = [];
      for (let l = 0; l <= maxCompLevel; l++) {
        compLevels.push([]);
      }
      component.forEach((id) => {
        compLevels[compLevelMap.get(id)].push(id);
      });

      compLevels.forEach((lvlNodes) => {
        lvlNodes.sort((a, b) => {
          const bA = getObjectBounds(objectMap.get(a));
          const bB = getObjectBounds(objectMap.get(b));
          if (orientation === 'horizontal') {
            if (Math.abs(bA.cy - bB.cy) > 1) return bA.cy - bB.cy;
            return String(a).localeCompare(String(b));
          } else {
            if (Math.abs(bA.cx - bB.cx) > 1) return bA.cx - bB.cx;
            return String(a).localeCompare(String(b));
          }
        });
      });

      const orderedNodeIds = compLevels.flat();
      const levelAssignment = Object.fromEntries(compLevelMap);
      const verifiedEdges = compEdges.map((e) => ({
        connId: e.connId,
        srcId: e.srcId,
        tgtId: e.tgtId,
        confidence: e.confidence
      }));

      const compObjects = component.map((id) => objectMap.get(id)).filter(Boolean);

      const currentNodes = compObjects.map((obj) => ({ id: obj.id, ...getObjectBounds(obj) }));




      const currentConnectors = compEdges.map((e) => {
        const connObj = objectMap.get(e.connId);
        const srcB = getObjectBounds(objectMap.get(e.srcId));
        const tgtB = getObjectBounds(objectMap.get(e.tgtId));


        const shaftEndpoints = connObj ? extractSemanticShaftEndpoints(connObj) : null;

        return {
          connId: e.connId,
          srcId: e.srcId,
          tgtId: e.tgtId,
          path: connObj?.path || connObj?.pathData || '',
          startPoint: shaftEndpoints ? shaftEndpoints.sourceAnchor : { x: srcB.cx, y: srcB.cy },
          endPoint: shaftEndpoints ? shaftEndpoints.targetAnchor : { x: tgtB.cx, y: tgtB.cy },
          shaftEndpoints
        };
      });






      const connectorAttachmentData = currentConnectors
        .filter((cc) => cc.shaftEndpoints !== null)
        .map((cc) => ({
        connId: cc.connId,
        sourceShapeId: cc.srcId,
        targetShapeId: cc.tgtId,
        sourceAnchor: cc.startPoint,
        targetAnchor: cc.endPoint,
        topologyConfidence: compEdges.find((e) => e.connId === cc.connId)?.confidence ?? 0.96,
        shaftPath: cc.shaftEndpoints?.shaftPath || null,
        arrowheadPath: cc.shaftEndpoints?.arrowheadPath || null
      }));

      const currentQualityMetrics = evaluateCompositionQuality({
        objects: compObjects,
        objectMap,
        explicitEdges: compEdges,
        structureType: STRUCTURE_TYPES.FLOW,
        orientation,
        levelAssignment,
        connectorAttachmentData
      });

      const memberNodeIds = new Set(component);
      const memberOwnedTextIds = new Set();
      component.forEach((nId) => {
        const texts = ownership?.ownedByOwner?.get(nId) || [];
        texts.forEach((tId) => memberOwnedTextIds.add(tId));
      });
      const memberConnIds = new Set(compConns);

      const nonMemberObjects = rawObjects.filter(
        (o) => !memberNodeIds.has(o.id) && !memberOwnedTextIds.has(o.id) && !memberConnIds.has(o.id)
      );
      console.log('[DEBUG] nonMemberObjects:', nonMemberObjects.map(o => o.id));

      const currentLabels = [];
      component.forEach((nId) => {
        const textIds = ownership?.ownedByOwner?.get(nId) || [];
        textIds.forEach((tId) => {
          const tObj = objectMap.get(tId);
          if (tObj) currentLabels.push({ id: tId, parentNodeId: nId, ...getObjectBounds(tObj) });
        });
      });

      let curMinX = Infinity, curMinY = Infinity, curMaxX = -Infinity, curMaxY = -Infinity;
      currentNodes.forEach((n) => {
        curMinX = Math.min(curMinX, n.x); curMinY = Math.min(curMinY, n.y);
        curMaxX = Math.max(curMaxX, n.x + n.width); curMaxY = Math.max(curMaxY, n.y + n.height);
      });
      currentLabels.forEach((l) => {
        curMinX = Math.min(curMinX, l.x); curMinY = Math.min(curMinY, l.y);
        curMaxX = Math.max(curMaxX, l.x + l.width); curMaxY = Math.max(curMaxY, l.y + l.height);
      });
      currentConnectors.forEach((c) => {
        if (c.startPoint) {
          curMinX = Math.min(curMinX, c.startPoint.x); curMinY = Math.min(curMinY, c.startPoint.y);
          curMaxX = Math.max(curMaxX, c.startPoint.x); curMaxY = Math.max(curMaxY, c.startPoint.y);
        }
        if (c.endPoint) {
          curMinX = Math.min(curMinX, c.endPoint.x); curMinY = Math.min(curMinY, c.endPoint.y);
          curMaxX = Math.max(curMaxX, c.endPoint.x); curMaxY = Math.max(curMaxY, c.endPoint.y);
        }
      });
      const currentCompleteBounds = {
        x: curMinX, y: curMinY,
        width: Math.max(1, curMaxX - curMinX), height: Math.max(1, curMaxY - curMinY),
        cx: curMinX + (curMaxX - curMinX) / 2, cy: curMinY + (curMaxY - curMinY) / 2
      };
      const currentCompleteGeometry = {
        candidateNodeBounds: currentNodes,
        candidateLabelBounds: currentLabels,
        candidateConnectorGeometry: currentConnectors,
        candidateCompleteBounds: currentCompleteBounds
      };

      const primaryFlowResult = findSafeFlowCandidateGeometry({
        compObjects,
        compLevelMap,
        orientation,
        compEdges,
        nonMemberObjects,
        ownership,
        objectMap,
        currentCompleteGeometry
      });
      const candidateGeometry = primaryFlowResult.candidateGeometry;
      const primaryCompleteGeom = primaryFlowResult.completeGeometry;
      const primaryCollision = primaryFlowResult.collisionResult;
      const safeRegion = primaryFlowResult.safeRegion;

      const geoComparison = compareCompositionsGeometry({
        currentNodes,
        candidateNodes: candidateGeometry.nodes,
        currentConnectors,
        candidateConnectors: candidateGeometry.connectors
      });

      const candidateObjects = compObjects.map((orig) => {
        const candNode = candidateGeometry.nodes.find((n) => n.id === orig.id);
        if (!candNode) return orig;
        return {
          ...orig,
          position: { x: candNode.x, y: candNode.y },
          left: candNode.x,
          top: candNode.y,
          bounds: {
            x: candNode.x,
            y: candNode.y,
            width: candNode.width,
            height: candNode.height
          }
        };
      });




      const candidateConnAttData = candidateGeometry.connectors.map((cc) => ({
        connId: cc.connId,
        sourceShapeId: cc.srcId,
        targetShapeId: cc.tgtId,
        sourceAnchor: cc.startPoint,
        targetAnchor: cc.endPoint,
        topologyConfidence: 0.98
      }));

      const candidateQualityMetrics = evaluateCompositionQuality({
        objects: candidateObjects,
        objectMap: new Map(candidateObjects.map((o) => [o.id, o])),
        explicitEdges: compEdges,
        structureType: STRUCTURE_TYPES.FLOW,
        orientation,
        levelAssignment,
        connectorAttachmentData: candidateConnAttData
      });

      const candidateQuality = candidateQualityMetrics.quality;
      let benefit = Math.max(0, Number((candidateQuality - currentQualityMetrics.quality).toFixed(2)));




      if (!geoComparison.hasMeaningfulVisualChange) {
        benefit = 0;
      }

      const nodeCount = component.length;
      const movementCost = calculateMovementCost({
        objectCount: nodeCount,
        currentQuality: currentQualityMetrics.quality,
        candidateQuality,
        isBranchingOrMerge: hasBranch || hasMerge
      });

      const risk = calculateCompositionRisk({
        hasUnknownConnectorEndpoints: false,
        nearCreativeContent: false,
        structureConfidence: 0.96
      });

      const structureId = `struct_flow_${sortStrings(component)[0]}`;
      const cand1Safe = primaryCollision.safe;
      const candidateCompositions = [
        {
          template: primaryTemplate,
          orientation,
          levelAssignment,
          orderedNodeIds,
          verifiedEdges,
          quality: candidateQuality,
          currentQuality: currentQualityMetrics.quality,
          currentGeometry: {
            nodes: currentNodes,
            connectors: currentConnectors
          },
          candidateGeometry,
          geoComparison,
          alignment: candidateQualityMetrics.alignment,
          spacing: candidateQualityMetrics.spacing,
          directionalClarity: candidateQualityMetrics.directionalClarity,
          connectorCrossings: candidateQualityMetrics.connectorCrossings,
          whitespace: candidateQualityMetrics.whitespace,
          hierarchy: candidateQualityMetrics.hierarchy,
          readability: candidateQualityMetrics.readability,
          compositionBenefit: Number(benefit.toFixed(2)),
          movementCost,
          risk,
          reason: `Flowchart graph of ${nodeCount} nodes organized into clean ${orientation} flow levels.`,


          candidateCompleteBounds: primaryCompleteGeom.candidateCompleteBounds,
          candidateNodeBounds: primaryCompleteGeom.candidateNodeBounds,
          candidateLabelBounds: primaryCompleteGeom.candidateLabelBounds,
          candidateConnectorGeometry: primaryCompleteGeom.candidateConnectorGeometry,
          protectedCollisionCount: primaryCollision.protectedCollisionCount,
          protectedCollisionArea: primaryCollision.protectedCollisionArea,
          minimumProtectedGap: primaryCollision.minimumProtectedGap,
          candidateIntersectsProtectedObject: primaryCollision.candidateIntersectsProtectedObject,
          currentProtectedCollisions: primaryCollision.currentProtectedCollisions,
          candidateProtectedCollisions: primaryCollision.candidateProtectedCollisions,
          newProtectedCollisions: primaryCollision.newProtectedCollisions,
          resolvedProtectedCollisions: primaryCollision.resolvedProtectedCollisions,
          collidedObjectIds: primaryCollision.collidedObjectIds,
          collisionObjectIds: primaryCollision.collidedObjectIds,
          safe: cand1Safe,
          rejectionReason: cand1Safe ? null : 'protectedObjectCollision',
          safeRegion
        }
      ];


      if (nodeCount <= 5 && !hasBranch && !hasMerge) {
        const altTemplate = orientation === 'horizontal' ? TEMPLATE_TYPES.FLOW_VERTICAL : TEMPLATE_TYPES.FLOW_HORIZONTAL;
        const altOrientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';

        const altFlowResult = findSafeFlowCandidateGeometry({
          compObjects,
          compLevelMap,
          orientation: altOrientation,
          compEdges,
          nonMemberObjects,
          ownership,
          objectMap,
          currentCompleteGeometry
        });
        const altCandGeom = altFlowResult.candidateGeometry;
        const altCompleteGeom = altFlowResult.completeGeometry;
        const altCollision = altFlowResult.collisionResult;
        const altSafe = altCollision.safe;

        const altGeoComparison = compareCompositionsGeometry({
          currentNodes,
          candidateNodes: altCandGeom.nodes,
          currentConnectors,
          candidateConnectors: altCandGeom.connectors
        });

        const altMovementCost = calculateMovementCost({
          objectCount: nodeCount,
          currentQuality: currentQualityMetrics.quality,
          candidateQuality: 9.0,
          isBranchingOrMerge: false
        });

        const altRisk = calculateCompositionRisk({
          hasUnknownConnectorEndpoints: false,
          nearCreativeContent: false,
          structureConfidence: 0.96
        });

        candidateCompositions.push({
          template: altTemplate,
          orientation: altOrientation,
          levelAssignment,
          orderedNodeIds,
          verifiedEdges,
          quality: 9.0,
          currentQuality: currentQualityMetrics.quality,
          currentGeometry: {
            nodes: currentNodes,
            connectors: currentConnectors
          },
          candidateGeometry: altCandGeom,
          geoComparison: altGeoComparison,
          compositionBenefit: Math.max(0, 9.0 - currentQualityMetrics.quality),
          movementCost: altMovementCost,
          risk: altRisk,
          reason: `Alternative ${altTemplate === TEMPLATE_TYPES.FLOW_HORIZONTAL ? 'horizontal' : 'vertical'} flow candidate.`,


          candidateCompleteBounds: altCompleteGeom.candidateCompleteBounds,
          candidateNodeBounds: altCompleteGeom.candidateNodeBounds,
          candidateLabelBounds: altCompleteGeom.candidateLabelBounds,
          candidateConnectorGeometry: altCompleteGeom.candidateConnectorGeometry,
          protectedCollisionCount: altCollision.protectedCollisionCount,
          protectedCollisionArea: altCollision.protectedCollisionArea,
          minimumProtectedGap: altCollision.minimumProtectedGap,
          candidateIntersectsProtectedObject: altCollision.candidateIntersectsProtectedObject,
          currentProtectedCollisions: altCollision.currentProtectedCollisions,
          candidateProtectedCollisions: altCollision.candidateProtectedCollisions,
          newProtectedCollisions: altCollision.newProtectedCollisions,
          resolvedProtectedCollisions: altCollision.resolvedProtectedCollisions,
          collidedObjectIds: altCollision.collidedObjectIds,
          collisionObjectIds: altCollision.collidedObjectIds,
          safe: altSafe,
          rejectionReason: altSafe ? null : 'protectedObjectCollision',
          safeRegion: altFlowResult.safeRegion
        });
      }

      component.forEach((id) => claimedObjectIds.add(id));
      compConns.forEach((id) => {
        claimedObjectIds.add(id);
        claimedConnectorIds.add(id);
      });

      structures.push({
        id: structureId,
        type: STRUCTURE_TYPES.FLOW,
        objectIds: orderedNodeIds,
        memberIds: [...component],
        connectorIds: sortStrings(Array.from(compConns)),
        orientation,
        template: primaryTemplate,
        levelAssignment,
        orderedNodeIds,
        verifiedEdges,
        confidence: 0.96,
        evidence: ['verified-connector-topology', 'flowchart-dag-levels'],
        currentComposition: currentQualityMetrics,
        candidateCompositions,
        compositionBenefit: Number(benefit.toFixed(2)),
        movementCost,
        risk,
        reason: benefit >= 1.5
          ? `Flowchart structure with ${nodeCount} connected nodes has low visual quality (${currentQualityMetrics.quality}/10); reorganizing into structured ${orientation} flow improves readability.`
          : `Flowchart structure with ${nodeCount} connected nodes already has clean flow composition (${currentQualityMetrics.quality}/10); preserved.`
      });
    }
  });


  const unverifiedConnectors = unknownConnectors
    .map((cId) => objectMap.get(cId))
    .filter(Boolean)
    .filter((o) => !claimedConnectorIds.has(o.id));

  unverifiedConnectors.forEach((conn) => {
    const detachedRes = findDetachedFlowAssociation(conn, candidateContainers, { visualStructures: structures });
    if (!detachedRes || !detachedRes.association || detachedRes.association.associationConfidence < 0.90) {
      return;
    }

    const association = detachedRes.association;
    const srcId = association.sourceCandidateId;
    const tgtId = association.targetCandidateId;
    const srcObj = objectMap.get(srcId);
    const tgtObj = objectMap.get(tgtId);

    if (!srcObj || !tgtObj || srcId === tgtId) {
      return;
    }

    const bSrc = getObjectBounds(srcObj);
    const bTgt = getObjectBounds(tgtObj);
    const dx = Math.abs(bTgt.cx - bSrc.cx);
    const dy = Math.abs(bTgt.cy - bSrc.cy);
    const orientation = dy > dx * 1.2 ? 'vertical' : 'horizontal';
    const primaryTemplate = orientation === 'horizontal' ? TEMPLATE_TYPES.FLOW_HORIZONTAL : TEMPLATE_TYPES.FLOW_VERTICAL;

    const compEdges = [{
      connId: conn.id,
      srcId,
      tgtId,
      confidence: association.associationConfidence
    }];

    const currentNodes = [
      { id: srcId, ...bSrc },
      { id: tgtId, ...bTgt }
    ];

    const shaftEndpoints = extractSemanticShaftEndpoints(conn);
    const currentConnectors = [{
      connId: conn.id,
      srcId,
      tgtId,
      path: conn.path || '',
      startPoint: shaftEndpoints ? shaftEndpoints.sourceAnchor : { x: bSrc.cx, y: bSrc.cy },
      endPoint: shaftEndpoints ? shaftEndpoints.targetAnchor : { x: bTgt.cx, y: bTgt.cy },
      shaftEndpoints
    }];

    let curMinX = Math.min(bSrc.x, bTgt.x);
    let curMinY = Math.min(bSrc.y, bTgt.y);
    let curMaxX = Math.max(bSrc.x + bSrc.width, bTgt.x + bTgt.width);
    let curMaxY = Math.max(bSrc.y + bSrc.height, bTgt.y + bTgt.height);
    if (currentConnectors[0].startPoint) {
      curMinX = Math.min(curMinX, currentConnectors[0].startPoint.x);
      curMinY = Math.min(curMinY, currentConnectors[0].startPoint.y);
      curMaxX = Math.max(curMaxX, currentConnectors[0].startPoint.x);
      curMaxY = Math.max(curMaxY, currentConnectors[0].startPoint.y);
    }
    if (currentConnectors[0].endPoint) {
      curMinX = Math.min(curMinX, currentConnectors[0].endPoint.x);
      curMinY = Math.min(curMinY, currentConnectors[0].endPoint.y);
      curMaxX = Math.max(curMaxX, currentConnectors[0].endPoint.x);
      curMaxY = Math.max(curMaxY, currentConnectors[0].endPoint.y);
    }
    const currentCompleteBounds = {
      x: curMinX,
      y: curMinY,
      width: Math.max(1, curMaxX - curMinX),
      height: Math.max(1, curMaxY - curMinY),
      cx: curMinX + (curMaxX - curMinX) / 2,
      cy: curMinY + (curMaxY - curMinY) / 2
    };

    const currentCompleteGeometry = {
      candidateNodeBounds: currentNodes,
      candidateLabelBounds: [],
      candidateConnectorGeometry: currentConnectors,
      candidateCompleteBounds: currentCompleteBounds
    };

    const connectorAttachmentData = [{
      connId: conn.id,
      sourceShapeId: srcId,
      targetShapeId: tgtId,
      sourceAnchor: currentConnectors[0].startPoint,
      targetAnchor: currentConnectors[0].endPoint,
      topologyConfidence: association.associationConfidence,
      shaftPath: shaftEndpoints?.shaftPath || null,
      arrowheadPath: shaftEndpoints?.arrowheadPath || null
    }];

    const currentQualityMetrics = evaluateCompositionQuality({
      objects: [srcObj, tgtObj],
      objectMap,
      explicitEdges: compEdges,
      structureType: STRUCTURE_TYPES.FLOW,
      orientation,
      levelAssignment: { [srcId]: 0, [tgtId]: 1 },
      connectorAttachmentData
    });

    const repairPayload = computeConnectorRepair(conn, srcObj, tgtObj, {
      connectorId: conn.id,
      sourceShapeId: srcId,
      targetShapeId: tgtId,
      overallConfidence: association.associationConfidence,
      confidence: association.associationConfidence,
      routeType: association.routeType || 'straight'
    });

    const memberOwnedTextIds = new Set();
    const srcTexts = ownership?.ownedByOwner?.get(srcId) || [];
    srcTexts.forEach((tId) => memberOwnedTextIds.add(tId));
    const tgtTexts = ownership?.ownedByOwner?.get(tgtId) || [];
    tgtTexts.forEach((tId) => memberOwnedTextIds.add(tId));

    const otherObjects = rawObjects.filter(
      (o) => o.id !== conn.id && o.id !== srcId && o.id !== tgtId && !memberOwnedTextIds.has(o.id)
    );

    let candA = null;
    if (repairPayload && repairPayload.repairAccepted) {
      const startPoint = repairPayload.sourceAnchor;
      const endPoint = repairPayload.targetAnchor;
      const fullPath = [...repairPayload.shaftPath, ...(repairPayload.arrowheadPath || [])];
      const pathData = fullPath.map((cmd) => `${cmd[0]} ${cmd.slice(1).map((n) => typeof n === 'number' ? Number(n.toFixed(2)) : n).join(' ')}`).join(' ');
      repairPayload.startPoint = startPoint;
      repairPayload.endPoint = endPoint;
      repairPayload.pathCommands = fullPath;
      repairPayload.pathData = pathData;

      const candACompleteGeom = {
        candidateNodeBounds: [bSrc, bTgt],
        candidateLabelBounds: [],
        candidateConnectorGeometry: [{
          connId: conn.id,
          srcId,
          tgtId,
          startPoint,
          endPoint,
          path: pathData
        }],
        candidateCompleteBounds: {
          x: Math.min(bSrc.x, bTgt.x, startPoint.x, endPoint.x),
          y: Math.min(bSrc.y, bTgt.y, startPoint.y, endPoint.y),
          width: Math.max(bSrc.x + bSrc.width, bTgt.x + bTgt.width, startPoint.x, endPoint.x) - Math.min(bSrc.x, bTgt.x, startPoint.x, endPoint.x),
          height: Math.max(bSrc.y + bSrc.height, bTgt.y + bTgt.height, startPoint.y, endPoint.y) - Math.min(bSrc.y, bTgt.y, startPoint.y, endPoint.y),
          cx: (bSrc.cx + bTgt.cx) / 2,
          cy: (bSrc.cy + bTgt.cy) / 2
        }
      };

      const candACollision = evaluateCompleteGeometryCollisions({
        completeGeometry: candACompleteGeom,
        nonMemberObjects: otherObjects,
        currentCompleteGeometry
      });

      const candAGeoComparison = {
        nodeDisplacements: { [srcId]: 0, [tgtId]: 0 },
        totalNodeDisplacement: 0,
        maxNodeDisplacement: 0,
        connectorDisplacements: { [conn.id]: repairPayload.pathChanged ? 20 : 0 },
        maxConnectorDisplacement: repairPayload.pathChanged ? 20 : 0,
        hasNodeGeometryChange: false,
        hasConnectorGeometryChange: repairPayload.pathChanged,
        hasMeaningfulVisualChange: repairPayload.pathChanged
      };

      const candABenefit = repairPayload.pathChanged ? 3.0 : 0.0;
      const candAMovementCost = 0.5;
      const candARisk = 0.2;

      candA = {
        template: 'repair_connector_only',
        actionType: 'repairConnector',
        orientation,
        levelAssignment: { [srcId]: 0, [tgtId]: 1 },
        orderedNodeIds: [srcId, tgtId],
        verifiedEdges: compEdges,
        quality: 9.5,
        currentQuality: currentQualityMetrics.quality,
        currentGeometry: { nodes: currentNodes, connectors: currentConnectors },
        candidateGeometry: {
          nodes: currentNodes,
          connectors: [{
            connId: conn.id,
            srcId,
            tgtId,
            startPoint,
            endPoint,
            path: pathData
          }]
        },
        geoComparison: candAGeoComparison,
        compositionBenefit: Number(candABenefit.toFixed(2)),
        movementCost: candAMovementCost,
        risk: candARisk,
        confidence: association.associationConfidence,
        reason: `Repaired detached connector '${conn.id}' attaching '${srcId}' to '${tgtId}'.`,
        connectorRepairs: [repairPayload],
        candidateCompleteBounds: candACompleteGeom.candidateCompleteBounds,
        candidateNodeBounds: candACompleteGeom.candidateNodeBounds,
        candidateLabelBounds: candACompleteGeom.candidateLabelBounds,
        candidateConnectorGeometry: candACompleteGeom.candidateConnectorGeometry,
        protectedCollisionCount: candACollision.protectedCollisionCount,
        protectedCollisionArea: candACollision.protectedCollisionArea,
        minimumProtectedGap: candACollision.minimumProtectedGap,
        candidateIntersectsProtectedObject: candACollision.candidateIntersectsProtectedObject,
        currentProtectedCollisions: candACollision.currentProtectedCollisions,
        candidateProtectedCollisions: candACollision.candidateProtectedCollisions,
        newProtectedCollisions: candACollision.newProtectedCollisions,
        resolvedProtectedCollisions: candACollision.resolvedProtectedCollisions,
        collidedObjectIds: candACollision.collidedObjectIds,
        collisionObjectIds: candACollision.collidedObjectIds,
        safe: candACollision.safe,
        rejectionReason: candACollision.safe ? null : 'protectedObjectCollision'
      };
    }

    const compObjects = [srcObj, tgtObj];
    const compLevelMap = new Map([[srcId, 0], [tgtId, 1]]);
    const candBFlowResult = findSafeFlowCandidateGeometry({
      compObjects,
      compLevelMap,
      orientation,
      compEdges,
      nonMemberObjects: otherObjects,
      ownership,
      objectMap,
      currentCompleteGeometry
    });

    const candBGeometry = candBFlowResult.candidateGeometry;
    const candBCompleteGeom = candBFlowResult.completeGeometry;
    const candBCollision = candBFlowResult.collisionResult;
    const candBSafe = candBCollision.safe;

    const candBGeoComparison = compareCompositionsGeometry({
      currentNodes,
      candidateNodes: candBGeometry.nodes,
      currentConnectors,
      candidateConnectors: candBGeometry.connectors
    });

    const candidateObjects = compObjects.map((orig) => {
      const candNode = candBGeometry.nodes.find((n) => n.id === orig.id);
      if (!candNode) return orig;
      return {
        ...orig,
        position: { x: candNode.x, y: candNode.y },
        left: candNode.x,
        top: candNode.y,
        bounds: {
          x: candNode.x,
          y: candNode.y,
          width: candNode.width,
          height: candNode.height
        }
      };
    });
    const candObjectMap = new Map(candidateObjects.map((o) => [o.id, o]));

    const candBQualityMetrics = evaluateCompositionQuality({
      objects: candidateObjects,
      objectMap: candObjectMap,
      explicitEdges: compEdges,
      structureType: STRUCTURE_TYPES.FLOW,
      orientation,
      levelAssignment: { [srcId]: 0, [tgtId]: 1 },
      connectorAttachmentData: candBGeometry.connectors.map((c) => ({
        connId: c.connId,
        sourceShapeId: c.srcId,
        targetShapeId: c.tgtId,
        sourceAnchor: c.startPoint,
        targetAnchor: c.endPoint,
        topologyConfidence: association.associationConfidence
      }))
    });

    const candBBenefit = Math.max(0, candBQualityMetrics.quality - currentQualityMetrics.quality);
    const candBMovementCost = calculateMovementCost({
      objectCount: 2,
      currentQuality: currentQualityMetrics.quality,
      candidateQuality: candBQualityMetrics.quality
    });
    const candBRisk = 0.5;

    const candB = {
      template: primaryTemplate,
      actionType: 'cleanFlowchart',
      orientation,
      levelAssignment: { [srcId]: 0, [tgtId]: 1 },
      orderedNodeIds: [srcId, tgtId],
      verifiedEdges: compEdges,
      quality: candBQualityMetrics.quality,
      currentQuality: currentQualityMetrics.quality,
      currentGeometry: { nodes: currentNodes, connectors: currentConnectors },
      candidateGeometry: candBGeometry,
      geoComparison: candBGeoComparison,
      compositionBenefit: Number(candBBenefit.toFixed(2)),
      movementCost: candBMovementCost,
      risk: candBRisk,
      confidence: association.associationConfidence,
      reason: `Reorganized detached flow structure between '${srcId}' and '${tgtId}' into aligned ${orientation} flow.`,
      candidateCompleteBounds: candBCompleteGeom.candidateCompleteBounds,
      candidateNodeBounds: candBCompleteGeom.candidateNodeBounds,
      candidateLabelBounds: candBCompleteGeom.candidateLabelBounds,
      candidateConnectorGeometry: candBCompleteGeom.candidateConnectorGeometry,
      protectedCollisionCount: candBCollision.protectedCollisionCount,
      protectedCollisionArea: candBCollision.protectedCollisionArea,
      minimumProtectedGap: candBCollision.minimumProtectedGap,
      candidateIntersectsProtectedObject: candBCollision.candidateIntersectsProtectedObject,
      currentProtectedCollisions: candBCollision.currentProtectedCollisions,
      candidateProtectedCollisions: candBCollision.candidateProtectedCollisions,
      newProtectedCollisions: candBCollision.newProtectedCollisions,
      resolvedProtectedCollisions: candBCollision.resolvedProtectedCollisions,
      collidedObjectIds: candBCollision.collidedObjectIds,
      collisionObjectIds: candBCollision.collidedObjectIds,
      safe: candBSafe,
      rejectionReason: candBSafe ? null : 'protectedObjectCollision',
      safeRegion: candBFlowResult.safeRegion
    };

    const candidates = [];
    if (candB) candidates.push(candB);
    if (candA) candidates.push(candA);

    candidates.sort((c1, c2) => {
      if (c1.safe && !c2.safe) return -1;
      if (!c1.safe && c2.safe) return 1;
      const u1 = (c1.compositionBenefit || 0) * (c1.confidence || 0.9) - (c1.movementCost || 0) - (c1.risk || 1);
      const u2 = (c2.compositionBenefit || 0) * (c2.confidence || 0.9) - (c2.movementCost || 0) - (c2.risk || 1);
      return u2 - u1;
    });

    claimedObjectIds.add(srcId);
    claimedObjectIds.add(tgtId);
    claimedObjectIds.add(conn.id);
    claimedConnectorIds.add(conn.id);

    const winningCand = candidates[0] || candB;
    const structureId = `struct_detached_flow_${conn.id}`;

    structures.push({
      id: structureId,
      type: STRUCTURE_TYPES.FLOW,
      provenance: 'detached-flow-intent',
      objectIds: [srcId, tgtId],
      nodeIds: [srcId, tgtId],
      memberIds: [srcId, tgtId],
      connectorIds: [conn.id],
      orientation,
      template: winningCand.template,
      levelAssignment: { [srcId]: 0, [tgtId]: 1 },
      orderedNodeIds: [srcId, tgtId],
      verifiedEdges: compEdges,
      confidence: association.associationConfidence,
      evidence: ['detached-flow-intent', ...association.evidence],
      detachedFlowAssociation: association,
      currentComposition: currentQualityMetrics,
      candidateCompositions: candidates,
      compositionBenefit: winningCand.compositionBenefit,
      movementCost: winningCand.movementCost,
      risk: winningCand.risk,
      safe: winningCand.safe,
      reason: winningCand.reason
    });
  });


  unknownConnectors.filter((cId) => !claimedConnectorIds.has(cId)).forEach((cId) => {
    claimedObjectIds.add(cId);
    claimedConnectorIds.add(cId);
    structures.push({
      id: `struct_unknown_conn_${cId}`,
      type: STRUCTURE_TYPES.STANDALONE,
      objectIds: [cId],
      connectorIds: [cId],
      confidence: 0.95,
      evidence: ['unattached-connector-no-topology'],
      currentComposition: {
        quality: 3.0,
        readability: 3.0,
        connectorAttachment: 1.5,
        connectorAttachmentDetails: [{
          connectorId: cId,
          sourceShapeId: null,
          targetShapeId: null,
          topologyConfidence: 0.0,
          sourceAttachmentError: 100,
          targetAttachmentError: 100,
          connectorAttachmentScore: 1.5,
          visuallyAttached: false
        }]
      },
      candidateCompositions: [{ template: TEMPLATE_TYPES.PRESERVE, quality: 3.0 }],
      compositionBenefit: 0.0,
      movementCost: 0.0,
      risk: 3.5,
      reason: `Connector '${cId}' has ambiguous or missing endpoints; preserved without topology invention.`
    });
  });


  const notesGroups = (semanticScene?.groups || []).filter((g) => {
    const isUnassigned = (g.id && g.id.includes('unassigned')) || (g.purpose && g.purpose.toLowerCase().includes('unassigned'));
    return !isUnassigned && g.type === 'notes' && Array.isArray(g.objectIds) && g.objectIds.length >= 2;
  });


  const unclaimedNotes = rawObjects.filter((o) => {
    if (claimedObjectIds.has(o.id)) return false;
    const sem = getSemanticType(o);
    return sem === 'note' || o.isStickyNote === true || o.metadata?.isStickyNote === true;
  });

  if (unclaimedNotes.length >= 2) {

    const noteClusters = [];
    const noteVisited = new Set();

    unclaimedNotes.forEach((noteA) => {
      if (noteVisited.has(noteA.id)) return;
      const bA = getObjectBounds(noteA);
      const cluster = [noteA.id];
      noteVisited.add(noteA.id);

      unclaimedNotes.forEach((noteB) => {
        if (noteVisited.has(noteB.id)) return;
        const bB = getObjectBounds(noteB);
        const dist = Math.hypot(bA.cx - bB.cx, bA.cy - bB.cy);
        if (dist <= 350) {
          cluster.push(noteB.id);
          noteVisited.add(noteB.id);
        }
      });

      if (cluster.length >= 2) {
        noteClusters.push(cluster);
      }
    });

    noteClusters.forEach((clusterIds) => {
      const clusterObjects = clusterIds.map((id) => objectMap.get(id)).filter(Boolean);
      const currentQuality = evaluateCompositionQuality({
        objects: clusterObjects,
        objectMap,
        structureType: STRUCTURE_TYPES.CLUSTER
      });

      const candidateQuality = 9.2;
      const benefit = Math.max(0, candidateQuality - currentQuality.quality);
      const movementCost = calculateMovementCost({
        objectCount: clusterIds.length,
        currentQuality: currentQuality.quality,
        candidateQuality
      });

      const risk = 0.8;
      const structId = `struct_cluster_${sortStrings(clusterIds)[0]}`;

      clusterIds.forEach((id) => claimedObjectIds.add(id));

      structures.push({
        id: structId,
        type: STRUCTURE_TYPES.CLUSTER,
        objectIds: sortStrings(clusterIds),
        connectorIds: [],
        confidence: 0.92,
        evidence: ['sticky-note-semantic-role', 'spatial-proximity-clustering'],
        currentComposition: currentQuality,
        candidateCompositions: [
          {
            template: TEMPLATE_TYPES.CLUSTER_GRID,
            quality: candidateQuality,
            compositionBenefit: Number(benefit.toFixed(2)),
            movementCost,
            risk,
            reason: `Cluster of ${clusterIds.length} notes arranged into a compact, scannable grid.`
          }
        ],
        compositionBenefit: Number(benefit.toFixed(2)),
        movementCost,
        risk,
        reason: benefit >= 1.5
          ? `Cluster of ${clusterIds.length} sticky notes has disorganized layout (${currentQuality.quality}/10); compact grid arrangement restores scannability.`
          : `Cluster of ${clusterIds.length} sticky notes is already well-placed (${currentQuality.quality}/10); preserved.`
      });
    });
  }


  const conceptGroups = (semanticScene?.groups || []).filter((g) => {
    const isUnassigned = (g.id && g.id.includes('unassigned')) || (g.purpose && g.purpose.toLowerCase().includes('unassigned'));
    return !isUnassigned && ['concept', 'diagram'].includes(g.type) && Array.isArray(g.objectIds) && g.objectIds.length >= 2;
  });

  conceptGroups.forEach((g) => {
    const unclaimedInGroup = g.objectIds.filter((id) => !claimedObjectIds.has(id) && objectMap.has(id) && !ownership.attachedTextIds?.has(id) && !ownership.ownerByText?.has(id));
    if (unclaimedInGroup.length >= 2) {
      const items = unclaimedInGroup.map((id) => objectMap.get(id));
      const bounds = items.map((o) => getObjectBounds(o));

      const cxVals = bounds.map((b) => b.cx);
      const cyVals = bounds.map((b) => b.cy);
      const deltaX = Math.max(...cxVals) - Math.min(...cxVals);
      const deltaY = Math.max(...cyVals) - Math.min(...cyVals);

      const orientation = deltaY > deltaX * 1.2 ? 'vertical' : 'horizontal';
      const template = orientation === 'horizontal' ? TEMPLATE_TYPES.SEQUENCE_ROW : TEMPLATE_TYPES.SEQUENCE_COLUMN;

      const currentQuality = evaluateCompositionQuality({
        objects: items,
        objectMap,
        structureType: STRUCTURE_TYPES.SEQUENCE,
        orientation
      });

      const candidateQuality = 9.3;
      const benefit = Math.max(0, candidateQuality - currentQuality.quality);
      const movementCost = calculateMovementCost({
        objectCount: unclaimedInGroup.length,
        currentQuality: currentQuality.quality,
        candidateQuality
      });

      const risk = 0.7;
      const structId = `struct_seq_${g.id}`;

      unclaimedInGroup.forEach((id) => claimedObjectIds.add(id));

      structures.push({
        id: structId,
        type: STRUCTURE_TYPES.SEQUENCE,
        objectIds: sortStrings(unclaimedInGroup),
        connectorIds: [],
        confidence: 0.94,
        evidence: ['semantic-group-membership', 'repeated-card-sequence'],
        currentComposition: currentQuality,
        candidateCompositions: [
          {
            template,
            quality: candidateQuality,
            compositionBenefit: Number(benefit.toFixed(2)),
            movementCost,
            risk,
            reason: `Sequence of ${unclaimedInGroup.length} items aligned with consistent cadence.`
          }
        ],
        compositionBenefit: Number(benefit.toFixed(2)),
        movementCost,
        risk,
        reason: benefit >= 1.5
          ? `Sequence of ${unclaimedInGroup.length} objects has inconsistent alignment or spacing (${currentQuality.quality}/10); aligning establishes clean visual rhythm.`
          : `Sequence of ${unclaimedInGroup.length} objects is already clean (${currentQuality.quality}/10); preserved.`
      });
    }
  });


  const annotations = (semanticScene?.annotations || []).filter((ann) => {
    return ann.objectId && Array.isArray(ann.targetObjectIds) && ann.targetObjectIds.length > 0;
  });

  annotations.forEach((ann) => {
    if (!claimedObjectIds.has(ann.objectId)) {
      const parentId = ann.targetObjectIds.find((id) => objectMap.has(id));
      if (parentId) {
        claimedObjectIds.add(ann.objectId);
        structures.push({
          id: `struct_annotation_${ann.objectId}`,
          type: STRUCTURE_TYPES.ANNOTATION,
          objectIds: [ann.objectId],
          connectorIds: [],
          confidence: 0.92,
          evidence: ['semantic-annotation-relationship'],
          currentComposition: { quality: 8.5, readability: 8.5 },
          candidateCompositions: [
            {
              template: TEMPLATE_TYPES.ANNOTATION_CALLOUT,
              quality: 9.0,
              compositionBenefit: 0.5,
              movementCost: 0.5,
              risk: 0.5,
              reason: `Annotation callout '${ann.objectId}' linked to parent '${parentId}'.`
            }
          ],
          compositionBenefit: 0.5,
          movementCost: 0.5,
          risk: 0.5,
          reason: `Annotation callout '${ann.objectId}' associated with '${parentId}'; preserved near parent.`
        });
      }
    }
  });


  rawObjects.forEach((obj) => {
    if (claimedObjectIds.has(obj.id)) return;
    const sem = getSemanticType(obj);


    const parent = ownership.ownerByText.get(obj.id);
    if (parent && claimedObjectIds.has(parent)) {
      return;
    }

    structures.push({
      id: `struct_standalone_${obj.id}`,
      type: STRUCTURE_TYPES.STANDALONE,
      objectIds: [obj.id],
      connectorIds: [],
      confidence: 0.95,
      evidence: ['isolated-canvas-element'],
      currentComposition: { quality: 10, readability: 10 },
      candidateCompositions: [{ template: TEMPLATE_TYPES.PRESERVE, quality: 10 }],
      compositionBenefit: 0.0,
      movementCost: 0.0,
      risk: 0.0,
      reason: `Object '${obj.id}' (${sem}) has insufficient structural evidence; preserved untouched in place.`
    });
  });

  return structures;
};


export const generateCompositionCandidates = (visualStructures, options = {}) => {
  const candidates = [];
  const minStructureConfidence = options.minStructureConfidence ?? 0.90;
  const minCandidateConfidence = options.minCandidateConfidence ?? 0.88;
  const minCompositionBenefit = options.minCompositionBenefit ?? 1.5;
  const maxRisk = options.maxRisk ?? 2.0;

  visualStructures.forEach((struct) => {

    if (![STRUCTURE_TYPES.FLOW, STRUCTURE_TYPES.SEQUENCE, STRUCTURE_TYPES.CLUSTER, STRUCTURE_TYPES.ANNOTATION].includes(struct.type)) {
      return;
    }

    if (struct.confidence < minStructureConfidence) {
      return;
    }

    const availableCandidates = (struct.candidateCompositions || []).slice(0, 3);

    availableCandidates.forEach((cand, idx) => {
      const benefit = cand.compositionBenefit ?? struct.compositionBenefit ?? 0;
      const candConfidence = cand.confidence ?? struct.confidence;
      const candCost = cand.movementCost ?? struct.movementCost ?? 1.0;
      const candRisk = cand.risk ?? struct.risk ?? 1.0;


      if (
        candConfidence >= minCandidateConfidence &&
        benefit >= minCompositionBenefit &&
        candRisk <= maxRisk
      ) {
        const utility = Number((benefit * candConfidence - candCost - candRisk).toFixed(3));

        candidates.push({
          id: `cand_${struct.id}_${idx + 1}`,
          structureId: struct.id,
          type: struct.type,
          template: cand.template || struct.template,
          orientation: cand.orientation || struct.orientation,
          levelAssignment: cand.levelAssignment || struct.levelAssignment,
          orderedNodeIds: cand.orderedNodeIds || struct.orderedNodeIds,
          verifiedEdges: cand.verifiedEdges || struct.verifiedEdges,
          memberIds: struct.memberIds || struct.objectIds,
          objectIds: cand.orderedNodeIds || [...struct.objectIds],
          connectorIds: struct.connectorIds ? [...struct.connectorIds] : [],
          confidence: candConfidence,
          quality: cand.quality,
          currentQuality: cand.currentQuality ?? struct.currentComposition?.quality,
          currentGeometry: cand.currentGeometry || struct.currentGeometry,
          candidateGeometry: cand.candidateGeometry,
          geoComparison: cand.geoComparison,
          compositionBenefit: Number(benefit.toFixed(2)),
          movementCost: candCost,
          risk: candRisk,
          utilityScore: utility,
          reason: cand.reason || struct.reason,
          evidence: [...(struct.evidence || []), `template:${cand.template}`],


          candidateCompleteBounds: cand.candidateCompleteBounds || null,
          candidateNodeBounds: cand.candidateNodeBounds || [],
          candidateLabelBounds: cand.candidateLabelBounds || [],
          candidateConnectorGeometry: cand.candidateConnectorGeometry || [],
          protectedCollisionCount: cand.protectedCollisionCount ?? 0,
          protectedCollisionArea: cand.protectedCollisionArea ?? 0,
          minimumProtectedGap: cand.minimumProtectedGap ?? Infinity,
          candidateIntersectsProtectedObject: cand.candidateIntersectsProtectedObject ?? false,
          currentProtectedCollisions: cand.currentProtectedCollisions ?? 0,
          candidateProtectedCollisions: cand.candidateProtectedCollisions ?? 0,
          newProtectedCollisions: cand.newProtectedCollisions ?? 0,
          resolvedProtectedCollisions: cand.resolvedProtectedCollisions ?? 0,
          collidedObjectIds: cand.collidedObjectIds || cand.collisionObjectIds || [],
          collisionObjectIds: cand.collisionObjectIds || cand.collidedObjectIds || [],
          safe: cand.safe ?? (cand.newProtectedCollisions === 0 && cand.candidateProtectedCollisions === 0),
          rejectionReason: cand.rejectionReason || (cand.safe === false ? 'protectedObjectCollision' : null),
          safeRegion: cand.safeRegion || null,
          connectorRepairs: cand.connectorRepairs || struct.connectorRepairs || []
        });
      }
    });
  });

  return candidates;
};

export default {
  STRUCTURE_TYPES,
  TEMPLATE_TYPES,
  evaluateCompositionQuality,
  extractSemanticShaftEndpoints,
  computeFlowCandidateGeometry,
  findSafeFlowCandidateGeometry,
  buildCompleteCandidateGeometry,
  evaluateCompleteGeometryCollisions,
  evaluateTextSafety,
  compareCompositionsGeometry,
  calculateMovementCost,
  calculateCompositionRisk,
  discoverVisualStructures,
  generateCompositionCandidates
};
