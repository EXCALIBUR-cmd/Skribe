
import { generateConnectorPathData } from '../../utils/connectorUtils.js';

export const parseConnectorPath = (pathInput) => {
  let commands = [];
  if (Array.isArray(pathInput)) {
    commands = pathInput.map((cmd) => [...cmd]);
  } else if (typeof pathInput === 'string') {
    const regex = /([MLCQZmlcqz])\s*([^MLCQZmlcqz]*)/g;
    let match;
    while ((match = regex.exec(pathInput)) !== null) {
      const type = match[1];
      const numbers = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
      commands.push([type, ...numbers]);
    }
  }

  if (commands.length === 0) return null;

  const mIndices = [];
  commands.forEach((cmd, idx) => {
    if (cmd[0] === 'M' || cmd[0] === 'm') mIndices.push(idx);
  });

  const mainStartIndex = mIndices.length > 0 ? mIndices[0] : 0;
  const mainEndIndex = mIndices.length > 1 ? mIndices[1] : commands.length;
  const mainCommands = commands.slice(mainStartIndex, mainEndIndex);

  let startPt = { x: 0, y: 0 };
  let endPt = { x: 0, y: 0 };

  if (mainCommands.length > 0) {
    const first = mainCommands[0];
    if (first.length >= 3) {
      startPt = { x: Number(first[1]), y: Number(first[2]) };
    }
    const last = mainCommands[mainCommands.length - 1];
    if (last.length >= 3) {
      endPt = { x: Number(last[last.length - 2]), y: Number(last[last.length - 1]) };
    }
  }

  return {
    allCommands: commands,
    mainCommands,
    startPt,
    endPt,
    hasArrowhead: mIndices.length > 1
  };
};

