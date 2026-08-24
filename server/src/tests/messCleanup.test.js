import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MESS_CLEANUP_SYSTEM_PROMPT,
  analyzeWithNemotron,
  buildMultimodalPayload,
  extractJsonFromText,
  formatImageUrl
} from '../services/nemotronService.js';
import messCleanupController from '../controllers/messCleanupController.js';

const sampleWorkspaceModel = {
  version: 1,
  board: {
    objects: [
      { id: 't1', type: 'text', text: 'Meeting Notes', position: { x: 100, y: 50 }, size: { width: 180, height: 28 } },
      { id: 'n1', type: 'note', position: { x: 100, y: 150 }, size: { width: 120, height: 80 } },
      { id: 'n2', type: 'note', position: { x: 240, y: 150 }, size: { width: 120, height: 80 } }
    ]
  }
};

const sampleScreenshot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const validPlanResponse = {
  version: 1,
  workspaceType: 'notes',
  hierarchy: [
    {
      type: 'document_root',
      titleObjectId: 't1',
      sections: ['section_1']
    }
  ],
  sections: [
    {
      id: 'section_1',
      type: 'notes',
      titleObjectId: 't1',
      purpose: 'Meeting action items',
      layoutHint: 'grid',
      objectIds: ['t1', 'n1', 'n2']
    }
  ],
  relationships: [
    {
      sourceObjectId: 't1',
      targetObjectIds: ['n1', 'n2'],
      type: 'notes-heading',
      confidence: 0.95
    }
  ]
};

const mockRes = () => {
  const res = {
    statusCode: 200,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonBody = data;
      return this;
    }
  };
  return res;
};

test('TEST 1: Successful Omni request returns parsed plan payload', async () => {
  const mockFetch = async (url, options) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(validPlanResponse)
            }
          }
        ]
      })
    };
  };

  const plan = await analyzeWithNemotron(sampleWorkspaceModel, sampleScreenshot, {
    apiKey: 'mock_key',
    fetch: mockFetch
  });

  assert.deepEqual(plan, validPlanResponse);
});

test('TEST 2: Correct model identifier is set in payload', () => {
  const payload = buildMultimodalPayload(sampleWorkspaceModel, sampleScreenshot, 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');
  assert.equal(payload.model, 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');
});

test('TEST 3: Correct multimodal request structure with system prompt', () => {
  const payload = buildMultimodalPayload(sampleWorkspaceModel, sampleScreenshot);

  assert.equal(payload.messages.length, 2);
  assert.equal(payload.messages[0].role, 'system');
  assert.ok(payload.messages[0].content.includes('semantic organization engine'));
  assert.equal(payload.messages[1].role, 'user');
  assert.equal(Array.isArray(payload.messages[1].content), true);
});

test('TEST 4: Workspace JSON is included in user prompt text', () => {
  const payload = buildMultimodalPayload(sampleWorkspaceModel, sampleScreenshot);
  const textContent = payload.messages[1].content.find((item) => item.type === 'text')?.text || '';

  assert.ok(textContent.includes('Meeting Notes'));
  assert.ok(textContent.includes('WorkspaceModel JSON'));
});

test('TEST 5: Screenshot is included as formatted image_url', () => {
  const payload = buildMultimodalPayload(sampleWorkspaceModel, 'base64rawstring');
  const imageItem = payload.messages[1].content.find((item) => item.type === 'image_url');

  assert.ok(imageItem);
  assert.equal(imageItem.image_url.url, 'data:image/png;base64,base64rawstring');
});

test('TEST 6: Missing workspaceModel causes controller 400 response', async () => {
  const req = { body: { image: sampleScreenshot }, user: { id: 'u1' } };
  const res = mockRes();

  await messCleanupController.analyze(req, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.jsonBody.success, false);
  assert.ok(res.jsonBody.message.includes('workspaceModel'));
});

test('TEST 7: Missing screenshot causes controller 400 response', async () => {
  const req = { body: { workspaceModel: sampleWorkspaceModel }, user: { id: 'u1' } };
  const res = mockRes();

  await messCleanupController.analyze(req, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.jsonBody.success, false);
  assert.ok(res.jsonBody.message.includes('image'));
});

test('TEST 8: NVIDIA 4xx response returns error status without silent fallback', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => 'Invalid API key'
  });

  await assert.rejects(
    analyzeWithNemotron(sampleWorkspaceModel, sampleScreenshot, { apiKey: 'bad_key', fetch: mockFetch }),
    (err) => err.code === 'NVIDIA_API_ERROR' && err.statusCode === 401
  );
});

test('TEST 9: NVIDIA 5xx response throws 502 error', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    text: async () => 'NVIDIA API down'
  });

  await assert.rejects(
    analyzeWithNemotron(sampleWorkspaceModel, sampleScreenshot, { apiKey: 'key', fetch: mockFetch }),
    (err) => err.code === 'NVIDIA_API_ERROR' && err.statusCode === 502
  );
});

test('TEST 10: Timeout aborts request and returns timeout error', async () => {
  const mockFetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });

  await assert.rejects(
    analyzeWithNemotron(sampleWorkspaceModel, sampleScreenshot, { apiKey: 'key', fetch: mockFetch, timeoutMs: 50 }),
    (err) => err.code === 'TIMEOUT' && err.statusCode === 504
  );
});

test('TEST 11: Malformed model response returns error status', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'Sorry, I cannot organize this as JSON without brackets.' } }]
    })
  });

  await assert.rejects(
    analyzeWithNemotron(sampleWorkspaceModel, sampleScreenshot, { apiKey: 'key', fetch: mockFetch }),
    (err) => err.code === 'MALFORMED_JSON_RESPONSE'
  );
});

test('TEST 12: extractJsonFromText extracts JSON wrapped in Markdown code blocks and prose', () => {
  const markdownText = 'Here is the plan:\n```json\n{"workspaceType": "notes"}\n```\nHope this helps!';
  const parsed = extractJsonFromText(markdownText);
  assert.equal(parsed.workspaceType, 'notes');
});
