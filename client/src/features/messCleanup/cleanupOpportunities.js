
import { getSemanticType } from './cleanupTypes.js';
import { buildVisualObjectModel, resolveContainerOwnership } from './visualUnits.js';
import { recoverConnectorTopology } from './connectorTopology.js';

export const OPPORTUNITY_TYPES = Object.freeze({
  OVERLAP: 'overlap',
  BROKEN_FLOW: 'brokenFlow',
  CONNECTOR_CROSSING: 'connectorCrossing',
  MISALIGNMENT: 'misalignment',
  UNEVEN_SPACING: 'unevenSpacing',
  DETACHED_TEXT: 'detachedText',
  CLUTTERED_CLUSTER: 'clutteredCluster',
  EXCESSIVE_WHITESPACE: 'excessiveWhitespace',
  COSMETIC_TEXT_ISSUE: 'cosmeticTextIssue',
  ISOLATED_OUTLIER: 'isolatedOutlier'
});

export const OPPORTUNITY_PRIORITY = Object.freeze({
  overlap: 1,
  brokenFlow: 2,
  connectorCrossing: 3,
  clutteredCluster: 4,
  misalignment: 5,
  unevenSpacing: 6,
  detachedText: 7,
  excessiveWhitespace: 8,
  cosmeticTextIssue: 9,
  isolatedOutlier: 10
});

const sortStrings = (arr) => [...(arr || [])].sort((a, b) => String(a).localeCompare(String(b)));

export const getObjectBounds = (obj) => {
  if (!obj) return { x: 0, y: 0, width: 0, height: 0, cx: 0, cy: 0 };
  const b = obj.bounds || {
    x: obj.position?.x ?? obj.left ?? 0,
    y: obj.position?.y ?? obj.top ?? 0,
    width: (obj.size?.width ?? obj.width ?? 100) * (obj.scale?.x ?? obj.scaleX ?? 1),
    height: (obj.size?.height ?? obj.height ?? 80) * (obj.scale?.y ?? obj.scaleY ?? 1)
  };
  return {
    x: b.x,
    y: b.y,
    width: Math.max(1, b.width),
    height: Math.max(1, b.height),
    cx: b.x + b.width / 2,
    cy: b.y + b.height / 2
  };
};

export const isBoxContained = (boxA, boxB, threshold = 0.75) => {
  const xOverlap = Math.max(0, Math.min(boxA.x + boxA.width, boxB.x + boxB.width) - Math.max(boxA.x, boxB.x));
  const yOverlap = Math.max(0, Math.min(boxA.y + boxA.height, boxB.y + boxB.height) - Math.max(boxA.y, boxB.y));
  const overlapArea = xOverlap * yOverlap;
  const areaB = boxB.width * boxB.height;
  return areaB > 0 ? (overlapArea / areaB) >= threshold : false;
};

const ccw = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);

