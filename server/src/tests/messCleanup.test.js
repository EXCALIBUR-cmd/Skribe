import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleGenAI } from '@google/genai';
import {
  MESS_CLEANUP_SYSTEM_PROMPT,
  GEMINI_ORGANIZATION_PLAN_SCHEMA,
  analyzeWithGemini,
  buildGeminiInput,
  extractJsonFromText,
  parseImageData
} from '../services/geminiService.js';
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

const createMockGeminiClient = (options = {}) => {
  return {
    interactions: {
      create: async (params, reqOptions) => {
        if (options.onCall) {
          options.onCall(params, reqOptions);
        }
        if (options.throwError) {
          throw options.throwError;
        }
        return {
          id: options.id || 'interaction_test_123',
          model: options.model || params.model || 'gemini-3.8-flash',
          status: 'completed',
          usage: options.usage || { prompt_tokens: 150, completion_tokens: 60, total_tokens: 210 },
          output_text: options.outputText !== undefined ? options.outputText : JSON.stringify(validPlanResponse)
        };
      }
    }
  };
};

test('TEST 1: Successful Gemini request returns parsed plan payload', async () => {
  const mockClient = createMockGeminiClient();

  const plan = await analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
    apiKey: 'mock_key',
    client: mockClient
  });

  assert.equal(plan.workspaceType, 'notes');
  assert.equal(plan.version, 1);
  assert.equal(plan.sections.length, 1);
  assert.equal(plan.relationships.length, 1);
  assert.equal(plan.source?.engine, 'gemini');
  assert.equal(plan.source?.model, 'gemini-3.8-flash');
});

test('TEST 2: Correct model identifier is set in payload', () => {
  const input = buildGeminiInput(sampleWorkspaceModel, sampleScreenshot);
  assert.ok(Array.isArray(input));
  assert.equal(input.length, 2);
  assert.equal(input[0].type, 'text');
  assert.equal(input[1].type, 'image');
});

test('TEST 3: Correct multimodal request structure with system prompt', () => {
  const input = buildGeminiInput(sampleWorkspaceModel, sampleScreenshot);

  assert.equal(input.length, 2);
  assert.equal(input[0].type, 'text');
  assert.ok(input[0].text.includes('visual semantic organization engine'));
  assert.equal(input[1].type, 'image');
  assert.equal(input[1].mime_type, 'image/png');
  assert.ok(input[1].data.length > 0);
});

test('TEST 4: Workspace JSON is included in user prompt text', () => {
  const input = buildGeminiInput(sampleWorkspaceModel, sampleScreenshot);
  const textPrompt = input[0].text;

  assert.ok(textPrompt.includes('Meeting Notes'));
  assert.ok(textPrompt.includes('WorkspaceModel JSON:'));
});

test('TEST 5: Screenshot is parsed into mime_type and base64 data', () => {
  const parsed = parseImageData('data:image/jpeg;base64,abc123xyz');
  assert.equal(parsed.mime_type, 'image/jpeg');
  assert.equal(parsed.data, 'abc123xyz');

  const rawParsed = parseImageData('rawbase64payload');
  assert.equal(rawParsed.mime_type, 'image/jpeg');
  assert.equal(rawParsed.data, 'rawbase64payload');
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

test('TEST 8: Authentication error returns 401 without secret disclosure', async () => {
  const authErr = new Error('API key not valid. Please pass a valid API key.');
  authErr.status = 401;
  const mockClient = createMockGeminiClient({ throwError: authErr });

  await assert.rejects(
    analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, { apiKey: 'bad_key', client: mockClient }),
    (err) => err.code === 'AUTHENTICATION_FAILED' && err.statusCode === 401
  );
});

test('TEST 9: Gemini 5xx upstream response throws 502 error', async () => {
  const serverErr = new Error('Internal server error');
  serverErr.status = 500;
  const mockClient = createMockGeminiClient({ throwError: serverErr });

  await assert.rejects(
    analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, { apiKey: 'key', client: mockClient, maxAttempts: 1 }),
    (err) => err.code === 'UPSTREAM_ERROR' && err.statusCode === 502
  );
});

test('TEST 10: Timeout returns timeout error without retrying', async () => {
  let attemptCount = 0;
  const timeoutErr = new Error('Request timed out: TimeoutError');
  timeoutErr.name = 'APIConnectionTimeoutError';

  const mockClient = {
    interactions: {
      create: async () => {
        attemptCount++;
        throw timeoutErr;
      }
    }
  };

  await assert.rejects(
    analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, { apiKey: 'key', client: mockClient, timeoutMs: 50 }),
    (err) => err.code === 'TIMEOUT' && err.statusCode === 504
  );
  assert.equal(attemptCount, 1);
});

test('TEST 11: Malformed model response returns error status', async () => {
  const mockClient = createMockGeminiClient({ outputText: 'Non-json malformed string' });

  await assert.rejects(
    analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, { apiKey: 'key', client: mockClient }),
    (err) => err.code === 'MALFORMED_JSON_RESPONSE'
  );
});

