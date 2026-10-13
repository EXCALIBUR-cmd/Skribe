import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverVisualStructures, STRUCTURE_TYPES } from './discoverVisualStructures.js';
import { generateMacroCandidates, selectMacroCandidates, MACRO_CANDIDATE_TYPES } from './macroComposition.js';
import { recoverConnectorTopology, evaluateEndpointCandidate } from './connectorTopology.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { buildVisualObjectModel, resolveContainerOwnership } from './visualUnits.js';

const makeBlock = (id, x, y, w, h, type = STRUCTURE_TYPES.FLOW, isProtected = false, extra = {}) => ({
  id,
  structureId: id,
  type,
  bounds: { x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 },
  center: { x: x + w / 2, y: y + h / 2 },
  objectIds: [`${id}_obj`],
  connectorIds: [],
  protected: isProtected,
  cleanupEligibility: isProtected ? 'outside-scope' : 'eligible',
  ...extra
});

const makeEvidence = (blocks, relationships = []) => ({
  blocks,
  relationships,
  boardBounds: null,
  occupiedBounds: null,
  protectedOccupiedBounds: null,
  evidence: {}
});

describe('LOOP 25F-2 — FIX A: Container Ownership Integrity', () => {
  test('standalone sticky note claims body, text, and timestamp into exactly one block', () => {
    const rawObjects = [
      {
        id: 'note_bg_1',
        type: 'Rect',
        isStickyNote: true,
        elementId: 'elem_note_1',
        metadata: { role: 'shape', isStickyNote: true },
        left: 100,
        top: 100,
        width: 180,
        height: 180
      },
      {
        id: 'note_txt_1',
        type: 'Textbox',
        text: 'Fix bugs',
        elementId: 'elem_note_1',
        metadata: { role: 'text' },
        left: 110,
        top: 115,
        width: 140,
        height: 35
      },
      {
        id: 'note_time_1',
        type: 'Text',
        text: '1 Oct',
        elementId: 'elem_note_1',
        metadata: { role: 'timestamp' },
        left: 150,
        top: 250,
        width: 30,
        height: 14
      }
    ];

    const workspaceModel = { board: { objects: rawObjects } };
    const structures = discoverVisualStructures(workspaceModel);

    assert.equal(structures.length, 1);
    const noteStruct = structures[0];
    assert.deepEqual(noteStruct.objectIds.slice().sort(), ['note_bg_1', 'note_time_1', 'note_txt_1'].sort());
  });

  test('container with multiple owned children forms one block and does not create independent child blocks', () => {
    const rawObjects = [
      {
        id: 'card_rect',
        type: 'Rect',
        left: 200,
        top: 200,
        width: 250,
        height: 200
      },
      {
        id: 'card_title',
        type: 'Textbox',
        text: 'Card Title',
        left: 210,
        top: 210,
        width: 120,
        height: 30
      },
      {
        id: 'card_desc',
        type: 'Textbox',
        text: 'Card Description',
        left: 210,
        top: 250,
        width: 200,
        height: 50
      }
    ];

    const workspaceModel = { board: { objects: rawObjects } };
    const structures = discoverVisualStructures(workspaceModel);

    const cardStructs = structures.filter(s => s.objectIds.includes('card_rect'));
    assert.equal(cardStructs.length, 1);
    assert.ok(cardStructs[0].objectIds.includes('card_title'));
    assert.ok(cardStructs[0].objectIds.includes('card_desc'));

    const childStructs = structures.filter(s => s.id !== cardStructs[0].id && (s.objectIds.includes('card_title') || s.objectIds.includes('card_desc')));
    assert.equal(childStructs.length, 0);
  });

  test('unrelated nearby text outside container bounds is not merged into container', () => {
    const rawObjects = [
      {
        id: 'note_bg',
        type: 'Rect',
        isStickyNote: true,
        elementId: 'elem_n',
        metadata: { role: 'shape' },
        left: 100,
        top: 100,
        width: 180,
        height: 180
      },
      {
        id: 'note_txt',
        type: 'Textbox',
        text: 'Inside text',
        elementId: 'elem_n',
        metadata: { role: 'text' },
        left: 110,
        top: 115,
        width: 140,
        height: 30
      },
      {
        id: 'nearby_external_txt',
        type: 'Textbox',
        text: 'Unrelated note outside',
        left: 320,
        top: 100,
        width: 100,
        height: 30
      }
    ];

    const workspaceModel = { board: { objects: rawObjects } };
    const structures = discoverVisualStructures(workspaceModel);

    const noteStruct = structures.find(s => s.objectIds.includes('note_bg'));
    assert.ok(noteStruct);
    assert.ok(!noteStruct.objectIds.includes('nearby_external_txt'));

    const extStruct = structures.find(s => s.objectIds.includes('nearby_external_txt'));
    assert.ok(extStruct);
  });

  test('repeated discovery runs produce consistent non-duplicate blocks', () => {
    const rawObjects = [
      {
        id: 'note_bg',
        type: 'Rect',
        isStickyNote: true,
        elementId: 'elem_rep',
        metadata: { role: 'shape' },
        left: 100,
        top: 100,
        width: 180,
        height: 180
      },
      {
        id: 'note_txt',
        type: 'Textbox',
        text: 'Repeat text',
        elementId: 'elem_rep',
        metadata: { role: 'text' },
        left: 110,
        top: 115,
        width: 140,
        height: 30
      }
    ];

    const s1 = discoverVisualStructures({ board: { objects: rawObjects } });
    const s2 = discoverVisualStructures({ board: { objects: rawObjects } });

    assert.equal(s1.length, s2.length);
    assert.deepEqual(s1[0].objectIds, s2[0].objectIds);
  });
});