export const segmentsIntersect = (p1, p2, p3, p4) => {
  if (!p1 || !p2 || !p3 || !p4) return false;
  const EPSILON = 8;
  if (Math.hypot(p1.x - p3.x, p1.y - p3.y) < EPSILON ||
      Math.hypot(p1.x - p4.x, p1.y - p4.y) < EPSILON ||
      Math.hypot(p2.x - p3.x, p2.y - p3.y) < EPSILON ||
      Math.hypot(p2.x - p4.x, p2.y - p4.y) < EPSILON) {
    return false;
  }
  return (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
};

export const detectOverlapOpportunities = (objects, objectMap, ownership) => {
  const opportunities = [];
  const { ownedByOwner, ownerByText } = ownership;
  const nonConnectorObjects = objects.filter((o) => {
    const sem = getSemanticType(o);
    return sem !== 'connector' && sem !== 'line' && sem !== 'stroke';
  });

  for (let i = 0; i < nonConnectorObjects.length; i++) {
    for (let j = i + 1; j < nonConnectorObjects.length; j++) {
      const objA = nonConnectorObjects[i];
      const objB = nonConnectorObjects[j];

      if (ownerByText.get(objA.id) === objB.id || ownerByText.get(objB.id) === objA.id) continue;
      if (objA.relationshipMetadata?.attachedTextId === objB.id || objB.relationshipMetadata?.attachedTextId === objA.id) continue;
      if (objA.relationshipMetadata?.parentShapeId === objB.id || objB.relationshipMetadata?.parentShapeId === objA.id) continue;
      if (objA.elementId && objB.elementId && objA.elementId === objB.elementId) continue;

      const semA = getSemanticType(objA);
      const semB = getSemanticType(objB);

      const bA = getObjectBounds(objA);
      const bB = getObjectBounds(objB);

      if ((semA === 'text' && isBoxContained(bB, bA, 0.70)) || (semB === 'text' && isBoxContained(bA, bB, 0.70))) {
        continue;
      }

      const xOverlap = Math.max(0, Math.min(bA.x + bA.width, bB.x + bB.width) - Math.max(bA.x, bB.x));
      const yOverlap = Math.max(0, Math.min(bA.y + bA.height, bB.y + bB.height) - Math.max(bA.y, bB.y));
      const overlapArea = xOverlap * yOverlap;

      if (overlapArea <= 0) continue;

      const minArea = Math.min(bA.width * bA.height, bB.width * bB.height);
      const overlapRatio = minArea > 0 ? overlapArea / minArea : 0;

      if (overlapRatio > 0.05) {
        const idPair = sortStrings([objA.id, objB.id]);
        opportunities.push({
          id: `opp_overlap_${idPair.join('_')}`,
          type: OPPORTUNITY_TYPES.OVERLAP,
          objectIds: idPair,
          confidence: 0.95,
          visualBenefit: 9.0,
          movementCost: 2.5,
          risk: 1.0,
          evidence: ['bounding-box-collision', 'accidental-overlap'],
          reason: `Accidental overlap of ${Math.round(overlapRatio * 100)}% detected between '${objA.id}' and '${objB.id}'; separating them restores visual clarity.`,
          metadata: {
            overlapArea: Math.round(overlapArea),
            overlapRatio: Number(overlapRatio.toFixed(3)),
            roles: [semA, semB]
          }
        });
      }
    }
  }

  return opportunities;
};

export const detectBrokenFlowOpportunities = (objects, objectMap, semanticScene) => {
  const opportunities = [];
  const connectorObjects = objects.filter((o) => getSemanticType(o) === 'connector');
  const explicitEdges = [];

  connectorObjects.forEach((conn) => {
    const srcId = conn.sourceShapeId || conn.relationshipMetadata?.sourceShapeId || null;
    const tgtId = conn.targetShapeId || conn.relationshipMetadata?.targetShapeId || null;

    if (srcId && tgtId && objectMap.has(srcId) && objectMap.has(tgtId)) {
      const srcObj = objectMap.get(srcId);
      const tgtObj = objectMap.get(tgtId);
      const srcSem = getSemanticType(srcObj);
      const tgtSem = getSemanticType(tgtObj);

      if (srcSem === 'shape' && tgtSem === 'shape' && !srcObj.isStickyNote && !tgtObj.isStickyNote) {
        explicitEdges.push({ connId: conn.id, srcId, tgtId });
      }
    }
  });

  const adj = new Map();
  const connByPair = new Map();
  explicitEdges.forEach((e) => {
    if (!adj.has(e.srcId)) adj.set(e.srcId, new Set());
    if (!adj.has(e.tgtId)) adj.set(e.tgtId, new Set());
    adj.get(e.srcId).add(e.tgtId);
    adj.get(e.tgtId).add(e.srcId);

    const pairKey = [e.srcId, e.tgtId].sort().join('--');
    if (!connByPair.has(pairKey)) connByPair.set(pairKey, []);
    connByPair.get(pairKey).push(e.connId);
  });

  const flowchartGroups = (semanticScene?.groups || [])
    .filter((g) => g.type === 'flowchart' && Array.isArray(g.objectIds) && g.objectIds.length > 0)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  flowchartGroups.forEach((g) => {
    const groupObjectIds = g.objectIds.filter((id) => objectMap.has(id));
    const nodeIds = groupObjectIds.filter((id) => {
      const semType = getSemanticType(objectMap.get(id));
      return semType === 'shape' && !objectMap.get(id)?.isStickyNote;
    });

    if (nodeIds.length >= 2) {
      for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
          const n1 = nodeIds[i];
          const n2 = nodeIds[j];
          if (!adj.has(n1)) adj.set(n1, new Set());
          if (!adj.has(n2)) adj.set(n2, new Set());
          adj.get(n1).add(n2);
          adj.get(n2).add(n1);
        }
      }
    }
  });

  if (adj.size === 0) return opportunities;

  const visited = new Set();
  const sortedNodes = [...adj.keys()].sort((a, b) => String(a).localeCompare(String(b)));

  sortedNodes.forEach((startNode) => {
    if (visited.has(startNode)) return;
    const cluster = [];
    const q = [startNode];
    visited.add(startNode);

    while (q.length > 0) {
      const curr = q.shift();
      cluster.push(curr);
      const nbrs = adj.get(curr) || new Set();
      nbrs.forEach((nbr) => {
        if (!visited.has(nbr)) {
          visited.add(nbr);
          q.push(nbr);
        }
      });
    }

    if (cluster.length >= 2) {
      const clusterConns = new Set();
      for (let i = 0; i < cluster.length; i++) {
        for (let j = i + 1; j < cluster.length; j++) {
          const key = [cluster[i], cluster[j]].sort().join('--');
          (connByPair.get(key) || []).forEach((cId) => clusterConns.add(cId));
        }
      }

      let hasDisorder = false;
      const relevantEdges = explicitEdges.filter((e) => cluster.includes(e.srcId) && cluster.includes(e.tgtId));

      relevantEdges.forEach((e) => {
        const bSrc = getObjectBounds(objectMap.get(e.srcId));
        const bTgt = getObjectBounds(objectMap.get(e.tgtId));
        if ((bTgt.x < bSrc.x - 30 && Math.abs(bTgt.y - bSrc.y) < 100) ||
            (bTgt.y < bSrc.y - 30 && Math.abs(bTgt.x - bSrc.x) < 100)) {
          hasDisorder = true;
        }
      });

      if (cluster.length >= 2) {
        const sortedNodeIds = sortStrings(cluster);
        opportunities.push({
          id: `opp_flow_${sortedNodeIds[0]}`,
          type: OPPORTUNITY_TYPES.BROKEN_FLOW,
          objectIds: sortedNodeIds,
          connectorIds: sortStrings(Array.from(clusterConns)),
          confidence: cluster.length >= 3 ? 0.98 : 0.96,
          visualBenefit: hasDisorder ? 9.2 : 8.5,
          movementCost: 3.5,
          risk: 1.5,
          evidence: hasDisorder ? ['explicit-connector-topology', 'backward-edge-disorder'] : ['explicit-connector-topology', 'graph-structure'],
          reason: `Flowchart graph with ${cluster.length} connected nodes and ${clusterConns.size} connectors demonstrates clear topological flow; structuring levels enhances diagram legibility.`,
          metadata: { nodeCount: cluster.length, connectorCount: clusterConns.size, hasDisorder }
        });
      }
    }
  });

  return opportunities;
};

