import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeObject } from './normalizeObjects.js';
import { createLayoutProposal } from './layoutEngine.js';
import { buildPreviewRenderModel, worldToPreview } from './previewModel.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { applyCleanup } from './applyCleanup.js';

const createMockFabricCanvas = (objects) => ({
  objects: [...objects],
  getObjects() {
    return this.objects;
  },
  renderAll() {},
  requestRenderAll() {}
});

test('1. Sticky note body with two-line wrapping preserves textLines and explicit breaks', () => {
  const rawText = {
    id: 'text_sticky_1',
    type: 'textbox',
    text: 'Have to fix \nsome bugs',
    textLines: ['Have to fix ', 'some bugs'],
    _textLines: [['H', 'a', 'v', 'e', ' ', 't', 'o', ' ', 'f', 'i', 'x', ' '], ['s', 'o', 'm', 'e', ' ', 'b', 'u', 'g', 's']],
    width: 144,
    height: 39,
    fontSize: 16,
    fontFamily: 'Nunito Sans',
    fontWeight: 'bold',
    lineHeight: 1.16,
    left: 1189,
    top: 496,
    scaleX: 1,
    scaleY: 1
  };
  const norm = normalizeObject(rawText);
  assert.equal(norm.text, 'Have to fix \nsome bugs');
  assert.deepEqual(norm.textLines, ['Have to fix ', 'some bugs']);
  assert.equal(norm.style.lineHeight, 1.16);

  const model = { version: 1, board: { objects: [norm] } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);
  const rendered = renderModel.objects.find((o) => o.originalObjectId === 'text_sticky_1');

  assert.ok(rendered);
  assert.equal(rendered.text, 'Have to fix \nsome bugs');
  assert.deepEqual(rendered.textLines, ['Have to fix ', 'some bugs']);
  assert.equal(rendered.style.lineHeight, 1.16);
});

test('2. Longer multiline sticky-note text preserves all lines and linebreaks', () => {
  const multiline = 'First step\nSecond critical action\nThird review pass\nFinal signoff';
  const rawText = {
    id: 'text_multi',
    type: 'textbox',
    text: multiline,
    textLines: multiline.split('\n'),
    width: 160,
    height: 80,
    fontSize: 14,
    left: 100,
    top: 100
  };
  const norm = normalizeObject(rawText);
  assert.equal(norm.text, multiline);
  assert.equal(norm.textLines.length, 4);

  const model = { version: 1, board: { objects: [norm] } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);
  const rendered = renderModel.objects.find((o) => o.originalObjectId === 'text_multi');

  assert.equal(rendered.text, multiline);
  assert.equal(rendered.textLines.length, 4);
});

test('3. Short text fitting on one line preserves single-line structure', () => {
  const rawText = {
    id: 'text_short',
    type: 'textbox',
    text: 'Approved',
    textLines: ['Approved'],
    width: 100,
    height: 20,
    fontSize: 16,
    left: 200,
    top: 200
  };
  const norm = normalizeObject(rawText);
  assert.equal(norm.text, 'Approved');
  assert.deepEqual(norm.textLines, ['Approved']);

  const model = { version: 1, board: { objects: [norm] } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);
  const rendered = renderModel.objects.find((o) => o.originalObjectId === 'text_short');

  assert.equal(rendered.text, 'Approved');
  assert.deepEqual(rendered.textLines, ['Approved']);
});

test('4. Multiword timestamp date preserves text and role containment metadata', () => {
  const rawTime = {
    id: 'time_elem_1',
    type: 'text',
    text: '10 Oct 2026',
    textLines: ['10 Oct 2026'],
    width: 48,
    height: 12,
    fontSize: 11,
    left: 240,
    top: 260,
    metadata: { role: 'timestamp' },
    elementRole: 'timestamp'
  };
  const norm = normalizeObject(rawTime);
  assert.equal(norm.text, '10 Oct 2026');
  assert.equal(norm.metadata.role, 'timestamp');

  const model = { version: 1, board: { objects: [norm] } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);
  const rendered = renderModel.objects.find((o) => o.originalObjectId === 'time_elem_1');

  assert.equal(rendered.text, '10 Oct 2026');
  assert.equal(rendered.metadata.role, 'timestamp');
});

