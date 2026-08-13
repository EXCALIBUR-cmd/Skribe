import * as fabric from 'fabric';

export const smoothStrokePoints = (points = []) => {
  if (!points || points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.1} ${p.y + 0.1}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let pathStr = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    pathStr += ` Q ${p0.x} ${p0.y} ${midX} ${midY}`;
  }

  const lastPoint = points[points.length - 1];
  pathStr += ` L ${lastPoint.x} ${lastPoint.y}`;

  return pathStr;
};

export const renderVectorStroke = (vectorStrokeData) => {
  const {
    points = [],
    color = '#000000',
    width = 3,
    opacity = 1,
    style = 'solid'
  } = vectorStrokeData || {};

  const pathData = smoothStrokePoints(points);
  if (!pathData) return null;

  const strokeDashArray =
    style === 'dashed' ? [6, 6] : style === 'dotted' ? [2, 4] : null;

  const strokePath = new fabric.Path(pathData, {
    stroke: color,
    strokeWidth: width,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeDashArray,
    fill: '',
    opacity,
    selectable: true,
    evented: true,
    objectCaching: false
  });

  strokePath.id = vectorStrokeData.id || 'stroke_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  strokePath.isVectorStroke = true;
  strokePath.vectorStrokeData = {
    ...vectorStrokeData,
    id: strokePath.id
  };

  return strokePath;
};

export const createVectorStrokeData = ({
  points = [],
  color = '#000000',
  width = 3,
  opacity = 1,
  style = 'solid'
}) => {
  return {
    id: 'stroke_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    type: 'stroke',
    points,
    color,
    width,
    opacity,
    style,
    createdAt: Date.now()
  };
};
