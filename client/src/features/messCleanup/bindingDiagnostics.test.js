import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runBindingDiagnostic } from './bindingDiagnostics.js';

const shape = (id, x = 100, y = 100, w = 140, h = 90, extra = {}) => ({
  id, type: 'shape', shapeType: 'rect',
  position: { x, y }, size: { width: w, height: h },
  rotation: 0, scale: { x: 1, y: 1 }, zIndex: 1,
  relationshipMetadata: {}, metadata: {}, ...extra
});

const text = (id, val, x = 100, y = 100, w = 120, h = 28, extra = {}) => ({
  id, type: 'text', text: val,
  position: { x, y }, size: { width: w, height: h },
  rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2,
  relationshipMetadata: {}, metadata: {}, ...extra
});

const makeModel = (objects) => ({ board: { objects } });

global.window = { location: { search: '?debugBinding' } };
global.URLSearchParams = class {
  constructor(s) { this._s = s || ''; }
  has(k) { return this._s.includes(k); }
};
global.document = {
  createElement: () => ({ href: '', download: '', style: {}, click() {} }),
  body: { appendChild() {}, removeChild() {} },
};
global.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
global.Blob = class { constructor(parts, opts) { this.parts = parts; } };
global.setTimeout = (fn) => {};

test('returns null when debugBinding flag is absent', () => {
  const saved = global.window;
  global.window = { location: { search: '' } };
  const model = makeModel([shape('s1'), text('t1', 'hello', 120, 130)]);
  const result = runBindingDiagnostic(model, null, null);
  assert.equal(result, null);
  global.window = saved;
});

test('returns report structure when debugBinding is present', () => {
  const model = makeModel([shape('s1', 100, 100), text('t1', 'Circle', 120, 130)]);
  const result = runBindingDiagnostic(model, null, null);
  assert.ok(result, 'report should be returned');
  assert.ok(result.summary, 'report.summary must exist');
  assert.ok(Array.isArray(result.textBindings), 'textBindings must be array');
  assert.ok(Array.isArray(result.containerOwnership), 'containerOwnership must be array');
  assert.ok(Array.isArray(result.connectors), 'connectors must be array');
  assert.ok(Array.isArray(result.freeformGroups), 'freeformGroups must be array');
});

test('reports text with parentShapeId as explicit-metadata winner', () => {
  const objects = [
    shape('rect1', 100, 100),
    text('txt1', 'Circle', 130, 130, 80, 24, { relationshipMetadata: { parentShapeId: 'rect1' } })
  ];
  const model = makeModel(objects);
  const result = runBindingDiagnostic(model, null, null);
  const txtReport = result.textBindings.find((r) => r.textObjectId === 'txt1');
  assert.ok(txtReport, 'text report must exist');
  assert.equal(txtReport.winningTier, 'explicit-metadata', 'parentShapeId should win tier 1');
  assert.equal(txtReport.tier1ExplicitMetadata.pass, true);
});

test('reports text with attachedTextId on container as explicit-metadata winner', () => {
  const objects = [
    shape('rect1', 100, 100, 140, 90, { relationshipMetadata: { attachedTextId: 'txt1' } }),
    text('txt1', 'Hello', 130, 130)
  ];
  const model = makeModel(objects);
  const result = runBindingDiagnostic(model, null, null);
  const containerReport = result.containerOwnership.find((r) => r.containerObjectId === 'rect1');
  assert.ok(containerReport, 'container report must exist');
  assert.equal(containerReport.tier1ExplicitMetadata.pass, true, 'container tier1 should pass');
  assert.equal(containerReport.tier1ExplicitMetadata.attachedTextId, 'txt1');
});

test('reports text with shared elementId as shared-element-id winner', () => {
  const eid = 'elem-abc';
  const objects = [
    { ...shape('rect1', 100, 100), elementId: eid },
    { ...text('txt1', 'Hi', 130, 130), elementId: eid }
  ];
  const model = makeModel(objects);
  const result = runBindingDiagnostic(model, null, null);
  const txtReport = result.textBindings.find((r) => r.textObjectId === 'txt1');
  assert.ok(txtReport, 'text report must exist');
  assert.equal(txtReport.tier2SharedElementId.pass, true, 'elementId tier should pass');
  assert.equal(txtReport.tier2SharedElementId.textElementId, eid);
});

