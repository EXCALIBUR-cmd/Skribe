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

test('TEST 1: strokeWidth preserved across all pipeline stages', () => {
  const rawObj = {
    id: 'shape_thick',
    type: 'rect',
    left: 100,
    top: 100,
    width: 150,
    height: 100,
    stroke: '#000000',
    strokeWidth: 8,
    fill: '#ffffff'
  };

  const canonical = normalizeObject(rawObj);
  assert.equal(canonical.strokeWidth, 8, 'Canonical strokeWidth must match source');
  assert.equal(canonical.visual.strokeWidth, 8, 'Canonical visual.strokeWidth must match source');

  const { proposal, renderModel } = runPipeline([rawObj]);
  const placement = proposal.placements.find(p => p.objectId === 'shape_thick');
  assert.equal(placement.strokeWidth, 8, 'Proposal placement must preserve strokeWidth');

  const rendered = renderModel.objects.find(o => o.originalObjectId === 'shape_thick');
  assert.equal(rendered.strokeWidth, 8, 'Render model must preserve strokeWidth');
});

test('TEST 2: strokeDashArray preserved across all pipeline stages', () => {
  const rawObj = {
    id: 'shape_dashed',
    type: 'rect',
    left: 100,
    top: 100,
    width: 150,
    height: 100,
    stroke: '#3b82f6',
    strokeWidth: 3,
    strokeDashArray: [10, 5],
    fill: '#ffffff'
  };

  const canonical = normalizeObject(rawObj);
  assert.deepEqual(canonical.strokeDashArray, [10, 5], 'Canonical strokeDashArray must match');
  assert.deepEqual(canonical.visual.strokeDashArray, [10, 5], 'Canonical visual.strokeDashArray must match');

  const { proposal, renderModel } = runPipeline([rawObj]);
  const placement = proposal.placements.find(p => p.objectId === 'shape_dashed');
  assert.deepEqual(placement.strokeDashArray, [10, 5], 'Proposal placement must preserve strokeDashArray');

  const rendered = renderModel.objects.find(o => o.originalObjectId === 'shape_dashed');
  assert.deepEqual(rendered.strokeDashArray, [10, 5], 'Render model must preserve strokeDashArray');
});

test('TEST 3: solid stroke preserved (strokeDashArray null/empty)', () => {
  const rawObj = {
    id: 'shape_solid',
    type: 'rect',
    left: 50,
    top: 50,
    width: 100,
    height: 100,
    stroke: '#10b981',
    strokeWidth: 2,
    strokeDashArray: null,
    fill: '#f0fdf4'
  };

  const { renderModel } = runPipeline([rawObj]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'shape_solid');
  assert.equal(rendered.strokeDashArray, null, 'Solid stroke must remain null');
  assert.equal(rendered.stroke, '#10b981', 'Stroke color preserved');
});

test('TEST 4: dashed stroke preserved', () => {
  const rawObj = {
    id: 'shape_dash',
    type: 'circle',
    left: 50,
    top: 50,
    width: 100,
    height: 100,
    stroke: '#ef4444',
    strokeWidth: 4,
    strokeDashArray: [8, 4],
    fill: 'transparent'
  };

  const { renderModel } = runPipeline([rawObj]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'shape_dash');
  assert.deepEqual(rendered.strokeDashArray, [8, 4]);
  assert.equal(rendered.strokeWidth, 4);
});

test('TEST 5: dotted stroke preserved', () => {
  const rawObj = {
    id: 'shape_dotted',
    type: 'rect',
    left: 50,
    top: 50,
    width: 100,
    height: 100,
    stroke: '#8b5cf6',
    strokeWidth: 2,
    strokeDashArray: [2, 2],
    fill: '#ffffff'
  };

  const { renderModel } = runPipeline([rawObj]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'shape_dotted');
  assert.deepEqual(rendered.strokeDashArray, [2, 2]);
});

