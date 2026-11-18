import * as fabric from 'fabric';

export const MAX_POINTER_JUMP = 400;

export const scenePointOf = (canvas, opt) => opt?.scenePoint || canvas.getScenePoint(opt?.e || opt);

export const isPointerJump = (canvas, from, to) => {
  if (!from || !to) return false;
  const vpt = canvas.viewportTransform;
  const a = fabric.util.transformPoint(from, vpt);
  const b = fabric.util.transformPoint(to, vpt);
  return Math.hypot(a.x - b.x, a.y - b.y) > MAX_POINTER_JUMP;
};

export const withoutPointerJumps = (canvas, points) => points.reduce((kept, point) => {
  if (!isPointerJump(canvas, kept[kept.length - 1], point)) kept.push(point);
  return kept;
}, []);
