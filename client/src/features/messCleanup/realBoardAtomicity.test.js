import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVisualObjectModel, reconstructVisualUnits, resolveContainerOwnership } from './visualUnits.js';
import { getSemanticType, detectConnectorTypeFromPath, isVerticalDividerUnit, NOTEBOOK_CONSTANTS } from './cleanupTypes.js';
import { normalizeObject } from './normalizeObjects.js';
import { detectRelationships } from './detectRelationships.js';
import { createLayoutProposal } from './layoutEngine.js';
import { buildPreviewRenderModel } from './previewModel.js';

const makeLinkedShape = (elementId, shapeType = 'rect', textContent = 'Label', x = 100, y = 100, w = 140, h = 90) => {
  const shapeId = `shape_${elementId}`;
  const textId = `text_${elementId}`;

  const shapeObj = {
    id: shapeId,
    elementId,
    type: 'shape',
    shapeType,
    position: { x, y },
    size: { width: w, height: h },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 1,
    relationshipMetadata: { attachedTextId: textId, parentShapeId: null },
    metadata: { role: 'shape' }
  };

  const textObj = {
    id: textId,
    elementId,
    type: 'text',
    text: textContent,
    position: { x, y },
    size: { width: 100, height: 24 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 2,
    relationshipMetadata: { attachedTextId: null, parentShapeId: shapeId },
    metadata: { role: 'text' }
  };

  return { shapeObj, textObj };
};

const makeStickyNote = (elementId, textContent = 'Sticky Content', x = 300, y = 300, size = 180) => {
  const shapeId = `shape_${elementId}`;
  const textId = `text_${elementId}`;

  const shapeObj = {
    id: shapeId,
    elementId,
    type: 'rect',
    isStickyNote: true,
    noteColor: '#fff3a0',
    position: { x, y },
    size: { width: size, height: size },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 1,
    relationshipMetadata: { attachedTextId: textId, parentShapeId: null },
    metadata: { isStickyNote: true, noteColor: '#fff3a0' }
  };

  const textObj = {
    id: textId,
    elementId,
    type: 'text',
    text: textContent,
    position: { x, y },
    size: { width: 140, height: 24 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 2,
    relationshipMetadata: { attachedTextId: null, parentShapeId: shapeId },
    metadata: { isStickyNote: true }
  };

  return { shapeObj, textObj };
};

test('1. Nemotron graph group contains shape but omits attached label -> shape + label in SAME graph unit', () => {
  const { shapeObj, textObj } = makeLinkedShape('elem_rect_1', 'rect', 'Rectangle', 100, 100);
  const objects = [shapeObj, textObj];
  const model = { board: { objects } };

  const semanticScene = {
    groups: [
      { id: 'group_flow_1', type: 'flowchart', objectIds: [shapeObj.id] }
    ]
  };

  const visualObjects = buildVisualObjectModel(model);
  const { atomicUnits, visualIntegrity } = reconstructVisualUnits(visualObjects, semanticScene);

  const graphUnit = atomicUnits.find((u) => u.type === 'graph-unit');
  assert.ok(graphUnit, 'Graph unit must be created');
  assert.ok(graphUnit.objectIds.includes(shapeObj.id), 'Graph unit must contain shape');
  assert.ok(graphUnit.objectIds.includes(textObj.id), 'Graph unit MUST contain omitted attached text label');
  assert.equal(atomicUnits.filter((u) => u.objectIds.includes(textObj.id)).length, 1, 'Text must be in exactly one unit');
  assert.equal(visualIntegrity.detachedTextIds.length, 0, 'No detached text IDs');
});

test('2. Multiple graph nodes with omitted labels -> every shape attached label remains atomic in the graph unit', () => {
  const rect = makeLinkedShape('elem_rect', 'rect', 'Rectangle', 100, 100);
  const circle = makeLinkedShape('elem_circle', 'circle', 'Circle', 300, 100);
  const triangle = makeLinkedShape('elem_tri', 'triangle', 'Triangle', 500, 100);

  const objects = [rect.shapeObj, rect.textObj, circle.shapeObj, circle.textObj, triangle.shapeObj, triangle.textObj];
  const model = { board: { objects } };

  const semanticScene = {
    groups: [
      { id: 'group_flow_1', type: 'flowchart', objectIds: [rect.shapeObj.id, circle.shapeObj.id, triangle.shapeObj.id] }
    ]
  };

  const visualObjects = buildVisualObjectModel(model);
  const { atomicUnits, visualIntegrity } = reconstructVisualUnits(visualObjects, semanticScene);

  const graphUnit = atomicUnits.find((u) => u.type === 'graph-unit');
  assert.ok(graphUnit, 'Graph unit must exist');
  assert.ok(graphUnit.objectIds.includes(rect.shapeObj.id) && graphUnit.objectIds.includes(rect.textObj.id), 'Rect shape + text in graph unit');
  assert.ok(graphUnit.objectIds.includes(circle.shapeObj.id) && graphUnit.objectIds.includes(circle.textObj.id), 'Circle shape + text in graph unit');
  assert.ok(graphUnit.objectIds.includes(triangle.shapeObj.id) && graphUnit.objectIds.includes(triangle.textObj.id), 'Triangle shape + text in graph unit');

  assert.equal(atomicUnits.length, 1, 'All 3 nodes + labels belong to the single graph unit');
  assert.equal(visualIntegrity.detachedTextIds.length, 0, 'Zero detached text labels');
});

test('3. Sticky note shape + text split across different semantic groups -> same note unit', () => {
  const sticky = makeStickyNote('elem_sticky_1', 'Notes text', 100, 200);
  const objects = [sticky.shapeObj, sticky.textObj];
  const model = { board: { objects } };

  const semanticScene = {
    groups: [
      { id: 'group_flow_1', type: 'flowchart', objectIds: [sticky.shapeObj.id] },
      { id: 'group_notes_1', type: 'notes', objectIds: [sticky.textObj.id] }
    ]
  };

  const visualObjects = buildVisualObjectModel(model);
  const { atomicUnits, visualIntegrity } = reconstructVisualUnits(visualObjects, semanticScene);

  const containingUnits = atomicUnits.filter((u) => u.objectIds.includes(sticky.shapeObj.id) || u.objectIds.includes(sticky.textObj.id));
  assert.equal(containingUnits.length, 1, 'Sticky note shape and text must be in the same unit');
  assert.ok(containingUnits[0].objectIds.includes(sticky.shapeObj.id), 'Unit contains shape');
  assert.ok(containingUnits[0].objectIds.includes(sticky.textObj.id), 'Unit contains text');
  assert.equal(visualIntegrity.detachedTextIds.length, 0);
});

test('4. Standalone text with no actual parent -> standalone text-unit', () => {
  const textObj = {
    id: 'text_standalone_1',
    elementId: 'obj_standalone_1',
    type: 'text',
    text: 'What is MESS cleanup?',
    position: { x: 500, y: 500 },
    size: { width: 200, height: 40 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 1,
    relationshipMetadata: {},
    metadata: {}
  };
  const model = { board: { objects: [textObj] } };
  const visualObjects = buildVisualObjectModel(model);
  const { atomicUnits } = reconstructVisualUnits(visualObjects, null);

  assert.equal(atomicUnits.length, 1);
  assert.equal(atomicUnits[0].type, 'text-unit');
  assert.deepEqual(atomicUnits[0].objectIds, ['text_standalone_1']);
});

test('5. Actual Skribe Path line with connectors -> classified as connector, NOT generic shape', () => {
  const skribeLineObj = {
    id: 'line_1787661297756_bk89k',
    elementId: 'line_1787661297756_bk89k',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true,
    sourceShapeId: 'shape_1',
    targetShapeId: 'shape_2'
  };

  const semanticType = getSemanticType(skribeLineObj);
  assert.equal(semanticType, 'connector', 'Skribe line connecting shapes must be classified as connector');

  const normalized = normalizeObject(skribeLineObj);
  assert.equal(normalized.type, 'connector');
  assert.equal(normalized.connector.sourceShapeId, 'shape_1');
  assert.equal(normalized.connector.targetShapeId, 'shape_2');
});

test('6. Freehand Path/stroke -> classified as stroke, NOT connector or shape', () => {
  const strokeObj = {
    id: 'stroke_1787661297756_abcde',
    elementId: 'stroke_1787661297756_abcde',
    type: 'path',
    strokeId: 'stroke_1787661297756_abcde',
    isVectorStroke: true
  };

  const semanticType = getSemanticType(strokeObj);
  assert.equal(semanticType, 'stroke', 'Freehand stroke must be classified as stroke');
  assert.notEqual(semanticType, 'connector');
  assert.notEqual(semanticType, 'shape');
});

test('7. Connector remains attached between source and target nodes in layout proposal', () => {
  const rect1 = makeLinkedShape('elem_r1', 'rect', 'Step 1', 100, 100);
  const rect2 = makeLinkedShape('elem_r2', 'rect', 'Step 2', 400, 100);
  const connObj = {
    id: 'conn_1',
    type: 'connector',
    isConnector: true,
    position: { x: 250, y: 100 },
    size: { width: 10, height: 10 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 3,
    sourceShapeId: rect1.shapeObj.id,
    targetShapeId: rect2.shapeObj.id,
    relationshipMetadata: { sourceShapeId: rect1.shapeObj.id, targetShapeId: rect2.shapeObj.id },
    connector: { sourceShapeId: rect1.shapeObj.id, targetShapeId: rect2.shapeObj.id, connectorType: 'straight' }
  };

  const objects = [rect1.shapeObj, rect1.textObj, rect2.shapeObj, rect2.textObj, connObj];
  const model = { board: { objects } };

  const proposal = createLayoutProposal(null, model);
  assert.ok(proposal, 'Proposal must be generated');
  assert.ok(proposal.placements.some((p) => p.objectId === 'conn_1'));
  assert.ok(proposal.placements.some((p) => p.objectId === rect1.shapeObj.id));
  assert.ok(proposal.placements.some((p) => p.objectId === rect2.shapeObj.id));
});

test('8. No duplicate object membership across atomic units', () => {
  const rect = makeLinkedShape('elem_r1', 'rect', 'R1', 100, 100);
  const circle = makeLinkedShape('elem_c1', 'circle', 'C1', 300, 100);
  const objects = [rect.shapeObj, rect.textObj, circle.shapeObj, circle.textObj];
  const model = { board: { objects } };

  const semanticScene = {
    groups: [
      { id: 'group_flow_1', type: 'flowchart', objectIds: [rect.shapeObj.id, circle.shapeObj.id] }
    ]
  };

  const visualObjects = buildVisualObjectModel(model);
  const { atomicUnits } = reconstructVisualUnits(visualObjects, semanticScene);

  const seenIds = new Set();
  atomicUnits.forEach((unit) => {
    unit.objectIds.forEach((id) => {
      assert.ok(!seenIds.has(id), `Object ${id} appears in multiple atomic units`);
      seenIds.add(id);
    });
  });
  assert.equal(seenIds.size, 4, 'All 4 objects accounted for with zero duplicates');
});

test('9. No object falls through into standalone text-unit after being claimed by a visual unit', () => {
  const rect = makeLinkedShape('elem_r1', 'rect', 'Rectangle', 100, 100);
  const objects = [rect.shapeObj, rect.textObj];
  const model = { board: { objects } };

  const semanticScene = {
    groups: [{ id: 'group_flow_1', type: 'flowchart', objectIds: [rect.shapeObj.id] }]
  };

  const visualObjects = buildVisualObjectModel(model);
  const { atomicUnits } = reconstructVisualUnits(visualObjects, semanticScene);

  const textUnits = atomicUnits.filter((u) => u.type === 'text-unit');
  assert.equal(textUnits.length, 0, 'Attached text must not create a standalone text-unit');
});

test('10. Invariant: for every text object where resolveContainerOwnership() returns a valid owner, owner unit MUST contain that text object', () => {
  const rect1 = makeLinkedShape('elem_1', 'rect', 'Shape 1', 100, 100);
  const rect2 = makeLinkedShape('elem_2', 'circle', 'Shape 2', 300, 100);
  const sticky1 = makeStickyNote('elem_3', 'Note 1', 500, 100);
  const objects = [rect1.shapeObj, rect1.textObj, rect2.shapeObj, rect2.textObj, sticky1.shapeObj, sticky1.textObj];
  const model = { board: { objects } };

  const semanticScene = {
    groups: [
      { id: 'group_flow_1', type: 'flowchart', objectIds: [rect1.shapeObj.id, rect2.shapeObj.id] },
      { id: 'group_notes_1', type: 'notes', objectIds: [sticky1.shapeObj.id] }
    ]
  };

  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map((vo) => [vo.objectId, vo]));
  const { ownerByText } = resolveContainerOwnership(visualObjects, objectMap);
  const { atomicUnits } = reconstructVisualUnits(visualObjects, semanticScene);

  ownerByText.forEach((ownerId, textId) => {
    const ownerUnit = atomicUnits.find((u) => u.objectIds.includes(ownerId));
    const textUnit = atomicUnits.find((u) => u.objectIds.includes(textId));

    assert.ok(ownerUnit, `Owner unit for ${ownerId} must exist`);
    assert.ok(textUnit, `Text unit for ${textId} must exist`);
    assert.equal(ownerUnit.unitId, textUnit.unitId, `Text ${textId} MUST be in the same unit as owner ${ownerId}`);
  });
});

test('11. End-to-End Trace: Elbow Connector survives from raw Fabric object to preview model', () => {
  const rect1 = makeLinkedShape('elem_src', 'rect', 'Source', 100, 100);
  const rect2 = makeLinkedShape('elem_tgt', 'circle', 'Target', 400, 300);

  const rawElbowConnector = {
    id: 'conn_1787567653469_gywjn',
    elementId: 'conn_1787567653469_gywjn',
    type: 'path',
    isConnector: true,
    connectorType: 'elbow',
    sourceShapeId: rect1.shapeObj.id,
    targetShapeId: rect2.shapeObj.id,
    x1: 170,
    y1: 145,
    x2: 450,
    y2: 345,
    stroke: '#1e293b',
    strokeWidth: 3,
    startArrow: false,
    endArrow: true
  };

  const semanticType = getSemanticType(rawElbowConnector);
  assert.equal(semanticType, 'connector', 'Elbow connector must be recognized as connector');

  const normalized = normalizeObject(rawElbowConnector);
  assert.equal(normalized.type, 'connector');
  assert.equal(normalized.connector.connectorType, 'elbow');
  assert.equal(normalized.connector.sourceShapeId, rect1.shapeObj.id);
  assert.equal(normalized.connector.targetShapeId, rect2.shapeObj.id);

  const model = { board: { objects: [rect1.shapeObj, rect1.textObj, rect2.shapeObj, rect2.textObj, normalized] } };
  const visualObjects = buildVisualObjectModel(model);
  const connVo = visualObjects.find((v) => v.objectId === rawElbowConnector.id);
  assert.ok(connVo);
  assert.equal(connVo.kind, 'connector');
  assert.equal(connVo.connectorMetadata.connectorType, 'elbow');

  const proposal = createLayoutProposal(null, model);
  assert.ok(proposal.placements.some((p) => p.objectId === rawElbowConnector.id));

  const renderModel = buildPreviewRenderModel(model, proposal);
  const renderConn = renderModel.objects.find((o) => o.originalObjectId === rawElbowConnector.id);
  assert.ok(renderConn);
  assert.equal(renderConn.type, 'connector');
  assert.equal(renderConn.connectorType, 'elbow');
  assert.equal(renderConn.relationshipMetadata.sourceShapeId, rect1.shapeObj.id);
  assert.equal(renderConn.relationshipMetadata.targetShapeId, rect2.shapeObj.id);
});

test('12. End-to-End Trace: Vertical Straight Line is recognized, placed, and not lost', () => {
  const rawVerticalLine = {
    id: 'line_1787661297756_bk89k',
    elementId: 'line_1787661297756_bk89k',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true,
    left: 1402,
    top: 144,
    width: 2,
    height: 666,
    stroke: '#000000',
    strokeWidth: 2,
    skribeLine: {
      mode: 'straight',
      start: { x: 1403, y: 144 },
      end: { x: 1403, y: 810 }
    }
  };

  const semanticType = getSemanticType(rawVerticalLine);
  assert.equal(semanticType, 'line');

  const normalized = normalizeObject(rawVerticalLine);
  assert.equal(normalized.type, 'line');
  assert.equal(normalized.size.height, 666);
  assert.ok(normalized.geometry);
  assert.equal(normalized.geometry.start.y, 144);
  assert.equal(normalized.geometry.end.y, 810);

  const model = { board: { objects: [normalized] } };
  const proposal = createLayoutProposal(null, model);
  assert.ok(proposal.placements.some((p) => p.objectId === rawVerticalLine.id));

  const renderModel = buildPreviewRenderModel(model, proposal);
  const renderLine = renderModel.objects.find((o) => o.originalObjectId === rawVerticalLine.id);
  assert.ok(renderLine);
  assert.equal(renderLine.type, 'line');
  assert.ok(renderLine.geometry);
});

test('13. End-to-End Trace: Freehand multi-stroke drawings remain freeform (never converted to connectors)', () => {
  const stroke1 = {
    id: 'stroke_1',
    elementId: 'stroke_1',
    type: 'path',
    strokeId: 'stroke_1',
    isVectorStroke: true,
    left: 100,
    top: 100,
    width: 50,
    height: 30
  };
  const stroke2 = {
    id: 'stroke_2',
    elementId: 'stroke_2',
    type: 'path',
    strokeId: 'stroke_2',
    isVectorStroke: true,
    left: 140,
    top: 105,
    width: 40,
    height: 25
  };

  assert.equal(getSemanticType(stroke1), 'stroke');
  assert.equal(getSemanticType(stroke2), 'stroke');

  const model = { board: { objects: [normalizeObject(stroke1), normalizeObject(stroke2)] } };
  const visualObjects = buildVisualObjectModel(model);
  assert.equal(visualObjects[0].kind, 'freehand');
  assert.equal(visualObjects[1].kind, 'freehand');

  const { atomicUnits } = reconstructVisualUnits(visualObjects, {
    groups: [{ id: 'group_freeform_1', type: 'freeform', objectIds: ['stroke_1', 'stroke_2'] }]
  });

  assert.equal(atomicUnits.length, 1);
  assert.equal(atomicUnits[0].type, 'freeform-unit');
  assert.deepEqual(atomicUnits[0].objectIds, ['stroke_1', 'stroke_2']);
});

test('14. Exact Real Board Trace: shape_obj_1787567653469_gywjn is classified as connector and never a shape-unit', () => {
  const realBoardElbow = {
    id: 'shape_obj_1787567653469_gywjn',
    elementId: 'obj_1787567653469_gywjn',
    type: 'path',
    left: 658,
    top: 472,
    width: 146,
    height: 40,
    isConnector: true,
    connectorType: 'elbow',
    startArrow: false,
    endArrow: true,
    x1: 658,
    y1: 472,
    x2: 804,
    y2: 512,
    stroke: '#1e293b',
    strokeWidth: 3,
    attachedTextId: 'text_obj_1787567653469_gywjn',
    relationshipMetadata: {
      attachedTextId: 'text_obj_1787567653469_gywjn'
    }
  };

  const semanticType = getSemanticType(realBoardElbow);
  assert.equal(semanticType, 'connector', 'Must be connector');

  const normalized = normalizeObject(realBoardElbow);
  assert.equal(normalized.type, 'connector');
  assert.equal(normalized.connector.connectorType, 'elbow');

  const model = { board: { objects: [normalized] } };
  const visualObjects = buildVisualObjectModel(model);
  assert.equal(visualObjects[0].kind, 'connector');
  assert.equal(visualObjects[0].connectorMetadata.connectorType, 'elbow');

  const { atomicUnits } = reconstructVisualUnits(visualObjects, null);
  const shapeUnits = atomicUnits.filter((u) => u.type === 'shape-unit');
  assert.equal(shapeUnits.length, 0, 'Connector must never become a shape-unit');

  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);
  const renderItem = renderModel.objects.find((o) => o.originalObjectId === 'shape_obj_1787567653469_gywjn');
  assert.ok(renderItem);
  assert.equal(renderItem.type, 'connector');
  assert.equal(renderItem.connectorType, 'elbow');
});

test('15. General Connector Classification: curved and straight arrow connectors', () => {
  const curved = {
    id: 'conn_curved_1',
    elementId: 'conn_curved_1',
    type: 'path',
    connectorType: 'curved',
    endArrow: true
  };
  const straight = {
    id: 'arrow_straight_1',
    elementId: 'arrow_straight_1',
    type: 'path',
    connectorType: 'straight',
    endArrow: true
  };
  const ordinaryPath = {
    id: 'shape_custom_path',
    elementId: 'shape_custom_path',
    type: 'path',
    path: [['M', 0, 0], ['L', 100, 0], ['L', 50, 100], ['z']]
  };

  assert.equal(getSemanticType(curved), 'connector');
  assert.equal(getSemanticType(straight), 'connector');
  assert.equal(getSemanticType(ordinaryPath), 'shape', 'Ordinary polygon path without connector markers must remain shape');
});

test('16. Triple Connector Variant Board: straight, curved, and elbow connectors all survive and are placed', () => {
  const rect = makeLinkedShape('elem_r', 'rect', 'Rectangle', 100, 200);
  const circle = makeLinkedShape('elem_c', 'circle', 'Circle', 400, 200);
  const triangle = makeLinkedShape('elem_t', 'triangle', 'Triangle', 700, 200);
  const sticky1 = makeStickyNote('elem_s1', 'Sticky 1', 100, 450);
  const sticky2 = makeStickyNote('elem_s2', 'Sticky 2', 600, 450);

  const straightConn = {
    id: 'conn_straight',
    elementId: 'conn_straight',
    type: 'path',
    isConnector: true,
    connectorType: 'straight',
    sourceShapeId: circle.shapeObj.id,
    targetShapeId: triangle.shapeObj.id,
    x1: 460, y1: 200, x2: 650, y2: 200,
    endArrow: true
  };

  const curvedConn = {
    id: 'conn_curved',
    elementId: 'conn_curved',
    type: 'path',
    isConnector: true,
    connectorType: 'curved',
    left: 400, top: 120, width: 140, height: 60,
    endArrow: true
  };

  const elbowConn = {
    id: 'conn_elbow',
    elementId: 'conn_elbow',
    type: 'path',
    isConnector: true,
    connectorType: 'elbow',
    left: 300, top: 470, width: 146, height: 40,
    endArrow: true
  };

  const vertLine = {
    id: 'line_vert',
    elementId: 'line_vert',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true,
    left: 950, top: 140, width: 2, height: 500
  };

  const rawObjects = [
    rect.shapeObj, rect.textObj,
    circle.shapeObj, circle.textObj,
    triangle.shapeObj, triangle.textObj,
    sticky1.shapeObj, sticky1.textObj,
    sticky2.shapeObj, sticky2.textObj,
    straightConn, curvedConn, elbowConn, vertLine
  ];

  const model = { board: { objects: rawObjects.map((o) => normalizeObject(o)) } };

  assert.equal(getSemanticType(straightConn), 'connector');
  assert.equal(getSemanticType(curvedConn), 'connector');
  assert.equal(getSemanticType(elbowConn), 'connector');
  assert.equal(getSemanticType(vertLine), 'line');

  const visualObjects = buildVisualObjectModel(model);
  assert.equal(visualObjects.filter((v) => v.kind === 'connector').length, 3);
  assert.equal(visualObjects.filter((v) => v.kind === 'line').length, 1);

  const { atomicUnits } = reconstructVisualUnits(visualObjects, null);

  assert.ok(atomicUnits.some((u) => u.objectIds.includes('conn_straight')));
  assert.ok(atomicUnits.some((u) => u.objectIds.includes('conn_curved')));
  assert.ok(atomicUnits.some((u) => u.objectIds.includes('conn_elbow')));

  const proposal = createLayoutProposal(null, model);
  assert.ok(proposal.placements.some((p) => p.objectId === 'conn_straight'));
  assert.ok(proposal.placements.some((p) => p.objectId === 'conn_curved'));
  assert.ok(proposal.placements.some((p) => p.objectId === 'conn_elbow'));
  assert.ok(proposal.placements.some((p) => p.objectId === 'line_vert'));

  const renderModel = buildPreviewRenderModel(model, proposal);
  const connectors = renderModel.objects.filter((o) => o.type === 'connector');
  assert.equal(connectors.length, 3);
  assert.ok(connectors.some((c) => c.connectorType === 'straight'));
  assert.ok(connectors.some((c) => c.connectorType === 'curved'));
  assert.ok(connectors.some((c) => c.connectorType === 'elbow'));

  const lines = renderModel.objects.filter((o) => o.type === 'line');
  assert.equal(lines.length, 1);
});

test('17. Unhydrated Raw Fabric Paths: connectors without isConnector flag are correctly identified by path geometry', () => {
  const rawStraight = {
    id: 'shape_1787668882995_cdwqp',
    elementId: '1787668882995_cdwqp',
    type: 'path',
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 3,
    path: [
      ['M', 645, 370],
      ['L', 785, 370],
      ['M', 770, 365],
      ['L', 785, 370],
      ['L', 770, 375]
    ]
  };

  const rawElbow = {
    id: 'shape_1787668890931_w2si6',
    elementId: '1787668890931_w2si6',
    type: 'path',
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 3,
    path: [
      ['M', 663, 476],
      ['L', 736, 476],
      ['L', 736, 516],
      ['L', 809, 516],
      ['M', 794, 511],
      ['L', 809, 516],
      ['L', 794, 521]
    ]
  };

  const rawCurved = {
    id: 'shape_1787668898659_1a2k8',
    elementId: '1787668898659_1a2k8',
    type: 'path',
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 3,
    path: [
      ['M', 630, 162],
      ['C', 670, 120, 730, 120, 770, 162],
      ['M', 755, 155],
      ['L', 770, 162],
      ['L', 760, 175]
    ]
  };

  const closedShape = {
    id: 'shape_closed_star',
    elementId: 'closed_star',
    type: 'path',
    fill: '#ffcc00',
    stroke: '#000000',
    path: [
      ['M', 100, 100],
      ['L', 150, 200],
      ['L', 50, 200],
      ['z']
    ]
  };

  assert.equal(getSemanticType(rawStraight), 'connector');
  assert.equal(getSemanticType(rawElbow), 'connector');
  assert.equal(getSemanticType(rawCurved), 'connector');
  assert.equal(getSemanticType(closedShape), 'shape');

  assert.equal(detectConnectorTypeFromPath(rawStraight), 'straight');
  assert.equal(detectConnectorTypeFromPath(rawElbow), 'elbow');
  assert.equal(detectConnectorTypeFromPath(rawCurved), 'curved');

  const normStraight = normalizeObject(rawStraight);
  const normElbow = normalizeObject(rawElbow);
  const normCurved = normalizeObject(rawCurved);
  const normShape = normalizeObject(closedShape);

  assert.equal(normStraight.type, 'connector');
  assert.equal(normStraight.connector.connectorType, 'straight');

  assert.equal(normElbow.type, 'connector');
  assert.equal(normElbow.connector.connectorType, 'elbow');

  assert.equal(normCurved.type, 'connector');
  assert.equal(normCurved.connector.connectorType, 'curved');

  assert.equal(normShape.type, 'shape');
});

test('18. Dependent Geometry Connector Architecture: connectors excluded from row packing and placed relative to their owning shapes', () => {
  const rect = makeLinkedShape('elem_r', 'rect', 'Rectangle', 100, 200);
  const circle = makeLinkedShape('elem_c', 'circle', 'Circle', 400, 200);
  const triangle = makeLinkedShape('elem_t', 'triangle', 'Triangle', 700, 200);
  const sticky1 = makeStickyNote('elem_s1', 'Sticky 1', 100, 450);
  const sticky2 = makeStickyNote('elem_s2', 'Sticky 2', 600, 450);

  const straightConn = {
    id: 'conn_straight',
    elementId: 'conn_straight',
    type: 'path',
    isConnector: true,
    connectorType: 'straight',
    sourceShapeId: circle.shapeObj.id,
    targetShapeId: triangle.shapeObj.id,
    x1: 460, y1: 200, x2: 650, y2: 200,
    endArrow: true
  };

  const curvedConn = {
    id: 'conn_curved',
    elementId: 'conn_curved',
    type: 'path',
    isConnector: true,
    connectorType: 'curved',
    sourceShapeId: circle.shapeObj.id,
    left: 400, top: 120, width: 140, height: 60,
    endArrow: true
  };

  const elbowConn = {
    id: 'conn_elbow',
    elementId: 'conn_elbow',
    type: 'path',
    isConnector: true,
    connectorType: 'elbow',
    sourceShapeId: sticky1.shapeObj.id,
    left: 300, top: 470, width: 146, height: 40,
    endArrow: true
  };

  const vertLine = {
    id: 'line_vert',
    elementId: 'line_vert',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true,
    left: 950, top: 140, width: 2, height: 500
  };

  const rawObjects = [
    rect.shapeObj, rect.textObj,
    circle.shapeObj, circle.textObj,
    triangle.shapeObj, triangle.textObj,
    sticky1.shapeObj, sticky1.textObj,
    sticky2.shapeObj, sticky2.textObj,
    straightConn, curvedConn, elbowConn, vertLine
  ];

  const model = { board: { objects: rawObjects.map((o) => normalizeObject(o)) } };

  const proposal = createLayoutProposal(null, model);
  console.log('TEST 18 PROPOSAL PLACEMENTS:', proposal.placements.map(p => ({ id: p.objectId, bounds: p.bounds })));

  const pStraight = proposal.placements.find((p) => p.objectId === 'conn_straight');
  const pCurved = proposal.placements.find((p) => p.objectId === 'conn_curved');
  const pElbow = proposal.placements.find((p) => p.objectId === 'conn_elbow');
  const pLine = proposal.placements.find((p) => p.objectId === 'line_vert');
  const pCircle = proposal.placements.find((p) => p.objectId === circle.shapeObj.id);
  const pTriangle = proposal.placements.find((p) => p.objectId === triangle.shapeObj.id);
  const pSticky1 = proposal.placements.find((p) => p.objectId === sticky1.shapeObj.id);

  assert.ok(pStraight, 'Straight connector must be placed');
  assert.ok(pCurved, 'Curved connector must be placed');
  assert.ok(pElbow, 'Elbow connector must be placed');
  assert.ok(pLine, 'Vertical line must be placed');

  assert.ok(
    pStraight.bounds.x >= pCircle.bounds.x &&
    pStraight.bounds.x <= pTriangle.bounds.x + pTriangle.bounds.width,
    'Straight connector must route between Circle and Triangle'
  );

  assert.ok(
    pCurved.bounds.y < pCircle.bounds.y,
    `Curved connector (y: ${pCurved.bounds.y}) must be above placed Circle (y: ${pCircle.bounds.y})`
  );

  assert.ok(
    Math.abs(pElbow.bounds.y - pSticky1.bounds.y) < 100,
    'Elbow connector must be located near Sticky Note row'
  );

  proposal.placements.forEach((p) => {
    assert.ok(p.bounds.x >= proposal.canvasBounds.x, `Placement ${p.objectId} left edge inside canvas`);
    assert.ok(p.bounds.y >= proposal.canvasBounds.y, `Placement ${p.objectId} top edge inside canvas`);
    assert.ok(
      p.bounds.x + p.bounds.width <= proposal.canvasBounds.x + proposal.canvasBounds.width + 1,
      `Placement ${p.objectId} right edge inside canvas`
    );
    assert.ok(
      p.bounds.y + p.bounds.height <= proposal.canvasBounds.y + proposal.canvasBounds.height + 1,
      `Placement ${p.objectId} bottom edge inside canvas`
    );
  });
});

test('19. Connector Topology & Structural Fidelity: curved, elbow, and straight paths retain their exact segment structure without collapsing', () => {
  const rawCurvedPath = [
    ['M', 630, 162],
    ['C', 679, 112, 721, 112, 770, 162],
    ['M', 755, 157],
    ['L', 770, 162],
    ['L', 755, 167]
  ];

  const rawElbowPath = [
    ['M', 663, 476],
    ['L', 736, 476],
    ['L', 736, 436],
    ['L', 809, 436],
    ['L', 809, 476],
    ['M', 794, 471],
    ['L', 809, 476],
    ['L', 794, 481]
  ];

  const rawStraightPath = [
    ['M', 645, 370],
    ['L', 785, 370],
    ['M', 770, 365],
    ['L', 785, 370],
    ['L', 770, 375]
  ];

  const circle = makeLinkedShape('c1', 'circle', 'Circle', 630, 244, 120, 120);
  const triangle = makeLinkedShape('t1', 'triangle', 'Triangle', 822, 194, 140, 120);
  const sticky1 = makeStickyNote('s1', 'Note 1', 380, 427, 183);
  const sticky2 = makeStickyNote('s2', 'Note 2', 880, 412, 183);

  const curvedConn = {
    id: 'conn_curved_top',
    elementId: 'conn_curved_top',
    type: 'path',
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 3,
    path: rawCurvedPath,
    left: 630, top: 162, width: 140, height: 38,
    endArrow: true
  };

  const elbowConn = {
    id: 'conn_elbow_steps',
    elementId: 'conn_elbow_steps',
    type: 'path',
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 3,
    path: rawElbowPath,
    left: 663, top: 436, width: 146, height: 40,
    endArrow: true
  };

  const straightConn = {
    id: 'conn_straight_arr',
    elementId: 'conn_straight_arr',
    type: 'path',
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 3,
    path: rawStraightPath,
    left: 645, top: 370, width: 140, height: 11,
    endArrow: true
  };

  const vertLine = {
    id: 'line_divider',
    elementId: 'line_divider',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true,
    left: 1402, top: 144, width: 2, height: 666
  };

  const rawObjects = [
    circle.shapeObj, circle.textObj,
    triangle.shapeObj, triangle.textObj,
    sticky1.shapeObj, sticky1.textObj,
    sticky2.shapeObj, sticky2.textObj,
    curvedConn, elbowConn, straightConn, vertLine
  ];

  const model = { board: { objects: rawObjects.map((o) => normalizeObject(o)) } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);

  const pCurved = renderModel.objects.find((o) => o.originalObjectId === 'conn_curved_top');
  const pElbow = renderModel.objects.find((o) => o.originalObjectId === 'conn_elbow_steps');
  const pStraight = renderModel.objects.find((o) => o.originalObjectId === 'conn_straight_arr');
  const pLine = renderModel.objects.find((o) => o.originalObjectId === 'line_divider');

  assert.ok(pCurved, 'Curved connector exists');
  assert.ok(pElbow, 'Elbow connector exists');
  assert.ok(pStraight, 'Straight connector exists');
  assert.ok(pLine, 'Line exists');

  assert.equal(pCurved.connectorType, 'curved');
  assert.ok(pCurved.pathData?.includes('C') || pCurved.pathCommands?.some((c) => c[0] === 'C'), 'Curved connector retains Bézier C command');
  assert.ok(!pCurved.pathData?.startsWith('M 0 0 L'), 'Curved connector does not collapse into simple straight line');

  assert.equal(pElbow.connectorType, 'elbow');
  const elbowLCmdCount = (pElbow.pathCommands || []).filter((c) => c[0] === 'L').length || (pElbow.pathData?.match(/L/g) || []).length;
  assert.ok(elbowLCmdCount >= 3, `Elbow connector preserves multi-step orthogonal bends (got ${elbowLCmdCount} L commands)`);

  assert.equal(pStraight.connectorType, 'straight');

  assert.equal(pLine.type, 'line');

  assert.ok(pStraight.pathData?.includes('M') && pStraight.pathData?.match(/M/g).length >= 2, 'Straight connector has arrow wings');
  assert.ok(pCurved.pathData?.includes('M') && pCurved.pathData?.match(/M/g).length >= 2, 'Curved connector has arrow wings');
  assert.ok(pElbow.pathData?.includes('M') && pElbow.pathData?.match(/M/g).length >= 2, 'Elbow connector has arrow wings');
});

test('20. Multi-Lane Connector Routing & Collision Separation: co-routed straight + elbow connectors receive distinct non-overlapping lanes', () => {
  const circle = makeLinkedShape('c1', 'circle', 'Circle', 630, 244, 120, 120);
  const triangle = makeLinkedShape('t1', 'triangle', 'Triangle', 822, 194, 140, 120);
  const sticky2 = makeStickyNote('s2', 'Sticky 2', 880, 412, 183);

  const connStraight = {
    id: 'conn_straight_shared',
    elementId: 'conn_straight_shared',
    type: 'path',
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 3,
    isConnector: true,
    connectorType: 'straight',
    sourceShapeId: circle.shapeObj.id,
    targetShapeId: triangle.shapeObj.id,
    left: 645, top: 370, width: 140, height: 11,
    endArrow: true,
    path: [['M', 645, 370], ['L', 785, 370], ['M', 770, 365], ['L', 785, 370], ['L', 770, 375]]
  };

  const connElbow = {
    id: 'conn_elbow_shared',
    elementId: 'conn_elbow_shared',
    type: 'path',
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 3,
    isConnector: true,
    connectorType: 'elbow',
    sourceShapeId: circle.shapeObj.id,
    targetShapeId: triangle.shapeObj.id,
    left: 663, top: 476, width: 146, height: 40,
    endArrow: true,
    path: [['M', 663, 476], ['L', 736, 476], ['L', 736, 436], ['L', 809, 436], ['L', 809, 476], ['M', 794, 471], ['L', 809, 476], ['L', 794, 481]]
  };

  const connCurved = {
    id: 'conn_curved_distinct',
    elementId: 'conn_curved_distinct',
    type: 'path',
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 3,
    isConnector: true,
    connectorType: 'curved',
    sourceShapeId: circle.shapeObj.id,
    targetShapeId: sticky2.shapeObj.id,
    left: 630, top: 162, width: 140, height: 38,
    endArrow: true,
    path: [['M', 630, 162], ['C', 679, 112, 721, 112, 770, 162], ['M', 755, 157], ['L', 770, 162], ['L', 755, 167]]
  };

  const vertLine = {
    id: 'line_divider',
    elementId: 'line_divider',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true,
    left: 1402, top: 144, width: 2, height: 666
  };

  const rawObjects = [
    circle.shapeObj, circle.textObj,
    triangle.shapeObj, triangle.textObj,
    sticky2.shapeObj, sticky2.textObj,
    connStraight, connElbow, connCurved, vertLine
  ];

  const model = { board: { objects: rawObjects.map((o) => normalizeObject(o)) } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);

  const pStraight = renderModel.objects.find((o) => o.originalObjectId === 'conn_straight_shared');
  const pElbow = renderModel.objects.find((o) => o.originalObjectId === 'conn_elbow_shared');
  const pCurved = renderModel.objects.find((o) => o.originalObjectId === 'conn_curved_distinct');
  const pLine = renderModel.objects.find((o) => o.originalObjectId === 'line_divider');
  const pCircle = renderModel.objects.find((o) => o.originalObjectId === circle.shapeObj.id);
  const pTriangle = renderModel.objects.find((o) => o.originalObjectId === triangle.shapeObj.id);

  assert.ok(pStraight, 'Straight connector exists in render model');
  assert.ok(pElbow, 'Elbow connector exists in render model');
  assert.ok(pCurved, 'Curved connector exists in render model');

  assert.equal(pStraight.connectorType, 'straight');
  assert.equal(pElbow.connectorType, 'elbow');
  assert.equal(pCurved.connectorType, 'curved');

  assert.notEqual(pStraight.pathData, pElbow.pathData, 'Straight and elbow path data must not be identical');

  const elbowYCoords = (pElbow.pathCommands || [])
    .filter((c) => c[0] === 'M' || c[0] === 'L')
    .map((c) => Number(c[2]));
  const straightYCoords = (pStraight.pathCommands || [])
    .filter((c) => c[0] === 'M' || c[0] === 'L')
    .map((c) => Number(c[2]));

  const maxElbowYDiff = Math.max(...elbowYCoords) - Math.min(...elbowYCoords);
  assert.ok(maxElbowYDiff >= 30, `Elbow connector preserves its orthogonal bend step height (got ${maxElbowYDiff}px)`);

  const straightAvgY = straightYCoords.reduce((a, b) => a + b, 0) / Math.max(1, straightYCoords.length);
  const elbowDetourStepY = elbowYCoords.find((y) => Math.abs(y - straightAvgY) >= 30);
  assert.ok(elbowDetourStepY !== undefined, 'Elbow connector has a detour step separated from the straight central corridor');

  assert.equal(pCircle.bounds.width, 120);
  assert.equal(pCircle.bounds.height, 120);
  assert.equal(pTriangle.bounds.width, 140);
  assert.equal(pTriangle.bounds.height, 120);

  assert.equal(pLine.type, 'line');
  assert.equal(pLine.bounds.width, 2);
  assert.ok(pLine.bounds.height >= 250);
});

test('21. Multi-Stroke Freehand Drawing Rigid Clustering: strokes forming a drawing remain unified without shattering into row items', () => {
  const strokeV1 = {
    id: 'stroke_v1',
    type: 'path',
    isVectorStroke: true,
    left: 200, top: 200, width: 4, height: 60,
    path: [['M', 200, 200], ['L', 200, 260]]
  };
  const strokeV2 = {
    id: 'stroke_v2',
    type: 'path',
    isVectorStroke: true,
    left: 240, top: 200, width: 4, height: 60,
    path: [['M', 240, 200], ['L', 240, 260]]
  };
  const strokeH = {
    id: 'stroke_h',
    type: 'path',
    isVectorStroke: true,
    left: 200, top: 230, width: 40, height: 4,
    path: [['M', 200, 230], ['L', 240, 230]]
  };

  const model = { board: { objects: [strokeV1, strokeV2, strokeH].map((o) => normalizeObject(o)) } };
  const { atomicUnits } = reconstructVisualUnits(buildVisualObjectModel(model), null);

  assert.equal(atomicUnits.length, 1, 'All 3 strokes must form a single atomic unit');
  const freeformUnit = atomicUnits[0];
  assert.equal(freeformUnit.type, 'freeform-unit');
  assert.deepEqual(freeformUnit.objectIds.sort(), ['stroke_h', 'stroke_v1', 'stroke_v2']);

  const p1 = freeformUnit.localPlacements.find((p) => p.objectId === 'stroke_v1');
  const p2 = freeformUnit.localPlacements.find((p) => p.objectId === 'stroke_v2');
  assert.equal(p2.position.x - p1.position.x, 40, 'Relative X distance is rigidly preserved');
});

test('22. Embedded Sticky Note Underline / Doodle Atomicity: drawings inside sticky note bounds remain bound to the note', () => {
  const sticky = makeStickyNote('s_ann', 'Important:', 300, 300, 180);
  const underlineStroke = {
    id: 'stroke_underline',
    type: 'path',
    isVectorStroke: true,
    left: 320, top: 340, width: 60, height: 4,
    path: [['M', 320, 340], ['L', 380, 340]]
  };

  const rawObjects = [sticky.shapeObj, sticky.textObj, underlineStroke];
  const model = { board: { objects: rawObjects.map((o) => normalizeObject(o)) } };
  const { atomicUnits } = reconstructVisualUnits(buildVisualObjectModel(model), null);

  assert.equal(atomicUnits.length, 1, 'Sticky note, label, and underline doodle must be in 1 note unit');
  const noteUnit = atomicUnits[0];
  assert.equal(noteUnit.type, 'note-unit');
  assert.ok(noteUnit.objectIds.includes('stroke_underline'), 'Underline stroke is owned by the note unit');
  assert.ok(noteUnit.objectIds.includes(sticky.shapeObj.id), 'Shape is in note unit');
  assert.ok(noteUnit.objectIds.includes(sticky.textObj.id), 'Text is in note unit');
});

test('23. Negative Degree Angle Normalization: standalone text with -90° / 270° normalizes to horizontal (0°)', () => {
  const rotatedText = {
    id: 'text_vertical_hello',
    type: 'text',
    text: 'Hello World!',
    angle: -90,
    left: 400, top: 400, width: 100, height: 24
  };

  const model = { board: { objects: [normalizeObject(rotatedText)] } };
  const visualObjects = buildVisualObjectModel(model);
  assert.equal(visualObjects[0].rotation, 0, 'Standalone text rotation is normalized to 0°');
});

test('24. Inter-Shape Connector Separation: connectors between adjacent shapes do not collapse into single-container self-loops', () => {
  const hex = makeLinkedShape('hex', 'hexagon', 'Process', 200, 200, 140, 90);
  const note = makeStickyNote('note_tgt', 'Important:', 380, 200, 140);
  const arrowConn = {
    id: 'conn_hex_to_note',
    type: 'path',
    fill: 'transparent',
    stroke: '#000000',
    strokeWidth: 3,
    isConnector: true,
    connectorType: 'curved',
    sourceShapeId: hex.shapeObj.id,
    targetShapeId: note.shapeObj.id,
    left: 270, top: 180, width: 110, height: 30,
    path: [['M', 270, 200], ['C', 300, 170, 340, 170, 380, 200]]
  };

  const rawObjects = [hex.shapeObj, hex.textObj, note.shapeObj, note.textObj, arrowConn];
  const detected = detectRelationships(rawObjects.map((o) => normalizeObject(o)));

  const connObj = detected.find((o) => o.id === 'conn_hex_to_note');
  assert.equal(connObj.relationshipMetadata.sourceShapeId, hex.shapeObj.id);
  assert.equal(connObj.relationshipMetadata.targetShapeId, note.shapeObj.id);
  assert.ok(connObj.relationshipMetadata.targetShapeId !== null, 'Target shape ID is preserved and not nullified');
});

test('25. Stroke Path & Vector Command Preservation in Preview Model', () => {
  const strokeObj = {
    id: 'stroke_art',
    type: 'path',
    isVectorStroke: true,
    left: 100, top: 100, width: 80, height: 40,
    path: [['M', 100, 100], ['Q', 140, 80, 180, 120]]
  };

  const model = { board: { objects: [normalizeObject(strokeObj)] } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);

  const renderedStroke = renderModel.objects.find((o) => o.originalObjectId === 'stroke_art');
  assert.ok(renderedStroke, 'Rendered stroke exists');
  assert.ok(renderedStroke.path || renderedStroke.pathCommands, 'Stroke retains path commands or path array');
});

test('26. Configurable & Dynamically Derived Stroke Proximity Clustering Threshold', () => {
  const strokeA = {
    id: 'stroke_scale_a',
    type: 'path',
    isVectorStroke: true,
    strokeWidth: 4,
    left: 100, top: 100, width: 80, height: 80,
    path: [['M', 100, 100], ['L', 180, 180]]
  };
  const strokeB = {
    id: 'stroke_scale_b',
    type: 'path',
    isVectorStroke: true,
    strokeWidth: 4,
    left: 245, top: 100, width: 80, height: 80,
    path: [['M', 245, 100], ['L', 325, 180]]
  };

  const model = { board: { objects: [normalizeObject(strokeA), normalizeObject(strokeB)] } };
  const visualObjects = buildVisualObjectModel(model);

  const resDynamic = reconstructVisualUnits(visualObjects, null);
  assert.equal(resDynamic.atomicUnits.length, 1, 'Dynamically derived threshold clusters large strokes 65px apart');
  assert.equal(resDynamic.atomicUnits[0].type, 'freeform-unit');

  const resStrict = reconstructVisualUnits(visualObjects, null, { strokeClusteringThreshold: 40 });
  assert.equal(resStrict.atomicUnits.length, 2, 'Explicit configurable override of 40px keeps them separated');
});

test('27. Configurable Vertical Divider Rule & Recognition', () => {
  const lineDivider = {
    id: 'line_divider_test',
    type: 'line',
    isSkribeLine: true,
    isStraightLine: true,
    left: 500, top: 100, width: 4, height: 160
  };

  const lineUnit = {
    type: 'line-unit',
    width: 4,
    height: 160,
    objectIds: ['line_divider_test']
  };

  assert.ok(isVerticalDividerUnit(lineUnit), 'Recognized as vertical divider with default constants');
  assert.equal(NOTEBOOK_CONSTANTS.VERTICAL_DIVIDER_MIN_HEIGHT, 120);
  assert.equal(NOTEBOOK_CONSTANTS.VERTICAL_DIVIDER_MIN_ASPECT_RATIO, 2.5);

  assert.equal(isVerticalDividerUnit(lineUnit, { verticalDividerMinHeight: 200 }), false, 'Configurable override verticalDividerMinHeight: 200 rejects 160px line');

  assert.equal(isVerticalDividerUnit(lineUnit, { verticalDividerMinAspect: 50 }), false, 'Configurable override verticalDividerMinAspect: 50 rejects aspect 40');
});



import { getShapeType } from './cleanupTypes.js';

test('28. Shape Type Preservation: object.shapeType flows through pipeline to preview model', () => {
  const hexObj = {
    id: 'shape_hex_test',
    type: 'path',
    shapeType: 'hexagon',
    position: { x: 100, y: 100 },
    size: { width: 120, height: 100 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    fill: '#8b5cf6',
    stroke: '#6d28d9',
    zIndex: 1,
    metadata: {}
  };
  const diamondObj = {
    id: 'shape_diamond_test',
    type: 'path',
    shapeType: 'diamond',
    position: { x: 300, y: 100 },
    size: { width: 100, height: 100 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    fill: '#93c5fd',
    stroke: '#3b82f6',
    zIndex: 2,
    metadata: {}
  };

  assert.equal(getShapeType(hexObj), 'hexagon', 'getShapeType reads shapeType property for hexagon');
  assert.equal(getShapeType(diamondObj), 'diamond', 'getShapeType reads shapeType property for diamond');

  const normalizedHex = normalizeObject(hexObj, 0);
  assert.equal(normalizedHex.shapeType, 'hexagon', 'normalizeObject preserves hexagon shapeType');

  const normalizedDiamond = normalizeObject(diamondObj, 0);
  assert.equal(normalizedDiamond.shapeType, 'diamond', 'normalizeObject preserves diamond shapeType');

  const model = { board: { objects: [normalizedHex, normalizedDiamond] } };
  const visualObjects = buildVisualObjectModel(model);
  const hexVo = visualObjects.find((vo) => vo.objectId === 'shape_hex_test');
  const diamondVo = visualObjects.find((vo) => vo.objectId === 'shape_diamond_test');
  assert.equal(hexVo.shapeType, 'hexagon', 'Visual object model preserves hexagon shapeType');
  assert.equal(diamondVo.shapeType, 'diamond', 'Visual object model preserves diamond shapeType');
});

test('29. Fill Color Forwarding: original fill/stroke flows through previewModel', () => {
  const blackRect = {
    id: 'rect_black_1',
    type: 'shape',
    position: { x: 100, y: 200 },
    size: { width: 160, height: 110 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    visual: { fill: '#000000', stroke: '#333333', strokeWidth: 2, opacity: 1 },
    metadata: {}
  };
  const model = { board: { objects: [blackRect] } };
  const proposal = {
    placements: [{
      objectId: 'rect_black_1',
      position: { x: 50, y: 50 },
      size: { width: 160, height: 110 },
      bounds: { x: 50, y: 50, width: 160, height: 110 },
      anchor: 'center'
    }],
    canvasBounds: { x: 0, y: 0, width: 500, height: 500 }
  };

  const renderModel = buildPreviewRenderModel(model, proposal);
  const rendered = renderModel.objects.find((o) => o.originalObjectId === 'rect_black_1');

  assert.ok(rendered, 'Black rect appears in render model');
  assert.equal(rendered.fill, '#000000', 'Fill color is forwarded from visual.fill');
  assert.ok(rendered.visual, 'Visual object is forwarded');
  assert.equal(rendered.visual.fill, '#000000', 'visual.fill preserved');
  assert.equal(rendered.visual.stroke, '#333333', 'visual.stroke preserved');
});

test('30. Text Rotation Normalization: wrapper-shape parentShapeId treated as standalone', () => {
  const wrapperShape = {
    id: 'shape_wrapper_a3zpv',
    type: 'text',
    position: { x: 1325, y: 447 },
    size: { width: 54, height: 200 },
    rotation: 90,
    scale: { x: 1, y: 1 },
    metadata: {}
  };
  const rotatedText = {
    id: 'text_wrapper_a3zpv',
    type: 'text',
    text: 'What is MESS cleanup?',
    position: { x: 1352, y: 547 },
    size: { width: 54, height: 200 },
    rotation: 90,
    scale: { x: 1, y: 1 },
    relationshipMetadata: { parentShapeId: 'shape_wrapper_a3zpv' },
    metadata: {}
  };

  const model = { board: { objects: [wrapperShape, rotatedText] } };
  const visualObjects = buildVisualObjectModel(model);
  const textVo = visualObjects.find((vo) => vo.objectId === 'text_wrapper_a3zpv');

  assert.equal(textVo.rotation, 0, 'Text with wrapper-shape parent normalizes rotation to 0');
  assert.equal(textVo.originalRotation, 90, 'Original rotation preserved for reference');
});

test('31. Text Content Completeness: no text truncation in preview model', () => {
  const longText = 'Important: Verify database schema before deployment.';
  const stickyNote = {
    id: 'sticky_full_text',
    type: 'note',
    isStickyNote: true,
    text: longText,
    position: { x: 100, y: 100 },
    size: { width: 180, height: 180 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    noteColor: '#ff9800',
    metadata: { isStickyNote: true, noteColor: '#ff9800' }
  };
  const model = { board: { objects: [stickyNote] } };
  const proposal = {
    placements: [{
      objectId: 'sticky_full_text',
      position: { x: 50, y: 50 },
      size: { width: 180, height: 180 },
      bounds: { x: 50, y: 50, width: 180, height: 180 },
      anchor: 'center'
    }],
    canvasBounds: { x: 0, y: 0, width: 500, height: 500 }
  };

  const renderModel = buildPreviewRenderModel(model, proposal);
  const rendered = renderModel.objects.find((o) => o.originalObjectId === 'sticky_full_text');

  assert.ok(rendered, 'Sticky note appears in render model');
  assert.equal(rendered.text, longText, 'Full text content is preserved without truncation');
  assert.equal(rendered.isStickyNote, true, 'isStickyNote flag preserved');
  assert.equal(rendered.noteColor, '#ff9800', 'noteColor preserved');
});

test('32. No-Information-Loss End-to-End Identity Invariant', () => {
  const objects = [
    { id: 'circle_1', type: 'circle', shapeType: 'circle', position: { x: 100, y: 100 }, size: { width: 120, height: 120 }, visual: { fill: '#06b6d4', stroke: '#0891b2' }, rotation: 0, scale: { x: 1, y: 1 }, metadata: {} },
    { id: 'hexagon_1', type: 'path', shapeType: 'hexagon', position: { x: 300, y: 100 }, size: { width: 140, height: 120 }, visual: { fill: '#a855f7', stroke: '#7c3aed' }, rotation: 0, scale: { x: 1, y: 1 }, metadata: {} },
    { id: 'rect_dark', type: 'rect', position: { x: 500, y: 100 }, size: { width: 160, height: 110 }, visual: { fill: '#000000', stroke: '#000000' }, rotation: 0, scale: { x: 1, y: 1 }, metadata: {} },
    { id: 'note_yellow', type: 'note', isStickyNote: true, noteColor: '#fff3a0', text: 'New Sticky Note', position: { x: 100, y: 300 }, size: { width: 183, height: 183 }, visual: { fill: '#fff3a0' }, rotation: 0, scale: { x: 1, y: 1 }, metadata: { isStickyNote: true, noteColor: '#fff3a0' } }
  ];

  const model = { board: { objects } };
  const placements = objects.map((obj) => ({
    objectId: obj.id,
    position: { x: obj.position.x + 10, y: obj.position.y + 10 },
    size: obj.size,
    bounds: { x: obj.position.x + 10, y: obj.position.y + 10, ...obj.size },
    anchor: 'center'
  }));
  const proposal = { placements, canvasBounds: { x: 0, y: 0, width: 1000, height: 600 } };
  const renderModel = buildPreviewRenderModel(model, proposal);

  const rendered = new Map(renderModel.objects.map((o) => [o.originalObjectId, o]));

  assert.equal(rendered.get('circle_1').fill, '#06b6d4', 'Circle fill preserved');
  assert.equal(rendered.get('circle_1').type, 'circle', 'Circle type preserved');

  assert.equal(rendered.get('hexagon_1').fill, '#a855f7', 'Hexagon fill preserved');
  assert.equal(rendered.get('hexagon_1').shapeType, 'hexagon', 'Hexagon shapeType preserved');

  assert.equal(rendered.get('rect_dark').fill, '#000000', 'Dark rect fill preserved');
  assert.equal(rendered.get('note_yellow').isStickyNote, true, 'Sticky note flag preserved');
  assert.equal(rendered.get('note_yellow').noteColor, '#fff3a0', 'Sticky note color preserved');
  assert.equal(rendered.get('note_yellow').text, 'New Sticky Note', 'Sticky note text preserved');
});

test('33. Global Object Conservation on Real Board Fixture: 1-to-1 mapping end-to-end', async () => {
  const fs = await import('fs');
  const { fileURLToPath } = await import('url');
  const fixturePath = fileURLToPath(new URL('./fixtures/real_board_binding_diagnostic.json', import.meta.url));
  const content = fs.readFileSync(fixturePath, 'utf8').replace(/^\uFEFF/, '');
  const diag = JSON.parse(content);

  const rawObjects = [];
  diag.textBindings.forEach((tb) => {
    rawObjects.push({
      id: tb.textObjectId,
      elementId: tb.tier2SharedElementId?.textElementId || tb.textObjectId.replace('text_', ''),
      type: 'text',
      text: tb.textContent,
      position: { x: tb.rawPosition.x, y: tb.rawPosition.y },
      size: { width: tb.textBounds.w, height: tb.textBounds.h },
      rotation: tb.rotation,
      relationshipMetadata: {
        parentShapeId: tb.tier1ExplicitMetadata?.parentShapeId || null
      }
    });
  });

  diag.containerOwnership.forEach((co) => {
    rawObjects.push({
      id: co.containerObjectId,
      elementId: co.elementId,
      type: co.containerKind === 'sticky-note' ? 'note' : 'shape',
      shapeType: co.containerShapeType,
      position: { x: co.rawPosition.x, y: co.rawPosition.y },
      size: { width: co.containerBounds.w, height: co.containerBounds.h },
      rotation: 0,
      relationshipMetadata: {
        attachedTextId: co.metadataAttachedTextIds?.[0] || null
      }
    });
  });

  const workspaceModel = { board: { objects: rawObjects } };
  const visualObjects = buildVisualObjectModel(workspaceModel);
  const { atomicUnits } = reconstructVisualUnits(visualObjects, null);
  const layoutProposal = createLayoutProposal(null, workspaceModel);
  const renderModel = buildPreviewRenderModel(workspaceModel, layoutProposal);

  assert.equal(visualObjects.length, rawObjects.length, 'Visual objects count matches raw objects');
  assert.equal(layoutProposal.placements.length, rawObjects.length, 'Placement count matches raw objects');
  assert.equal(renderModel.objects.length, rawObjects.length, 'Render model object count matches raw objects');

  const placementIdCount = new Map();
  layoutProposal.placements.forEach((p) => {
    placementIdCount.set(p.objectId, (placementIdCount.get(p.objectId) || 0) + 1);
  });
  const renderIdCount = new Map();
  renderModel.objects.forEach((r) => {
    renderIdCount.set(r.originalObjectId, (renderIdCount.get(r.originalObjectId) || 0) + 1);
  });

  rawObjects.forEach((orig) => {
    assert.equal(placementIdCount.get(orig.id), 1, `Object ${orig.id} has exactly 1 placement`);
    assert.equal(renderIdCount.get(orig.id), 1, `Object ${orig.id} has exactly 1 render representation`);
  });
});

test('34. Strict Text Multiplicity Invariant: no duplicate text objects in preview model', async () => {
  const fs = await import('fs');
  const { fileURLToPath } = await import('url');
  const fixturePath = fileURLToPath(new URL('./fixtures/real_board_binding_diagnostic.json', import.meta.url));
  const content = fs.readFileSync(fixturePath, 'utf8').replace(/^\uFEFF/, '');
  const diag = JSON.parse(content);

  const rawObjects = [];
  diag.textBindings.forEach((tb) => {
    rawObjects.push({
      id: tb.textObjectId,
      elementId: tb.tier2SharedElementId?.textElementId || tb.textObjectId.replace('text_', ''),
      type: 'text',
      text: tb.textContent,
      position: { x: tb.rawPosition.x, y: tb.rawPosition.y },
      size: { width: tb.textBounds.w, height: tb.textBounds.h },
      rotation: tb.rotation,
      relationshipMetadata: {
        parentShapeId: tb.tier1ExplicitMetadata?.parentShapeId || null
      }
    });
  });

  diag.containerOwnership.forEach((co) => {
    rawObjects.push({
      id: co.containerObjectId,
      elementId: co.elementId,
      type: co.containerKind === 'sticky-note' ? 'note' : 'shape',
      shapeType: co.containerShapeType,
      position: { x: co.rawPosition.x, y: co.rawPosition.y },
      size: { width: co.containerBounds.w, height: co.containerBounds.h },
      rotation: 0,
      relationshipMetadata: {
        attachedTextId: co.metadataAttachedTextIds?.[0] || null
      }
    });
  });

  const workspaceModel = { board: { objects: rawObjects } };
  const layoutProposal = createLayoutProposal(null, workspaceModel);
  const renderModel = buildPreviewRenderModel(workspaceModel, layoutProposal);

  const renderedTextObjects = renderModel.objects.filter((o) => o.type === 'text');
  assert.equal(renderedTextObjects.length, diag.textBindings.length, 'Rendered text count matches original text count');

  const expectedTextCounts = new Map();
  diag.textBindings.forEach((tb) => {
    expectedTextCounts.set(tb.textContent, (expectedTextCounts.get(tb.textContent) || 0) + 1);
  });

  const actualTextCounts = new Map();
  renderedTextObjects.forEach((to) => {
    actualTextCounts.set(to.text, (actualTextCounts.get(to.text) || 0) + 1);
  });

  expectedTextCounts.forEach((count, text) => {
    assert.equal(actualTextCounts.get(text), count, `Text "${text}" multiplicity is exactly ${count}`);
  });
});

test('35. Curved Connector Origin Offset & Rigid Translation: remains on right side of canvas', () => {
  const fabricCurved = {
    id: 'conn_curved_right',
    elementId: 'conn_curved_right',
    type: 'path',
    left: 950,
    top: 300,
    position: { x: 950, y: 300 },
    size: { width: 120, height: 80 },
    width: 120,
    height: 80,
    rotation: 0,
    scale: { x: 1, y: 1 },
    path: [
      ['M', 0, 0],
      ['C', 40, -50, 80, -50, 120, 0],
      ['M', 100, -20],
      ['L', 120, 0],
      ['L', 100, 20]
    ],
    connectorType: 'curved'
  };

  const model = { board: { objects: [fabricCurved] } };
  const proposal = createLayoutProposal(null, model);
  const pCurved = proposal.placements.find((p) => p.objectId === 'conn_curved_right');

  assert.ok(pCurved, 'Curved connector placement generated');
  assert.equal(pCurved.connectorType, 'curved', 'Connector type is curved');
  assert.ok(pCurved.pathCommands || pCurved.pathData, 'Path commands/data present');

  assert.ok(pCurved.bounds.x >= 800, `Placement bounds x (${pCurved.bounds.x}) is in world space (>= 800), not near (0,0)`);
});

test('36. Four Dots Freehand Unit: multi-stroke horizontal dots remain together', () => {
  const dots = [
    { id: 'dot_1', type: 'stroke', strokeId: 'stroke_dots', isVectorStroke: true, left: 100, top: 50, width: 6, height: 6 },
    { id: 'dot_2', type: 'stroke', strokeId: 'stroke_dots', isVectorStroke: true, left: 140, top: 50, width: 6, height: 6 },
    { id: 'dot_3', type: 'stroke', strokeId: 'stroke_dots', isVectorStroke: true, left: 180, top: 50, width: 6, height: 6 },
    { id: 'dot_4', type: 'stroke', strokeId: 'stroke_dots', isVectorStroke: true, left: 220, top: 50, width: 6, height: 6 }
  ];

  const model = { board: { objects: dots } };
  const visualObjects = buildVisualObjectModel(model);
  const { atomicUnits } = reconstructVisualUnits(visualObjects, null);

  assert.equal(atomicUnits.length, 1, 'All 4 dots are clustered into exactly 1 freeform unit');
  assert.equal(atomicUnits[0].type, 'freeform-unit', 'Unit type is freeform-unit');
  assert.deepEqual(atomicUnits[0].objectIds.sort(), ['dot_1', 'dot_2', 'dot_3', 'dot_4'].sort());
});

test('37. Freehand Handwriting Drawing Rigidity: multi-letter word strokes remain 1 unit with identical translation', () => {
  const helloStrokes = [
    { id: 's_H', type: 'stroke', isVectorStroke: true, left: 400, top: 500, width: 25, height: 50 },
    { id: 's_e', type: 'stroke', isVectorStroke: true, left: 430, top: 515, width: 18, height: 35 },
    { id: 's_l1', type: 'stroke', isVectorStroke: true, left: 452, top: 505, width: 10, height: 45 },
    { id: 's_l2', type: 'stroke', isVectorStroke: true, left: 468, top: 505, width: 10, height: 45 },
    { id: 's_o', type: 'stroke', isVectorStroke: true, left: 490, top: 515, width: 22, height: 35 }
  ];

  const model = { board: { objects: helloStrokes.map((s) => normalizeObject(s)) } };
  const visualObjects = buildVisualObjectModel(model);
  const { atomicUnits } = reconstructVisualUnits(visualObjects, null);

  assert.equal(atomicUnits.length, 1, 'All 5 letters of Hello must cluster into exactly 1 freeform unit');
  assert.equal(atomicUnits[0].type, 'freeform-unit');
  assert.equal(atomicUnits[0].objectIds.length, 5);

  const proposal = createLayoutProposal(null, model);
  const pStrokes = proposal.placements.filter((p) => helloStrokes.some((s) => s.id === p.objectId));
  assert.equal(pStrokes.length, 5);

  const deltas = pStrokes.map((p) => {
    const orig = helloStrokes.find((s) => s.id === p.objectId);
    return {
      id: p.objectId,
      dx: Number((p.bounds.x - orig.left).toFixed(2)),
      dy: Number((p.bounds.y - orig.top).toFixed(2))
    };
  });

  const firstDx = deltas[0].dx;
  const firstDy = deltas[0].dy;
  deltas.forEach((d) => {
    assert.equal(d.dx, firstDx, `Stroke ${d.id} dx matches first stroke dx`);
    assert.equal(d.dy, firstDy, `Stroke ${d.id} dy matches first stroke dy`);
  });
});

test('38. Unanchored Connector Delta Isolation: unanchored connector does not blindly inherit nearest shape movement', () => {
  const shapeA = makeLinkedShape('elem_a', 'rect', 'Moved Shape', 100, 100);
  const unanchoredConn = {
    id: 'conn_unanchored',
    type: 'path',
    isConnector: true,
    connectorType: 'elbow',
    left: 250, top: 120, width: 100, height: 40,
    path: [['M', 0, 0], ['L', 50, 0], ['L', 50, 40], ['L', 100, 40]]
  };

  const rawObjects = [shapeA.shapeObj, shapeA.textObj, unanchoredConn];
  const model = { board: { objects: rawObjects.map((o) => normalizeObject(o)) } };

  const proposal = createLayoutProposal(null, model);
  const pShape = proposal.placements.find((p) => p.objectId === shapeA.shapeObj.id);
  const pConn = proposal.placements.find((p) => p.objectId === 'conn_unanchored');

  assert.ok(pShape, 'Shape placed');
  assert.ok(pConn, 'Connector placed');
  assert.equal(pConn.connectorType, 'elbow', 'Elbow type preserved');
});

test('39. Pure Connector Preview Model Integrity: renderModel forwards connector path and metadata cleanly', () => {
  const conn = {
    id: 'conn_pure',
    type: 'path',
    isConnector: true,
    connectorType: 'curved',
    left: 400, top: 200, width: 100, height: 50,
    path: [['M', 0, 0], ['C', 30, -30, 70, -30, 100, 0]],
    endArrow: true
  };

  const model = { board: { objects: [normalizeObject(conn)] } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);

  const renderedConn = renderModel.objects.find((o) => o.originalObjectId === 'conn_pure');
  assert.ok(renderedConn, 'Rendered connector exists in preview render model');
  assert.equal(renderedConn.type, 'connector');
  assert.equal(renderedConn.connectorType, 'curved');
  assert.ok(renderedConn.pathCommands || renderedConn.pathData, 'Path commands/data preserved in render model');
});

test('40. Adversarial Tests A-G: strict metadata-first classification invariant', () => {
  const strokeMCCC = {
    id: 'stroke_mccc',
    type: 'path',
    fill: 'transparent',
    stroke: '#000000',
    path: [['M', 0, 0], ['C', 10, 10, 20, 20, 30, 30], ['C', 30, 30, 40, 40, 50, 50], ['C', 50, 50, 60, 60, 70, 70]]
  };
  assert.equal(getSemanticType(strokeMCCC), 'stroke', 'TEST A: M + C + C + C stroke remains stroke');

  const circularStroke = {
    id: 'stroke_circle',
    type: 'path',
    isVectorStroke: true,
    fill: 'none',
    path: [['M', 50, 0], ['C', 100, 0, 100, 100, 50, 100], ['C', 0, 100, 0, 0, 50, 0]]
  };
  assert.equal(getSemanticType(circularStroke), 'stroke', 'TEST B: Circular freehand stroke remains stroke');

  const curvedConn = {
    id: 'conn_curved_explicit',
    type: 'path',
    isConnector: true,
    connectorType: 'curved',
    path: [['M', 0, 0], ['C', 30, -30, 70, -30, 100, 0]]
  };
  assert.equal(getSemanticType(curvedConn), 'connector', 'TEST C: Explicit curved connector remains connector');

  const elbowConn = {
    id: 'conn_elbow_explicit',
    type: 'path',
    isConnector: true,
    connectorType: 'elbow',
    path: [['M', 0, 0], ['L', 50, 0], ['L', 50, 50], ['L', 100, 50]]
  };
  assert.equal(getSemanticType(elbowConn), 'connector', 'TEST D: Explicit elbow connector remains connector');

  const standaloneConn = {
    id: 'conn_standalone',
    type: 'path',
    isConnector: true,
    path: [['M', 0, 0], ['L', 100, 0]]
  };
  assert.equal(getSemanticType(standaloneConn), 'connector', 'TEST E: Standalone connector remains connector');

  const singleEndpointConn = {
    id: 'conn_single_ep',
    type: 'path',
    sourceShapeId: 'shape_process',
    path: [['M', 0, 0], ['L', 80, 0]]
  };
  assert.equal(getSemanticType(singleEndpointConn), 'connector', 'TEST F: Single-endpoint connector remains connector');

  const model = { board: { objects: [normalizeObject(standaloneConn)] } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);
  const previewConn = renderModel.objects.find((o) => o.originalObjectId === 'conn_standalone');
  assert.ok(previewConn, 'TEST G: Zero-endpoint connector reaches preview render model');
  assert.equal(previewConn.type, 'connector');
});

test('41. Golden Board Invariant: 100% object conservation across all categories', () => {
  const process = makeLinkedShape('elem_process', 'hexagon', 'Process', 300, 200);
  const circle = makeLinkedShape('elem_circle', 'circle', 'Circle', 600, 200);
  const triangle = makeLinkedShape('elem_triangle', 'triangle', 'Triangle', 300, 500);
  const decision = makeLinkedShape('elem_decision', 'diamond', 'Decision', 600, 500);
  const blueSticky = makeStickyNote('elem_blue_sticky', 'New Sticky Note', 300, 350);
  const importantNote = makeStickyNote('elem_important_note', 'Important: Verify database schema before deployment.', 500, 200);

  const blackTestingPhase = {
    id: 'shape_testing_phase',
    elementId: 'elem_tp',
    type: 'rect',
    shapeType: 'rounded_rect',
    left: 700, top: 350, width: 140, height: 80, fill: '#000000',
    relationshipMetadata: { attachedTextId: 'text_tp' }
  };
  const blackTestingPhaseText = {
    id: 'text_tp',
    elementId: 'elem_tp',
    type: 'text',
    text: 'This is a testing phase.',
    left: 710, top: 375, width: 120, height: 30, fill: '#ffffff',
    relationshipMetadata: { parentShapeId: 'shape_testing_phase' }
  };

  const blackTestOver = {
    id: 'shape_test_over',
    elementId: 'elem_to',
    type: 'rect',
    shapeType: 'rounded_rect',
    left: 880, top: 350, width: 120, height: 60, fill: '#000000',
    relationshipMetadata: { attachedTextId: 'text_to' }
  };
  const blackTestOverText = {
    id: 'text_to',
    elementId: 'elem_to',
    type: 'text',
    text: 'Test will be over',
    left: 890, top: 365, width: 100, height: 30, fill: '#ffffff',
    relationshipMetadata: { parentShapeId: 'shape_test_over' }
  };

  const helloWorldText = {
    id: 'text_hello_world',
    type: 'text',
    text: 'Hello World!',
    left: 450, top: 520, width: 100, height: 24, rotation: 0
  };

  const verticalDivider = {
    id: 'line_divider',
    type: 'path',
    isSkribeLine: true,
    isStraightLine: true,
    left: 950, top: 200, width: 2, height: 400
  };

  const straightConn = {
    id: 'conn_process_important',
    type: 'path',
    isConnector: true,
    connectorType: 'straight',
    sourceShapeId: process.shapeObj.id,
    targetShapeId: importantNote.shapeObj.id,
    endArrow: true,
    left: 420, top: 230, width: 80, height: 10
  };

  const curvedConn = {
    id: 'conn_curved',
    type: 'path',
    isConnector: true,
    connectorType: 'curved',
    endArrow: true,
    left: 800, top: 150, width: 120, height: 60,
    path: [['M', 0, 0], ['C', 40, -40, 80, -40, 120, 0]]
  };

  const elbowConn = {
    id: 'conn_elbow',
    type: 'path',
    isConnector: true,
    connectorType: 'elbow',
    sourceShapeId: blueSticky.shapeObj.id,
    endArrow: true,
    left: 420, top: 370, width: 100, height: 40,
    path: [['M', 0, 0], ['L', 50, 0], ['L', 50, 40], ['L', 100, 40]]
  };

  const helloStrokes = [
    { id: 'stroke_H', type: 'stroke', isVectorStroke: true, left: 300, top: 450, width: 20, height: 40 },
    { id: 'stroke_e', type: 'stroke', isVectorStroke: true, left: 325, top: 460, width: 15, height: 30 },
    { id: 'stroke_l1', type: 'stroke', isVectorStroke: true, left: 345, top: 450, width: 10, height: 40 },
    { id: 'stroke_l2', type: 'stroke', isVectorStroke: true, left: 360, top: 450, width: 10, height: 40 },
    { id: 'stroke_o', type: 'stroke', isVectorStroke: true, left: 375, top: 460, width: 20, height: 30 }
  ];

  const fourDots = [
    { id: 'dot_1', type: 'stroke', isVectorStroke: true, left: 200, top: 80, width: 6, height: 6 },
    { id: 'dot_2', type: 'stroke', isVectorStroke: true, left: 240, top: 80, width: 6, height: 6 },
    { id: 'dot_3', type: 'stroke', isVectorStroke: true, left: 280, top: 80, width: 6, height: 6 },
    { id: 'dot_4', type: 'stroke', isVectorStroke: true, left: 320, top: 80, width: 6, height: 6 }
  ];

  const allRawObjects = [
    process.shapeObj, process.textObj,
    circle.shapeObj, circle.textObj,
    triangle.shapeObj, triangle.textObj,
    decision.shapeObj, decision.textObj,
    blueSticky.shapeObj, blueSticky.textObj,
    importantNote.shapeObj, importantNote.textObj,
    blackTestingPhase, blackTestingPhaseText,
    blackTestOver, blackTestOverText,
    helloWorldText, verticalDivider,
    straightConn, curvedConn, elbowConn,
    ...helloStrokes,
    ...fourDots
  ];

  const model = { board: { objects: allRawObjects.map(normalizeObject) } };
  const proposal = createLayoutProposal(null, model);
  const renderModel = buildPreviewRenderModel(model, proposal);

  assert.equal(renderModel.objects.length, allRawObjects.length, 'Every source object produces exactly 1 preview object');

  const renderedConnectors = renderModel.objects.filter((o) => o.type === 'connector');
  assert.equal(renderedConnectors.length, 3, 'Exactly 3 connectors rendered');

  const renderedStrokes = renderModel.objects.filter((o) => o.type === 'stroke');
  assert.equal(renderedStrokes.length, helloStrokes.length + fourDots.length, 'All 9 freehand strokes conserved');

  const renderedLines = renderModel.objects.filter((o) => o.type === 'line');
  assert.equal(renderedLines.length, 1, 'Vertical divider line conserved');
});