test('TEST 6: stroke color preserved without degradation', () => {
  const rawObj = {
    id: 'shape_color',
    type: 'rect',
    left: 50,
    top: 50,
    width: 100,
    height: 100,
    stroke: '#f59e0b',
    strokeWidth: 3,
    fill: '#fef3c7'
  };

  const { renderModel } = runPipeline([rawObj]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'shape_color');
  assert.equal(rendered.stroke, '#f59e0b');
});

test('TEST 7: fill preserved without degradation', () => {
  const rawObj = {
    id: 'shape_fill',
    type: 'rect',
    left: 50,
    top: 50,
    width: 100,
    height: 100,
    stroke: '#000000',
    fill: '#06b6d4'
  };

  const { renderModel } = runPipeline([rawObj]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'shape_fill');
  assert.equal(rendered.fill, '#06b6d4');
});

test('TEST 8: opacity preserved across all stages', () => {
  const rawObj = {
    id: 'shape_opacity',
    type: 'rect',
    left: 50,
    top: 50,
    width: 100,
    height: 100,
    stroke: '#000000',
    opacity: 0.65
  };

  const canonical = normalizeObject(rawObj);
  assert.equal(canonical.opacity, 0.65);
  assert.equal(canonical.visual.opacity, 0.65);

  const { proposal, renderModel } = runPipeline([rawObj]);
  const placement = proposal.placements.find(p => p.objectId === 'shape_opacity');
  assert.equal(placement.opacity, 0.65);

  const rendered = renderModel.objects.find(o => o.originalObjectId === 'shape_opacity');
  assert.equal(rendered.opacity, 0.65);
});

test('TEST 9: lineCap preserved (round vs butt vs square)', () => {
  const rawObj = {
    id: 'line_cap',
    type: 'path',
    path: [['M', 0, 0], ['L', 100, 0]],
    stroke: '#000000',
    strokeWidth: 5,
    strokeLineCap: 'square',
    isStraightLine: true
  };

  const canonical = normalizeObject(rawObj);
  assert.equal(canonical.strokeLineCap, 'square');

  const { renderModel } = runPipeline([rawObj]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'line_cap');
  assert.equal(rendered.strokeLineCap, 'square');
});

test('TEST 10: lineJoin preserved (round vs miter vs bevel)', () => {
  const rawObj = {
    id: 'path_join',
    type: 'path',
    path: [['M', 0, 0], ['L', 50, 50], ['L', 100, 0]],
    stroke: '#000000',
    strokeWidth: 4,
    strokeLineJoin: 'bevel'
  };

  const canonical = normalizeObject(rawObj);
  assert.equal(canonical.strokeLineJoin, 'bevel');

  const { renderModel } = runPipeline([rawObj]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'path_join');
  assert.equal(rendered.strokeLineJoin, 'bevel');
});

test('TEST 11: connector stroke width preserved (e.g. strokeWidth 8)', () => {
  const rawConn = {
    id: 'conn_thick',
    type: 'path',
    path: [['M', 0, 0], ['L', 100, 0]],
    isConnector: true,
    connectorType: 'straight',
    stroke: '#000000',
    strokeWidth: 8,
    endArrow: true
  };

  const { renderModel } = runPipeline([rawConn]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'conn_thick');
  assert.equal(rendered.strokeWidth, 8, 'Connector stroke width 8 must be preserved');
});

test('TEST 12: freehand stroke width preserved', () => {
  const rawStroke = {
    id: 'stroke_pen',
    type: 'path',
    path: [['M', 10, 10], ['Q', 20, 20, 30, 30]],
    stroke: '#475569',
    strokeWidth: 6,
    isVectorStroke: true
  };

  const { renderModel } = runPipeline([rawStroke]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'stroke_pen');
  assert.equal(rendered.strokeWidth, 6, 'Freehand stroke width 6 must be preserved');
});

test('TEST 13: divider stroke width and cap preserved', () => {
  const rawLine = {
    id: 'div_line',
    type: 'path',
    path: [['M', 500, 0], ['L', 500, 300]],
    stroke: '#94a3b8',
    strokeWidth: 3,
    strokeLineCap: 'round',
    isStraightLine: true
  };

  const { renderModel } = runPipeline([rawLine]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'div_line');
  assert.equal(rendered.strokeWidth, 3);
  assert.equal(rendered.strokeLineCap, 'round');
});