export const transformConnectorGeometry = ({
  originalObject,
  connectorType = 'straight',
  newStart,
  newEnd,
  laneOffset = 0,
  translationDelta = null,
  startArrow = false,
  endArrow = true,
  strokeWidth = 3
}) => {
  const origPath = originalObject?.path || originalObject?.connector?.path;
  const parsed = origPath ? parseConnectorPath(origPath) : null;

  if (translationDelta && (!newStart || !newEnd)) {
    const dx = translationDelta.dx || 0;
    const dy = translationDelta.dy || 0;

    if (parsed) {
      const translatedCommands =
        dx !== 0 || dy !== 0
          ? translatePathCommands(parsed.allCommands, dx, dy)
          : parsed.allCommands;
      const pathStr = commandsToSvgString(translatedCommands);
      return {
        pathCommands: translatedCommands,
        pathStr,
        start: {
          x: parsed.startPt.x + dx,
          y: parsed.startPt.y + dy
        },
        end: {
          x: parsed.endPt.x + dx,
          y: parsed.endPt.y + dy
        },
        connectorType
      };
    }
  }

  let x1 = newStart ? newStart.x : 0;
  let y1 = newStart ? newStart.y : 0;
  let x2 = newEnd ? newEnd.x : 0;
  let y2 = newEnd ? newEnd.y : 0;

  if (laneOffset !== 0 && connectorType === 'straight') {
    const isHoriz = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    if (isHoriz) {
      y1 += laneOffset * 0.5;
      y2 += laneOffset * 0.5;
    } else {
      x1 += laneOffset * 0.5;
      x2 += laneOffset * 0.5;
    }
  }

  if (parsed && parsed.mainCommands.length > 0) {
    const origStart = parsed.startPt;
    const origEnd = parsed.endPt;
    const origDx = origEnd.x - origStart.x;
    const origDy = origEnd.y - origStart.y;
    const newDx = x2 - x1;
    const newDy = y2 - y1;

    if (connectorType === 'curved' && parsed.mainCommands.some((c) => c[0] === 'C' || c[0] === 'c')) {
      const cCmd = parsed.mainCommands.find((c) => c[0] === 'C' || c[0] === 'c');
      if (cCmd && cCmd.length >= 7) {
        const origCp1 = { x: Number(cCmd[1]), y: Number(cCmd[2]) };
        const origCp2 = { x: Number(cCmd[3]), y: Number(cCmd[4]) };

        const origLenSq = origDx * origDx + origDy * origDy;
        const origLen = Math.max(1, Math.sqrt(origLenSq));

        const cp1Proj = ((origCp1.x - origStart.x) * origDx + (origCp1.y - origStart.y) * origDy) / origLenSq;
        const cp1Perp = ((origCp1.y - origStart.y) * origDx - (origCp1.x - origStart.x) * origDy) / origLen;

        const cp2Proj = ((origCp2.x - origStart.x) * origDx + (origCp2.y - origStart.y) * origDy) / origLenSq;
        const cp2Perp = ((origCp2.y - origStart.y) * origDx - (origCp2.x - origStart.x) * origDy) / origLen;

        const newLen = Math.max(1, Math.sqrt(newDx * newDx + newDy * newDy));
        const newUx = newDx / newLen;
        const newUy = newDy / newLen;
        const newVx = -newUy;
        const newVy = newUx;

        const t1 = Number.isFinite(cp1Proj) ? cp1Proj : 0.35;
        const t2 = Number.isFinite(cp2Proj) ? cp2Proj : 0.65;
        let h1 = Number.isFinite(cp1Perp) && Math.abs(cp1Perp) > 5 ? cp1Perp : -Math.max(30, newLen * 0.25);
        let h2 = Number.isFinite(cp2Perp) && Math.abs(cp2Perp) > 5 ? cp2Perp : -Math.max(30, newLen * 0.25);

        if (laneOffset !== 0) {
          h1 += laneOffset;
          h2 += laneOffset;
        }

        const newCp1 = {
          x: x1 + t1 * newDx + h1 * newVx,
          y: y1 + t1 * newDy + h1 * newVy
        };
        const newCp2 = {
          x: x1 + t2 * newDx + h2 * newVx,
          y: y1 + t2 * newDy + h2 * newVy
        };

        const mainCmds = [
          ['M', x1, y1],
          ['C', newCp1.x, newCp1.y, newCp2.x, newCp2.y, x2, y2]
        ];

        const pathStr = appendArrowheads(commandsToSvgString(mainCmds), {
          startPt: { x: x1, y: y1 },
          endPt: { x: x2, y: y2 },
          startTangent: { x: newCp1.x - x1, y: newCp1.y - y1 },
          endTangent: { x: x2 - newCp2.x, y: y2 - newCp2.y },
          startArrow,
          endArrow,
          strokeWidth
        });

        return {
          pathCommands: mainCmds,
          pathStr,
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          connectorType: 'curved'
        };
      }
    }

    if (connectorType === 'elbow') {
      const isHorizontal = Math.abs(newDy) < 20;
      const midX = (x1 + x2) / 2;

      let newPoints = [];
      if (isHorizontal) {
        let stepOffset = laneOffset !== 0 ? laneOffset : -40;
        if (laneOffset === 0 && parsed.mainCommands.length >= 4) {
          const yVals = parsed.mainCommands.map((c) => Number(c[2])).filter(Number.isFinite);
          const minY = Math.min(...yVals);
          if (origStart.y - minY > 10) {
            stepOffset = -(origStart.y - minY);
          }
        }
        const stepY = y1 + stepOffset;
        newPoints = [
          { x: x1, y: y1 },
          { x: midX, y: y1 },
          { x: midX, y: stepY },
          { x: x2, y: stepY },
          { x: x2, y: y2 }
        ];
      } else {
        const stepOffset = laneOffset !== 0 ? laneOffset : 0;
        newPoints = [
          { x: x1, y: y1 },
          { x: midX + stepOffset, y: y1 },
          { x: midX + stepOffset, y: y2 },
          { x: x2, y: y2 }
        ];
      }

      const mainCmds = newPoints.map((pt, idx) => [idx === 0 ? 'M' : 'L', pt.x, pt.y]);
      const lastIdx = newPoints.length - 1;
      const endTan = {
        x: newPoints[lastIdx].x - newPoints[lastIdx - 1].x,
        y: newPoints[lastIdx].y - newPoints[lastIdx - 1].y
      };
      const startTan = {
        x: newPoints[1].x - newPoints[0].x,
        y: newPoints[1].y - newPoints[0].y
      };

      const pathStr = appendArrowheads(commandsToSvgString(mainCmds), {
        startPt: { x: x1, y: y1 },
        endPt: { x: x2, y: y2 },
        startTangent: startTan,
        endTangent: endTan,
        startArrow,
        endArrow,
        strokeWidth
      });

      return {
        pathCommands: mainCmds,
        pathStr,
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        connectorType: 'elbow'
      };
    }
  }

  const pathStr = generateConnectorPathData({
    x1,
    y1,
    x2,
    y2,
    connectorType,
    strokeWidth,
    startArrow,
    endArrow
  });

  return {
    pathCommands: parseConnectorPath(pathStr)?.allCommands || [],
    pathStr,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    connectorType
  };
};

const commandsToSvgString = (commands) => {
  return commands.map((cmd) => `${cmd[0]} ${cmd.slice(1).map((n) => typeof n === 'number' ? Number(n.toFixed(2)) : n).join(' ')}`).join(' ');
};

