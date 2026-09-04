import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObject } from './normalizeObjects.js';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildPreviewRenderModel } from './previewModel.js';

function runPipeline(rawObjects) {
  const mockCanvas = { getObjects: () => rawObjects, version: '5.3.0' };
  const wm = extractWorkspaceModel(mockCanvas);
  const plan = buildCleanupPlan(null, wm);
  const proposal = executeCleanupPlan(plan, wm);
  const renderModel = buildPreviewRenderModel(wm, proposal);
  return { wm, plan, proposal, renderModel };
}

test('1. Decision diamond dash array preserved across pipeline', () => {
  const rawDiamond = {
    id: 'diamond_1',
    type: 'Polygon',
    points: [{ x: 70, y: 0 }, { x: 140, y: 70 }, { x: 70, y: 140 }, { x: 0, y: 70 }],
    width: 140,
    height: 140,
    stroke: '#000000',
    strokeWidth: 4,
    strokeDashArray: [6, 6],
    strokeLineCap: 'butt',
    strokeLineJoin: 'miter',
    fill: '#e0f2fe'
  };

  const canonical = normalizeObject(rawDiamond);
  assert.equal(canonical.shapeType, 'diamond');
  assert.deepEqual(canonical.strokeDashArray, [6, 6]);
  assert.deepEqual(canonical.points, [{ x: 70, y: 0 }, { x: 140, y: 70 }, { x: 70, y: 140 }, { x: 0, y: 70 }]);

  const { renderModel } = runPipeline([rawDiamond]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'diamond_1');
  assert.equal(rendered.shapeType, 'diamond');
  assert.deepEqual(rendered.strokeDashArray, [6, 6]);
  assert.deepEqual(rendered.points, [{ x: 70, y: 0 }, { x: 140, y: 70 }, { x: 70, y: 140 }, { x: 0, y: 70 }]);
  assert.equal(rendered.strokeWidth, 4);
});

test('2. Rotated diamond dash pattern preserved', () => {
  const rawDiamond = {
    id: 'diamond_rot',
    type: 'Polygon',
    points: [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }],
    width: 100,
    height: 100,
    angle: 45,
    strokeDashArray: [8, 4],
    strokeWidth: 3
  };

  const { renderModel } = runPipeline([rawDiamond]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'diamond_rot');
  assert.equal(rendered.rotation, 45);
  assert.deepEqual(rendered.strokeDashArray, [8, 4]);
});

test('3. Triangle dash array preserved', () => {
  const rawTri = {
    id: 'tri_dash',
    type: 'triangle',
    width: 120,
    height: 100,
    stroke: '#000000',
    strokeWidth: 3,
    strokeDashArray: [5, 5],
    fill: '#ffd600'
  };

  const { renderModel } = runPipeline([rawTri]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'tri_dash');
  assert.equal(rendered.shapeType, 'triangle');
  assert.deepEqual(rendered.strokeDashArray, [5, 5]);
});

test('4. Hexagon dash array preserved', () => {
  const rawHex = {
    id: 'hex_dash',
    type: 'Polygon',
    points: [
      { x: 30, y: 0 }, { x: 90, y: 0 }, { x: 120, y: 50 },
      { x: 90, y: 100 }, { x: 30, y: 100 }, { x: 0, y: 50 }
    ],
    width: 120,
    height: 100,
    strokeDashArray: [10, 5],
    strokeWidth: 2,
    fill: '#f3e8ff'
  };

  const { renderModel } = runPipeline([rawHex]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'hex_dash');
  assert.equal(rendered.shapeType, 'hexagon');
  assert.deepEqual(rendered.strokeDashArray, [10, 5]);
  assert.equal(rendered.points.length, 6);
});

test('5. Custom polygon dash array preserved', () => {
  const rawPoly = {
    id: 'custom_poly',
    type: 'Polygon',
    points: [{ x: 0, y: 0 }, { x: 80, y: 20 }, { x: 60, y: 90 }, { x: 10, y: 80 }],
    width: 80,
    height: 90,
    strokeDashArray: [4, 2, 2, 2],
    strokeWidth: 2
  };

  const { renderModel } = runPipeline([rawPoly]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'custom_poly');
  assert.deepEqual(rendered.strokeDashArray, [4, 2, 2, 2]);
  assert.equal(rendered.points.length, 4);
});

test('6. Numeric dash array scaled correctly without rounding degradation', () => {
  const scale = 0.5279;
  const originalDash = [8, 4];
  const expectedScaled = originalDash.map(v => Math.round(v * scale * 1000) / 1000);
  assert.deepEqual(expectedScaled, [4.223, 2.112]);
});

test('7. Stroke width scaled correctly without rounding degradation', () => {
  const scale = 0.5279;
  const strokeWidth = 4;
  const expectedScaled = Math.max(1, strokeWidth * scale);
  assert.ok(Math.abs(expectedScaled - 2.1116) < 0.001);
});

