import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeWorkspaceWithOmni } from './omniClient.js';

const sampleModel = { version: 1, board: { objects: [{ id: 's1', type: 'shape' }] } };
const sampleImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const validPlan = {
  version: 1,
  workspaceType: 'notes',
  hierarchy: [{ type: 'document_root', titleObjectId: null, sections: ['sec1'] }],
  sections: [{ id: 'sec1', type: 'notes', objectIds: ['s1'] }],
  relationships: []
};

test('TEST 1: Correct endpoint /mess-cleanup/analyze is called', async () => {
  let requestedUrl = '';
  const mockClient = {
    post: async (url) => {
      requestedUrl = url;
      return { data: { organizationPlan: validPlan } };
    }
  };

  await analyzeWorkspaceWithOmni(sampleModel, sampleImage, { apiClient: mockClient });
  assert.equal(requestedUrl, '/mess-cleanup/analyze');
});

test('TEST 2: Correct POST method and payload format', async () => {
  let sentPayload = null;
  const mockClient = {
    post: async (url, payload) => {
      sentPayload = payload;
      return { data: { organizationPlan: validPlan } };
    }
  };

  await analyzeWorkspaceWithOmni(sampleModel, sampleImage, { apiClient: mockClient });
  assert.ok(sentPayload);
  assert.equal(sentPayload.image, sampleImage);
});

test('TEST 3: WorkspaceModel is included in payload', async () => {
  let sentPayload = null;
  const mockClient = {
    post: async (url, payload) => {
      sentPayload = payload;
      return { data: { organizationPlan: validPlan } };
    }
  };

  await analyzeWorkspaceWithOmni(sampleModel, sampleImage, { apiClient: mockClient });
  assert.deepEqual(sentPayload.workspaceModel, sampleModel);
});

test('TEST 4: Screenshot is included in payload', async () => {
  let sentPayload = null;
  const mockClient = {
    post: async (url, payload) => {
      sentPayload = payload;
      return { data: { organizationPlan: validPlan } };
    }
  };

  await analyzeWorkspaceWithOmni(sampleModel, sampleImage, { apiClient: mockClient });
  assert.equal(sentPayload.image, sampleImage);
});

test('TEST 5: Successful response parsed and returns organizationPlan', async () => {
  const mockClient = {
    post: async () => ({ data: { organizationPlan: validPlan } })
  };

  const plan = await analyzeWorkspaceWithOmni(sampleModel, sampleImage, { apiClient: mockClient });
  assert.deepEqual(plan, validPlan);
});

test('TEST 6: 400 response surfaced with error message', async () => {
  const mockClient = {
    post: async () => {
      const err = new Error('Missing or invalid workspaceModel payload');
      err.status = 400;
      err.code = 'INVALID_WORKSPACE_MODEL';
      throw err;
    }
  };

  await assert.rejects(
    analyzeWorkspaceWithOmni(sampleModel, sampleImage, { apiClient: mockClient }),
    (err) => err.status === 400 && err.message.includes('workspaceModel')
  );
});

test('TEST 7: 502 response surfaced with error message', async () => {
  const mockClient = {
    post: async () => {
      const err = new Error('NVIDIA API request failed with status 502');
      err.status = 502;
      err.code = 'NVIDIA_API_ERROR';
      throw err;
    }
  };

  await assert.rejects(
    analyzeWorkspaceWithOmni(sampleModel, sampleImage, { apiClient: mockClient }),
    (err) => err.status === 502 && err.code === 'NVIDIA_API_ERROR'
  );
});

test('TEST 8: 503 response surfaced with error message', async () => {
  const mockClient = {
    post: async () => {
      const err = new Error('AI service is not configured on the server');
      err.status = 503;
      err.code = 'NO_API_KEY';
      throw err;
    }
  };

  await assert.rejects(
    analyzeWorkspaceWithOmni(sampleModel, sampleImage, { apiClient: mockClient }),
    (err) => err.status === 503 && err.code === 'NO_API_KEY'
  );
});

test('TEST 9: 504 response surfaced with error message', async () => {
  const mockClient = {
    post: async () => {
      const err = new Error('NVIDIA API request timed out after 15000ms');
      err.status = 504;
      err.code = 'TIMEOUT';
      throw err;
    }
  };

  await assert.rejects(
    analyzeWorkspaceWithOmni(sampleModel, sampleImage, { apiClient: mockClient }),
    (err) => err.status === 504 && err.code === 'TIMEOUT'
  );
});

test('TEST 10: Malformed non-JSON response handled cleanly without crash', async () => {
  const mockClient = {
    post: async () => ({ data: { invalidKey: 'no_plan_here' } })
  };

  await assert.rejects(
    analyzeWorkspaceWithOmni(sampleModel, sampleImage, { apiClient: mockClient }),
    (err) => err.code === 'INVALID_SERVER_RESPONSE' && err.status === 502
  );
});
