import { buildCleanupPlan } from './buildCleanupPlan.js';
import test from 'node:test';
import assert from 'node:assert';

const createNode = (id, x, y, width, height, type = 'rect', text = '') => {
  return [
    { id: `shape_${id}`, type, left: x, top: y, width, height, scaleX: 1, scaleY: 1, isSkribeShape: true },
    { id: `text_${id}`, type: 'textbox', left: x + 10, top: y + 10, width: width - 20, height: height - 20, text, parentShapeId: `shape_${id}` }
  ];
};

const createConn = (id, srcId, tgtId, x, y, routeType = 'straight') => {
  return { id, type: 'path', isConnector: true, left: x, top: y, sourceShapeId: `shape_${srcId}`, targetShapeId: `shape_${tgtId}`, routeType };
};

import { describe, it, beforeEach } from 'node:test';

describe('Structure-Aware Cleanup Scope (SELECTION vs BOARD)', () => {
  let wsModel;

  beforeEach(() => {
    const objects = [
      // Flow 1
      ...createNode('1', 0, 0, 100, 100),
      ...createNode('2', 150, 0, 100, 100),
      createConn('c1', '1', '2', 100, 50),

      // Flow 2
      ...createNode('3', 0, 200, 100, 100),
      ...createNode('4', 150, 200, 100, 100),
      createConn('c2', '3', '4', 100, 250)
    ];

    wsModel = { board: { objects } };
  });

  it('BOARD scope processes all structures', () => {
    const context = { scopeType: 'BOARD', selectedObjectIds: [] };
    const plan = buildCleanupPlan(null, wsModel, { cleanupContext: context });

    // There should be no outside-scope structures, except maybe non-eligible ones
    const eligibleCount = plan.diagnostics.structures.filter(s => s.cleanupEligibility !== 'outside-scope' && s.type !== 'creative' && s.type !== 'structural').length;
    const outsideCount = plan.diagnostics.structures.filter(s => s.cleanupEligibility === 'outside-scope').length;

    assert.strictEqual(outsideCount, 0);
    assert.ok(eligibleCount > 0);
  });

  it('SELECTION scope isolates structures intersecting the selection', () => {
    // Select a shape from Flow 1
    const context = { scopeType: 'SELECTION', selectedObjectIds: ['shape_1'] };
    const plan = buildCleanupPlan(null, wsModel, { cleanupContext: context });

    const outsideCount = plan.diagnostics.structures.filter(s => s.cleanupEligibility === 'outside-scope').length;
    const eligibleCount = plan.diagnostics.structures.filter(s => s.cleanupEligibility !== 'outside-scope' && s.type !== 'creative' && s.type !== 'structural').length;

    assert.ok(outsideCount > 0);
    assert.ok(eligibleCount > 0);
  });

  it('SELECTION scope suppresses cross-contamination', () => {
    // Select Flow 2 only
    const context = { scopeType: 'SELECTION', selectedObjectIds: ['shape_3', 'shape_4'] };
    const plan = buildCleanupPlan(null, wsModel, { cleanupContext: context });

    // Check opportunities. Actions on shape_1 should not be present
    const touchesFlow1 = plan.actions.some(a =>
      a.objectIds?.some(id => id.includes('_1') || id.includes('_2'))
    );
    assert.strictEqual(touchesFlow1, false);
  });
});