export const detectConnectorCrossingOpportunities = (objects, objectMap) => {
  const opportunities = [];
  const connectors = objects.filter((o) => getSemanticType(o) === 'connector');
  if (connectors.length < 2) return opportunities;  const getConnectorSegment = (conn) => {
    let srcId = conn.sourceShapeId || conn.relationshipMetadata?.sourceShapeId;
    let tgtId = conn.targetShapeId || conn.relationshipMetadata?.targetShapeId;

    if (srcId && tgtId && objectMap.has(srcId) && objectMap.has(tgtId)) {
      const bSrc = getObjectBounds(objectMap.get(srcId));
      const bTgt = getObjectBounds(objectMap.get(tgtId));
      return { p1: { x: bSrc.cx, y: bSrc.cy }, p2: { x: bTgt.cx, y: bTgt.cy }, srcId, tgtId };
    }

    if (conn.startPoint && conn.endPoint) {
      return { p1: { x: conn.startPoint.x, y: conn.startPoint.y }, p2: { x: conn.endPoint.x, y: conn.endPoint.y }, srcId: null, tgtId: null };
    }

    if (Array.isArray(conn.points) && conn.points.length >= 2) {
      const pFirst = conn.points[0];
      const pLast = conn.points[conn.points.length - 1];
      const ox = conn.left || conn.x || 0;
      const oy = conn.top || conn.y || 0;
      return { p1: { x: ox + pFirst.x, y: oy + pFirst.y }, p2: { x: ox + pLast.x, y: oy + pLast.y }, srcId: null, tgtId: null };
    }

    const b = getObjectBounds(conn);
    return { p1: { x: b.x, y: b.y }, p2: { x: b.x + b.width, y: b.y + b.height }, srcId: null, tgtId: null };
  };

  const segments = connectors.map((c) => ({ id: c.id, ...getConnectorSegment(c) }));

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s1 = segments[i];
      const s2 = segments[j];

      if (s1.srcId && s2.srcId && (s1.srcId === s2.srcId || s1.srcId === s2.tgtId || s1.tgtId === s2.srcId || s1.tgtId === s2.tgtId)) {
        continue;
      }

      if (segmentsIntersect(s1.p1, s1.p2, s2.p1, s2.p2)) {
        const affectedObjects = [s1.srcId, s1.tgtId, s2.srcId, s2.tgtId].filter((id) => id && objectMap.has(id));
        const idPair = sortStrings([s1.id, s2.id]);

        opportunities.push({
          id: `opp_cross_${idPair.join('_')}`,
          type: OPPORTUNITY_TYPES.CONNECTOR_CROSSING,
          objectIds: sortStrings(affectedObjects),
          connectorIds: idPair,
          confidence: 0.92,
          visualBenefit: 8.0,
          movementCost: 3.0,
          risk: 1.5,
          evidence: ['connector-segment-intersection', 'visual-crossing-clutter'],
          reason: `Connectors '${s1.id}' and '${s2.id}' cross unexpectedly in diagram plane; resolving the crossing improves graph legibility.`,
          metadata: { connectorA: s1.id, connectorB: s2.id }
        });
      }
    }
  }

  return opportunities;
};