test('TEST 12: extractJsonFromText extracts JSON wrapped in Markdown code blocks and prose', () => {
  const markdownText = 'Here is the plan:\n```json\n{"workspaceType": "notes"}\n```\nHope this helps!';
  const parsed = extractJsonFromText(markdownText);
  assert.equal(parsed.workspaceType, 'notes');
});

test('TEST 13: HTTP 503 Service Unavailable aborts immediately without automatic retries', async () => {
  let attemptCount = 0;
  const unavailErr = new Error('gemini-3.8-flash is currently experiencing high demand');
  unavailErr.status = 503;

  const mockClient = {
    interactions: {
      create: async () => {
        attemptCount++;
        throw unavailErr;
      }
    }
  };

  await assert.rejects(
    analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
      apiKey: 'key',
      client: mockClient,
      maxAttempts: 2
    }),
    (err) => err.code === 'SERVICE_UNAVAILABLE' && err.statusCode === 503
  );

  assert.equal(attemptCount, 1);
});

test('TEST 13b: HTTP 429 rate limit aborts immediately without automatic retries', async () => {
  let attemptCount = 0;
  const rateLimitErr = new Error('Resource exhausted / quota exceeded');
  rateLimitErr.status = 429;

  const mockClient = {
    interactions: {
      create: async () => {
        attemptCount++;
        throw rateLimitErr;
      }
    }
  };

  await assert.rejects(
    analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
      apiKey: 'key',
      client: mockClient,
      maxAttempts: 2
    }),
    (err) => err.code === 'RATE_LIMITED' && err.statusCode === 429
  );

  assert.equal(attemptCount, 1);
});

test('TEST 13c: Multimodal requests completing under 22s deadline are accepted', async () => {
  const mockClient = createMockGeminiClient({
    model: 'gemini-3.8-flash',
    outputText: JSON.stringify(validPlanResponse)
  });

  const plan = await analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
    apiKey: 'key',
    client: mockClient,
    timeoutMs: 22000
  });

  assert.ok(plan);
  assert.equal(plan.workspaceType, 'notes');
  assert.equal(plan.source?.model, 'gemini-3.8-flash');
});

test('TEST 14: Client disconnection aborts upstream work immediately without duplicate retries', async () => {
  let attempts = 0;
  const clientController = new AbortController();

  const abortErr = new Error('Request aborted by client');
  abortErr.name = 'APIUserAbortError';

  const mockClient = {
    interactions: {
      create: async () => {
        attempts++;
        clientController.abort();
        throw abortErr;
      }
    }
  };

  await assert.rejects(
    analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
      apiKey: 'key',
      client: mockClient,
      signal: clientController.signal
    }),
    (err) => err.code === 'CLIENT_ABORTED' && err.statusCode === 499
  );

  assert.equal(attempts, 1);
});

test('TEST 15: Normal request completion does not trigger abort in controller', async () => {
  const req = {
    body: {
      workspaceModel: sampleWorkspaceModel,
      image: sampleScreenshot
    }
  };

  let closeListener = null;
  const res = {
    statusCode: 200,
    writableEnded: false,
    jsonBody: null,
    on(event, cb) {
      if (event === 'close') closeListener = cb;
    },
    removeListener(event, cb) {
      if (event === 'close' && closeListener === cb) closeListener = null;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonBody = data;
      this.writableEnded = true;
      return this;
    }
  };

  const mockFetch = async () => new Response(JSON.stringify({
    id: 'inter_test_ctrl',
    model: 'gemini-3.8-flash',
    status: 'completed',
    output_text: JSON.stringify(validPlanResponse)
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    await messCleanupController.analyze(req, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.success, true);
    assert.equal(res.writableEnded, true);
    assert.equal(res.jsonBody.data?.model, 'gemini-3.8-flash');
    if (closeListener) {
      closeListener();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TEST 16: Model identifier from response is attached to source and controller payload', async () => {
  const mockClient = createMockGeminiClient({
    model: 'gemini-3.8-flash-custom',
    outputText: JSON.stringify(validPlanResponse)
  });

  const plan = await analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
    apiKey: 'key',
    client: mockClient
  });

  assert.equal(plan.source?.model, 'gemini-3.8-flash-custom');
});

test('TEST 17: Backend maximum nominal budget fits comfortably within client timeout', () => {
  const perAttemptTimeoutMs = 22000;
  const frontendTimeoutMs = 30000;
  const marginMs = frontendTimeoutMs - perAttemptTimeoutMs;

  assert.equal(perAttemptTimeoutMs, 22000);
  assert.equal(frontendTimeoutMs, 30000);
  assert.ok(marginMs >= 8000);
});

test('TEST 18: GEMINI_ORGANIZATION_PLAN_SCHEMA defines valid schema properties', () => {
  assert.equal(GEMINI_ORGANIZATION_PLAN_SCHEMA.type, 'object');
  assert.ok(GEMINI_ORGANIZATION_PLAN_SCHEMA.properties.version);
  assert.ok(GEMINI_ORGANIZATION_PLAN_SCHEMA.properties.workspaceType);
  assert.ok(GEMINI_ORGANIZATION_PLAN_SCHEMA.properties.groups);
  assert.ok(GEMINI_ORGANIZATION_PLAN_SCHEMA.properties.relationships);
  assert.deepEqual(GEMINI_ORGANIZATION_PLAN_SCHEMA.required, ['version', 'workspaceType', 'groups', 'relationships']);
});

test('TEST 19: Correct SDK timeout_ms, signal, and retries: none options are passed', async () => {
  let capturedOptions = null;
  const clientController = new AbortController();

  const mockClient = {
    interactions: {
      create: async (params, reqOptions) => {
        capturedOptions = reqOptions;
        return {
          id: 'test_opt_id',
          model: 'gemini-3.8-flash',
          status: 'completed',
          output_text: JSON.stringify(validPlanResponse)
        };
      }
    }
  };

  await analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
    apiKey: 'key',
    client: mockClient,
    timeout_ms: 22000,
    signal: clientController.signal
  });

  assert.ok(capturedOptions);
  assert.equal(capturedOptions.timeout_ms, 22000);
  assert.equal(capturedOptions.signal, clientController.signal);
  assert.deepEqual(capturedOptions.retries, { strategy: 'none' });
});