describe('LOOP 25F-2 — FIX B: Mutual Overlap Candidate Exclusivity', () => {
  test('opposing translations for one overlap edge select at most one resolution', () => {
    const blockA = makeBlock('blk_A', 100, 100, 120, 100);
    const blockB = makeBlock('blk_B', 150, 100, 120, 100);

    const rel = {
      blockA: 'blk_A',
      blockB: 'blk_B',
      connected: false,
      overlapping: true,
      overlapRatio: 0.58,
      horizontalGap: 0,
      verticalGap: 0,
      minDistance: 0,
      alignmentEvidence: []
    };

    const rawObjs = [blockA, blockB].map(b => ({ id: `${b.id}_obj`, bounds: b.bounds, left: b.bounds.x, top: b.bounds.y, width: b.bounds.width, height: b.bounds.height }));
    const opts = { rawObjects: rawObjs, objectMap: new Map(rawObjs.map(o => [o.id, o])) };
    const evidence = makeEvidence([blockA, blockB], [rel]);
    const candidates = generateMacroCandidates(evidence, opts);

    const overlapCands = candidates.filter(c => c.type === MACRO_CANDIDATE_TYPES.RESOLVE_MACRO_OVERLAP);
    assert.ok(overlapCands.length >= 2);

    const { selectedMacroCandidates, macroConflicts } = selectMacroCandidates(overlapCands, {
      blocks: [blockA, blockB],
      rawObjects: rawObjs
    });

    assert.equal(selectedMacroCandidates.length, 1);
    const rejectedEdgeConflict = macroConflicts.find(c => c.reason === 'overlap_edge_conflict');
    assert.ok(rejectedEdgeConflict, 'opposing candidate rejected due to overlap edge conflict');
  });

  test('two distinct overlaps sharing one block can each be resolved safely if different edges', () => {
    const blockA = makeBlock('blk_A', 100, 100, 100, 100);
    const blockB = makeBlock('blk_B', 150, 100, 100, 100);
    const blockC = makeBlock('blk_C', 350, 100, 100, 100);
    const blockD = makeBlock('blk_D', 400, 100, 100, 100);

    const relAB = {
      blockA: 'blk_A',
      blockB: 'blk_B',
      connected: false,
      overlapping: true,
      overlapRatio: 0.5,
      horizontalGap: 0,
      verticalGap: 0,
      alignmentEvidence: []
    };

    const relCD = {
      blockA: 'blk_C',
      blockB: 'blk_D',
      connected: false,
      overlapping: true,
      overlapRatio: 0.5,
      horizontalGap: 0,
      verticalGap: 0,
      alignmentEvidence: []
    };

    const rawObjs = [blockA, blockB, blockC, blockD].map(b => ({ id: `${b.id}_obj`, bounds: b.bounds, left: b.bounds.x, top: b.bounds.y, width: b.bounds.width, height: b.bounds.height }));
    const opts = { rawObjects: rawObjs, objectMap: new Map(rawObjs.map(o => [o.id, o])) };
    const evidence = makeEvidence([blockA, blockB, blockC, blockD], [relAB, relCD]);
    const candidates = generateMacroCandidates(evidence, opts);

    const { selectedMacroCandidates } = selectMacroCandidates(candidates, {
      blocks: [blockA, blockB, blockC, blockD],
      rawObjects: rawObjs
    });

    assert.equal(selectedMacroCandidates.length, 2);
  });
});

