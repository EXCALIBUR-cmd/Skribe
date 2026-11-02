import assert from 'node:assert/strict';
import test from 'node:test';
import { GRID_SIZE, getGridBackground, snapPoint } from './canvasGrid.js';

const firstDot = (viewportTransform) => {
  const { backgroundSize, backgroundPosition } = getGridBackground(viewportTransform);
  const size = parseFloat(backgroundSize);
  const [left, top] = backgroundPosition.split(' ').map(parseFloat);
  return { size, x: left + size / 2, y: top + size / 2 };
};

const onGrid = (value) => Math.abs(value - Math.round(value)) < 1e-9;

const toScreen = ([zoom, , , , x, y], point) => ({ x: point.x * zoom + x, y: point.y * zoom + y });

test('snapping rounds world points to the nearest grid intersection', () => {
  assert.deepEqual(snapPoint({ x: 0, y: 0 }), { x: 0, y: 0 });
  assert.deepEqual(snapPoint({ x: 11.9, y: 12.1 }), { x: 0, y: GRID_SIZE });
  assert.deepEqual(snapPoint({ x: -13, y: -11 }), { x: -GRID_SIZE, y: 0 });
  assert.deepEqual(snapPoint({ x: 1210.4, y: 535 }), { x: 1200, y: 528 });
  const once = snapPoint({ x: 333.3, y: -77.7 });
  assert.deepEqual(snapPoint(once), once);
});

test('the visible grid dots sit on the snap points at any pan and zoom', () => {
  for (const vpt of [[1, 0, 0, 1, 0, 0], [1, 0, 0, 1, -137, 58], [2.5, 0, 0, 2.5, 410, -96], [0.8, 0, 0, 0.8, -200, -100]]) {
    const dot = firstDot(vpt);
    const snapped = toScreen(vpt, snapPoint({ x: 72.4, y: -47 }));
    assert.ok(onGrid((snapped.x - dot.x) / dot.size), `x aligned for ${vpt}`);
    assert.ok(onGrid((snapped.y - dot.y) / dot.size), `y aligned for ${vpt}`);
    assert.equal(dot.size, GRID_SIZE * vpt[0]);
  }
});

test('the grid scales with zoom but never packs dots closer than 12 px', () => {
  assert.equal(firstDot([1, 0, 0, 1, 0, 0]).size, 24);
  assert.equal(firstDot([3, 0, 0, 3, 0, 0]).size, 72);
  assert.equal(firstDot([0.5, 0, 0, 0.5, 0, 0]).size, 12);
  assert.equal(firstDot([0.2, 0, 0, 0.2, 0, 0]).size, 19.200000000000003);
  const sparse = firstDot([0.2, 0, 0, 0.2, 33, 21]);
  const origin = toScreen([0.2, 0, 0, 0.2, 33, 21], { x: 0, y: 0 });
  assert.ok(onGrid((origin.x - sparse.x) / sparse.size));
});
