import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import executeCleanupPlan from './executeCleanupPlan.js';
import { applyCleanup } from './applyCleanup.js';
import { buildVisualObjectModel, resolveContainerOwnership } from './visualUnits.js';
import { discoverVisualStructures, generateCompositionCandidates } from './discoverVisualStructures.js';
import { buildPreviewRenderModel } from './previewModel.js';

const EPSILON = 0.001;

const createMockFabricObject = (spec) => {
  const obj = {
    ...spec,
    set(props) {
      Object.assign(this, props);
      return this;
    },
    setCoords() {
      return this;
    },
    toObject() {
      return JSON.parse(JSON.stringify(this));
    }
  };
  return obj;
};

const createRepresentativeObjects = () => [
  createMockFabricObject({
    id: 'shape_rect',
    type: 'Rect',
    left: 200,
    top: 200,
    width: 150,
    height: 90,
    scaleX: 0.8,
    scaleY: 0.8,
    angle: 0,
    originX: 'center',
    originY: 'center',
    fill: '#e0f2fe'
  }),
  createMockFabricObject({
    id: 'shape_diamond',
    type: 'Polygon',
    shapeType: 'diamond',
    left: 450,
    top: 200,
    width: 120,
    height: 120,
    scaleX: 0.75,
    scaleY: 0.75,
    angle: 0,
    originX: 'center',
    originY: 'center',
    fill: '#fef08a',
    points: [{ x: 60, y: 0 }, { x: 120, y: 60 }, { x: 60, y: 120 }, { x: 0, y: 60 }]
  }),
  createMockFabricObject({
    id: 'shape_hexagon',
    type: 'Polygon',
    shapeType: 'hexagon',
    left: 700,
    top: 200,
    width: 160,
    height: 140,
    scaleX: 0.7,
    scaleY: 0.7,
    angle: 0,
    originX: 'center',
    originY: 'center',
    fill: '#f3e8ff',
    points: [
      { x: 40, y: 0 }, { x: 120, y: 0 }, { x: 160, y: 70 },
      { x: 120, y: 140 }, { x: 40, y: 140 }, { x: 0, y: 70 }
    ]
  }),
  createMockFabricObject({
    id: 'shape_triangle',
    type: 'Triangle',
    left: 950,
    top: 200,
    width: 130,
    height: 110,
    scaleX: 0.85,
    scaleY: 0.85,
    angle: 0,
    originX: 'center',
    originY: 'center',
    fill: '#ffd600'
  }),
  createMockFabricObject({
    id: 'note_bg',
    type: 'Rect',
    elementId: 'elem_note_1',
    left: 300,
    top: 450,
    width: 180,
    height: 180,
    scaleX: 0.65,
    scaleY: 0.65,
    angle: 0,
    originX: 'center',
    originY: 'center',
    fill: '#fef9c3',
    isStickyNote: true
  }),
  createMockFabricObject({
    id: 'note_text',
    type: 'Textbox',
    elementId: 'elem_note_1',
    left: 300,
    top: 430,
    width: 150,
    height: 60,
    scaleX: 0.65,
    scaleY: 0.65,
    angle: 0,
    originX: 'center',
    originY: 'center',
    text: 'Note body content'
  }),
  createMockFabricObject({
    id: 'note_timestamp',
    type: 'Textbox',
    elementId: 'elem_note_1',
    elementRole: 'timestamp',
    metadata: { role: 'timestamp' },
    left: 300,
    top: 490,
    width: 80,
    height: 20,
    scaleX: 0.65,
    scaleY: 0.65,
    angle: 0,
    originX: 'center',
    originY: 'center',
    text: '1 Oct'
  }),
  createMockFabricObject({
    id: 'custom_path_shape',
    type: 'Path',
    left: 550,
    top: 450,
    width: 100,
    height: 80,
    scaleX: 0.9,
    scaleY: 0.9,
    angle: 15,
    originX: 'center',
    originY: 'center',
    fill: '#cbd5e1',
    path: [['M', 0, 0], ['C', 30, -20, 70, -20, 100, 0], ['L', 80, 80], ['Z']]
  }),
  createMockFabricObject({
    id: 'freehand_protected',
    type: 'Path',
    semanticType: 'stroke',
    isVectorStroke: true,
    left: 800,
    top: 450,
    width: 140,
    height: 60,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    originX: 'center',
    originY: 'center',
    stroke: '#000000',
    strokeWidth: 2,
    path: [['M', 800, 450], ['Q', 850, 420, 900, 450], ['L', 940, 460]]
  }),
  createMockFabricObject({
    id: 'conn_horizontal',
    type: 'Path',
    isConnector: true,
    connectorType: 'straight',
    endArrow: true,
    left: 825,
    top: 200,
    width: 90,
    height: 10,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    originX: 'center',
    originY: 'center',
    path: [['M', 780, 200], ['L', 870, 200], ['M', 860, 195], ['L', 870, 200], ['L', 860, 205]]
  })
];