test('8. lineCap preserved on vector shapes', () => {
  const rawDiamond = {
    id: 'dia_cap',
    type: 'Polygon',
    points: [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }],
    strokeLineCap: 'round'
  };

  const { renderModel } = runPipeline([rawDiamond]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'dia_cap');
  assert.equal(rendered.strokeLineCap, 'round');
});

test('9. lineJoin preserved on vector shapes', () => {
  const rawDiamond = {
    id: 'dia_join',
    type: 'Polygon',
    points: [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }],
    strokeLineJoin: 'bevel'
  };

  const { renderModel } = runPipeline([rawDiamond]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'dia_join');
  assert.equal(rendered.strokeLineJoin, 'bevel');
});

test('10. Fill preserved on vector shapes', () => {
  const rawDiamond = {
    id: 'dia_fill',
    type: 'Polygon',
    points: [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }],
    fill: '#e0f2fe'
  };

  const { renderModel } = runPipeline([rawDiamond]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'dia_fill');
  assert.equal(rendered.fill, '#e0f2fe');
});

test('11. Solid stroke remains solid (dashArray null/empty)', () => {
  const rawDiamond = {
    id: 'dia_solid',
    type: 'Polygon',
    points: [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }],
    strokeDashArray: null
  };

  const { renderModel } = runPipeline([rawDiamond]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'dia_solid');
  assert.equal(rendered.strokeDashArray, null);
});

test('12. Dashed stroke remains dashed with original array', () => {
  const rawDiamond = {
    id: 'dia_dashed',
    type: 'Polygon',
    points: [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }],
    strokeDashArray: [12, 6]
  };

  const { renderModel } = runPipeline([rawDiamond]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'dia_dashed');
  assert.deepEqual(rendered.strokeDashArray, [12, 6]);
});

test('13. Dotted/custom numeric stroke remains numerically identical after scale transform', () => {
  const rawDiamond = {
    id: 'dia_dots',
    type: 'Polygon',
    points: [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }],
    strokeDashArray: [2, 4]
  };

  const { renderModel } = runPipeline([rawDiamond]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'dia_dots');
  assert.deepEqual(rendered.strokeDashArray, [2, 4]);

  const scale = 0.5;
  const scaledStr = rendered.strokeDashArray.map(v => v * scale).join(' ');
  assert.equal(scaledStr, '1 2');
});

test('14. Source geometry unchanged by dash array or vector rendering', () => {
  const rawDiamond = {
    id: 'dia_geom',
    type: 'Polygon',
    points: [{ x: 70, y: 0 }, { x: 140, y: 70 }, { x: 70, y: 140 }, { x: 0, y: 70 }],
    width: 140,
    height: 140,
    strokeDashArray: [6, 6]
  };

  const { proposal } = runPipeline([rawDiamond]);
  const placement = proposal.placements.find(p => p.objectId === 'dia_geom');
  assert.equal(placement.size.width, 140);
  assert.equal(placement.size.height, 140);
  assert.deepEqual(placement.points, [{ x: 70, y: 0 }, { x: 140, y: 70 }, { x: 70, y: 140 }, { x: 0, y: 70 }]);
});

test('15. Real-board Decision diamond regression check with strokeDashArray [6, 6]', () => {
  const rawDiamond = {
    id: 'shape_elem_1788435035924_d771y',
    type: 'Polygon',
    originX: 'center',
    originY: 'center',
    left: 970,
    top: 237,
    width: 140,
    height: 140,
    fill: '#e0f2fe',
    stroke: '#000000',
    strokeWidth: 4,
    strokeDashArray: [6, 6],
    strokeLineCap: 'butt',
    strokeLineJoin: 'miter',
    points: [{ x: 70, y: 0 }, { x: 140, y: 70 }, { x: 70, y: 140 }, { x: 0, y: 70 }]
  };

  const { proposal, renderModel } = runPipeline([rawDiamond]);
  const p = proposal.placements.find(pl => pl.objectId === rawDiamond.id);
  assert.equal(p.strokeWidth, 4);
  assert.deepEqual(p.strokeDashArray, [6, 6]);

  const r = renderModel.objects.find(ro => ro.originalObjectId === rawDiamond.id);
  assert.equal(r.shapeType, 'diamond');
  assert.equal(r.strokeWidth, 4);
  assert.deepEqual(r.strokeDashArray, [6, 6]);
  assert.deepEqual(r.points, [{ x: 70, y: 0 }, { x: 140, y: 70 }, { x: 70, y: 140 }, { x: 0, y: 70 }]);
  assert.equal(r.fill, '#e0f2fe');
  assert.equal(r.stroke, '#000000');
});
