

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayoutProposal } from './layoutEngine.js';
import { workspaceModel, organizationPlan, weldedPairs } from './fixtures/realMessyBoard.js';

const build = () => createLayoutProposal(organizationPlan, workspaceModel);
const placementOf = (proposal, id) => proposal.placements.find((p) => p.objectId === id);
const centerInside = (inner, outer) => {
  const cx = inner.bounds.x + inner.bounds.width / 2;
  const cy = inner.bounds.y + inner.bounds.height / 2;
  return cx >= outer.bounds.x && cx <= outer.bounds.x + outer.bounds.width &&
         cy >= outer.bounds.y && cy <= outer.bounds.y + outer.bounds.height;
};

test('inner labels weld to their shape despite split groups', () => {
  const proposal = build();
  weldedPairs.forEach(([shapeId, textId]) => {
    const pShape = placementOf(proposal, shapeId);
    const pText = placementOf(proposal, textId);
    assert.ok(pShape && pText, `${shapeId} and ${textId} must both be placed`);
    assert.equal(pText.unitId, pShape.unitId, `${textId} must share ${shapeId}'s unit (was torn out)`);
  });
});

test('inner labels render inside their shape bounds', () => {
  const proposal = build();
  weldedPairs.forEach(([shapeId, textId]) => {
    const pShape = placementOf(proposal, shapeId);
    const pText = placementOf(proposal, textId);
    assert.ok(centerInside(pText, pShape), `${textId} center must fall within ${shapeId} bounds`);
  });
});

test('no inner label becomes its own standalone section', () => {
  const proposal = build();
  weldedPairs.forEach(([shapeId, textId]) => {
    const stray = proposal.sections.filter(
      (s) => s.objectIds.length === 1 && s.objectIds.includes(textId)
    );
    assert.equal(stray.length, 0, `${textId} must not be its own section`);
    const shared = proposal.sections.find((s) => s.objectIds.includes(shapeId));
    assert.ok(shared && shared.objectIds.includes(textId),
      `${textId} must share ${shapeId}'s section`);
  });
});

test('ungrouped sticky-note text stays welded inside the note', () => {
  const proposal = build();
  const pBg = placementOf(proposal, 'shape_note');
  const pTxt = placementOf(proposal, 'text_note');
  assert.ok(pBg && pTxt, 'both note objects must be placed');
  assert.equal(pTxt.unitId, pBg.unitId, 'note text must share the note background unit');
  assert.ok(centerInside(pTxt, pBg), 'note text center must fall within the note background');
});

test('metadata-less contained text welds by geometric containment', () => {
  const proposal = build();
  const pShape = placementOf(proposal, 'shape_plain');
  const pText = placementOf(proposal, 'text_inside');
  assert.ok(pShape && pText, 'plain shape and contained text must both be placed');
  assert.equal(pText.unitId, pShape.unitId, 'contained text must weld to the enclosing shape');
  assert.ok(centerInside(pText, pShape), 'contained text center must fall within the shape');
});

test('independent text stays standalone and horizontally readable', () => {
  const proposal = build();
  const pFree = placementOf(proposal, 'text_free');
  assert.ok(pFree, 'independent text must be placed');
  assert.equal(pFree.rotation, 0, 'standalone text must be horizontal');
  
  const shapeUnitIds = new Set(
    weldedPairs.map(([shapeId]) => placementOf(proposal, shapeId)?.unitId)
  );
  assert.equal(shapeUnitIds.has(pFree.unitId), false,
    'independent text must not share a shape unit');
});

test('handwriting strokes remain one atomic unit', () => {
  const proposal = build();
  const ids = ['stroke_h1', 'stroke_h2', 'stroke_h3'].map((id) => placementOf(proposal, id));
  assert.ok(ids.every(Boolean), 'all strokes must be placed');
  const unitIds = new Set(ids.map((p) => p.unitId));
  assert.equal(unitIds.size, 1, 'handwriting strokes must share one unit');
});

test('no detached linked objects and geometry integrity holds', () => {
  const proposal = build();
  assert.deepEqual(proposal.metadata.diagnostics.detachedLinkedObjects, []);
  assert.deepEqual(proposal.metadata.diagnostics.orphanConnectors, []);
  assert.ok(proposal.metadata.diagnostics.visualIntegrity.geometryIntegrityPassed);
});

test('every object is placed exactly once', () => {
  const proposal = build();
  const placedIds = proposal.placements.map((p) => p.objectId);
  assert.equal(placedIds.length, new Set(placedIds).size, 'no duplicate placements');
  workspaceModel.board.objects.forEach((obj) => {
    assert.ok(placedIds.includes(obj.id), `${obj.id} must be placed`);
  });
});

test('layout is deterministic', () => {
  assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});