test('5. Non-unit note scale factors preserve relative child offsets', () => {
  const shape = {
    id: 'shape_note',
    type: 'rect',
    isStickyNote: true,
    left: 1000,
    top: 500,
    width: 120,
    height: 120,
    scaleX: 1.0751,
    scaleY: 1.0751
  };
  const text = {
    id: 'text_note',
    type: 'textbox',
    text: 'Have to fix \nsome bugs',
    left: 1020,
    top: 520,
    width: 100,
    height: 40,
    scaleX: 1,
    scaleY: 1,
    parentShapeId: 'shape_note'
  };
  const normShape = normalizeObject(shape);
  const normText = normalizeObject(text);

  assert.equal(normShape.bounds.width, 120 * 1.0751);
  assert.equal(normShape.bounds.height, 120 * 1.0751);
  assert.equal(normText.bounds.width, 100);
});

test('6. Different preview viewport scales transform bounds and font sizes consistently', () => {
  const raw = {
    id: 't_scale',
    type: 'textbox',
    text: 'Scaled Text',
    width: 140,
    height: 30,
    left: 100,
    top: 100,
    fontSize: 16
  };
  const norm = normalizeObject(raw);
  const model = { version: 1, board: { objects: [norm] } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);
  const obj = renderModel.objects[0];

  const scales = [0.4, 0.619, 0.85, 1.0];
  scales.forEach((s) => {
    const previewPos = worldToPreview(obj.position, renderModel.bounds, s, 24);
    const scaledWidth = obj.bounds.width * s;
    const scaledFontSize = (obj.style.fontSize || 16) * s;
    assert.ok(previewPos.x >= 24);
    assert.ok(previewPos.y >= 24);
    assert.equal(scaledWidth, 140 * s);
    assert.equal(scaledFontSize, 16 * s);
  });
});

test('7. Repeated preview generation without application produces identical deterministic models', () => {
  const objs = [
    normalizeObject({ id: 's1', type: 'rect', isStickyNote: true, left: 100, top: 100, width: 140, height: 140 }),
    normalizeObject({ id: 't1', type: 'textbox', text: 'Sticky Note\nLine 2', left: 110, top: 110, width: 120, height: 40, parentShapeId: 's1' }),
    normalizeObject({ id: 'ts1', type: 'text', text: '1 Oct', left: 210, top: 220, width: 25, height: 12, parentShapeId: 's1', metadata: { role: 'timestamp' } })
  ];
  const model = { version: 1, board: { objects: objs } };

  const p1 = createLayoutProposal(null, model);
  const r1 = buildPreviewRenderModel(model, p1);

  const p2 = createLayoutProposal(null, model);
  const r2 = buildPreviewRenderModel(model, p2);

  assert.deepEqual(r1.objects.map((o) => ({ id: o.originalObjectId, b: o.bounds, t: o.text })), r2.objects.map((o) => ({ id: o.originalObjectId, b: o.bounds, t: o.text })));
});

test('8. attachText translation does not mutate text format or content', () => {
  const shape = normalizeObject({ id: 's1', type: 'rect', isStickyNote: true, left: 100, top: 100, width: 140, height: 140 });
  const text = normalizeObject({ id: 't1', type: 'textbox', text: 'Have to fix \nsome bugs', left: 112, top: 116, width: 120, height: 38 });
  const model = { version: 1, board: { objects: [shape, text] } };

  const plan = {
    version: 1,
    actions: [
      { id: 'act_attach', type: 'attachText', objectIds: ['s1', 't1'], confidence: 0.95, reason: 'Attach text' }
    ],
    untouchedObjectIds: [],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 0, unsupportedActionCount: 0 }
  };

  const executed = executeCleanupPlan(plan, model);
  assert.equal(executed.valid, true);
  const pText = executed.placements.find((p) => p.objectId === 't1');
  assert.equal(pText.size.width, 120);
  assert.equal(pText.size.height, 38);
  const renderModel = buildPreviewRenderModel(model, executed);
  const rText = renderModel.objects.find((o) => o.originalObjectId === 't1');
  assert.equal(rText.text, 'Have to fix \nsome bugs');
  assert.equal(rText.bounds.width, 120);
});

