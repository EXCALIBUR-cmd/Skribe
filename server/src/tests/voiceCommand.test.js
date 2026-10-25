import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VOICE_COMMAND_RESPONSE_SCHEMA,
  classifyVoiceProviderStatus,
  interpretVoiceCommand,
  validateVoiceCommandIntent
} from '../services/voiceCommandService.js';
import { createInterpretHandler } from '../controllers/voiceCommandController.js';

const mockRes = () => {
  const listeners = {};
  return {
    statusCode: 200,
    jsonBody: null,
    writableEnded: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonBody = data;
      this.writableEnded = true;
      return this;
    },
    on(event, handler) {
      listeners[event] = handler;
    },
    removeListener(event) {
      delete listeners[event];
    },
    emit(event) {
      if (listeners[event]) listeners[event]();
    }
  };
};

const intent = (fields) => ({
  outcome: 'command',
  action: null,
  text: null,
  shapeType: null,
  label: null,
  clarification: null,
  reason: null,
  ...fields
});

test('valid text and sticky-note intents validate to executable commands', () => {
  assert.deepEqual(
    validateVoiceCommandIntent(intent({ action: 'create_text', text: '  Quarterly   goals ' })),
    { status: 'execute', command: { action: 'create_text', text: 'Quarterly goals' } }
  );
  assert.deepEqual(
    validateVoiceCommandIntent(intent({ action: 'create_sticky_note', text: 'Buy milk' })),
    { status: 'execute', command: { action: 'create_sticky_note', text: 'Buy milk' } }
  );
});

test('valid basic-shape intents validate with and without a label', () => {
  assert.deepEqual(
    validateVoiceCommandIntent(intent({ action: 'create_shape', shapeType: 'circle', label: 'Start' })),
    { status: 'execute', command: { action: 'create_shape', shapeType: 'circle', label: 'Start' } }
  );
  assert.deepEqual(
    validateVoiceCommandIntent(intent({ action: 'create_shape', shapeType: 'diamond' })),
    { status: 'execute', command: { action: 'create_shape', shapeType: 'diamond' } }
  );
});

test('unknown, destructive and unsupported actions are rejected', () => {
  assert.equal(validateVoiceCommandIntent(intent({ action: 'delete_object' })).code, 'UNKNOWN_ACTION');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'move_object', text: 'x' })).code, 'UNKNOWN_ACTION');
  assert.equal(validateVoiceCommandIntent(intent({ action: null })).code, 'MISSING_ACTION');
  const unsupported = validateVoiceCommandIntent(intent({ outcome: 'unsupported', reason: 'Deleting objects is not supported.' }));
  assert.equal(unsupported.status, 'rejected');
  assert.equal(unsupported.code, 'UNSUPPORTED_COMMAND');
  assert.equal(unsupported.message, 'Deleting objects is not supported.');
});

test('malformed model output is rejected', () => {
  for (const value of [null, 'create_text', 42, [], { action: 'create_text', text: 'hi' }]) {
    assert.equal(validateVoiceCommandIntent(value).status, 'rejected');
  }
  assert.equal(validateVoiceCommandIntent({ outcome: 'execute_now' }).code, 'MALFORMED_INTENT');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_text', text: 'hi', script: 'alert(1)' })).code, 'MALFORMED_INTENT');
});

test('missing text, invalid shapes, coordinates and object identifiers are rejected', () => {
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_text', text: '   ' })).code, 'MISSING_TEXT');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_sticky_note' })).code, 'MISSING_TEXT');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_text', text: 'a'.repeat(501) })).code, 'TEXT_TOO_LONG');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_shape', shapeType: 'star' })).code, 'INVALID_SHAPE');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_shape' })).code, 'INVALID_SHAPE');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_shape', shapeType: 'circle', label: 7 })).code, 'INVALID_LABEL');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_shape', shapeType: 'circle', label: 'a'.repeat(81) })).code, 'LABEL_TOO_LONG');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_text', text: 'hi', x: 10, y: 20 })).code, 'INVALID_COORDINATES');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_text', text: 'hi', position: { x: 1 } })).code, 'INVALID_COORDINATES');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_shape', shapeType: 'circle', objectId: 'shape_1' })).code, 'UNEXPECTED_OBJECT_ID');
  assert.equal(validateVoiceCommandIntent(intent({ action: 'create_text', text: 'hi', targetId: 'text_1' })).code, 'UNEXPECTED_OBJECT_ID');
});