test('TEST 14: callout note border and style preserved', () => {
  const rawCallout = {
    id: 'callout_note',
    type: 'path',
    isCalloutNote: true,
    shapeType: 'callout',
    fill: '#fef3c7',
    stroke: '#f59e0b',
    strokeWidth: 4,
    strokeDashArray: [6, 3],
    left: 200,
    top: 200,
    width: 180,
    height: 115
  };

  const canonical = normalizeObject(rawCallout);
  assert.equal(canonical.shapeType, 'callout');
  assert.equal(canonical.strokeWidth, 4);
  assert.deepEqual(canonical.strokeDashArray, [6, 3]);

  const { renderModel } = runPipeline([rawCallout]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'callout_note');
  assert.equal(rendered.strokeWidth, 4);
  assert.deepEqual(rendered.strokeDashArray, [6, 3]);
});

test('TEST 15: HTML shape border preserves width and dash', () => {
  const rawRect = {
    id: 'shape_bordered',
    type: 'rect',
    left: 100,
    top: 100,
    width: 160,
    height: 100,
    stroke: '#1e293b',
    strokeWidth: 6,
    strokeDashArray: [12, 6],
    fill: '#e2e8f0'
  };

  const { renderModel } = runPipeline([rawRect]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'shape_bordered');
  assert.equal(rendered.strokeWidth, 6);
  assert.deepEqual(rendered.strokeDashArray, [12, 6]);
});

test('TEST 16: text style preserved (font, weight, style, underline, stroke)', () => {
  const rawText = {
    id: 'text_styled',
    type: 'textbox',
    text: 'Styled Header',
    fontSize: 24,
    fontFamily: 'Roboto',
    fontWeight: '700',
    fontStyle: 'italic',
    textAlign: 'center',
    underline: true,
    linethrough: false,
    overline: false,
    charSpacing: 2,
    fill: '#1e3a8a',
    stroke: '#3b82f6',
    strokeWidth: 1,
    left: 100,
    top: 100,
    width: 200,
    height: 40
  };

  const canonical = normalizeObject(rawText);
  assert.equal(canonical.style.fontSize, 24);
  assert.equal(canonical.style.fontFamily, 'Roboto');
  assert.equal(canonical.style.fontWeight, '700');
  assert.equal(canonical.style.fontStyle, 'italic');
  assert.equal(canonical.style.textAlign, 'center');
  assert.equal(canonical.style.underline, true);
  assert.equal(canonical.style.charSpacing, 2);
  assert.equal(canonical.style.color, '#1e3a8a');
  assert.equal(canonical.style.stroke, '#3b82f6');
  assert.equal(canonical.style.strokeWidth, 1);

  const { renderModel } = runPipeline([rawText]);
  const rendered = renderModel.objects.find(o => o.originalObjectId === 'text_styled');
  assert.equal(rendered.style.fontSize, 24);
  assert.equal(rendered.style.underline, true);
});

test('TEST 17: actioned objects cannot silently restyle', () => {
  const shape = {
    id: 'container_1',
    type: 'rect',
    left: 100,
    top: 100,
    width: 160,
    height: 100,
    stroke: '#dc2626',
    strokeWidth: 5,
    strokeDashArray: [4, 4],
    fill: '#fee2e2'
  };
  const text = {
    id: 'label_1',
    type: 'textbox',
    text: 'Danger Zone',
    fontSize: 16,
    fontFamily: 'Quicksand',
    fontWeight: 'bold',
    fill: '#7f1d1d',
    left: 105,
    top: 105,
    width: 120,
    height: 30
  };

  const { proposal, renderModel } = runPipeline([shape, text]);
  const shapePlacement = proposal.placements.find(p => p.objectId === 'container_1');
  assert.equal(shapePlacement.strokeWidth, 5, 'Actioned container strokeWidth must not change');
  assert.deepEqual(shapePlacement.strokeDashArray, [4, 4], 'Actioned container strokeDashArray must not change');
  assert.equal(shapePlacement.stroke, '#dc2626', 'Actioned container stroke color must not change');
  assert.equal(shapePlacement.fill, '#fee2e2', 'Actioned container fill must not change');

  const textPlacement = proposal.placements.find(p => p.objectId === 'label_1');
  assert.equal(textPlacement.style?.color || textPlacement.fill, '#7f1d1d', 'Text color must not change');
});