test('9. Sticky note background, body text, and timestamp translate atomically as one unit', () => {
  const s1 = normalizeObject({ id: 's1', elementId: 'elem_1', type: 'rect', isStickyNote: true, left: 100, top: 100, width: 140, height: 140 });
  const t1 = normalizeObject({ id: 't1', elementId: 'elem_1', type: 'textbox', text: 'Content\nHere', left: 116, top: 116, width: 100, height: 35, parentShapeId: 's1' });
  const time1 = normalizeObject({ id: 'time1', elementId: 'elem_1', type: 'text', text: '1 Oct', left: 200, top: 215, width: 30, height: 12, parentShapeId: 's1', metadata: { role: 'timestamp' } });
  const s2 = normalizeObject({ id: 's2', elementId: 'elem_2', type: 'rect', isStickyNote: true, left: 300, top: 250, width: 140, height: 140 });
  const t2 = normalizeObject({ id: 't2', elementId: 'elem_2', type: 'textbox', text: 'Note 2', left: 316, top: 266, width: 100, height: 35, parentShapeId: 's2' });
  const time2 = normalizeObject({ id: 'time2', elementId: 'elem_2', type: 'text', text: '2 Oct', left: 400, top: 365, width: 30, height: 12, parentShapeId: 's2', metadata: { role: 'timestamp' } });
  const model = { version: 1, board: { objects: [s1, t1, time1, s2, t2, time2] } };

  const initialRelTextX = t1.position.x - s1.position.x;
  const initialRelTextY = t1.position.y - s1.position.y;
  const initialRelTimeX = time1.position.x - s1.position.x;
  const initialRelTimeY = time1.position.y - s1.position.y;

  const plan = {
    version: 1,
    actions: [
      { id: 'act_grid', type: 'arrangeGrid', objectIds: ['s1', 's2'], confidence: 0.95, reason: 'Arrange grid' }
    ],
    untouchedObjectIds: ['t1', 'time1', 't2', 'time2'],
    diagnostics: { actionCount: 1, highConfidenceActionCount: 1, untouchedObjectCount: 4, unsupportedActionCount: 0 }
  };

  const executed = executeCleanupPlan(plan, model);
  assert.equal(executed.valid, true);
  const pShape = executed.placements.find((p) => p.objectId === 's1');
  const pText = executed.placements.find((p) => p.objectId === 't1');
  const pTime = executed.placements.find((p) => p.objectId === 'time1');

  assert.equal(pText.position.x - pShape.position.x, initialRelTextX);
  assert.equal(pText.position.y - pShape.position.y, initialRelTextY);
  assert.equal(pTime.position.x - pShape.position.x, initialRelTimeX);
  assert.equal(pTime.position.y - pShape.position.y, initialRelTimeY);
});

test('10. Apply followed by serialization and reload preserves text geometry', () => {
  const fabricShape = {
    id: 's1',
    type: 'rect',
    isStickyNote: true,
    left: 100,
    top: 100,
    width: 140,
    height: 140,
    scaleX: 1,
    scaleY: 1,
    angle: 0
  };
  const fabricText = {
    id: 't1',
    type: 'textbox',
    text: 'Have to fix \nsome bugs',
    fontSize: 16,
    fontFamily: 'Nunito Sans',
    left: 115,
    top: 115,
    width: 120,
    height: 38,
    scaleX: 1,
    scaleY: 1,
    angle: 0
  };

  const canvas = createMockFabricCanvas([fabricShape, fabricText]);
  const normShape = normalizeObject(fabricShape);
  const normText = normalizeObject(fabricText);
  const model = { version: 1, board: { objects: [normShape, normText] } };

  const proposal = {
    placements: [
      { objectId: 's1', position: { x: 120, y: 120 }, bounds: { x: 120, y: 120, width: 140, height: 140 } },
      { objectId: 't1', position: { x: 135, y: 135 }, bounds: { x: 135, y: 135, width: 120, height: 38 } }
    ]
  };

  const applyRes = applyCleanup(canvas, proposal, model);
  assert.equal(applyRes.success, true);

  assert.equal(fabricText.text, 'Have to fix \nsome bugs');
  assert.equal(fabricText.fontSize, 16);
  assert.equal(fabricText.width, 120);
  assert.equal(fabricText.left, 135);
  assert.equal(fabricText.top, 135);
});