test('reports standalone text with no binding as standalone', () => {
  const objects = [
    shape('rect1', 500, 500),
    text('txt1', 'Floating note', 10, 10)
  ];
  const model = makeModel(objects);
  const result = runBindingDiagnostic(model, null, null);
  const txtReport = result.textBindings.find((r) => r.textObjectId === 'txt1');
  assert.ok(txtReport, 'text report must exist');
  assert.equal(txtReport.tier1ExplicitMetadata.pass, false);
  assert.equal(txtReport.tier2SharedElementId.pass, false);
  assert.equal(txtReport.tier3GeometricContainment.pass, false);
  assert.equal(txtReport.winningTier, 'standalone');
});

test('reports geometric containment when text center is inside container', () => {
  const objects = [
    shape('rect1', 100, 100, 200, 100),
    text('txt_inside', 'Inside text', 140, 135, 60, 20)
  ];
  const model = makeModel(objects);
  const result = runBindingDiagnostic(model, null, null);
  const txtReport = result.textBindings.find((r) => r.textObjectId === 'txt_inside');
  assert.ok(txtReport, 'text report must exist');
  assert.equal(txtReport.tier3GeometricContainment.pass, true, 'should detect containment');
});

test('connector report includes source and target ids', () => {
  const objects = [
    shape('s1', 100, 100),
    shape('s2', 400, 100),
    {
      id: 'c1', type: 'connector',
      position: { x: 250, y: 100 }, size: { width: 10, height: 10 },
      rotation: 0, scale: { x: 1, y: 1 }, zIndex: 2, metadata: {},
      relationshipMetadata: { sourceShapeId: 's1', targetShapeId: 's2' }
    }
  ];
  const model = makeModel(objects);
  const result = runBindingDiagnostic(model, null, null);
  assert.equal(result.connectors.length, 1);
  const conn = result.connectors[0];
  assert.equal(conn.connectorObjectId, 'c1');
  assert.equal(conn.metadataSourceShapeId, 's1');
  assert.equal(conn.metadataTargetShapeId, 's2');
});

test('summary tally is consistent with textBindings count', () => {
  const objects = [
    shape('s1', 100, 100),
    text('t1', 'A', 10, 10),
    text('t2', 'B', 20, 10),
  ];
  const model = makeModel(objects);
  const result = runBindingDiagnostic(model, null, null);
  const tallyTotal = Object.values(result.summary.ownershipWinnerTally).reduce((a, b) => a + b, 0);
  assert.equal(tallyTotal, result.textBindings.length, 'tally must sum to total text objects');
});

test('no credentials or private fields appear in report', () => {
  const model = makeModel([shape('s1'), text('t1', 'hello', 100, 100)]);
  const result = runBindingDiagnostic(model, null, null);
  const json = JSON.stringify(result);
  const forbidden = ['password', 'token', 'apiKey', 'Authorization', 'credential', 'cookie', 'base64'];
  forbidden.forEach((word) => {
    assert.ok(!json.toLowerCase().includes(word.toLowerCase()), `report must not contain '${word}'`);
  });
});

test('diagnostic is deterministic (same input produces same report)', () => {
  const model = makeModel([shape('s1', 100, 100), text('t1', 'hello', 120, 130)]);
  const r1 = runBindingDiagnostic(model, null, null);
  const r2 = runBindingDiagnostic(model, null, null);
  assert.deepEqual(
    r1.textBindings.map((r) => r.winningTier),
    r2.textBindings.map((r) => r.winningTier)
  );
});

test('semantic scene tier4 reports same-group when both text and container share a group', () => {
  const eid = 'shared-elem';
  const model = makeModel([
    { ...shape('s1', 100, 100), elementId: eid },
    { ...text('t1', 'hello', 130, 130, 60, 20), elementId: eid }
  ]);
  const semanticScene = {
    groups: [{ id: 'g1', type: 'concept', objectIds: ['s1', 't1'] }]
  };
  const result = runBindingDiagnostic(model, semanticScene, null);
  const txtReport = result.textBindings.find((r) => r.textObjectId === 't1');
  assert.ok(txtReport);
  assert.equal(txtReport.tier2SharedElementId.pass, true, 'shared elementId should win tier 2');
  assert.equal(txtReport.tier4SemanticGroup.result, 'same-group', 'tier4 should see same group');
});
