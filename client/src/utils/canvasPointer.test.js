import assert from 'node:assert/strict';
import test from 'node:test';
import * as fabric from 'fabric';
import { MAX_POINTER_JUMP, isPointerJump, scenePointOf, withoutPointerJumps } from './canvasPointer.js';

const CANVAS_LEFT = 0;
const CANVAS_TOP = 64;
const makeCanvas = (viewportTransform = [1, 0, 0, 1, 0, 0]) => ({
  upperCanvasEl: { width: 1280, height: 736, getBoundingClientRect: () => ({ left: CANVAS_LEFT, top: CANVAS_TOP, right: 1280, bottom: 800, width: 1280, height: 736 }) },
  _offset: { left: CANVAS_LEFT, top: CANVAS_TOP },
  calcOffset() {},
  getRetinaScaling: () => 1,
  viewportTransform,
  _getPointerImpl: fabric.Canvas.prototype._getPointerImpl,
  getScenePoint: fabric.Canvas.prototype.getScenePoint,
  getViewportPoint: fabric.Canvas.prototype.getViewportPoint
});
const canvasTarget = { tagName: 'CANVAS' };
const dockButton = { tagName: 'BUTTON' };
const onCanvas = (clientX, clientY) => ({ e: { clientX, clientY, offsetX: clientX - CANVAS_LEFT, offsetY: clientY - CANVAS_TOP, target: canvasTarget } });
const onDock = (clientX, clientY) => ({ e: { clientX, clientY, offsetX: 12, offsetY: 20, target: dockButton } });
const viewportOf = (canvas, point) => fabric.util.transformPoint(point, canvas.viewportTransform);
const oldConversion = (canvas, opt) => fabric.util.transformPoint(new fabric.Point(opt.e.offsetX, opt.e.offsetY), fabric.util.invertTransform(canvas.viewportTransform));

const drawStroke = (canvas, events) => {
  let points = [];
  events.forEach((opt, index) => {
    const point = scenePointOf(canvas, opt);
    if (index === 0) points = [point];
    else if (!isPointerJump(canvas, points[points.length - 1], point)) points.push(point);
  });
  return withoutPointerJumps(canvas, points);
};

const strokeEndingOnDock = [onCanvas(560, 600), onCanvas(580, 640), onCanvas(600, 680), onCanvas(615, 720), onDock(630, 740), onDock(640, 752)];

for (const [label, vpt] of [['at 100% zoom', [1, 0, 0, 1, 0, 0]], ['panned and zoomed to 150%', [1.5, 0, 0, 1.5, -240, -130]]]) {
  test(`a pen stroke that ends over the dock has no point near the origin and no jump (${label})`, () => {
    const canvas = makeCanvas(vpt);
    assert.ok(viewportOf(canvas, oldConversion(canvas, strokeEndingOnDock[5])).x < 20, 'the old offsetX conversion no longer reproduces the bug');
    const points = drawStroke(canvas, strokeEndingOnDock);
    assert.equal(points.length, strokeEndingOnDock.length);
    points.forEach((point, index) => {
      const screen = viewportOf(canvas, point);
      assert.ok(screen.x > 100 && screen.y > 100, `point ${index} is near the viewport origin: ${JSON.stringify(screen)}`);
      if (index > 0) assert.ok(!isPointerJump(canvas, points[index - 1], point), `point ${index} jumps more than ${MAX_POINTER_JUMP}px`);
    });
    const last = viewportOf(canvas, points[points.length - 1]);
    assert.ok(Math.abs(last.x - 640) < 0.001 && Math.abs(last.y - (752 - CANVAS_TOP)) < 0.001, `the stroke does not end at the real pointer: ${JSON.stringify(last)}`);
  });

  test(`a line drawn onto the dock ends at the real pointer (${label})`, () => {
    const canvas = makeCanvas(vpt);
    const end = scenePointOf(canvas, onDock(900, 760));
    const screen = viewportOf(canvas, end);
    assert.ok(Math.abs(screen.x - 900) < 0.001 && Math.abs(screen.y - (760 - CANVAS_TOP)) < 0.001, JSON.stringify(screen));
    const start = scenePointOf(canvas, onCanvas(500, 400));
    assert.ok(Math.hypot(end.x - start.x, end.y - start.y) > 100);
  });
}

test('Fabric event scene points are used when present, and the guard drops a bogus far point', () => {
  const canvas = makeCanvas([1.5, 0, 0, 1.5, -240, -130]);
  const given = new fabric.Point(7, 9);
  assert.equal(scenePointOf(canvas, { scenePoint: given, e: onDock(0, 0).e }), given);
  const near = scenePointOf(canvas, onCanvas(600, 600));
  const bogus = new fabric.Point(0, 0);
  assert.equal(isPointerJump(canvas, near, bogus), true);
  assert.deepEqual(withoutPointerJumps(canvas, [near, bogus, scenePointOf(canvas, onCanvas(610, 605))]).length, 2);
});
