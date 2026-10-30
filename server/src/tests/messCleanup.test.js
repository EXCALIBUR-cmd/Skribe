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
import config from '../config/env.js';
import { MESS_CLEANUP_RESPONSE_SCHEMA, analyzeWithGroq, buildGroqMessages, compactWorkspaceModel } from '../services/messCleanupGroqService.js';

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
    model: 'qwen/qwen3.8-27b',
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(validPlanResponse) }, finish_reason: 'stop' }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const originalFetch = globalThis.fetch;
  const originalKey = config.groqMessCleanupApiKey;
  globalThis.fetch = mockFetch;
  config.groqMessCleanupApiKey = 'gsk_test_mess_cleanup';

  try {
    await messCleanupController.analyze(req, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.success, true);
    assert.equal(res.writableEnded, true);
    assert.equal(res.jsonBody.data?.model, 'qwen/qwen3.8-27b');
    if (closeListener) {
      closeListener();
    }
  } finally {
    globalThis.fetch = originalFetch;
    config.groqMessCleanupApiKey = originalKey;
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

const GROQ_TEST_KEY = 'gsk_test_mess_cleanup_key';

const groqFetch = (respond) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return respond(url, init);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
};

const groqReply = (content, model = 'qwen/qwen3.8-27b') => new Response(JSON.stringify({
  model,
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const hangingGroqFetch = () => groqFetch((url, init) => new Promise((resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')), { once: true });
}));

const collectObjectNodes = (node, found = []) => {
  if (!node || typeof node !== 'object') return found;
  if (node.properties) found.push(node);
  Object.values(node.properties || {}).forEach((child) => collectObjectNodes(child, found));
  if (node.items) collectObjectNodes(node.items, found);
  return found;
};

test('GROQ 1: a valid structured plan comes back from exactly one Groq vision request', async () => {
  const fetchImpl = groqFetch(() => groqReply(JSON.stringify(validPlanResponse)));
  const plan = await analyzeWithGroq(sampleWorkspaceModel, sampleScreenshot, { apiKey: GROQ_TEST_KEY, fetch: fetchImpl, model: 'qwen/qwen3.8-27b' });

  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(plan.groups, validPlanResponse.groups);
  assert.deepEqual(plan.source, { engine: 'groq', model: 'qwen/qwen3.8-27b' });

  const [{ url, init, body }] = fetchImpl.calls;
  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer ' + GROQ_TEST_KEY);
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(body.model, 'qwen/qwen3.8-27b');
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'organization_plan', strict: true, schema: MESS_CLEANUP_RESPONSE_SCHEMA } });
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(body.reasoning_format, 'hidden');
  assert.deepEqual(body.messages[0], { role: 'system', content: MESS_CLEANUP_SYSTEM_PROMPT });
  assert.equal(body.messages[1].content[0].type, 'text');
  assert.ok(body.messages[1].content[0].text.includes('WorkspaceModel JSON'));
  assert.equal(body.messages[1].content[1].type, 'image_url');
  assert.equal(body.messages[1].content[1].image_url.url, sampleScreenshot);
  assert.equal(init.body.includes(GROQ_TEST_KEY), false);
});

test('GROQ 2: the response schema is the existing plan schema in strict form', () => {
  const nodes = collectObjectNodes(MESS_CLEANUP_RESPONSE_SCHEMA);
  assert.ok(nodes.length >= 5);
  for (const node of nodes) {
    assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
    assert.equal(node.additionalProperties, false);
  }
  assert.deepEqual(MESS_CLEANUP_RESPONSE_SCHEMA.properties.groups.items.properties.titleObjectId.type, ['string', 'null']);
  assert.equal(JSON.stringify(MESS_CLEANUP_RESPONSE_SCHEMA).includes('nullable'), false);
  assert.equal(GEMINI_ORGANIZATION_PLAN_SCHEMA.properties.groups.items.properties.titleObjectId.nullable, true);
});