test('ambiguous requests return a clarification and only a valid proposal', () => {
  const withProposal = validateVoiceCommandIntent(intent({
    outcome: 'clarify',
    action: 'create_sticky_note',
    text: 'Ideas',
    clarification: 'Did you mean a sticky note titled Ideas?'
  }));
  assert.deepEqual(withProposal, {
    status: 'clarify',
    message: 'Did you mean a sticky note titled Ideas?',
    proposal: { action: 'create_sticky_note', text: 'Ideas' }
  });

  const invalidProposal = validateVoiceCommandIntent(intent({ outcome: 'clarify', action: 'create_shape', shapeType: 'star', clarification: 'Which shape?' }));
  assert.equal(invalidProposal.status, 'clarify');
  assert.equal(invalidProposal.proposal, null);

  const noQuestion = validateVoiceCommandIntent(intent({ outcome: 'clarify' }));
  assert.equal(noQuestion.status, 'clarify');
  assert.ok(noQuestion.message.length > 0);
  assert.equal(noQuestion.proposal, null);
});

const TEST_KEY = 'gsk_test_secret_value';

const mockFetch = (respond) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return respond(url, init);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
};

const groqReply = (content) => new Response(JSON.stringify({
  model: 'openai/gpt-oss-20b',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const hangingFetch = () => mockFetch((url, init) => new Promise((resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')), { once: true });
}));

test('valid text, sticky-note and labeled-shape intents each come from exactly one Groq request', async () => {
  const cases = [
    ['write quarterly goals', { action: 'create_text', text: 'quarterly goals' }],
    ['add a sticky note that says buy milk', { action: 'create_sticky_note', text: 'buy milk' }],
    ['add a circle labeled start', { action: 'create_shape', shapeType: 'circle', label: 'start' }]
  ];
  for (const [instruction, command] of cases) {
    const fetchImpl = mockFetch(() => groqReply(JSON.stringify(intent(command))));
    const output = await interpretVoiceCommand(instruction, { apiKey: TEST_KEY, fetch: fetchImpl });
    assert.deepEqual(output.result, { status: 'execute', command });
    assert.equal(output.model, 'openai/gpt-oss-20b');
    assert.equal(fetchImpl.calls.length, 1);
  }
});

test('the request uses the documented Groq endpoint, strict schema and only the transcript as user content', async () => {
  const fetchImpl = mockFetch(() => groqReply(JSON.stringify(intent({ action: 'create_text', text: 'hi' }))));
  await interpretVoiceCommand('write hi', { apiKey: TEST_KEY, fetch: fetchImpl, model: 'openai/gpt-oss-20b' });
  const [{ url, init, body }] = fetchImpl.calls;

  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${TEST_KEY}`);
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(body.model, 'openai/gpt-oss-20b');
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system');
  assert.deepEqual(body.messages[1], { role: 'user', content: JSON.stringify('write hi') });
  assert.deepEqual(body.response_format, {
    type: 'json_schema',
    json_schema: { name: 'voice_command_intent', strict: true, schema: VOICE_COMMAND_RESPONSE_SCHEMA }
  });
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.include_reasoning, false);
  assert.equal(init.body.includes(TEST_KEY), false);
});

test('the response schema meets strict-mode rules', () => {
  assert.deepEqual([...VOICE_COMMAND_RESPONSE_SCHEMA.required].sort(), Object.keys(VOICE_COMMAND_RESPONSE_SCHEMA.properties).sort());
  assert.equal(VOICE_COMMAND_RESPONSE_SCHEMA.additionalProperties, false);
});

test('ambiguous, unsupported and injected model answers never become executable commands', async () => {
  const answers = [
    [intent({ outcome: 'clarify', action: 'create_sticky_note', text: 'Ideas', clarification: 'Did you mean a sticky note titled Ideas?' }), 'clarify', null],
    [intent({ outcome: 'unsupported', reason: 'Deleting objects is not supported.' }), 'rejected', 'UNSUPPORTED_COMMAND'],
    [intent({ action: 'delete_object' }), 'rejected', 'UNKNOWN_ACTION'],
    [intent({ action: 'create_shape', shapeType: 'circle', objectId: 'shape_1' }), 'rejected', 'UNEXPECTED_OBJECT_ID'],
    [intent({ action: 'create_text', text: 'hi', x: 10, y: 10 }), 'rejected', 'INVALID_COORDINATES']
  ];
  for (const [answer, status, code] of answers) {
    const fetchImpl = mockFetch(() => groqReply(JSON.stringify(answer)));
    const { result } = await interpretVoiceCommand('do something', { apiKey: TEST_KEY, fetch: fetchImpl });
    assert.equal(result.status, status);
    if (code) assert.equal(result.code, code);
    assert.equal(fetchImpl.calls.length, 1);
  }
});

test('malformed provider bodies are reported as invalid responses', async () => {
  const replies = [
    () => groqReply('Sure! Here is a circle.'),
    () => groqReply(''),
    () => groqReply('{"outcome":'),
    () => new Response(JSON.stringify({ model: 'openai/gpt-oss-20b', choices: [] }), { status: 200 }),
    () => new Response('<html>gateway</html>', { status: 200 })
  ];
  for (const reply of replies) {
    const fetchImpl = mockFetch(reply);
    await assert.rejects(
      interpretVoiceCommand('add a circle', { apiKey: TEST_KEY, fetch: fetchImpl }),
      (err) => err.code === 'AI_INVALID_RESPONSE' && err.statusCode === 502
    );
    assert.equal(fetchImpl.calls.length, 1);
  }
});

test('authentication, rate-limit and server failures map to typed errors after one request without leaking the key', async () => {
  const cases = [
    [401, 'AI_UNAVAILABLE', 503],
    [403, 'AI_UNAVAILABLE', 503],
    [429, 'AI_RATE_LIMITED', 429],
    [498, 'AI_UNAVAILABLE', 503],
    [500, 'AI_UNAVAILABLE', 503],
    [502, 'AI_UNAVAILABLE', 503],
    [503, 'AI_UNAVAILABLE', 503],
    [400, 'AI_FAILED', 502],
    [422, 'AI_FAILED', 502]
  ];
  for (const [status, code, statusCode] of cases) {
    const fetchImpl = mockFetch(() => new Response(JSON.stringify({ error: { message: `Invalid API Key ${TEST_KEY}`, type: 'invalid_request_error' } }), { status }));
    await assert.rejects(interpretVoiceCommand('add a circle', { apiKey: TEST_KEY, fetch: fetchImpl }), (err) => {
      assert.equal(err.code, code);
      assert.equal(err.statusCode, statusCode);
      assert.ok(err.message.includes('No changes were made'));
      assert.equal(JSON.stringify(err, Object.getOwnPropertyNames(err)).includes(TEST_KEY), false);
      return true;
    });
    assert.equal(fetchImpl.calls.length, 1);
  }
  assert.equal(classifyVoiceProviderStatus(504).code, 'AI_UNAVAILABLE');
});

test('a network failure is reported once as unreachable', async () => {
  const fetchImpl = mockFetch(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(
    interpretVoiceCommand('add a circle', { apiKey: TEST_KEY, fetch: fetchImpl }),
    (err) => err.code === 'AI_FAILED' && err.statusCode === 502
  );
  assert.equal(fetchImpl.calls.length, 1);
});

test('the deadline aborts the actual outbound request', async () => {
  const fetchImpl = hangingFetch();
  const started = Date.now();
  await assert.rejects(
    interpretVoiceCommand('add a circle', { apiKey: TEST_KEY, fetch: fetchImpl, timeoutMs: 50, signal: new AbortController().signal }),
    (err) => err.code === 'AI_TIMEOUT' && err.statusCode === 504
  );
  assert.ok(Date.now() - started < 2000);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].init.signal.aborted, true);
});

test('caller cancellation reaches the outbound request', async () => {
  const fetchImpl = hangingFetch();
  const caller = new AbortController();
  const pending = interpretVoiceCommand('add a circle', { apiKey: TEST_KEY, fetch: fetchImpl, timeoutMs: 5000, signal: caller.signal });
  caller.abort();
  await assert.rejects(pending, (err) => err.code === 'CLIENT_ABORTED' && err.statusCode === 499);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].init.signal.aborted, true);
});

test('missing configuration, invalid transcripts and pre-cancelled calls never reach the provider', async () => {
  const fetchImpl = mockFetch(() => groqReply('{}'));
  await assert.rejects(interpretVoiceCommand('add a circle', { apiKey: '', fetch: fetchImpl }), (err) => err.code === 'AI_NOT_CONFIGURED' && err.statusCode === 503);
  await assert.rejects(interpretVoiceCommand('   ', { apiKey: TEST_KEY, fetch: fetchImpl }), (err) => err.code === 'INVALID_TRANSCRIPT');
  await assert.rejects(interpretVoiceCommand('a'.repeat(501), { apiKey: TEST_KEY, fetch: fetchImpl }), (err) => err.code === 'INVALID_TRANSCRIPT');
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(interpretVoiceCommand('add a circle', { apiKey: TEST_KEY, fetch: fetchImpl, signal: cancelled.signal }), (err) => err.code === 'CLIENT_ABORTED');
  assert.equal(fetchImpl.calls.length, 0);
});

test('controller rejects missing or oversized transcripts without calling the interpreter', async () => {
  let calls = 0;
  const handler = createInterpretHandler(async () => {
    calls += 1;
    return { result: { status: 'execute', command: { action: 'create_text', text: 'x' } } };
  });

  for (const body of [{}, { transcript: '' }, { transcript: 42 }, { transcript: 'a'.repeat(501) }]) {
    const res = mockRes();
    await handler({ body }, res, () => {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.errors.code, 'INVALID_TRANSCRIPT');
  }
  assert.equal(calls, 0);
});

test('controller returns the validated result and maps provider failures to their status', async () => {
  const ok = createInterpretHandler(async () => ({
    result: { status: 'execute', command: { action: 'create_shape', shapeType: 'circle', label: 'Start' } },
    model: 'gemini-test-model'
  }));
  const okRes = mockRes();
  await ok({ body: { transcript: 'add a circle labeled start' } }, okRes, () => {});
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.jsonBody.success, true);
  assert.deepEqual(okRes.jsonBody.data.result.command, { action: 'create_shape', shapeType: 'circle', label: 'Start' });

  const failing = createInterpretHandler(async () => {
    throw Object.assign(new Error('The AI provider is temporarily unavailable. No changes were made.'), { code: 'AI_UNAVAILABLE', statusCode: 503 });
  });
  const failRes = mockRes();
  await failing({ body: { transcript: 'add a circle' } }, failRes, () => {});
  assert.equal(failRes.statusCode, 503);
  assert.equal(failRes.jsonBody.success, false);
  assert.equal(failRes.jsonBody.errors.code, 'AI_UNAVAILABLE');
});

test('controller writes nothing after the client disconnects', async () => {
  let release;
  const handler = createInterpretHandler((transcript, { signal }) => new Promise((resolve, reject) => {
    release = () => (signal.aborted ? reject(Object.assign(new Error('cancelled'), { code: 'CLIENT_ABORTED', statusCode: 499 })) : resolve({ result: { status: 'execute' } }));
  }));
  const res = mockRes();
  const pending = handler({ body: { transcript: 'add a circle' } }, res, () => {});
  res.emit('close');
  release();
  await pending;
  assert.equal(res.jsonBody, null);
});

test('controller limits each user to 20 provider calls per minute and blocks before the provider', async () => {
  let calls = 0;
  const handler = createInterpretHandler(async () => {
    calls += 1;
    return { result: { status: 'rejected', code: 'UNSUPPORTED_COMMAND', message: 'Not supported.' } };
  });

  const statuses = [];
  let lastBody = null;
  for (let i = 0; i < 21; i += 1) {
    const res = mockRes();
    await handler({ body: { transcript: 'add a circle' }, user: { id: 'user-a' } }, res, () => {});
    statuses.push(res.statusCode);
    lastBody = res.jsonBody;
  }
  const otherUser = mockRes();
  await handler({ body: { transcript: 'add a circle' }, user: { id: 'user-b' } }, otherUser, () => {});

  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(200));
  assert.equal(statuses[20], 429);
  assert.equal(lastBody.errors.code, 'VOICE_COMMAND_RATE_LIMITED');
  assert.equal(otherUser.statusCode, 200);
  assert.equal(calls, 21);
});