const appendArrowheads = (basePathStr, {
  startPt,
  endPt,
  startTangent = { x: 1, y: 0 },
  endTangent = { x: 1, y: 0 },
  startArrow = false,
  endArrow = true,
  strokeWidth = 3
}) => {
  let pathStr = basePathStr;
  const headLen = Math.max(12, strokeWidth * 4.5);
  const wingAngle = 0.42;

  if (endArrow) {
    const endAngle = Math.atan2(endTangent.y, endTangent.x);
    const leftX = endPt.x - headLen * Math.cos(endAngle - wingAngle);
    const leftY = endPt.y - headLen * Math.sin(endAngle - wingAngle);
    const rightX = endPt.x - headLen * Math.cos(endAngle + wingAngle);
    const rightY = endPt.y - headLen * Math.sin(endAngle + wingAngle);

    pathStr += ` M ${leftX.toFixed(2)} ${leftY.toFixed(2)} L ${endPt.x.toFixed(2)} ${endPt.y.toFixed(2)} L ${rightX.toFixed(2)} ${rightY.toFixed(2)}`;
  }

  if (startArrow) {
    const startAngle = Math.atan2(-startTangent.y, -startTangent.x);
    const leftX = startPt.x - headLen * Math.cos(startAngle - wingAngle);
    const leftY = startPt.y - headLen * Math.sin(startAngle - wingAngle);
    const rightX = startPt.x - headLen * Math.cos(startAngle + wingAngle);
    const rightY = startPt.y - headLen * Math.sin(startAngle + wingAngle);

    pathStr += ` M ${leftX.toFixed(2)} ${leftY.toFixed(2)} L ${startPt.x.toFixed(2)} ${startPt.y.toFixed(2)} L ${rightX.toFixed(2)} ${rightY.toFixed(2)}`;
  }

  return pathStr;
};

export const translatePathCommands = (pathInput, dx = 0, dy = 0) => {
  let commands = [];
  if (Array.isArray(pathInput)) {
    commands = pathInput.map((cmd) => [...cmd]);
  } else if (typeof pathInput === 'string') {
    commands = parseConnectorPath(pathInput)?.allCommands || [];
  }
  if (commands.length === 0 || (dx === 0 && dy === 0)) return commands;

  return commands.map((cmd) => {
    const type = cmd[0];
    const copy = [...cmd];
    if (type === 'M' || type === 'm' || type === 'L' || type === 'l') {
      copy[1] = Number(copy[1]) + dx;
      copy[2] = Number(copy[2]) + dy;
    } else if (type === 'C' || type === 'c') {
      copy[1] = Number(copy[1]) + dx;
      copy[2] = Number(copy[2]) + dy;
      copy[3] = Number(copy[3]) + dx;
      copy[4] = Number(copy[4]) + dy;
      copy[5] = Number(copy[5]) + dx;
      copy[6] = Number(copy[6]) + dy;
    } else if (type === 'Q' || type === 'q') {
      copy[1] = Number(copy[1]) + dx;
      copy[2] = Number(copy[2]) + dy;
      copy[3] = Number(copy[3]) + dx;
      copy[4] = Number(copy[4]) + dy;
    }
    return copy;
  });
};

export const mapSvgPathCommands = (pathCommandsOrStr, mapPoint, delta = null) => {
  let commands = [];
  if (Array.isArray(pathCommandsOrStr)) {
    commands = pathCommandsOrStr;
  } else if (typeof pathCommandsOrStr === 'string') {
    const parsed = parseConnectorPath(pathCommandsOrStr);
    commands = parsed?.allCommands || [];
  }

  if (commands.length === 0) return '';

  if (delta && (delta.dx !== 0 || delta.dy !== 0)) {
    commands = translatePathCommands(commands, delta.dx, delta.dy);
  }

  return commands.map((cmd) => {
    const type = cmd[0];
    if (type === 'M' || type === 'm' || type === 'L' || type === 'l') {
      const p = mapPoint({ x: Number(cmd[1]), y: Number(cmd[2]) });
      return `${type.toUpperCase()} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    }
    if (type === 'C' || type === 'c') {
      const cp1 = mapPoint({ x: Number(cmd[1]), y: Number(cmd[2]) });
      const cp2 = mapPoint({ x: Number(cmd[3]), y: Number(cmd[4]) });
      const end = mapPoint({ x: Number(cmd[5]), y: Number(cmd[6]) });
      return `C ${cp1.x.toFixed(2)} ${cp1.y.toFixed(2)}, ${cp2.x.toFixed(2)} ${cp2.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
    }
    if (type === 'Q' || type === 'q') {
      const cp = mapPoint({ x: Number(cmd[1]), y: Number(cmd[2]) });
      const end = mapPoint({ x: Number(cmd[3]), y: Number(cmd[4]) });
      return `Q ${cp.x.toFixed(2)} ${cp.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
    }
    if (type === 'Z' || type === 'z') {
      return 'Z';
    }
    return '';
  }).filter(Boolean).join(' ');
};

export default transformConnectorGeometry;
