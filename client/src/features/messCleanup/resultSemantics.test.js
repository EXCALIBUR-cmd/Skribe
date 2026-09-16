import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObject } from './normalizeObjects.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';
import { buildCleanupResult } from './buildCleanupResult.js';
import {
  detectConnectorAttachmentDefectOpportunities,
  OPPORTUNITY_TYPES
} from './cleanupOpportunities.js';


test('Control A: Clean board with shapes only → ALREADY_WELL_ORGANIZED', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 120, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 400, top: 100, width: 120, height: 80 });

  const model = { board: { objects: [s1, s2] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.resultType, 'ALREADY_WELL_ORGANIZED',
    'A clean board with no defects must be ALREADY_WELL_ORGANIZED');
});

test('Control B: Floating unresolved connector → NO_SAFE_CLEANUP_FOUND (not ALREADY_WELL_ORGANIZED)', () => {
  const shape_a = normalizeObject({ id: 'shape_a', type: 'rect', left: 100, top: 100, width: 120, height: 80 });
  const shape_b = normalizeObject({ id: 'shape_b', type: 'rect', left: 400, top: 350, width: 120, height: 80 });

  const conn = normalizeObject({
    id: 'conn_ab',
    type: 'path',
    isConnector: true,
    sourceShapeId: 'shape_a',
    targetShapeId: null,
    left: 220,
    top: 140,
    width: 100,
    height: 10
  });

  const model = { board: { objects: [shape_a, shape_b, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.resultType, 'NO_SAFE_CLEANUP_FOUND',
    'A board with a floating connector must NOT be classified as ALREADY_WELL_ORGANIZED');
  assert.ok(result.summary.humanSummary.includes('no safe automatic cleanup'),
    'Human summary must communicate that no safe cleanup was found');
});


test('Control C: Connector with both endpoints unresolved → NO_SAFE_CLEANUP_FOUND', () => {
  const shape_a = normalizeObject({ id: 'shape_a', type: 'rect', left: 100, top: 100, width: 120, height: 80 });

  const conn = normalizeObject({
    id: 'conn_orphan',
    type: 'path',
    isConnector: true,
    sourceShapeId: null,
    targetShapeId: null,
    left: 300,
    top: 140,
    width: 100,
    height: 10
  });

  const model = { board: { objects: [shape_a, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.resultType, 'NO_SAFE_CLEANUP_FOUND',
    'A connector with both endpoints unresolved is a visible defect');
});

test('Control D: Well-connected connector (both endpoints resolved) → ALREADY_WELL_ORGANIZED', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 120, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 400, top: 100, width: 120, height: 80 });

  const conn = normalizeObject({
    id: 'c1',
    type: 'path',
    isConnector: true,
    sourceShapeId: 's1',
    targetShapeId: 's2',
    left: 220,
    top: 140,
    width: 180,
    height: 10
  });

  const model = { board: { objects: [s1, s2, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  
  assert.notEqual(result.summary.resultType, 'NO_SAFE_CLEANUP_FOUND',
    'A well-connected connector should not be classified as NO_SAFE_CLEANUP_FOUND');
});

test('Control E: Connector referencing non-existent target shape → NO_SAFE_CLEANUP_FOUND', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 120, height: 80 });

  const conn = normalizeObject({
    id: 'c_dangling',
    type: 'path',
    isConnector: true,
    sourceShapeId: 's1',
    targetShapeId: 'nonexistent_shape',
    left: 220,
    top: 140,
    width: 100,
    height: 10
  });

  const model = { board: { objects: [s1, conn] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.resultType, 'NO_SAFE_CLEANUP_FOUND',
    'A connector pointing to a non-existent shape has a floating endpoint');
});


test('Control F: Sketch-only board → ALREADY_WELL_ORGANIZED', () => {
  const stroke = normalizeObject({
    id: 'st1',
    type: 'stroke',
    isVectorStroke: true,
    left: 100,
    top: 100,
    width: 30,
    height: 30
  });

  const model = { board: { objects: [stroke] } };
  const plan = buildCleanupPlan(null, model);
  const proposal = executeCleanupPlan(plan, model);
  const result = buildCleanupResult(plan, proposal, model);

  assert.equal(result.summary.resultType, 'ALREADY_WELL_ORGANIZED',
    'A sketch-only board has no structural defects');
});



test('connectorAttachmentDefect: detects connector with null source', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: null, targetShapeId: 's1',
    left: 200, top: 140, width: 100, height: 10
  });

  const objects = [s1, conn];
  const objectMap = new Map(objects.map((o) => [o.id, o]));
  const opps = detectConnectorAttachmentDefectOpportunities(objects, objectMap);

  assert.equal(opps.length, 1);
  assert.equal(opps[0].type, OPPORTUNITY_TYPES.CONNECTOR_ATTACHMENT_DEFECT);
  assert.ok(opps[0].metadata.floatingEndpoints.includes('source'));
  assert.equal(opps[0].metadata.targetResolved, true);
});

test('connectorAttachmentDefect: detects connector with null target', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: 's1', targetShapeId: null,
    left: 200, top: 140, width: 100, height: 10
  });

  const objects = [s1, conn];
  const objectMap = new Map(objects.map((o) => [o.id, o]));
  const opps = detectConnectorAttachmentDefectOpportunities(objects, objectMap);

  assert.equal(opps.length, 1);
  assert.equal(opps[0].type, OPPORTUNITY_TYPES.CONNECTOR_ATTACHMENT_DEFECT);
  assert.ok(opps[0].metadata.floatingEndpoints.includes('target'));
  assert.equal(opps[0].metadata.sourceResolved, true);
});

test('connectorAttachmentDefect: detects connector with both endpoints unresolved', () => {
  const conn = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: null, targetShapeId: null,
    left: 200, top: 140, width: 100, height: 10
  });

  const objects = [conn];
  const objectMap = new Map(objects.map((o) => [o.id, o]));
  const opps = detectConnectorAttachmentDefectOpportunities(objects, objectMap);

  assert.equal(opps.length, 1);
  assert.deepEqual(opps[0].metadata.floatingEndpoints, ['source', 'target']);
});

test('connectorAttachmentDefect: does NOT fire for fully resolved connector', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const s2 = normalizeObject({ id: 's2', type: 'rect', left: 300, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: 's1', targetShapeId: 's2',
    left: 200, top: 140, width: 100, height: 10
  });

  const objects = [s1, s2, conn];
  const objectMap = new Map(objects.map((o) => [o.id, o]));
  const opps = detectConnectorAttachmentDefectOpportunities(objects, objectMap);

  assert.equal(opps.length, 0, 'Fully resolved connector must not trigger attachment defect');
});

test('connectorAttachmentDefect: detects connector referencing non-existent shape', () => {
  const s1 = normalizeObject({ id: 's1', type: 'rect', left: 100, top: 100, width: 100, height: 80 });
  const conn = normalizeObject({
    id: 'c1', type: 'path', isConnector: true,
    sourceShapeId: 's1', targetShapeId: 'nonexistent',
    left: 200, top: 140, width: 100, height: 10
  });

  const objects = [s1, conn];
  const objectMap = new Map(objects.map((o) => [o.id, o]));
  const opps = detectConnectorAttachmentDefectOpportunities(objects, objectMap);

  assert.equal(opps.length, 1, 'Connector referencing non-existent shape has a floating endpoint');
  assert.ok(opps[0].metadata.floatingEndpoints.includes('target'));
});
