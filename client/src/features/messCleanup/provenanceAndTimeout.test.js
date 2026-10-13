import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeWorkspace } from './analyzeWorkspace.js';
import { createLayoutProposal } from './layoutEngine.js';
import { analyzeWorkspaceWithOmni } from './omniClient.js';
import { validateOrganizationPlan } from './validateOrganizationPlan.js';

const sampleModel = {
  version: 1,
  board: {
    objects: [
      { id: 'h1', type: 'text', text: 'Architecture Overview', position: { x: 100, y: 100 }, size: { width: 220, height: 32 } },
      { id: 'b1', type: 'text', text: 'Core engine implementation', position: { x: 100, y: 160 }, size: { width: 200, height: 24 } },
      { id: 's1', type: 'shape', shapeType: 'rect', position: { x: 400, y: 100 }, size: { width: 140, height: 80 } },
      { id: 's2', type: 'shape', shapeType: 'rect', position: { x: 600, y: 100 }, size: { width: 140, height: 80 } }
    ]
  }
};

const sampleScreenshot = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const mockAiSuccessResponse = {
  version: 1,
  workspaceType: 'diagram',
  model: 'gemini-3.8-flash',
  document: {
    titleObjectId: 'h1',
    sections: [
      {
        id: 'sec_1',
        type: 'diagram',
        titleObjectId: 'h1',
        layoutHint: 'flow',
        objectIds: ['h1', 'b1', 's1', 's2']
      }
    ]
  },
  sections: [
    {
      id: 'sec_1',
      type: 'diagram',
      titleObjectId: 'h1',
      layoutHint: 'flow',
      objectIds: ['h1', 'b1', 's1', 's2']
    }
  ],
  relationships: []
};

test('TEST 1: Successful AI analysis returns valid AI provenance with configured model', async () => {
  const mockClient = {
    post: async () => ({
      data: {
        organizationPlan: mockAiSuccessResponse,
        model: 'gemini-3.8-flash'
      }
    })
  };

  const plan = await analyzeWorkspace(sampleModel, sampleScreenshot, { apiClient: mockClient });

  assert.equal(plan.provenance.engine, 'ai-assisted');
  assert.equal(plan.provenance.isFallback, false);
  assert.equal(plan.provenance.aiUnavailable, false);
  assert.equal(plan.provenance.model, 'gemini-3.8-flash');
  assert.equal(plan.sections.length, 1);
});

test('TEST 2: Exhausted HTTP 503 attempts invoke deterministic fallback with SERVICE_UNAVAILABLE category', async () => {
  const mockClient = {
    post: async () => {
      const err = new Error('NVIDIA API request failed with status 503: Service Unavailable');
      err.status = 503;
      err.code = 'SERVICE_UNAVAILABLE';
      throw err;
    }
  };

  const plan = await analyzeWorkspace(sampleModel, sampleScreenshot, { apiClient: mockClient });

  assert.equal(plan.provenance.engine, 'deterministic-fallback');
  assert.equal(plan.provenance.isFallback, true);
  assert.equal(plan.provenance.aiUnavailable, true);
  assert.equal(plan.provenance.failureCategory, 'SERVICE_UNAVAILABLE');
  assert.ok(plan.sections.length > 0);
  assert.equal(Object.hasOwn(plan.provenance, 'stack'), false);
});

test('TEST 3: HTTP 502 controller failures invoke deterministic fallback with UPSTREAM_ERROR category', async () => {
  const mockClient = {
    post: async () => {
      const err = new Error('AI model returned an invalid organization plan structure');
      err.status = 502;
      err.code = 'INVALID_PLAN_SCHEMA';
      throw err;
    }
  };

  const plan = await analyzeWorkspace(sampleModel, sampleScreenshot, { apiClient: mockClient });

  assert.equal(plan.provenance.engine, 'deterministic-fallback');
  assert.equal(plan.provenance.isFallback, true);
  assert.equal(plan.provenance.aiUnavailable, true);
  assert.equal(plan.provenance.failureCategory, 'UPSTREAM_ERROR');
  assert.ok(plan.sections.length > 0);
});

test('TEST 4: Axios timeout invokes fallback with TIMEOUT category', async () => {
  const mockClient = {
    post: async () => {
      const err = new Error('timeout of 30000ms exceeded');
      err.code = 'ECONNABORTED';
      err.status = 504;
      throw err;
    }
  };

  const plan = await analyzeWorkspace(sampleModel, sampleScreenshot, { apiClient: mockClient });

  assert.equal(plan.provenance.engine, 'deterministic-fallback');
  assert.equal(plan.provenance.isFallback, true);
  assert.equal(plan.provenance.aiUnavailable, true);
  assert.equal(plan.provenance.failureCategory, 'TIMEOUT');
  assert.ok(plan.sections.length > 0);
});