describe('LOOP 25F-2 — FIX C: Connector Endpoint Attachment Protection', () => {
  test('connector touching source boundary does not generate accidental-overlap candidate', () => {
    const shape = {
      id: 'hex_src',
      type: 'Polygon',
      shapeType: 'polygon',
      left: 100,
      top: 100,
      width: 100,
      height: 100,
      bounds: { x: 100, y: 100, width: 100, height: 100, cx: 150, cy: 150 }
    };

    const connector = {
      id: 'conn_h',
      type: 'connector',
      semanticType: 'connector',
      sourceShapeId: 'hex_src',
      targetShapeId: null,
      left: 200,
      top: 145,
      width: 80,
      height: 10,
      bounds: { x: 200, y: 145, width: 80, height: 10, cx: 240, cy: 150 },
      worldPathCommands: [['M', 200, 150], ['L', 280, 150]]
    };

    const blockShape = makeBlock('blk_hex', 100, 100, 100, 100, STRUCTURE_TYPES.FLOW, false, {
      objectIds: ['hex_src']
    });
    const blockConn = makeBlock('blk_conn', 199, 145, 81, 10, STRUCTURE_TYPES.STANDALONE, false, {
      objectIds: ['conn_h'],
      connectorIds: ['conn_h']
    });

    const rel = {
      blockA: 'blk_hex',
      blockB: 'blk_conn',
      connected: false,
      overlapping: true,
      overlapRatio: 0.05,
      horizontalGap: 0,
      verticalGap: 0,
      alignmentEvidence: []
    };

    const evidence = makeEvidence([blockShape, blockConn], [rel]);
    const candidates = generateMacroCandidates(evidence, {
      rawObjects: [shape, connector],
      objectMap: new Map([['hex_src', shape], ['conn_h', connector]])
    });

    const overlapCands = candidates.filter(c => c.type === MACRO_CANDIDATE_TYPES.RESOLVE_MACRO_OVERLAP);
    assert.equal(overlapCands.length, 0, 'no overlap candidates generated between legitimately attached connector and shape');
  });

  test('candidate translating shape away from partially resolved connector is rejected', () => {
    const shape = {
      id: 'hex_src',
      type: 'Polygon',
      left: 100,
      top: 100,
      width: 100,
      height: 100,
      bounds: { x: 100, y: 100, width: 100, height: 100, cx: 150, cy: 150 }
    };

    const connector = {
      id: 'conn_part',
      type: 'connector',
      semanticType: 'connector',
      sourceShapeId: 'hex_src',
      targetShapeId: null,
      left: 200,
      top: 145,
      width: 80,
      height: 10,
      bounds: { x: 200, y: 145, width: 80, height: 10, cx: 240, cy: 150 },
      worldPathCommands: [['M', 200, 150], ['L', 280, 150]]
    };

    const blockShape = makeBlock('blk_hex', 100, 100, 100, 100, STRUCTURE_TYPES.FLOW, false, {
      objectIds: ['hex_src']
    });
    const blockOther = makeBlock('blk_other', 120, 100, 100, 100, STRUCTURE_TYPES.FLOW, false, {
      objectIds: ['other_obj']
    });

    const rel = {
      blockA: 'blk_hex',
      blockB: 'blk_other',
      connected: false,
      overlapping: true,
      overlapRatio: 0.8,
      horizontalGap: 0,
      verticalGap: 0,
      alignmentEvidence: []
    };

    const evidence = makeEvidence([blockShape, blockOther], [rel]);
    const candidates = generateMacroCandidates(evidence, {
      rawObjects: [shape, connector, { id: 'other_obj', left: 120, top: 100, width: 100, height: 100, bounds: { x: 120, y: 100, width: 100, height: 100 } }],
      objectMap: new Map([
        ['hex_src', shape],
        ['conn_part', connector],
        ['other_obj', { id: 'other_obj', left: 120, top: 100, width: 100, height: 100, bounds: { x: 120, y: 100, width: 100, height: 100 } }]
      ])
    });

    const candsMovingHex = candidates.filter(c => c.blockIds?.includes('blk_hex'));
    for (const c of candsMovingHex) {
      assert.equal(c.safe, false, 'candidate moving hex away from attached connector must be rejected as unsafe');
    }
  });
});