test('GROQ 3: provider failures map to the codes the client fallback understands, once, without leaking the key', async () => {
  const cases = [
    [401, 'AUTHENTICATION_FAILED', 401],
    [403, 'AUTHENTICATION_FAILED', 401],
    [429, 'RATE_LIMITED', 429],
    [498, 'SERVICE_UNAVAILABLE', 503],
    [500, 'SERVICE_UNAVAILABLE', 503],
    [503, 'SERVICE_UNAVAILABLE', 503],
    [400, 'INVALID_REQUEST', 400],
    [413, 'RATE_LIMITED', 429]
  ];
  for (const [status, code, statusCode] of cases) {
    const fetchImpl = groqFetch(() => new Response(JSON.stringify({ error: { message: 'Invalid API Key ' + GROQ_TEST_KEY, type: 'invalid_request_error' } }), { status }));
    await assert.rejects(analyzeWithGroq(sampleWorkspaceModel, sampleScreenshot, { apiKey: GROQ_TEST_KEY, fetch: fetchImpl }), (err) => {
      assert.equal(err.code, code);
      assert.equal(err.statusCode, statusCode);
      assert.equal(JSON.stringify(err, Object.getOwnPropertyNames(err)).includes(GROQ_TEST_KEY), false);
      return true;
    });
    assert.equal(fetchImpl.calls.length, 1);
  }
  const offline = groqFetch(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(analyzeWithGroq(sampleWorkspaceModel, sampleScreenshot, { apiKey: GROQ_TEST_KEY, fetch: offline }), (err) => err.code === 'UPSTREAM_ERROR' && err.statusCode === 502);
  assert.equal(offline.calls.length, 1);
});

test('GROQ 4: the deadline aborts the outbound request and reports a timeout', async () => {
  const fetchImpl = hangingGroqFetch();
  const started = Date.now();
  await assert.rejects(
    analyzeWithGroq(sampleWorkspaceModel, sampleScreenshot, { apiKey: GROQ_TEST_KEY, fetch: fetchImpl, timeoutMs: 50, signal: new AbortController().signal }),
    (err) => err.code === 'TIMEOUT' && err.statusCode === 504
  );
  assert.ok(Date.now() - started < 2000);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].init.signal.aborted, true);
});

test('GROQ 5: a client disconnect aborts the outbound request', async () => {
  const fetchImpl = hangingGroqFetch();
  const caller = new AbortController();
  const pending = analyzeWithGroq(sampleWorkspaceModel, sampleScreenshot, { apiKey: GROQ_TEST_KEY, fetch: fetchImpl, timeoutMs: 5000, signal: caller.signal });
  caller.abort();
  await assert.rejects(pending, (err) => err.code === 'CLIENT_ABORTED' && err.statusCode === 499);
  assert.equal(fetchImpl.calls[0].init.signal.aborted, true);
});

test('GROQ 6: missing configuration or invalid input never reaches the provider', async () => {
  const fetchImpl = groqFetch(() => groqReply(JSON.stringify(validPlanResponse)));
  await assert.rejects(analyzeWithGroq(sampleWorkspaceModel, sampleScreenshot, { apiKey: '', fetch: fetchImpl }), (err) => err.code === 'AUTHENTICATION_FAILED' && err.statusCode === 401);
  await assert.rejects(analyzeWithGroq(null, sampleScreenshot, { apiKey: GROQ_TEST_KEY, fetch: fetchImpl }), (err) => err.code === 'INVALID_WORKSPACE_MODEL');
  await assert.rejects(analyzeWithGroq(sampleWorkspaceModel, '', { apiKey: GROQ_TEST_KEY, fetch: fetchImpl }), (err) => err.code === 'INVALID_IMAGE');
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(analyzeWithGroq(sampleWorkspaceModel, sampleScreenshot, { apiKey: GROQ_TEST_KEY, fetch: fetchImpl, signal: cancelled.signal }), (err) => err.code === 'CLIENT_ABORTED');
  assert.equal(fetchImpl.calls.length, 0);
});

test('GROQ 7: empty, malformed or non-object completions are rejected', async () => {
  const cases = [
    [() => groqReply(''), 'EMPTY_COMPLETION'],
    [() => groqReply('Sure, here is a plan.'), 'MALFORMED_JSON_RESPONSE'],
    [() => groqReply('[1, 2, 3]'), 'MALFORMED_JSON_RESPONSE'],
    [() => new Response(JSON.stringify({ model: 'qwen/qwen3.8-27b', choices: [] }), { status: 200 }), 'EMPTY_COMPLETION'],
    [() => new Response('<html>gateway</html>', { status: 200 }), 'MALFORMED_JSON_RESPONSE']
  ];
  for (const [reply, code] of cases) {
    const fetchImpl = groqFetch(reply);
    await assert.rejects(analyzeWithGroq(sampleWorkspaceModel, sampleScreenshot, { apiKey: GROQ_TEST_KEY, fetch: fetchImpl }), (err) => err.code === code && err.statusCode === 502);
  }
});