test('TEST 5: Direct deterministic local run attaches deterministic-local provenance', () => {
  const plan = analyzeWorkspace(sampleModel, null);

  assert.equal(plan.provenance.engine, 'deterministic-local');
  assert.equal(plan.provenance.isFallback, false);
  assert.equal(plan.provenance.aiUnavailable, false);
});

test('TEST 6: Provenance survives layout proposal construction into proposal metadata', async () => {
  const mockClient = {
    post: async () => {
      const err = new Error('Worker local total request limit reached');
      err.status = 503;
      throw err;
    }
  };

  const plan = await analyzeWorkspace(sampleModel, sampleScreenshot, { apiClient: mockClient });
  const proposal = createLayoutProposal(plan, sampleModel);

  assert.ok(proposal.provenance);
  assert.equal(proposal.provenance.engine, 'deterministic-fallback');
  assert.equal(proposal.provenance.isFallback, true);
  assert.equal(proposal.metadata.provenance.engine, 'deterministic-fallback');
  assert.equal(proposal.metadata.provenance.failureCategory, 'SERVICE_UNAVAILABLE');
});

test('TEST 7: No previous provenance or plan leaks into a new request', async () => {
  const mockClientAi = {
    post: async () => ({
      data: {
        organizationPlan: mockAiSuccessResponse,
        model: 'model-a'
      }
    })
  };

  const firstPlan = await analyzeWorkspace(sampleModel, sampleScreenshot, { apiClient: mockClientAi });
  assert.equal(firstPlan.provenance.engine, 'ai-assisted');
  assert.equal(firstPlan.provenance.isFallback, false);

  const mockClientFail = {
    post: async () => {
      const err = new Error('Service Unavailable');
      err.status = 503;
      throw err;
    }
  };

  const secondPlan = await analyzeWorkspace(sampleModel, sampleScreenshot, { apiClient: mockClientFail });
  assert.equal(secondPlan.provenance.engine, 'deterministic-fallback');
  assert.equal(secondPlan.provenance.isFallback, true);
  assert.equal(secondPlan.provenance.aiUnavailable, true);
  assert.notEqual(secondPlan.provenance.engine, firstPlan.provenance.engine);
});

test('TEST 8: omniClient defaults to 30s timeout deadline', async () => {
  let capturedConfig = null;
  const mockClient = {
    post: async (url, payload, config) => {
      capturedConfig = config;
      return {
        data: {
          organizationPlan: mockAiSuccessResponse
        }
      };
    }
  };

  await analyzeWorkspaceWithOmni(sampleModel, sampleScreenshot, { apiClient: mockClient });
  assert.equal(capturedConfig?.timeout, 30000);
});

test('TEST 9: validateOrganizationPlan preserves verified model identifier', () => {
  const rawWithCustomModel = {
    ...mockAiSuccessResponse,
    source: {
      engine: 'gemini',
      model: 'gemini-3.8-flash-live-verified'
    }
  };

  const validated = validateOrganizationPlan(sampleModel, rawWithCustomModel);
  assert.equal(validated.source.model, 'gemini-3.8-flash-live-verified');
  assert.equal(validated.provenance.model, 'gemini-3.8-flash-live-verified');
  assert.equal(validated.provenance.engine, 'ai-assisted');
  assert.equal(validated.provenance.isFallback, false);
});

test('TEST 10: Explicitly labelled AI success fixture verified contract', () => {
  const fixtureAiPlan = {
    ...mockAiSuccessResponse,
    provenance: {
      engine: 'ai-assisted',
      isFallback: false,
      aiUnavailable: false,
      model: 'gemini-3.8-flash-fixture'
    }
  };

  const proposal = createLayoutProposal(fixtureAiPlan, sampleModel);
  assert.equal(proposal.provenance.engine, 'ai-assisted');
  assert.equal(proposal.provenance.isFallback, false);
  assert.equal(proposal.metadata.provenance.model, 'gemini-3.8-flash-fixture');
});

test('TEST 11: Duplicate analysis calls are blocked when loading guard is active', async () => {
  let callCount = 0;
  const mockClient = {
    post: async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 50));
      return { data: { organizationPlan: mockAiSuccessResponse } };
    }
  };

  let isLoading = false;
  const triggerAnalysis = async () => {
    if (isLoading) return null;
    isLoading = true;
    try {
      return await analyzeWorkspace(sampleModel, sampleScreenshot, { apiClient: mockClient });
    } finally {
      isLoading = false;
    }
  };

  const p1 = triggerAnalysis();
  const p2 = triggerAnalysis();
  const [res1, res2] = await Promise.all([p1, p2]);

  assert.equal(callCount, 1);
  assert.ok(res1 !== null);
  assert.equal(res2, null);
  assert.equal(isLoading, false);
});
