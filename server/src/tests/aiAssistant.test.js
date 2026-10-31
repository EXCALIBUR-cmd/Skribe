import assert from 'node:assert/strict';
import test from 'node:test';
import config from '../config/env.js';
import { generateAssistantResult, validateDiagram, sanitizeBoard } from '../services/aiAssistantService.js';
import { analyzeWithGroq } from '../services/messCleanupGroqService.js';
import { createGenerateHandler } from '../controllers/aiAssistantController.js';

const mockFetch = (reply) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return reply();
  };
  fetchImpl.calls = calls;
  return fetchImpl;
};

const groqReply = (content) => new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content } }] }), { status: 200 });

const diagram = (overrides = {}) => JSON.stringify({
  title: 'Login flow',
  description: 'How a user signs in.',
  diagramType: 'flowchart',
  source: 'flowchart TD\n  A[Open app] --> B{Signed in?}\n  B -->|No| C[Sign in]\n  B -->|Yes| D[Boards]',
  ...overrides
});

const withConfig = async (values, run) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, config[key]]));
  Object.assign(config, values);
  try {
    return await run();
  } finally {
    Object.assign(config, previous);
  }
};

test('requests use the dedicated AI Assistant key, never the Mess Cleanup key', async () => {
  await withConfig({ groqAiAssistantApiKey: 'assistant-key', groqMessCleanupApiKey: 'cleanup-key' }, async () => {
    const fetchImpl = mockFetch(() => groqReply(diagram()));
    await generateAssistantResult('diagram', { prompt: 'login flow' }, { fetch: fetchImpl });
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer assistant-key');
    assert.equal(fetchImpl.calls[0].body.response_format.json_schema.strict, true);
  });
});

test('a missing AI Assistant key is a configuration error with no fallback and no request', async () => {
  await withConfig({ groqAiAssistantApiKey: '', groqMessCleanupApiKey: 'cleanup-key', groqApiKey: 'voice-key' }, async () => {
    const fetchImpl = mockFetch(() => groqReply(diagram()));
    await assert.rejects(generateAssistantResult('brainstorm', { prompt: 'ideas' }, { fetch: fetchImpl }), (err) => {
      assert.equal(err.code, 'AI_ASSISTANT_NOT_CONFIGURED');
      assert.equal(err.statusCode, 503);
      assert.doesNotMatch(err.message, /cleanup-key|voice-key/);
      return true;
    });
    assert.equal(fetchImpl.calls.length, 0);
  });
});

test('Mess Cleanup keeps using its own key when the AI Assistant key is set', async () => {
  await withConfig({ groqAiAssistantApiKey: 'assistant-key', groqMessCleanupApiKey: 'cleanup-key' }, async () => {
    const fetchImpl = mockFetch(() => groqReply(JSON.stringify({ actions: [] })));
    await analyzeWithGroq({ objects: [] }, 'data:image/png;base64,AAAA', { fetch: fetchImpl });
    assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer cleanup-key');
  });
});

test('valid Mermaid output is returned with its contract fields and code fences removed', async () => {
  const fetchImpl = mockFetch(() => groqReply(diagram({ source: '```mermaid\nsequenceDiagram\n  A->>B: Hi\n```', diagramType: 'sequence' })));
  const { result } = await generateAssistantResult('diagram', { prompt: 'greeting' }, { apiKey: 'k', fetch: fetchImpl });
  assert.deepEqual(Object.keys(result).sort(), ['description', 'diagramType', 'source', 'title']);
  assert.equal(result.source, 'sequenceDiagram\n  A->>B: Hi');
});