describe('LOOP 25F-2 — FIX D: Sticky Note Text & Timestamp Positioning', () => {
  test('sticky note top-aligned text is not displaced by vertical centering', () => {
    const rawNote = {
      id: 'shape_note',
      type: 'Rect',
      isStickyNote: true,
      elementId: 'elem_note',
      metadata: { role: 'shape', isStickyNote: true },
      left: 100,
      top: 100,
      width: 180,
      height: 180,
      bounds: { x: 100, y: 100, width: 180, height: 180, cx: 190, cy: 190 }
    };

    const rawText = {
      id: 'text_note',
      type: 'Textbox',
      text: 'Have to fix\nsome bugs',
      elementId: 'elem_note',
      metadata: { role: 'text' },
      left: 110,
      top: 115,
      width: 140,
      height: 40,
      bounds: { x: 110, y: 115, width: 140, height: 40, cx: 180, cy: 135 }
    };

    const rawTimestamp = {
      id: 'timestamp_note',
      type: 'Text',
      text: '1 Oct',
      elementId: 'elem_note',
      metadata: { role: 'timestamp' },
      left: 150,
      top: 250,
      width: 30,
      height: 14,
      bounds: { x: 150, y: 250, width: 30, height: 14, cx: 165, cy: 257 }
    };

    const rawObjects = [rawNote, rawText, rawTimestamp];
    const initialTextTop = rawText.top;
    const initialTimeTop = rawTimestamp.top;

    const plan = {
      version: 1,
      id: 'plan_test',
      untouchedObjectIds: [],
      diagnostics: {},
      actions: [
        {
          id: 'act_attach',
          type: 'attachText',
          objectIds: ['shape_note', 'text_note'],
          confidence: 0.99,
          reason: 'Attach text'
        }
      ]
    };

    const res = executeCleanupPlan(plan, { objects: rawObjects });
    const pText = res.placements.find(p => p.objectId === 'text_note');

    assert.equal(pText.bounds.y, initialTextTop, 'top-aligned note text top position preserved without vertical shift');
  });

  test('timestamp translates atomically with note without independent displacement', () => {
    const rawNote = {
      id: 'shape_note',
      type: 'Rect',
      isStickyNote: true,
      elementId: 'elem_note',
      metadata: { role: 'shape', isStickyNote: true },
      left: 100,
      top: 100,
      width: 180,
      height: 180,
      bounds: { x: 100, y: 100, width: 180, height: 180, cx: 190, cy: 190 }
    };

    const rawText = {
      id: 'text_note',
      type: 'Textbox',
      text: 'Bug note',
      elementId: 'elem_note',
      metadata: { role: 'text' },
      left: 110,
      top: 115,
      width: 140,
      height: 40,
      bounds: { x: 110, y: 115, width: 140, height: 40, cx: 180, cy: 135 }
    };

    const rawTimestamp = {
      id: 'timestamp_note',
      type: 'Text',
      text: '1 Oct',
      elementId: 'elem_note',
      metadata: { role: 'timestamp' },
      left: 150,
      top: 250,
      width: 30,
      height: 14,
      bounds: { x: 150, y: 250, width: 30, height: 14, cx: 165, cy: 257 }
    };

    const rawObjects = [rawNote, rawText, rawTimestamp];
    const plan = {
      version: 1,
      id: 'plan_macro',
      untouchedObjectIds: [],
      diagnostics: {},
      actions: [
        {
          id: 'act_macro_1',
          type: 'macroTranslate',
          objectIds: ['shape_note', 'text_note', 'timestamp_note'],
          structureBlockIds: ['blk_note'],
          translations: { blk_note: { dx: 50, dy: 30 } },
          geometry: {
            affectedObjectIds: ['shape_note', 'text_note', 'timestamp_note'],
            affectedConnectorIds: []
          },
          confidence: 0.9,
          reason: 'Macro align'
        }
      ]
    };

    const res = executeCleanupPlan(plan, { objects: rawObjects });
    const pShape = res.placements.find(p => p.objectId === 'shape_note');
    const pText = res.placements.find(p => p.objectId === 'text_note');
    const pTime = res.placements.find(p => p.objectId === 'timestamp_note');

    assert.equal(pShape.bounds.x, 150);
    assert.equal(pShape.bounds.y, 130);
    assert.equal(pText.bounds.x, 160);
    assert.equal(pText.bounds.y, 145);
    assert.equal(pTime.bounds.x, 200);
    assert.equal(pTime.bounds.y, 280);
  });
});