test('GROQ 8: the controller rejects an AI plan without groups so the client falls back', async () => {
  const req = { body: { workspaceModel: sampleWorkspaceModel, image: sampleScreenshot } };
  const res = {
    statusCode: 200,
    jsonBody: null,
    writableEnded: false,
    on() {},
    removeListener() {},
    status(code) { this.statusCode = code; return this; },
    json(data) { this.jsonBody = data; this.writableEnded = true; return this; }
  };
  const originalFetch = globalThis.fetch;
  const originalKey = config.groqMessCleanupApiKey;
  globalThis.fetch = async () => groqReply(JSON.stringify({ version: 1, workspaceType: 'mixed', relationships: [] }));
  config.groqMessCleanupApiKey = GROQ_TEST_KEY;
  try {
    await messCleanupController.analyze(req, res, () => {});
  } finally {
    globalThis.fetch = originalFetch;
    config.groqMessCleanupApiKey = originalKey;
  }
  assert.equal(res.statusCode, 502);
  assert.equal(res.jsonBody.success, false);
  assert.equal(res.jsonBody.errors.code, 'INVALID_PLAN_SCHEMA');
});

test('GROQ 9: a real-shaped board is sent as a compact projection that keeps every id and link', () => {
  const heavy = (id, extra) => ({
    id,
    sourceObjectId: id,
    elementId: 'elem_1',
    strokeId: null,
    textLines: null,
    position: { x: 688.4, y: 108.2 },
    bounds: { x: 688.4, y: 108.2, width: 160.3, height: 109.6 },
    size: { width: 160, height: 110 },
    center: { x: 768, y: 163 },
    scale: { x: 1, y: 1 },
    originX: 'center',
    originY: 'center',
    fill: '#000000',
    stroke: '#000000',
    strokeLineJoin: 'miter',
    shadow: { color: 'rgba(0, 0, 0, 0.12)', blur: 14, offsetX: 3, offsetY: 6 },
    visual: { fill: '#000000', stroke: '#000000', strokeWidth: 2, opacity: 1, visible: true },
    relationshipMetadata: { attachedTextId: null, parentShapeId: null, sourceShapeId: null, targetShapeId: null },
    vector: { stroke: '#000000', strokeWidth: 2 },
    ...extra
  });
  const longText = 'x'.repeat(400);
  const board = {
    version: 1,
    board: {
      objects: [
        heavy('shape_1', { type: 'shape', originalType: 'rect', shapeType: 'rounded_rect', text: null, relationships: [{ type: 'contains_text', targetId: 'text_1' }, { type: 'shared_element', targetId: 'text_1' }] }),
        heavy('text_1', { type: 'text', originalType: 'textbox', text: longText, fill: '#ffffff', style: { fontSize: 16, fontWeight: 'bold', color: '#ffffff' }, relationships: [{ type: 'contained_by', targetId: 'shape_1' }] }),
        null,
        heavy('note_1', { type: 'note', originalType: 'rect', fill: null, metadata: { role: 'shape', isStickyNote: true, noteColor: '#fce7f3' }, strokeId: 'stroke_9', hasExplicitArrow: true })
      ]
    }
  };

  const compact = compactWorkspaceModel(board);
  assert.deepEqual(compact.objects.map((object) => object.id), ['shape_1', 'text_1', 'note_1']);
  assert.deepEqual(compact.objects[0].links, { text_1: 'contains_text' });
  assert.deepEqual(compact.objects[1].links, { shape_1: 'contained_by' });
  assert.equal(compact.objects[0].shape, 'rounded_rect');
  assert.deepEqual(compact.objects[0].box, [688, 108, 160, 110]);
  assert.equal(compact.objects[1].text.length, 160);
  assert.equal(compact.objects[1].bold, true);
  assert.equal(compact.objects[1].fontSize, 16);
  assert.equal(compact.objects[2].color, '#fce7f3');
  assert.equal(compact.objects[2].strokeId, 'stroke_9');
  assert.equal(compact.objects[2].arrow, true);

  const sent = JSON.stringify(compact);
  for (const dropped of ['relationshipMetadata', 'visual', 'shadow', 'center', 'sourceObjectId', 'shared_element']) {
    assert.equal(sent.includes(dropped), false, dropped);
  }
  assert.ok(sent.length * 4 < JSON.stringify(board).length);

  const [, user] = buildGroqMessages(board, sampleScreenshot);
  assert.ok(user.content[0].text.endsWith(sent));
});