describe('LOOP 25F-3: Geometry Integrity & Invariants', () => {
  test('Stage 1 to 5: Original intrinsic geometry is preserved through extraction, planning, and execution', () => {
    const rawObjects = createRepresentativeObjects();
    const wsModel = { board: { objects: rawObjects } };

    const voModel = buildVisualObjectModel(wsModel);
    const ownership = resolveContainerOwnership(voModel);
    const structures = discoverVisualStructures(wsModel, null, { ownership });
    const candidates = generateCompositionCandidates(structures, wsModel);
    const plan = buildCleanupPlan(wsModel);
    const executionResult = executeCleanupPlan(plan, wsModel);

    assert.equal(executionResult.valid, true);

    const checkShapes = [
      'shape_rect',
      'shape_diamond',
      'shape_hexagon',
      'shape_triangle',
      'note_bg',
      'custom_path_shape'
    ];

    for (const shapeId of checkShapes) {
      const orig = rawObjects.find((o) => o.id === shapeId);
      const placement = executionResult.placements.find((p) => p.objectId === shapeId);

      assert.ok(placement, `Placement for ${shapeId} exists`);
      assert.ok(Math.abs(placement.size.width - orig.width) <= EPSILON, `${shapeId} intrinsic width preserved`);
      assert.ok(Math.abs(placement.size.height - orig.height) <= EPSILON, `${shapeId} intrinsic height preserved`);

      const origAspect = orig.width / orig.height;
      const finalAspect = placement.size.width / placement.size.height;
      assert.ok(Math.abs(origAspect - finalAspect) <= EPSILON, `${shapeId} aspect ratio preserved`);

      assert.ok(Math.abs(placement.scale.x - orig.scaleX) <= EPSILON, `${shapeId} scaleX preserved`);
      assert.ok(Math.abs(placement.scale.y - orig.scaleY) <= EPSILON, `${shapeId} scaleY preserved`);
      assert.ok(Math.abs(placement.rotation - orig.angle) <= EPSILON, `${shapeId} rotation angle preserved`);
    }
  });

  test('Stage 8 & 9: Live Fabric Apply mutates position without resizing or distorting shapes', () => {
    const rawObjects = createRepresentativeObjects();
    const wsModel = { board: { objects: rawObjects } };

    const plan = buildCleanupPlan(wsModel);
    const executionResult = executeCleanupPlan(plan, wsModel);
    assert.equal(executionResult.valid, true);

    const canvas = {
      _objects: [...rawObjects],
      getObjects: () => canvas._objects,
      requestRenderAll: () => {}
    };

    const applyResult = applyCleanup(canvas, executionResult, wsModel);
    assert.equal(applyResult.success, true);

    const checkShapes = ['shape_rect', 'shape_diamond', 'shape_hexagon', 'shape_triangle', 'note_bg'];
    for (const shapeId of checkShapes) {
      const orig = createRepresentativeObjects().find((o) => o.id === shapeId);
      const updated = canvas._objects.find((o) => o.id === shapeId);

      assert.ok(Math.abs(updated.width - orig.width) <= EPSILON, `${shapeId} Fabric width preserved`);
      assert.ok(Math.abs(updated.height - orig.height) <= EPSILON, `${shapeId} Fabric height preserved`);
      assert.ok(Math.abs(updated.scaleX - orig.scaleX) <= EPSILON, `${shapeId} Fabric scaleX preserved`);
      assert.ok(Math.abs(updated.scaleY - orig.scaleY) <= EPSILON, `${shapeId} Fabric scaleY preserved`);

      const serialized = updated.toObject();
      assert.ok(Math.abs(serialized.width - orig.width) <= EPSILON, `${shapeId} serialized width preserved`);
      assert.ok(Math.abs(serialized.height - orig.height) <= EPSILON, `${shapeId} serialized height preserved`);
    }
  });

  test('Preview and Apply geometry parity across all supported shape types', () => {
    const rawObjects = createRepresentativeObjects();
    const wsModel = { board: { objects: rawObjects } };

    const plan = buildCleanupPlan(wsModel);
    const executionResult = executeCleanupPlan(plan, wsModel);
    const previewModel = buildPreviewRenderModel(wsModel, executionResult);

    assert.ok(previewModel);
    assert.equal(previewModel.objects.length, executionResult.placements.length);

    for (const placement of executionResult.placements) {
      const previewObj = previewModel.objects.find((o) => o.originalObjectId === placement.objectId);
      assert.ok(previewObj, `Preview object for ${placement.objectId} exists`);
      assert.ok(Math.abs(previewObj.bounds.x - placement.bounds.x) <= EPSILON);
      assert.ok(Math.abs(previewObj.bounds.y - placement.bounds.y) <= EPSILON);
      assert.ok(Math.abs(previewObj.bounds.width - placement.bounds.width) <= EPSILON);
      assert.ok(Math.abs(previewObj.bounds.height - placement.bounds.height) <= EPSILON);
    }
  });

  test('No-op integrity: Analysis and plan generation do not mutate source objects', () => {
    const rawObjects = createRepresentativeObjects();
    const beforeSnapshots = rawObjects.map((o) => JSON.parse(JSON.stringify(o)));

    const wsModel = { board: { objects: rawObjects } };
    buildCleanupPlan(wsModel);
    buildCleanupPlan(wsModel);

    for (let i = 0; i < rawObjects.length; i++) {
      const before = beforeSnapshots[i];
      const after = rawObjects[i];
      assert.equal(after.left, before.left, `${after.id} left untouched by analysis`);
      assert.equal(after.top, before.top, `${after.id} top untouched by analysis`);
      assert.equal(after.width, before.width, `${after.id} width untouched by analysis`);
      assert.equal(after.height, before.height, `${after.id} height untouched by analysis`);
      assert.equal(after.scaleX, before.scaleX, `${after.id} scaleX untouched by analysis`);
      assert.equal(after.scaleY, before.scaleY, `${after.id} scaleY untouched by analysis`);
    }
  });

  test('Protected freehand strokes remain strictly untouched', () => {
    const rawObjects = createRepresentativeObjects();
    const wsModel = { board: { objects: rawObjects } };

    const plan = buildCleanupPlan(wsModel);
    const executionResult = executeCleanupPlan(plan, wsModel);

    const origStroke = rawObjects.find((o) => o.id === 'freehand_protected');
    const pStroke = executionResult.placements.find((p) => p.objectId === 'freehand_protected');

    assert.ok(pStroke);
    assert.ok(Math.abs(pStroke.position.x - origStroke.left) <= EPSILON);
    assert.ok(Math.abs(pStroke.position.y - origStroke.top) <= EPSILON);
    assert.deepEqual(pStroke.path, origStroke.path);
  });

  test('Sticky note and owned children translate as one atomic unit', () => {
    const rawObjects = createRepresentativeObjects();
    const wsModel = { board: { objects: rawObjects } };

    const plan = buildCleanupPlan(wsModel);
    const executionResult = executeCleanupPlan(plan, wsModel);

    const bgP = executionResult.placements.find((p) => p.objectId === 'note_bg');
    const textP = executionResult.placements.find((p) => p.objectId === 'note_text');
    const timeP = executionResult.placements.find((p) => p.objectId === 'note_timestamp');

    const origBg = rawObjects.find((o) => o.id === 'note_bg');
    const origText = rawObjects.find((o) => o.id === 'note_text');
    const origTime = rawObjects.find((o) => o.id === 'note_timestamp');

    const dxBg = bgP.position.x - origBg.left;
    const dyBg = bgP.position.y - origBg.top;
    const dxTime = timeP.position.x - origTime.left;
    const dyTime = timeP.position.y - origTime.top;

    assert.ok(Math.abs(dxBg - dxTime) <= EPSILON, 'Timestamp matches background dx');
    assert.ok(Math.abs(dyBg - dyTime) <= EPSILON, 'Timestamp matches background dy');

    const previewModel = buildPreviewRenderModel(wsModel, executionResult);
    const previewTime = previewModel.objects.find((o) => o.originalObjectId === 'note_timestamp');
    assert.equal(previewTime?.text, '1 Oct');
  });

  test('Connector rerouting updates path without mutating attached shapes geometry', () => {
    const rawObjects = createRepresentativeObjects();
    const wsModel = { board: { objects: rawObjects } };

    const plan = buildCleanupPlan(wsModel);
    const executionResult = executeCleanupPlan(plan, wsModel);

    const hexP = executionResult.placements.find((p) => p.objectId === 'shape_hexagon');
    const triP = executionResult.placements.find((p) => p.objectId === 'shape_triangle');
    const connP = executionResult.placements.find((p) => p.objectId === 'conn_horizontal');

    const origHex = rawObjects.find((o) => o.id === 'shape_hexagon');
    const origTri = rawObjects.find((o) => o.id === 'shape_triangle');

    assert.equal(hexP.size.width, origHex.width);
    assert.equal(hexP.size.height, origHex.height);
    assert.equal(triP.size.width, origTri.width);
    assert.equal(triP.size.height, origTri.height);

    assert.ok(connP.pathCommands.length > 0);
  });

  test('Preview polygon point mapping preserves scaled canonical bounds and aspect ratio for hexagons, diamonds, and non-unit polygons', () => {
    const rawObjects = createRepresentativeObjects();
    const wsModel = { board: { objects: rawObjects } };
    const plan = buildCleanupPlan(wsModel);
    const executionResult = executeCleanupPlan(plan, wsModel);
    const previewModel = buildPreviewRenderModel(wsModel, executionResult);

    const testShapes = ['shape_hexagon', 'shape_diamond'];
    const previewScale = 0.85;

    testShapes.forEach((id) => {
      const orig = rawObjects.find((o) => o.id === id);
      const renderObj = previewModel.objects.find((o) => o.originalObjectId === id);
      assert.ok(renderObj);

      const expectedRenderedWidth = orig.width * orig.scaleX;
      const expectedRenderedHeight = orig.height * orig.scaleY;
      const expectedAspect = expectedRenderedWidth / expectedRenderedHeight;

      const wScreen = (renderObj.bounds.width) * previewScale;
      const hScreen = (renderObj.bounds.height) * previewScale;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      renderObj.points.forEach((p) => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
      const spanX = Math.max(1e-6, maxX - minX);
      const spanY = Math.max(1e-6, maxY - minY);

      const mappedPoints = renderObj.points.map((p) => ({
        x: ((p.x - minX) / spanX) * wScreen,
        y: ((p.y - minY) / spanY) * hScreen
      }));

      const renderedMinX = Math.min(...mappedPoints.map((p) => p.x));
      const renderedMaxX = Math.max(...mappedPoints.map((p) => p.x));
      const renderedMinY = Math.min(...mappedPoints.map((p) => p.y));
      const renderedMaxY = Math.max(...mappedPoints.map((p) => p.y));

      const renderedW = renderedMaxX - renderedMinX;
      const renderedH = renderedMaxY - renderedMinY;

      assert.ok(Math.abs(renderedW - wScreen) <= EPSILON);
      assert.ok(Math.abs(renderedH - hScreen) <= EPSILON);

      const canonicalW = renderedW / previewScale;
      const canonicalH = renderedH / previewScale;
      assert.ok(Math.abs(canonicalW - expectedRenderedWidth) <= EPSILON);
      assert.ok(Math.abs(canonicalH - expectedRenderedHeight) <= EPSILON);

      const renderedAspect = renderedW / renderedH;
      assert.ok(Math.abs(renderedAspect - expectedAspect) <= EPSILON);
    });
  });

  test('Sticky note text never shifts to the left outside note boundary', () => {
    const rawObjects = [
      createMockFabricObject({
        id: 'note_bg_wide',
        type: 'Rect',
        elementId: 'elem_note_w',
        left: 200,
        top: 200,
        width: 180,
        height: 180,
        scaleX: 0.6667,
        scaleY: 0.6667,
        originX: 'center',
        originY: 'center',
        isStickyNote: true
      }),
      createMockFabricObject({
        id: 'note_text_wide',
        type: 'Textbox',
        elementId: 'elem_note_w',
        left: 151.74,
        top: 160,
        width: 144,
        height: 40,
        originX: 'left',
        originY: 'top',
        text: 'Have to fix some bugs'
      })
    ];
    const wsModel = { board: { objects: rawObjects } };
    const plan = buildCleanupPlan(wsModel);
    const executionResult = executeCleanupPlan(plan, wsModel);

    const bgP = executionResult.placements.find((p) => p.objectId === 'note_bg_wide');
    const textP = executionResult.placements.find((p) => p.objectId === 'note_text_wide');

    assert.ok(textP.bounds.x >= bgP.bounds.x, 'Text x must be >= note background x');
  });

  test('Real board 25F-3 preview and apply end-to-end geometry integrity', () => {
    const rawObjects = [
      createMockFabricObject({
        id: 'obj_1790863050807_18sp9',
        type: 'Rect',
        width: 160,
        height: 110,
        scaleX: 0.6964,
        scaleY: 0.6964,
        left: 1314.2258,
        top: 311.5322,
        originX: 'center',
        originY: 'center',
        fill: '#f87171'
      }),
      createMockFabricObject({
        id: 'obj_1790863050807_963ub',
        type: 'Polygon',
        width: 140,
        height: 140,
        scaleX: 0.7066,
        scaleY: 0.7066,
        left: 1347.7448,
        top: 462.8828,
        originX: 'center',
        originY: 'center',
        fill: '#e0f2fe',
        points: [{ x: 70, y: 0 }, { x: 140, y: 70 }, { x: 70, y: 140 }, { x: 0, y: 70 }]
      }),
      createMockFabricObject({
        id: 'obj_1790863050808_kz1ak',
        type: 'Polygon',
        width: 160,
        height: 140,
        scaleX: 0.7725,
        scaleY: 0.7725,
        left: 1539.8088,
        top: 348.4994,
        originX: 'center',
        originY: 'center',
        fill: '#f3e8ff',
        points: [
          { x: 40, y: 0 }, { x: 120, y: 0 }, { x: 160, y: 70 },
          { x: 120, y: 140 }, { x: 40, y: 140 }, { x: 0, y: 70 }
        ]
      }),
      createMockFabricObject({
        id: 'shape_elem_1790863056384_dcvla',
        type: 'Triangle',
        width: 140,
        height: 120,
        scaleX: 0.8026,
        scaleY: 0.8026,
        left: 1779.0638,
        top: 336.4771,
        originX: 'center',
        originY: 'center',
        fill: '#facc15'
      }),
      createMockFabricObject({
        id: 'conn_1790863050809',
        type: 'Path',
        isConnector: true,
        sourceShapeId: 'obj_1790863050808_kz1ak',
        targetShapeId: 'shape_elem_1790863056384_dcvla',
        left: 1631.426,
        top: 405.7578,
        path: [['M', 1601.6, 348.5], ['L', 1722.9, 348.5]]
      })
    ];

    const wsModel = { board: { objects: rawObjects } };
    const plan = buildCleanupPlan(wsModel);
    const executionResult = executeCleanupPlan(plan, wsModel);
    const previewModel = buildPreviewRenderModel(wsModel, executionResult);

    const applyResult = applyCleanup(
      { getObjects: () => rawObjects, isLoadingFromJSON: false, isHistoryProcessing: false },
      executionResult,
      wsModel
    );
    assert.equal(applyResult.success, true);

    const hexApplied = rawObjects.find((o) => o.id === 'obj_1790863050808_kz1ak');
    const diaApplied = rawObjects.find((o) => o.id === 'obj_1790863050807_963ub');
    const triApplied = rawObjects.find((o) => o.id === 'shape_elem_1790863056384_dcvla');

    assert.equal(hexApplied.width, 160);
    assert.equal(hexApplied.height, 140);
    assert.equal(hexApplied.scaleX, 0.7725);
    assert.equal(hexApplied.scaleY, 0.7725);

    assert.equal(diaApplied.width, 140);
    assert.equal(diaApplied.height, 140);
    assert.equal(diaApplied.scaleX, 0.7066);
    assert.equal(diaApplied.scaleY, 0.7066);

    assert.equal(triApplied.width, 140);
    assert.equal(triApplied.height, 120);
    assert.equal(triApplied.scaleX, 0.8026);
    assert.equal(triApplied.scaleY, 0.8026);

    const hexPreview = previewModel.objects.find((o) => o.originalObjectId === 'obj_1790863050808_kz1ak');
    const previewScale = 0.8;
    const wScreen = hexPreview.bounds.width * previewScale;
    const hScreen = hexPreview.bounds.height * previewScale;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    hexPreview.points.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    const mapped = hexPreview.points.map((p) => ({
      x: ((p.x - minX) / spanX) * wScreen,
      y: ((p.y - minY) / spanY) * hScreen
    }));

    const hexSpanW = Math.max(...mapped.map((p) => p.x)) - Math.min(...mapped.map((p) => p.x));
    const hexSpanH = Math.max(...mapped.map((p) => p.y)) - Math.min(...mapped.map((p) => p.y));

    assert.ok(Math.abs(hexSpanW - (160 * 0.7725 * previewScale)) <= EPSILON);
    assert.ok(Math.abs(hexSpanH - (140 * 0.7725 * previewScale)) <= EPSILON);

    const serialized = rawObjects.map((o) => o.toObject());
    serialized.forEach((s) => {
      const orig = rawObjects.find((r) => r.id === s.id);
      assert.equal(s.width, orig.width);
      assert.equal(s.height, orig.height);
      assert.equal(s.scaleX, orig.scaleX);
      assert.equal(s.scaleY, orig.scaleY);
    });
  });
});