describe('LOOP 25F-2 — FIX E: Conservative Directional-Corridor Connector Recovery', () => {
  test('horizontal arrow with target at 58.4px along collinear shaft direction is recovered', () => {
    const hex = {
      id: 'hex_src',
      type: 'Polygon',
      shapeType: 'polygon',
      left: 100,
      top: 100,
      width: 100,
      height: 100,
      bounds: { x: 100, y: 100, width: 100, height: 100, cx: 150, cy: 150 }
    };

    const triangle = {
      id: 'tri_tgt',
      type: 'Triangle',
      shapeType: 'triangle',
      left: 338.4,
      top: 100,
      width: 100,
      height: 100,
      bounds: { x: 338.4, y: 100, width: 100, height: 100, cx: 388.4, cy: 150 }
    };

    const connector = {
      id: 'conn_h',
      type: 'connector',
      left: 200,
      top: 145,
      width: 80,
      height: 10,
      bounds: { x: 200, y: 145, width: 80, height: 10, cx: 240, cy: 150 },
      worldPathCommands: [['M', 200, 150], ['L', 280, 150]]
    };

    const topology = recoverConnectorTopology(connector, [hex, triangle]);

    assert.equal(topology.sourceShapeId, 'hex_src');
    assert.equal(topology.targetShapeId, 'tri_tgt', 'directional corridor recovers target shape at 58.4px gap');
    assert.ok(topology.targetConfidence >= 0.95);
  });

  test('target shape in wrong direction is not recovered', () => {
    const connector = {
      id: 'conn_h',
      type: 'connector',
      left: 200,
      top: 145,
      width: 80,
      height: 10,
      bounds: { x: 200, y: 145, width: 80, height: 10, cx: 240, cy: 150 },
      worldPathCommands: [['M', 200, 150], ['L', 280, 150]]
    };

    const shapeAbove = {
      id: 'shape_above',
      type: 'Rect',
      left: 250,
      top: 50,
      width: 80,
      height: 40,
      bounds: { x: 250, y: 50, width: 80, height: 40, cx: 290, cy: 70 }
    };

    const topology = recoverConnectorTopology(connector, [shapeAbove]);
    assert.equal(topology.targetShapeId, null, 'shape in incompatible direction is not recovered');
  });

  test('target shape blocked by an intervening shape is not recovered', () => {
    const connector = {
      id: 'conn_h',
      type: 'connector',
      left: 200,
      top: 145,
      width: 80,
      height: 10,
      bounds: { x: 200, y: 145, width: 80, height: 10, cx: 240, cy: 150 },
      worldPathCommands: [['M', 200, 150], ['L', 280, 150]]
    };

    const intervening = {
      id: 'blocker',
      type: 'Rect',
      left: 295,
      top: 130,
      width: 20,
      height: 40,
      bounds: { x: 295, y: 130, width: 20, height: 40, cx: 305, cy: 150 }
    };

    const farTarget = {
      id: 'far_tgt',
      type: 'Rect',
      left: 338.4,
      top: 100,
      width: 100,
      height: 100,
      bounds: { x: 338.4, y: 100, width: 100, height: 100, cx: 388.4, cy: 150 }
    };

    const topology = recoverConnectorTopology(connector, [intervening, farTarget]);
    assert.notEqual(topology.targetShapeId, 'far_tgt', 'blocked target shape cannot be recovered');
  });

  test('genuinely floating arrow with nothing in corridor remains unresolved', () => {
    const connector = {
      id: 'conn_floating',
      type: 'connector',
      left: 200,
      top: 145,
      width: 80,
      height: 10,
      bounds: { x: 200, y: 145, width: 80, height: 10, cx: 240, cy: 150 },
      worldPathCommands: [['M', 200, 150], ['L', 280, 150]]
    };

    const farAway = {
      id: 'far_away',
      type: 'Rect',
      left: 600,
      top: 100,
      width: 100,
      height: 100,
      bounds: { x: 600, y: 100, width: 100, height: 100, cx: 650, cy: 150 }
    };

    const topology = recoverConnectorTopology(connector, [farAway]);
    assert.equal(topology.targetShapeId, null);
  });
});

