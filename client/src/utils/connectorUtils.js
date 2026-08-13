import * as fabric from 'fabric';


export const getNearestShapeAnchor = (shape, targetPoint) => {
  if (!shape) return { x: 0, y: 0 };

  const center = shape.getCenterPoint ? shape.getCenterPoint() : { x: shape.left || 0, y: shape.top || 0 };
  const width = (shape.width || 100) * (shape.scaleX || 1);
  const height = (shape.height || 100) * (shape.scaleY || 1);

  const halfW = width / 2;
  const halfH = height / 2;

  const anchors = [
    { x: center.x, y: center.y - halfH },
    { x: center.x + halfW, y: center.y }, 
    { x: center.x, y: center.y + halfH }, 
    { x: center.x - halfW, y: center.y } 
  ];

  if (!targetPoint) return anchors[1]; 

  let closest = anchors[0];
  let minDistance = Infinity;

  anchors.forEach((anchor) => {
    const dx = anchor.x - targetPoint.x;
    const dy = anchor.y - targetPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDistance) {
      minDistance = dist;
      closest = anchor;
    }
  });

  return closest;
};

export const generateConnectorPathData = ({
  x1,
  y1,
  x2,
  y2,
  connectorType = 'straight', 
  strokeWidth = 3,
  startArrow = false,
  endArrow = true
}) => {
  let pathStr = '';
  let endAngle = Math.atan2(y2 - y1, x2 - x1);
  let startAngle = Math.atan2(y1 - y2, x1 - x2);

  if (connectorType === 'elbow') {
    const midX = (x1 + x2) / 2;
    const isHorizontal = Math.abs(y2 - y1) < 20;

    if (isHorizontal) {
      const stepY = y1 - 40;
      pathStr = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${stepY} L ${x2} ${stepY} L ${x2} ${y2}`;
      endAngle = Math.atan2(y2 - stepY, 0);
    } else {
      pathStr = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
      endAngle = Math.atan2(0, x2 - midX);
    }
    startAngle = Math.atan2(0, x1 - midX);
  } else if (connectorType === 'curved') {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const archOffset = Math.abs(dy) < 25 ? -50 : 0;

    const cp1x = x1 + dx * 0.35;
    const cp1y = y1 + dy * 0.1 + archOffset;
    const cp2x = x1 + dx * 0.65;
    const cp2y = y2 - dy * 0.1 + archOffset;

    pathStr = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
    endAngle = Math.atan2(y2 - cp2y, x2 - cp2x);
    startAngle = Math.atan2(y1 - cp1y, x1 - cp1x);
  } else {
    pathStr = `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  const headLen = Math.max(12, strokeWidth * 4.5);
  const wingAngle = 0.42; 

  if (endArrow) {
    const leftX = x2 - headLen * Math.cos(endAngle - wingAngle);
    const leftY = y2 - headLen * Math.sin(endAngle - wingAngle);
    const rightX = x2 - headLen * Math.cos(endAngle + wingAngle);
    const rightY = y2 - headLen * Math.sin(endAngle + wingAngle);

    pathStr += ` M ${leftX} ${leftY} L ${x2} ${y2} L ${rightX} ${rightY}`;
  }

  if (startArrow) {
    const leftX = x1 - headLen * Math.cos(startAngle - wingAngle);
    const leftY = y1 - headLen * Math.sin(startAngle - wingAngle);
    const rightX = x1 - headLen * Math.cos(startAngle + wingAngle);
    const rightY = y1 - headLen * Math.sin(startAngle + wingAngle);

    pathStr += ` M ${leftX} ${leftY} L ${x1} ${y1} L ${rightX} ${rightY}`;
  }

  return pathStr;
};

export const createConnectorObject = ({
  x1,
  y1,
  x2,
  y2,
  connectorType = 'straight',
  stroke = '#1e293b',
  strokeWidth = 3,
  strokeDashArray = null,
  startArrow = false,
  endArrow = true,
  sourceShapeId = null,
  targetShapeId = null
}) => {
  console.log(`[ConnectorFactory] Selected connector type: ${connectorType}`);

  const pathData = generateConnectorPathData({
    x1,
    y1,
    x2,
    y2,
    connectorType,
    strokeWidth,
    startArrow,
    endArrow
  });

  const instantiatedClass = 'fabric.Path';
  console.log(`[ConnectorFactory] Factory function: createConnectorObject | ConnectorType: ${connectorType} | Instantiated Class: ${instantiatedClass}`);

  const connectorObj = new fabric.Path(pathData, {
    stroke,
    strokeWidth,
    fill: 'transparent',
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeDashArray,
    objectCaching: false,
    evented: true,
    selectable: true
  });

  connectorObj.isConnector = true;
  connectorObj.connectorType = connectorType;
  connectorObj.startArrow = startArrow;
  connectorObj.endArrow = endArrow;
  connectorObj.sourceShapeId = sourceShapeId;
  connectorObj.targetShapeId = targetShapeId;
  connectorObj.x1 = x1;
  connectorObj.y1 = y1;
  connectorObj.x2 = x2;
  connectorObj.y2 = y2;

  return connectorObj;
};
