import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createCanvasStructure } from './cleanupTypes.js';

describe('Canonical CanvasStructure Factory', () => {
  it('instantiates cleanly and assigns default fields', () => {
    const struct = createCanvasStructure({
      id: 'struct_123',
      type: 'flow',
      objectIds: ['a', 'b'],
      connectorIds: ['c1']
    });

    assert.strictEqual(struct.id, 'struct_123');
    assert.strictEqual(struct.type, 'flow');
    assert.deepStrictEqual(struct.objectIds, ['a', 'b']);
    assert.deepStrictEqual(struct.connectorIds, ['c1']);
    assert.deepStrictEqual(struct.relationships, []);
    assert.strictEqual(struct.confidence, 1.0);
    assert.deepStrictEqual(struct.evidence, []);
  });

  it('proves planning state is explicitly absent and discarded by the canonical factory', () => {
    const struct = createCanvasStructure({
      id: 'struct_456',
      type: 'cluster',
      objectIds: ['x'],
      candidateCompositions: [{ template: 'flow' }],
      currentComposition: { quality: 5 },
      compositionBenefit: 10,
      movementCost: 2,
      risk: 1,
      cleanupEligibility: 'eligible'
    });

    assert.strictEqual(struct.id, 'struct_456');
    assert.strictEqual(struct.candidateCompositions, undefined);
    assert.strictEqual(struct.currentComposition, undefined);
    assert.strictEqual(struct.compositionBenefit, undefined);
    assert.strictEqual(struct.movementCost, undefined);
    assert.strictEqual(struct.risk, undefined);
    assert.strictEqual(struct.cleanupEligibility, undefined);
  });

  it('preserves semantic fields and stable structure identity', () => {
    const evidenceList = ['verified-connector-topology'];
    const struct = createCanvasStructure({
      id: 'struct_789',
      type: 'conceptGroup',
      evidence: evidenceList,
      confidence: 0.95,
      relationships: [{ type: 'connectedTo', target: 'other' }],
      metadata: { safe: true }
    });

    assert.strictEqual(struct.id, 'struct_789');
    assert.strictEqual(struct.type, 'conceptGroup');
    assert.strictEqual(struct.confidence, 0.95);
    assert.deepStrictEqual(struct.evidence, evidenceList);
    assert.deepStrictEqual(struct.relationships, [{ type: 'connectedTo', target: 'other' }]);
    
    // Explicit test for stable identity and no object mutation side-effects on missing optional fields.
    assert.strictEqual(struct.bounds, null);
  });
});