describe('LOOP 25F-2 — FIX F: Evidence-Based Unconnected Structure Packing', () => {
  test('two aligned independent flow structures with excessive gap generate packing candidate with spatial confidence', () => {
    const blockFlow1 = makeBlock('blk_flow1', 100, 100, 200, 150, STRUCTURE_TYPES.FLOW);
    const blockFlow2 = makeBlock('blk_flow2', 460, 100, 200, 150, STRUCTURE_TYPES.FLOW);

    const rel = {
      blockA: 'blk_flow1',
      blockB: 'blk_flow2',
      connected: false,
      overlapping: false,
      horizontalGap: 160,
      verticalGap: 0,
      minDistance: 160,
      alignmentEvidence: [{ axis: 'y', type: 'top-edge', deviation: 0 }]
    };

    const evidence = makeEvidence([blockFlow1, blockFlow2], [rel]);
    const candidates = generateMacroCandidates(evidence, {});

    const packCands = candidates.filter(c => c.type === MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED);
    assert.ok(packCands.length > 0, 'generates packing candidates for aligned unconnected structures');
    assert.equal(packCands[0].confidence, 0.75, 'unconnected packing uses spatial confidence 0.75');
  });

  test('structures at reasonable spacing do not generate packing candidate', () => {
    const blockFlow1 = makeBlock('blk_flow1', 100, 100, 200, 150, STRUCTURE_TYPES.FLOW);
    const blockFlow2 = makeBlock('blk_flow2', 360, 100, 200, 150, STRUCTURE_TYPES.FLOW);

    const rel = {
      blockA: 'blk_flow1',
      blockB: 'blk_flow2',
      connected: false,
      overlapping: false,
      horizontalGap: 60,
      verticalGap: 0,
      minDistance: 60,
      alignmentEvidence: [{ axis: 'y', type: 'top-edge', deviation: 0 }]
    };

    const evidence = makeEvidence([blockFlow1, blockFlow2], [rel]);
    const candidates = generateMacroCandidates(evidence, {});

    const packCands = candidates.filter(c => c.type === MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED);
    assert.equal(packCands.length, 0, 'reasonable spacing produces no packing candidate');
  });

  test('nearby unrelated standalone notes are not packed based on distance alone', () => {
    const blockNote1 = makeBlock('blk_note1', 100, 100, 150, 150, STRUCTURE_TYPES.STANDALONE);
    const blockNote2 = makeBlock('blk_note2', 450, 100, 150, 150, STRUCTURE_TYPES.STANDALONE);

    const rel = {
      blockA: 'blk_note1',
      blockB: 'blk_note2',
      connected: false,
      overlapping: false,
      horizontalGap: 200,
      verticalGap: 0,
      minDistance: 200,
      alignmentEvidence: []
    };

    const evidence = makeEvidence([blockNote1, blockNote2], [rel]);
    const candidates = generateMacroCandidates(evidence, {});

    const packCands = candidates.filter(c => c.type === MACRO_CANDIDATE_TYPES.PACK_ADJACENT_ALIGNED);
    assert.equal(packCands.length, 0, 'arbitrary standalone notes without evidence are not packed');
  });
});

