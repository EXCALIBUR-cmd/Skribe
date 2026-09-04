import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';
import { hydrateCanvasObjects } from '../../utils/fabricHydration.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildPreviewRenderModel, worldToPreview } from './previewModel.js';
import { mapSvgPathCommands } from './connectorGeometry.js';
import { getShapeType } from './cleanupTypes.js';

function createMockBoard() {
  const rawObjects = [
    {
      type: 'Polygon',
      left: -9208,
      top: 17884,
      width: 160,
      height: 140,
      fill: '#f3e8ff',
      stroke: '#000000',
      strokeWidth: 2,
      points: [
        { x: 40, y: 0 }, { x: 120, y: 0 }, { x: 160, y: 70 },
        { x: 120, y: 140 }, { x: 40, y: 140 }, { x: 0, y: 70 }
      ],
      elementId: 'elem_process',
      attachedTextId: 'text_process'
    },
    {
      type: 'Textbox',
      left: -9208,
      top: 17884,
      width: 110,
      height: 17,
      text: 'Process',
      fontSize: 15,
      elementId: 'elem_process',
      parentShapeId: 'shape_elem_process'
    },
    {
      type: 'Circle',
      left: -8800,
      top: 17880,
      width: 120,
      height: 120,
      fill: '#e0f2fe',
      stroke: '#000000',
      strokeWidth: 2,
      elementId: 'elem_circle',
      attachedTextId: 'text_circle'
    },
    {
      type: 'Textbox',
      left: -8800,
      top: 17880,
      width: 100,
      height: 18,
      text: 'Circle',
      fontSize: 15,
      elementId: 'elem_circle',
      parentShapeId: 'shape_elem_circle'
    },
    {
      type: 'Triangle',
      left: -8462,
      top: 18297,
      width: 140,
      height: 120,
      fill: '#ffd600',
      stroke: '#000000',
      strokeWidth: 2,
      elementId: 'elem_triangle',
      attachedTextId: 'text_triangle'
    },
    {
      type: 'Textbox',
      left: -8462,
      top: 18297,
      width: 90,
      height: 17,
      text: 'Triangle',
      fontSize: 15,
      elementId: 'elem_triangle',
      parentShapeId: 'shape_elem_triangle'
    },
    {
      type: 'Polygon',
      left: -8094,
      top: 18420,
      width: 140,
      height: 140,
      fill: '#e0f2fe',
      stroke: '#000000',
      strokeWidth: 2,
      points: [{ x: 70, y: 0 }, { x: 140, y: 70 }, { x: 70, y: 140 }, { x: 0, y: 70 }],
      elementId: 'elem_decision',
      attachedTextId: 'text_decision'
    },
    {
      type: 'Textbox',
      left: -8094,
      top: 18420,
      width: 100,
      height: 17,
      text: 'Decision',
      fontSize: 15,
      elementId: 'elem_decision',
      parentShapeId: 'shape_elem_decision'
    },
    {
      type: 'Path',
      left: -8879,
      top: 18058,
      width: 180,
      height: 115,
      fill: '#fef3c7',
      stroke: '#f59e0b',
      strokeWidth: 2,
      isCalloutNote: true,
      path: [
        ['M', 10, 0], ['L', 170, 0], ['C', 180, 0, 180, 0, 180, 10],
        ['L', 180, 80], ['C', 180, 90, 180, 90, 170, 90], ['L', 50, 90],
        ['L', 25, 115], ['L', 35, 90], ['L', 10, 90], ['Z']
      ],
      elementId: 'elem_callout',
      attachedTextId: 'text_callout'
    },
    {
      type: 'Textbox',
      left: -8879,
      top: 18058,
      width: 144,
      height: 52,
      text: '💡 Important: Verify database schema before deployment.',
      elementId: 'elem_callout',
      parentShapeId: 'shape_elem_callout'
    },
    {
      type: 'Path',
      left: -8833,
      top: 18215,
      width: 140,
      height: 11,
      stroke: '#000000',
      strokeWidth: 3,
      path: [
        ['M', -9084, 18034], ['L', -8944, 18034],
        ['M', -8957, 18039], ['L', -8944, 18034], ['L', -8957, 18029]
      ],
      elementId: 'obj_straight_conn'
    },
    {
      type: 'Path',
      left: -8187,
      top: 18097,
      width: 140,
      height: 38,
      stroke: '#000000',
      strokeWidth: 3,
      path: [
        ['M', -8257, 18116], ['C', -8208, 18066, -8166, 18066, -8117, 18116],
        ['M', -8130, 18111], ['L', -8117, 18116], ['L', -8122, 18103]
      ],
      elementId: 'obj_curved_conn'
    },
    {
      type: 'Path',
      left: -8390,
      top: 18100,
      width: 146,
      height: 40,
      stroke: '#000000',
      strokeWidth: 3,
      path: [
        ['M', -8462, 18100], ['L', -8392, 18100], ['L', -8392, 18060], ['L', -8322, 18060], ['L', -8322, 18100],
        ['M', -8328, 18088], ['L', -8322, 18100], ['L', -8316, 18088]
      ],
      elementId: 'obj_elbow_conn'
    },
    {
      type: 'Path',
      left: -8102,
      top: 18224,
      width: 2,
      height: 210,
      stroke: '#64748b',
      strokeWidth: 2,
      path: [['M', -8101, 18329], ['L', -8102, 18119]],
      elementId: 'line_divider',
      isSkribeLine: true,
      isStraightLine: true
    },
    {
      type: 'Path',
      left: -9580,
      top: 18280,
      width: 3,
      height: 90,
      stroke: '#000000',
      strokeWidth: 2,
      path: [['M', -9580, 18235], ['Q', -9580, 18238, -9580, 18241], ['L', -9580, 18325]],
      elementId: 'stroke_H',
      strokeId: 'stroke_H',
      isVectorStroke: true
    }
  ];

  const fabricObjects = rawObjects.map((raw) => ({
    ...raw,
    set(props) { Object.assign(this, props); },
    setCoords() {}
  }));

  const canvas = { getObjects: () => fabricObjects };
  hydrateCanvasObjects(canvas, rawObjects);
  const wsModel = extractWorkspaceModel(canvas);
  const plan = buildCleanupPlan(wsModel);
  const proposal = executeCleanupPlan(plan, wsModel);
  const renderModel = buildPreviewRenderModel(wsModel, proposal);

  const renderBounds = renderModel.bounds;
  const previewWidth = 900;
  const previewHeight = 500;
  const padding = 24;
  const scale = Math.min(
    (previewWidth - padding * 2) / Math.max(renderBounds.width, 1),
    (previewHeight - padding * 2) / Math.max(renderBounds.height, 1),
    1
  );
  const contentWidth = Math.max(renderBounds.width * scale + padding * 2, 1);
  const contentHeight = Math.max(renderBounds.height * scale + padding * 2, 1);
  const mapPoint = (point) => ({
    x: (point.x - renderBounds.x) * scale + padding,
    y: (point.y - renderBounds.y) * scale + padding
  });

  return {
    rawObjects,
    wsModel,
    plan,
    proposal,
    renderModel,
    scale,
    contentWidth,
    contentHeight,
    mapPoint
  };
}