test('empty, mismatched, unsupported and unsafe diagrams are rejected', () => {
  const cases = [
    [{ diagramType: 'flowchart', source: '   ' }, 'EMPTY_DIAGRAM'],
    [{ diagramType: 'flowchart', source: 'sequenceDiagram\n A->>B: x' }, 'MALFORMED_DIAGRAM'],
    [{ diagramType: 'pie', source: 'pie\n "a": 1' }, 'UNSUPPORTED_DIAGRAM'],
    [{ diagramType: 'flowchart', source: 'flowchart TD\n A["<script>alert(1)</script>"]' }, 'UNSAFE_DIAGRAM'],
    [{ diagramType: 'flowchart', source: '%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\n A-->B' }, 'UNSAFE_DIAGRAM'],
    [{ diagramType: 'flowchart', source: 'flowchart TD\n A-->B\n click A "https://example.com"' }, 'UNSAFE_DIAGRAM']
  ];
  for (const [raw, code] of cases) {
    assert.throws(() => validateDiagram({ title: 't', description: 'd', ...raw }), (err) => err.code === code, code);
  }
  assert.equal(validateDiagram({ title: 't', description: 'd', diagramType: 'flowchart', source: 'flowchart LR\n A[Click Submit] --> B' }).diagramType, 'flowchart');
});

test('malformed and empty provider responses are reported, not returned', async () => {
  const replies = [
    [() => groqReply('not json'), 'MALFORMED_RESPONSE'],
    [() => groqReply(''), 'EMPTY_RESPONSE'],
    [() => groqReply(JSON.stringify({ title: 'x', points: [' ', ''] })), 'EMPTY_RESPONSE'],
    [() => new Response('{', { status: 200 }), 'MALFORMED_RESPONSE'],
    [() => new Response('', { status: 503 }), 'SERVICE_UNAVAILABLE']
  ];
  for (const [reply, code] of replies) {
    await assert.rejects(generateAssistantResult('summarize', { board: [{ kind: 'sticky', text: 'a' }] }, { apiKey: 'k', fetch: mockFetch(reply) }), (err) => err.code === code, code);
  }
});

test('text actions return display points and the board context is sanitized', async () => {
  const fetchImpl = mockFetch(() => groqReply(JSON.stringify({ title: 'Ideas', points: ['One', 'Two'] })));
  const output = await generateAssistantResult('brainstorm', { prompt: 'onboarding', board: [{ kind: 'sticky', text: 'x'.repeat(500), extra: 'drop' }, null, { kind: 'shape' }] }, { apiKey: 'k', fetch: fetchImpl });
  assert.deepEqual(output.result, { title: 'Ideas', points: ['One', 'Two'] });
  const user = JSON.parse(fetchImpl.calls[0].body.messages[1].content);
  assert.equal(user.board.length, 1);
  assert.equal(user.board[0].text.length, 160);
  assert.equal(user.board[0].extra, undefined);
  assert.deepEqual(sanitizeBoard('nope'), []);
});

const runHandler = async (body, generator) => {
  const res = {
    statusCode: 0,
    payload: null,
    writableEnded: false,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.payload = data; this.writableEnded = true; return this; }
  };
  await createGenerateHandler(generator)({ body, user: { id: 'u1' } }, res, (err) => { throw err; });
  return res;
};

test('the route validates actions and prompts before calling the provider', async () => {
  let calls = 0;
  const generator = async () => { calls += 1; return { action: 'diagram', result: {}, model: 'm' }; };
  assert.equal((await runHandler({ action: 'delete_board', prompt: 'x' }, generator)).statusCode, 400);
  assert.equal((await runHandler({ action: 'diagram', prompt: '  ' }, generator)).statusCode, 400);
  assert.equal((await runHandler({ action: 'summarize', board: [] }, generator)).statusCode, 400);
  assert.equal((await runHandler({ action: 'diagram', prompt: 'x'.repeat(1001) }, generator)).statusCode, 400);
  assert.equal(calls, 0);
  const ok = await runHandler({ action: 'diagram', prompt: 'login' }, generator);
  assert.equal(ok.statusCode, 200);
  assert.equal(calls, 1);
});

test('provider errors reach the client without the key', async () => {
  await withConfig({ groqAiAssistantApiKey: 'secret-assistant-key' }, async () => {
    const res = await runHandler({ action: 'diagram', prompt: 'login' }, (action, input, options) => generateAssistantResult(action, input, { ...options, fetch: mockFetch(() => new Response('', { status: 401 })) }));
    assert.equal(res.statusCode, 401);
    assert.doesNotMatch(JSON.stringify(res.payload), /secret-assistant-key/);
  });
});