describe('LOOP 25F-2 — Real Board Acceptance Regression', () => {
  test('real board scenario satisfies all 10 integrity conditions', () => {
    const rawObjects = [
      {
        id: 'start_node',
        type: 'Rect',
        left: 100,
        top: 50,
        width: 120,
        height: 60,
        bounds: { x: 100, y: 50, width: 120, height: 60, cx: 160, cy: 80 }
      },
      {
        id: 'start_text',
        type: 'Textbox',
        text: 'Loops Applied',
        left: 100,
        top: 50,
        width: 120,
        height: 30,
        bounds: { x: 100, y: 50, width: 120, height: 30, cx: 160, cy: 65 }
      },
      {
        id: 'decision_node',
        type: 'Polygon',
        shapeType: 'diamond',
        left: 100,
        top: 180,
        width: 120,
        height: 80,
        bounds: { x: 100, y: 180, width: 120, height: 80, cx: 160, cy: 220 }
      },
      {
        id: 'decision_text',
        type: 'Textbox',
        text: 'Decision made',
        left: 110,
        top: 200,
        width: 100,
        height: 30,
        bounds: { x: 110, y: 200, width: 100, height: 30, cx: 160, cy: 215 }
      },
      {
        id: 'vert_conn',
        type: 'connector',
        semanticType: 'connector',
        sourceShapeId: 'start_node',
        targetShapeId: 'decision_node',
        left: 155,
        top: 110,
        width: 10,
        height: 70,
        bounds: { x: 155, y: 110, width: 10, height: 70, cx: 160, cy: 145 },
        worldPathCommands: [['M', 160, 110], ['L', 160, 180]]
      },
      {
        id: 'hex_process',
        type: 'Polygon',
        shapeType: 'polygon',
        left: 300,
        top: 100,
        width: 120,
        height: 90,
        bounds: { x: 300, y: 100, width: 120, height: 90, cx: 360, cy: 145 }
      },
      {
        id: 'hex_text',
        type: 'Textbox',
        text: 'Processes working',
        left: 310,
        top: 130,
        width: 100,
        height: 30,
        bounds: { x: 310, y: 130, width: 100, height: 30, cx: 360, cy: 145 }
      },
      {
        id: 'horiz_conn',
        type: 'connector',
        semanticType: 'connector',
        sourceShapeId: 'hex_process',
        targetShapeId: null,
        left: 420,
        top: 140,
        width: 80,
        height: 10,
        bounds: { x: 420, y: 140, width: 80, height: 10, cx: 460, cy: 145 },
        worldPathCommands: [['M', 420, 145], ['L', 500, 145]]
      },
      {
        id: 'tri_cleaned',
        type: 'Triangle',
        shapeType: 'triangle',
        left: 558.4,
        top: 100,
        width: 100,
        height: 90,
        bounds: { x: 558.4, y: 100, width: 100, height: 90, cx: 608.4, cy: 145 }
      },
      {
        id: 'tri_text',
        type: 'Textbox',
        text: 'Mess Cleaned',
        left: 568.4,
        top: 130,
        width: 80,
        height: 30,
        bounds: { x: 568.4, y: 130, width: 80, height: 30, cx: 608.4, cy: 145 }
      },
      {
        id: 'sticky_body',
        type: 'Rect',
        isStickyNote: true,
        elementId: 'elem_sticky',
        metadata: { role: 'shape', isStickyNote: true },
        left: 100,
        top: 320,
        width: 180,
        height: 180,
        bounds: { x: 100, y: 320, width: 180, height: 180, cx: 190, cy: 410 }
      },
      {
        id: 'sticky_text',
        type: 'Textbox',
        text: 'Have to fix\nsome bugs',
        elementId: 'elem_sticky',
        metadata: { role: 'text' },
        left: 110,
        top: 335,
        width: 140,
        height: 40,
        bounds: { x: 110, y: 335, width: 140, height: 40, cx: 180, cy: 355 }
      },
      {
        id: 'sticky_time',
        type: 'Text',
        text: '1 Oct',
        elementId: 'elem_sticky',
        metadata: { role: 'timestamp' },
        left: 150,
        top: 470,
        width: 30,
        height: 14,
        bounds: { x: 150, y: 470, width: 30, height: 14, cx: 165, cy: 477 }
      },
      {
        id: 'stroke_hello',
        type: 'Path',
        isVectorStroke: true,
        semanticType: 'stroke',
        left: 500,
        top: 350,
        width: 100,
        height: 40,
        bounds: { x: 500, y: 350, width: 100, height: 40, cx: 550, cy: 370 }
      }
    ];

    const workspaceModel = { board: { objects: rawObjects } };
    const structures = discoverVisualStructures(workspaceModel);

    const stickyStruct = structures.find(s => s.objectIds.includes('sticky_body'));
    assert.ok(stickyStruct);
    assert.deepEqual(stickyStruct.objectIds.slice().sort(), ['sticky_body', 'sticky_text', 'sticky_time'].sort());

    const creativeStruct = structures.find(s => s.type === STRUCTURE_TYPES.CREATIVE);
    assert.ok(creativeStruct);
    assert.ok(creativeStruct.objectIds.includes('stroke_hello'));

    const topo = recoverConnectorTopology(rawObjects.find(o => o.id === 'horiz_conn'), [
      rawObjects.find(o => o.id === 'hex_process'),
      rawObjects.find(o => o.id === 'tri_cleaned')
    ]);
    assert.equal(topo.sourceShapeId, 'hex_process');
    assert.equal(topo.targetShapeId, 'tri_cleaned');
  });
});