export const detectAlignmentOpportunities = (objects, objectMap, semanticScene) => {
  const opportunities = [];
  const groups = (semanticScene?.groups || []).filter((g) => {
    const isUnassigned = (g.id && g.id.includes('unassigned')) || (g.purpose && g.purpose.toLowerCase().includes('unassigned'));
    return !isUnassigned && ['concept', 'diagram', 'notes'].includes(g.type) && Array.isArray(g.objectIds) && g.objectIds.length >= 2;
  });

  groups.forEach((g) => {
    const candidateIds = g.objectIds.filter((id) => {
      const obj = objectMap.get(id);
      if (!obj) return false;
      const sem = getSemanticType(obj);
      return (sem === 'shape' || sem === 'note') && !obj.isSkribeLine && !obj.isStraightLine;
    });

    if (candidateIds.length < 2) return;

    const bounds = candidateIds.map((id) => ({ id, ...getObjectBounds(objectMap.get(id)) }));
    const cyValues = bounds.map((b) => b.cy);
    const minCy = Math.min(...cyValues);
    const maxCy = Math.max(...cyValues);
    const deltaCy = maxCy - minCy;

    const cxValues = bounds.map((b) => b.cx);
    const minCx = Math.min(...cxValues);
    const maxCx = Math.max(...cxValues);
    const deltaCx = maxCx - minCx;

    let alignAxis = null;
    let delta = 0;

    if (deltaCy >= 2 && deltaCy <= 35 && deltaCx > deltaCy) {
      alignAxis = 'centerY';
      delta = deltaCy;
    } else if (deltaCx >= 2 && deltaCx <= 35 && deltaCy > deltaCx) {
      alignAxis = 'centerX';
      delta = deltaCx;
    }

    if (alignAxis) {
      const sortedIds = sortStrings(candidateIds);
      opportunities.push({
        id: `opp_align_${g.id}_${alignAxis}`,
        type: OPPORTUNITY_TYPES.MISALIGNMENT,
        axis: alignAxis,
        objectIds: sortedIds,
        confidence: 0.92,
        visualBenefit: 6.5,
        movementCost: 1.5,
        risk: 1.0,
        evidence: ['explicit-semantic-group', 'same-role', 'co-linear-intent'],
        reason: `${candidateIds.length} related objects in group '${g.id}' have a meaningful ${Math.round(delta)}px misalignment along ${alignAxis}; aligning them establishes a clean visual axis.`,
        metadata: { semanticGroup: g.id, delta: Math.round(delta), axis: alignAxis }
      });
    }
  });

  return opportunities;
};