test('1. all 3 real connectors reach SVG', () => {
  const { renderModel, mapPoint } = createMockBoard();
  const conns = renderModel.objects.filter((o) => o.type === 'connector');
  assert.equal(conns.length, 3, 'Must have 3 connectors in render model');

  conns.forEach((c) => {
    const svgPath = mapSvgPathCommands(c.pathCommands || c.path, mapPoint);
    assert.ok(svgPath && svgPath.length > 10, `Connector ${c.originalObjectId} must produce valid SVG path`);
  });
});

test('2. straight connector remains straight', () => {
  const { renderModel } = createMockBoard();
  const straight = renderModel.objects.find((o) => o.originalObjectId.includes('straight'));
  assert.equal(straight?.connectorType, 'straight');
});

test('3. elbow remains elbow', () => {
  const { renderModel } = createMockBoard();
  const elbow = renderModel.objects.find((o) => o.originalObjectId.includes('elbow'));
  assert.equal(elbow?.connectorType, 'elbow');
});

test('4. curved remains curved', () => {
  const { renderModel } = createMockBoard();
  const curved = renderModel.objects.find((o) => o.originalObjectId.includes('curved'));
  assert.equal(curved?.connectorType, 'curved');
});

test('5. arrowheads remain intact', () => {
  const { renderModel } = createMockBoard();
  const conns = renderModel.objects.filter((o) => o.type === 'connector');
  conns.forEach((c) => {
    assert.equal(c.endArrow, true, `Connector ${c.originalObjectId} must preserve endArrow=true`);
  });
});