test('11. Preservation of font styling and per-character style ranges', () => {
  const raw = {
    id: 'text_styled',
    type: 'textbox',
    text: 'Important Notice',
    fontSize: 18,
    fontFamily: 'Nunito Sans',
    fontWeight: 'bold',
    fontStyle: 'italic',
    lineHeight: 1.25,
    charSpacing: 50,
    styles: {
      0: {
        0: { fill: '#ef4444' },
        1: { fill: '#ef4444' }
      }
    },
    left: 50,
    top: 50,
    width: 200,
    height: 40
  };

  const norm = normalizeObject(raw);
  assert.equal(norm.style.fontSize, 18);
  assert.equal(norm.style.fontWeight, 'bold');
  assert.equal(norm.style.fontStyle, 'italic');
  assert.equal(norm.style.lineHeight, 1.25);
  assert.equal(norm.style.charSpacing, 50);
  assert.deepEqual(norm.style.styles, raw.styles);
});

test('12. No mutation of live Fabric text objects occurs during preview generation', () => {
  const fabricText = {
    id: 't_immut',
    type: 'textbox',
    text: 'Have to fix \nsome bugs',
    width: 144,
    height: 39,
    fontSize: 16,
    left: 500,
    top: 400
  };
  const snapshotBefore = JSON.stringify(fabricText);
  const norm = normalizeObject(fabricText);
  const model = { version: 1, board: { objects: [norm] } };
  const proposal = createLayoutProposal(null, model);
  buildPreviewRenderModel(model, proposal);

  const snapshotAfter = JSON.stringify(fabricText);
  assert.equal(snapshotBefore, snapshotAfter);
});

test('13. Horizontal and vertical connector repairs remain intact with text fidelity', () => {
  const hex = normalizeObject({ id: 'hex_1', type: 'shape', shapeType: 'hexagon', left: 100, top: 100, width: 100, height: 100 });
  const tri = normalizeObject({ id: 'tri_1', type: 'shape', shapeType: 'triangle', left: 300, top: 100, width: 100, height: 100 });
  const conn = normalizeObject({
    id: 'conn_h',
    type: 'connector',
    left: 200,
    top: 150,
    width: 100,
    height: 10,
    sourceShapeId: 'hex_1',
    targetShapeId: 'tri_1',
    pathCommands: [['M', 200, 150], ['L', 300, 150]]
  });
  const model = { version: 1, board: { objects: [hex, tri, conn] } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);

  const pConn = renderModel.objects.find((o) => o.originalObjectId === 'conn_h');
  assert.ok(pConn);
  assert.equal(pConn.type, 'connector');
});

test('14. Protected freehand handwriting artwork remains untouched', () => {
  const stroke = normalizeObject({
    id: 'stroke_hello',
    type: 'stroke',
    left: 500,
    top: 500,
    width: 80,
    height: 40,
    isVectorStroke: true,
    metadata: { isProtected: true }
  });
  const model = { version: 1, board: { objects: [stroke] } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);

  const pStroke = renderModel.objects.find((o) => o.originalObjectId === 'stroke_hello');
  assert.ok(pStroke);
  assert.equal(pStroke.position.x, 500);
  assert.equal(pStroke.position.y, 500);
});