export const detectSpacingOpportunities = (objects, objectMap, semanticScene) => {
  const opportunities = [];
  const groups = (semanticScene?.groups || []).filter((g) => {
    const isUnassigned = (g.id && g.id.includes('unassigned')) || (g.purpose && g.purpose.toLowerCase().includes('unassigned'));
    return !isUnassigned && ['concept', 'diagram', 'notes'].includes(g.type) && Array.isArray(g.objectIds) && g.objectIds.length >= 3;
  });

  groups.forEach((g) => {
    const candidateIds = g.objectIds.filter((id) => {
      const obj = objectMap.get(id);
      if (!obj) return false;
      const sem = getSemanticType(obj);
      return (sem === 'shape' || sem === 'note') && !obj.isSkribeLine;
    });

    if (candidateIds.length < 3) return;

    const items = candidateIds.map((id) => ({ id, ...getObjectBounds(objectMap.get(id)) }));

    const cxValues = items.map((s) => s.cx);
    const deltaCx = Math.max(...cxValues) - Math.min(...cxValues);

    if (deltaCx <= 35) {
      const sortedY = [...items].sort((a, b) => a.y - b.y);
      const gaps = [];
      let hasOverlap = false;

      for (let i = 0; i < sortedY.length - 1; i++) {
        const gap = sortedY[i + 1].y - (sortedY[i].y + sortedY[i].height);
        if (gap < 0) hasOverlap = true;
        gaps.push(gap);
      }

      if (!hasOverlap && gaps.length >= 2) {
        const minGap = Math.min(...gaps);
        const maxGap = Math.max(...gaps);
        const gapInconsistency = maxGap - minGap;

        const sortedGaps = [...gaps].sort((a, b) => a - b);
        const baselineGap = sortedGaps[0];
        const isExcessiveWhitespace = maxGap >= 120 && (maxGap >= 2.5 * Math.max(10, baselineGap));

        if (gapInconsistency >= 10) {
          const isAnomaly = isExcessiveWhitespace;
          opportunities.push({
            id: `opp_space_${g.id}_y`,
            type: isAnomaly ? OPPORTUNITY_TYPES.EXCESSIVE_WHITESPACE : OPPORTUNITY_TYPES.UNEVEN_SPACING,
            axis: 'y',
            objectIds: sortedY.map((s) => s.id),
            confidence: 0.94,
            visualBenefit: isAnomaly ? 7.8 : 6.0,
            movementCost: 2.0,
            risk: 1.0,
            evidence: isAnomaly
              ? ['explicit-semantic-group', 'co-linear', 'local-whitespace-anomaly']
              : ['explicit-semantic-group', 'co-linear', 'spacing-inconsistency'],
            reason: isAnomaly
              ? `Local whitespace anomaly in '${g.id}' where vertical gaps vary between ${Math.round(minGap)}px and ${Math.round(maxGap)}px; equalizing restores tight cadence without global compression.`
              : `${candidateIds.length} objects in '${g.id}' have inconsistent vertical gaps (${gaps.map((g) => Math.round(g) + 'px').join(', ')}); equalizing them restores rhythm.`,
            metadata: { gaps: gaps.map((g) => Math.round(g)), axis: 'y', minGap, maxGap, isAnomaly }
          });
        }
      }
    }

    const cyValues = items.map((s) => s.cy);
    const deltaCy = Math.max(...cyValues) - Math.min(...cyValues);

    if (deltaCy <= 35) {
      const sortedX = [...items].sort((a, b) => a.x - b.x);
      const gaps = [];
      let hasOverlap = false;

      for (let i = 0; i < sortedX.length - 1; i++) {
        const gap = sortedX[i + 1].x - (sortedX[i].x + sortedX[i].width);
        if (gap < 0) hasOverlap = true;
        gaps.push(gap);
      }

      if (!hasOverlap && gaps.length >= 2) {
        const minGap = Math.min(...gaps);
        const maxGap = Math.max(...gaps);
        const gapInconsistency = maxGap - minGap;

        const sortedGaps = [...gaps].sort((a, b) => a - b);
        const baselineGap = sortedGaps[0];
        const isExcessiveWhitespace = maxGap >= 120 && (maxGap >= 2.5 * Math.max(10, baselineGap));

        if (gapInconsistency >= 10) {
          const isAnomaly = isExcessiveWhitespace;
          opportunities.push({
            id: `opp_space_${g.id}_x`,
            type: isAnomaly ? OPPORTUNITY_TYPES.EXCESSIVE_WHITESPACE : OPPORTUNITY_TYPES.UNEVEN_SPACING,
            axis: 'x',
            objectIds: sortedX.map((s) => s.id),
            confidence: 0.94,
            visualBenefit: isAnomaly ? 7.8 : 6.0,
            movementCost: 2.0,
            risk: 1.0,
            evidence: isAnomaly
              ? ['explicit-semantic-group', 'co-linear', 'local-whitespace-anomaly']
              : ['explicit-semantic-group', 'co-linear', 'spacing-inconsistency'],
            reason: isAnomaly
              ? `Local whitespace anomaly in '${g.id}' where horizontal gaps vary between ${Math.round(minGap)}px and ${Math.round(maxGap)}px; equalizing restores tight cadence without global compression.`
              : `${candidateIds.length} objects in '${g.id}' have inconsistent horizontal gaps (${gaps.map((g) => Math.round(g) + 'px').join(', ')}); equalizing them restores rhythm.`,
            metadata: { gaps: gaps.map((g) => Math.round(g)), axis: 'x', minGap, maxGap, isAnomaly }
          });
        }
      }
    }
  });

  return opportunities;
};