test('TEST 18: untouched objects preserve style exactly', () => {
  const untouchedObj = {
    id: 'untouched_1',
    type: 'rect',
    left: 800,
    top: 800,
    width: 100,
    height: 100,
    stroke: '#6366f1',
    strokeWidth: 7,
    strokeDashArray: [14, 7],
    fill: '#e0e7ff',
    opacity: 0.8
  };

  const { proposal, renderModel } = runPipeline([untouchedObj]);
  const p = proposal.placements.find(pl => pl.objectId === 'untouched_1');
  assert.equal(p.strokeWidth, 7);
  assert.deepEqual(p.strokeDashArray, [14, 7]);
  assert.equal(p.fill, '#e0e7ff');
  assert.equal(p.opacity, 0.8);

  const r = renderModel.objects.find(ro => ro.originalObjectId === 'untouched_1');
  assert.equal(r.strokeWidth, 7);
  assert.deepEqual(r.strokeDashArray, [14, 7]);
  assert.equal(r.opacity, 0.8);
});

test('TEST 19: preview scaling does not cause false style mutation in world model', () => {
  const rawObj = {
    id: 'scaled_obj',
    type: 'rect',
    left: 0,
    top: 0,
    width: 200,
    height: 200,
    strokeWidth: 8
  };

  const { wm, proposal, renderModel } = runPipeline([rawObj]);
  assert.equal(wm.board.objects[0].strokeWidth, 8);
  assert.equal(proposal.placements[0].strokeWidth, 8);
  assert.equal(renderModel.objects[0].strokeWidth, 8);
});

test('TEST 20: real-board style regression (strokeWidth 8 connector & custom shapes)', () => {
  const connThick = {
    id: 'obj_1787517712296_9ph0k',
    type: 'path',
    path: [['M', -8719, 18195], ['L', -8491, 18195]],
    strokeWidth: 8,
    stroke: '#000000',
    fill: 'transparent',
    isConnector: true,
    connectorType: 'straight',
    endArrow: true
  };

  const callout = {
    id: 'elem_1787519509160_wzry1',
    type: 'path',
    strokeWidth: 2,
    stroke: '#f59e0b',
    fill: '#fef3c7',
    isCalloutNote: true,
    shapeType: 'callout',
    left: -8879,
    top: 18058,
    width: 180,
    height: 115
  };

  const divider = {
    id: 'line_1787519528340_i029o',
    type: 'path',
    path: [['M', -8101, 18224], ['L', -8101, 18433]],
    strokeWidth: 2,
    stroke: '#000000',
    isStraightLine: true
  };

  const { proposal, renderModel } = runPipeline([connThick, callout, divider]);
  const pConn = proposal.placements.find(p => p.objectId === connThick.id);
  assert.equal(pConn.strokeWidth, 8, 'Straight connector strokeWidth 8 must survive proposal');

  const rConn = renderModel.objects.find(o => o.originalObjectId === connThick.id);
  assert.equal(rConn.strokeWidth, 8, 'Straight connector strokeWidth 8 must survive preview model');

  const rCallout = renderModel.objects.find(o => o.originalObjectId === callout.id);
  assert.equal(rCallout.strokeWidth, 2);
  assert.equal(rCallout.stroke, '#f59e0b');
  assert.equal(rCallout.fill, '#fef3c7');

  const rDivider = renderModel.objects.find(o => o.originalObjectId === divider.id);
  assert.equal(rDivider.strokeWidth, 2);
});