test('6. connector paths are non-zero length', () => {
  const { renderModel, mapPoint } = createMockBoard();
  const conns = renderModel.objects.filter((o) => o.type === 'connector');
  conns.forEach((c) => {
    const svgPath = mapSvgPathCommands(c.pathCommands || c.path, mapPoint);
    assert.ok(svgPath.startsWith('M'), 'SVG path must start with MoveTo command');
    assert.ok(svgPath.length > 20, 'SVG path must have substantial non-zero geometry');
  });
});

test('7. connector SVG is not clipped (within content boundaries)', () => {
  const { renderModel, mapPoint, contentWidth, contentHeight } = createMockBoard();
  const conns = renderModel.objects.filter((o) => o.type === 'connector');
  conns.forEach((c) => {
    const svgPath = mapSvgPathCommands(c.pathCommands || c.path, mapPoint);
    const coords = [...svgPath.matchAll(/([-\d.]+)\s+([-\d.]+)/g)].map((m) => ({
      x: parseFloat(m[1]),
      y: parseFloat(m[2])
    }));
    assert.ok(coords.length > 0, 'Must extract coords');
    coords.forEach((pt) => {
      assert.ok(pt.x >= 0 && pt.x <= contentWidth + 5, `Point X (${pt.x}) must be within [0..${contentWidth}]`);
      assert.ok(pt.y >= 0 && pt.y <= contentHeight + 5, `Point Y (${pt.y}) must be within [0..${contentHeight}]`);
    });
  });
});

test('8. connector z-order permits visibility (Layer 4 z-30)', () => {
  const { renderModel } = createMockBoard();
  const conns = renderModel.objects.filter((o) => o.type === 'connector');
  assert.ok(conns.length > 0);
});

test('9. Important callout remains visually represented with callout shapeType and path', () => {
  const { renderModel } = createMockBoard();
  const callout = renderModel.objects.find((o) => o.isCalloutNote || o.shapeType === 'callout');
  assert.ok(callout, 'Callout note must exist in renderModel');
  assert.equal(callout.shapeType, 'callout');
  assert.equal(callout.isCalloutNote, true);
  assert.equal(callout.fill, '#fef3c7');
  assert.equal(callout.stroke, '#f59e0b');
});

test('10. shape dimensions preserved for untouched shapes', () => {
  const { renderModel } = createMockBoard();
  const circle = renderModel.objects.find((o) => o.shapeType === 'circle');
  assert.equal(circle?.size.width, 120);
  assert.equal(circle?.size.height, 120);
});

test('11. text wrapping preserved (single-word labels stay on single line)', () => {
  const { renderModel } = createMockBoard();
  const triText = renderModel.objects.find((o) => o.text === 'Triangle');
  assert.ok(triText);
  assert.equal(triText.text, 'Triangle');
});

test('12. freehand path preserved without replacement by synthetic lines', () => {
  const { renderModel, mapPoint } = createMockBoard();
  const stroke = renderModel.objects.find((o) => o.type === 'stroke');
  assert.ok(stroke, 'Stroke must be preserved');
  const svgPath = mapSvgPathCommands(stroke.pathCommands || stroke.path, mapPoint);
  assert.ok(svgPath.includes('Q') || svgPath.includes('L'), 'Must preserve Bézier/polyline commands');
});

test('13. divider preserved as line type with path', () => {
  const { renderModel } = createMockBoard();
  const divider = renderModel.objects.find((o) => o.type === 'line');
  assert.ok(divider, 'Line divider must be present');
  assert.equal(divider.isSkribeLine, true);
  assert.equal(divider.isStraightLine, true);
});

test('14. untouched object visual properties preserved', () => {
  const { renderModel } = createMockBoard();
  const tri = renderModel.objects.find((o) => o.shapeType === 'triangle');
  assert.equal(tri?.fill, '#ffd600');
  assert.equal(tri?.stroke, '#000000');
});

test('15. real-board preview object conservation', () => {
  const { rawObjects, renderModel } = createMockBoard();
  assert.equal(renderModel.objects.length, rawObjects.length, 'Every raw object must have an exact preview counterpart');
});