export const detectDetachedTextOpportunities = (objects, objectMap, ownership) => {
  const opportunities = [];
  const { ownedByOwner } = ownership;

  ownedByOwner.forEach((textIds, containerId) => {
    const containerObj = objectMap.get(containerId);
    if (!containerObj) return;
    const bCont = getObjectBounds(containerObj);

    textIds.forEach((tId) => {
      const textObj = objectMap.get(tId);
      if (!textObj || getSemanticType(textObj) !== 'text') return;
      const bText = getObjectBounds(textObj);

      const relMeta = containerObj.relationshipMetadata || {};
      const textRelMeta = textObj.relationshipMetadata || {};
      const hasExplicitBinding = relMeta.attachedTextId === tId ||
                                 textRelMeta.parentShapeId === containerId ||
                                 (containerObj.elementId && textObj.elementId && containerObj.elementId === textObj.elementId);

      const dx = Math.abs(bCont.cx - bText.cx);
      const dy = Math.abs(bCont.cy - bText.cy);
      const distFromCenter = Math.hypot(dx, dy);

      const isOutsideContainer = !isBoxContained(bCont, bText, 0.70);
      const isMeaningfullyDetached = distFromCenter > 4 || isOutsideContainer || Math.abs(textObj.rotation || textObj.angle || 0) > 2;

      let confidence = 0.90;
      let evidence = ['atomic-unit-containment'];
      if (hasExplicitBinding) {
        confidence = 0.99;
        evidence = ['explicit-metadata'];
      } else if (isOutsideContainer) {
        confidence = 0.98;
        evidence = ['label-outside-container', 'broken-containment'];
      }

      opportunities.push({
        id: `opp_detach_${containerId}_${tId}`,
        type: OPPORTUNITY_TYPES.DETACHED_TEXT,
        objectIds: [containerId, tId],
        confidence,
        visualBenefit: hasExplicitBinding ? 7.0 : (isOutsideContainer ? 7.5 : 5.0),
        movementCost: 0.5,
        risk: 0.2,
        evidence,
        reason: hasExplicitBinding
          ? `Text label '${tId}' is explicitly bound to container '${containerId}' via relationship metadata; centering it inside the container ensures visual atomicity and prevents detachment.`
          : (isOutsideContainer
            ? `Label '${tId}' is detached by ${Math.round(distFromCenter)}px from container '${containerId}'; centering re-establishes atomic unit containment.`
            : `Text label '${tId}' is contained inside container '${containerId}'; attaching it preserves compound unit atomicity.`),
        metadata: { containerId, textId: tId, distFromCenter: Math.round(distFromCenter), isOutsideContainer, hasExplicitBinding }
      });
    });
  });

  return opportunities;
};

export const detectClutteredClusterOpportunities = (objects, objectMap, semanticScene) => {
  const opportunities = [];
  const notesGroups = (semanticScene?.groups || []).filter((g) => {
    const isUnassigned = (g.id && g.id.includes('unassigned')) || (g.purpose && g.purpose.toLowerCase().includes('unassigned'));
    return !isUnassigned && g.type === 'notes' && Array.isArray(g.objectIds) && g.objectIds.length >= 2;
  });

  notesGroups.forEach((g) => {
    const stickyIds = g.objectIds.filter((id) => {
      const obj = objectMap.get(id);
      return obj && (obj.isStickyNote === true || obj.metadata?.isStickyNote === true || obj.type === 'note' || getSemanticType(obj) === 'note');
    });

    if (stickyIds.length < 2) return;

    const bounds = stickyIds.map((id) => ({ id, ...getObjectBounds(objectMap.get(id)) }));
    let hasClutter = false;

    for (let i = 0; i < bounds.length; i++) {
      for (let j = i + 1; j < bounds.length; j++) {
        const bA = bounds[i];
        const bB = bounds[j];
        const xOverlap = Math.max(0, Math.min(bA.x + bA.width, bB.x + bB.width) - Math.max(bA.x, bB.x));
        const yOverlap = Math.max(0, Math.min(bA.y + bA.height, bB.y + bB.height) - Math.max(bA.y, bB.y));
        if (xOverlap > 10 && yOverlap > 10) {
          hasClutter = true;
          break;
        }
      }
      if (hasClutter) break;
    }

    const hasBrainstormPurpose = g.purpose && typeof g.purpose === 'string' && g.purpose.toLowerCase().includes('brainstorm');

    if (hasClutter || hasBrainstormPurpose) {
      const sortedIds = sortStrings(stickyIds);
      opportunities.push({
        id: `opp_cluster_${g.id}`,
        type: OPPORTUNITY_TYPES.CLUTTERED_CLUSTER,
        objectIds: sortedIds,
        confidence: 0.92,
        visualBenefit: 7.2,
        movementCost: 3.0,
        risk: 1.2,
        evidence: hasClutter ? ['overlapping-notes', 'semantic-notes-group'] : ['semantic-notes-group', 'spatial-proximity'],
        reason: `Cluster of ${stickyIds.length} notes in '${g.id}' exhibits spatial clutter; arranging in a structured grid restores scannability.`,
        metadata: { group: g.id, noteCount: stickyIds.length, hasClutter }
      });
    }
  });

  return opportunities;
};