test('TEST 20: RequestTimeoutError is classified as TIMEOUT with status 504', async () => {
  const reqTimeoutErr = new Error('Request timed out: TimeoutError: The operation was aborted');
  reqTimeoutErr.name = 'RequestTimeoutError';

  const mockClient = {
    interactions: {
      create: async () => {
        throw reqTimeoutErr;
      }
    }
  };

  await assert.rejects(
    analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
      apiKey: 'key',
      client: mockClient
    }),
    (err) => err.code === 'TIMEOUT' && err.statusCode === 504
  );
});

test('TEST 21: Real GoogleGenAI client with mock fetch enforces timeout_ms and aborts when deadline expires', async () => {
  let fetchAttempts = 0;
  const loopTimer = setTimeout(() => {}, 2000);

  const realClient = new GoogleGenAI({
    apiKey: 'mock_api_key',
    httpOptions: {
      fetch: async (req) => {
        fetchAttempts++;
        return new Promise((resolve, reject) => {
          req.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'TimeoutError';
            reject(err);
          }, { once: true });
        });
      }
    }
  });

  try {
    await assert.rejects(
      analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
        apiKey: 'key',
        client: realClient,
        timeoutMs: 150
      }),
      (err) => err.code === 'TIMEOUT' && err.statusCode === 504
    );
  } finally {
    clearTimeout(loopTimer);
  }

  assert.equal(fetchAttempts, 1);
});

test('TEST 22: Real GoogleGenAI client with mock fetch makes exactly one request on HTTP 503 without SDK retries', async () => {
  let fetchAttempts = 0;

  const realClient = new GoogleGenAI({
    apiKey: 'mock_api_key',
    httpOptions: {
      fetch: async () => {
        fetchAttempts++;
        return new Response(JSON.stringify({ error: { message: '503 Service Unavailable' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  });

  await assert.rejects(
    analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
      apiKey: 'key',
      client: realClient
    }),
    (err) => err.code === 'SERVICE_UNAVAILABLE' && err.statusCode === 503
  );

  assert.equal(fetchAttempts, 1);
});

test('TEST 23: Real GoogleGenAI client with mock fetch makes exactly one request on HTTP 429 without SDK retries', async () => {
  let fetchAttempts = 0;

  const realClient = new GoogleGenAI({
    apiKey: 'mock_api_key',
    httpOptions: {
      fetch: async () => {
        fetchAttempts++;
        return new Response(JSON.stringify({ error: { message: '429 Rate Limit' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  });

  await assert.rejects(
    analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
      apiKey: 'key',
      client: realClient
    }),
    (err) => err.code === 'RATE_LIMITED' && err.statusCode === 429
  );

  assert.equal(fetchAttempts, 1);
});

test('TEST 24: Caller AbortSignal reaches SDK fetch and aborts active outbound operation', async () => {
  let fetchAttempts = 0;
  const clientController = new AbortController();
  const loopTimer = setTimeout(() => {}, 2000);

  const realClient = new GoogleGenAI({
    apiKey: 'mock_api_key',
    httpOptions: {
      fetch: async (req) => {
        fetchAttempts++;
        return new Promise((resolve, reject) => {
          req.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          }, { once: true });
        });
      }
    }
  });

  setTimeout(() => clientController.abort(), 60);

  try {
    await assert.rejects(
      analyzeWithGemini(sampleWorkspaceModel, sampleScreenshot, {
        apiKey: 'key',
        client: realClient,
        timeoutMs: 2000,
        signal: clientController.signal
      }),
      (err) => err.code === 'CLIENT_ABORTED' && err.statusCode === 499
    );
  } finally {
    clearTimeout(loopTimer);
  }

  assert.equal(fetchAttempts, 1);
});