export const detectCosmeticTextOpportunities = (objects, objectMap, ownership) => {
  const opportunities = [];

  objects.forEach((obj) => {
    if (getSemanticType(obj) !== 'text') return;

    const rotation = typeof obj.angle === 'number' ? obj.angle : (typeof obj.rotation === 'number' ? obj.rotation : 0);
    if (Math.abs(rotation) > 2) {
      opportunities.push({
        id: `opp_norm_text_${obj.id}`,
        type: OPPORTUNITY_TYPES.COSMETIC_TEXT_ISSUE,
        objectIds: [obj.id],
        confidence: 0.90,
        visualBenefit: 3.5,
        movementCost: 0.2,
        risk: 0.4,
        evidence: ['standalone-text-readability'],
        reason: `Standalone text '${obj.id}' tilted at ${Math.round(rotation)}deg normalized to horizontal reading orientation.`,
        metadata: { angle: Math.round(rotation) }
      });
    }
  });

  return opportunities;
};

export const detectIsolatedOutlierOpportunities = (objects, objectMap) => {
  const opportunities = [];
  const nonConnectors = objects.filter((o) => getSemanticType(o) !== 'connector');

  nonConnectors.forEach((obj) => {
    const b = getObjectBounds(obj);
    const isTiny = b.width <= 5 && b.height <= 5;
    const hasNoText = !obj.text || String(obj.text).trim().length === 0;

    if (isTiny && hasNoText) {
      let minDist = Infinity;
      nonConnectors.forEach((other) => {
        if (other.id === obj.id) return;
        const bOther = getObjectBounds(other);
        if (bOther.width > 5 || bOther.height > 5) {
          const dist = Math.hypot(b.cx - bOther.cx, b.cy - bOther.cy);
          if (dist < minDist) minDist = dist;
        }
      });

      if (minDist > 300) {
        opportunities.push({
          id: `opp_outlier_${obj.id}`,
          type: OPPORTUNITY_TYPES.ISOLATED_OUTLIER,
          objectIds: [obj.id],
          confidence: 0.85,
          visualBenefit: 1.0,
          movementCost: 0.0,
          risk: 2.0,
          evidence: ['sub-pixel-isolated-mark'],
          reason: `Tiny isolated mark '${obj.id}' (${Math.round(b.width)}x${Math.round(b.height)}px) identified far from content; preserved in place.`,
          metadata: { width: b.width, height: b.height, distanceToNearest: Math.round(minDist) }
        });
      }
    }
  });

  return opportunities;
};

export const detectCleanupOpportunities = (workspaceModel, semanticScene, options = {}) => {
  const rawObjects = workspaceModel?.board?.objects || workspaceModel?.objects || [];
  const objectMap = new Map(rawObjects.map((o) => [o.id, o]));

  const visualObjects = buildVisualObjectModel(workspaceModel);
  const voMap = new Map(visualObjects.map((vo) => [vo.objectId, vo]));
  const ownership = resolveContainerOwnership(visualObjects, voMap);

  const overlaps = detectOverlapOpportunities(rawObjects, objectMap, ownership);
  const brokenFlows = detectBrokenFlowOpportunities(rawObjects, objectMap, semanticScene);
  const crossings = detectConnectorCrossingOpportunities(rawObjects, objectMap);
  const alignments = detectAlignmentOpportunities(rawObjects, objectMap, semanticScene);
  const spacings = detectSpacingOpportunities(rawObjects, objectMap, semanticScene);
  const detachedTexts = detectDetachedTextOpportunities(rawObjects, objectMap, ownership);
  const clusters = detectClutteredClusterOpportunities(rawObjects, objectMap, semanticScene);
  const cosmeticTexts = detectCosmeticTextOpportunities(rawObjects, objectMap, ownership);
  const outliers = detectIsolatedOutlierOpportunities(rawObjects, objectMap);

  const allOpportunities = [
    ...overlaps,
    ...brokenFlows,
    ...crossings,
    ...alignments,
    ...spacings,
    ...detachedTexts,
    ...clusters,
    ...cosmeticTexts,
    ...outliers
  ];

  return allOpportunities;
};

export const scoreOpportunity = (opportunity) => {
  if (!opportunity) return 0;
  const benefit = (opportunity.visualBenefit || 5.0) * (opportunity.confidence || 0.9);
  const cost = (opportunity.movementCost || 1.0) + (opportunity.risk || 1.0);
  const utility = Number((benefit - cost).toFixed(3));
  return utility;
};

export const rankAndSelectOpportunities = (opportunities, options = {}) => {
  const rawOpportunities = opportunities || [];
  const objectCount = options.totalObjectCount || 20;

  const budget = {
    maxActions: options.maxActions || Math.max(5, Math.min(15, Math.ceil(objectCount * 0.75))),
    maxMovedObjects: options.maxMovedObjects || Math.max(10, Math.min(30, Math.ceil(objectCount * 0.8))),
    minUtilityThreshold: options.minUtilityThreshold ?? 1.0
  };

  const scored = rawOpportunities.map((opp) => ({
    ...opp,
    utilityScore: scoreOpportunity(opp)
  }));

  const sorted = scored.sort((a, b) => {
    const prioA = OPPORTUNITY_PRIORITY[a.type] || 99;
    const prioB = OPPORTUNITY_PRIORITY[b.type] || 99;
    if (prioA !== prioB) return prioA - prioB;
    if (b.utilityScore !== a.utilityScore) return b.utilityScore - a.utilityScore;
    return String(a.id).localeCompare(String(b.id));
  });

  const selectedOpportunities = [];
  const rejectedOpportunities = [];
  const claimedObjects = new Map();
  const claimedTypes = new Map();
  let totalMovedObjects = new Set();

  const hasStructuralMess = sorted.some((opp) =>
    opp.utilityScore >= budget.minUtilityThreshold &&
    [OPPORTUNITY_TYPES.OVERLAP, OPPORTUNITY_TYPES.BROKEN_FLOW, OPPORTUNITY_TYPES.CONNECTOR_CROSSING, OPPORTUNITY_TYPES.CLUTTERED_CLUSTER].includes(opp.type)
  );

  for (const opp of sorted) {
    const actId = opp.id.startsWith('opp_') ? opp.id.replace(/^opp_/, 'act_') : `act_${opp.id}`;

    if (opp.utilityScore < budget.minUtilityThreshold) {
      rejectedOpportunities.push({
        id: opp.id,
        actionId: actId,
        type: opp.type,
        reason: `Utility score ${opp.utilityScore} below threshold ${budget.minUtilityThreshold}`
      });
      continue;
    }

    const cosmeticCount = selectedOpportunities.filter((o) => o.type === OPPORTUNITY_TYPES.COSMETIC_TEXT_ISSUE).length;
    if (hasStructuralMess && opp.type === OPPORTUNITY_TYPES.COSMETIC_TEXT_ISSUE && cosmeticCount >= 1) {
      rejectedOpportunities.push({
        id: opp.id,
        actionId: actId,
        type: opp.type,
        reason: 'Additional cosmetic text normalization suppressed in favor of higher-value structural cleanup: subsumed by higher-priority action'
      });
      continue;
    }

    const isLayoutOpp = opp.type !== OPPORTUNITY_TYPES.DETACHED_TEXT;
    const conflictId = opp.objectIds.find((id) => {
      if (!claimedObjects.has(id)) return false;
      const prevType = claimedTypes.get(id);
      if (opp.type === OPPORTUNITY_TYPES.DETACHED_TEXT) {
        return prevType === OPPORTUNITY_TYPES.DETACHED_TEXT;
      }
      return prevType !== OPPORTUNITY_TYPES.DETACHED_TEXT;
    });

    if (conflictId) {
      const winnerId = claimedObjects.get(conflictId);
      rejectedOpportunities.push({
        id: opp.id,
        actionId: actId,
        type: opp.type,
        reason: `Object '${conflictId}' in opportunity '${opp.id}' is subsumed by higher-priority action '${winnerId}'`,
        supersededBy: winnerId
      });
      continue;
    }

    const currentLayoutCount = selectedOpportunities.filter((o) => o.type !== OPPORTUNITY_TYPES.DETACHED_TEXT).length;
    const oppObjSet = new Set(opp.objectIds || []);
    const projectedMovedCount = new Set([...totalMovedObjects, ...oppObjSet]).size;

    if (isLayoutOpp && currentLayoutCount >= budget.maxActions) {
      rejectedOpportunities.push({
        id: opp.id,
        type: opp.type,
        reason: `Budget limit reached: maxActions (${budget.maxActions})`
      });
      continue;
    }

    if (isLayoutOpp && projectedMovedCount > budget.maxMovedObjects) {
      rejectedOpportunities.push({
        id: opp.id,
        type: opp.type,
        reason: `Budget limit reached: maxMovedObjects (${budget.maxMovedObjects})`
      });
      continue;
    }

    selectedOpportunities.push(opp);
    opp.objectIds.forEach((id) => {
      claimedObjects.set(id, opp.id);
      claimedTypes.set(id, opp.type);
    });
    if (isLayoutOpp) {
      oppObjSet.forEach((id) => totalMovedObjects.add(id));
    }
  }

  const budgetReport = {
    maxActions: budget.maxActions,
    selectedActions: selectedOpportunities.length,
    maxMovedObjects: budget.maxMovedObjects,
    movedObjects: totalMovedObjects.size,
    budgetExceeded: false
  };

  return {
    selectedOpportunities,
    rejectedOpportunities,
    budgetReport
  };
};
