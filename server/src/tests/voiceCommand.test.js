import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VOICE_COMMAND_RESPONSE_SCHEMA,
  buildVoiceCommandInput,
  classifyVoiceProviderError,
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

const mockClient = (behaviour) => {
  const calls = [];
  return {
    calls,
    interactions: {
      create: async (params, requestOptions) => {
        calls.push({ params, requestOptions });
        if (behaviour.error) throw behaviour.error;
        return { output_text: behaviour.outputText, model: 'gemini-test-model' };
      }
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

test('interpretVoiceCommand sends one schema-constrained request with the transcript as data', async () => {
  const client = mockClient({ outputText: JSON.stringify(intent({ action: 'create_sticky_note', text: 'Buy milk' })) });
  const output = await interpretVoiceCommand('add a sticky note that says buy milk', { apiKey: 'test-key', client });

  assert.deepEqual(output.result, { status: 'execute', command: { action: 'create_sticky_note', text: 'Buy milk' } });
  assert.equal(output.model, 'gemini-test-model');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].params.response_format.schema, VOICE_COMMAND_RESPONSE_SCHEMA);
  assert.deepEqual(client.calls[0].requestOptions.retries, { strategy: 'none' });
  assert.ok(client.calls[0].params.input[0].text.endsWith(JSON.stringify('add a sticky note that says buy milk')));
  assert.deepEqual(buildVoiceCommandInput('x')[0].type, 'text');
});

test('provider timeout, outage and rate limits fail once without retrying', async () => {
  const cases = [
    [Object.assign(new Error('Request timed out'), { name: 'APIConnectionTimeoutError' }), 'AI_TIMEOUT', 504],
    [Object.assign(new Error('The model is overloaded'), { status: 503 }), 'AI_UNAVAILABLE', 503],
    [Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }), 'AI_RATE_LIMITED', 429],
    [Object.assign(new Error('API key not valid'), { status: 400 }), 'AI_UNAVAILABLE', 503],
    [Object.assign(new Error('socket hang up'), { status: 500 }), 'AI_FAILED', 502]
  ];

  for (const [providerError, code, statusCode] of cases) {
    const client = mockClient({ error: providerError });
    await assert.rejects(
      interpretVoiceCommand('add a circle', { apiKey: 'test-key', client }),
      (err) => err.code === code && err.statusCode === statusCode && err.message.includes('No changes were made')
    );
    assert.equal(client.calls.length, 1);
  }
});

test('a hung provider call is aborted at the timeout even when a client signal is attached', async () => {
  const seen = [];
  const hangingClient = {
    interactions: {
      create: (params, requestOptions) => new Promise((resolve, reject) => {
        seen.push(requestOptions);
        requestOptions.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
      })
    }
  };
  const clientSignal = new AbortController().signal;
  const started = Date.now();
  await assert.rejects(
    interpretVoiceCommand('add a circle', { apiKey: 'test-key', client: hangingClient, signal: clientSignal, timeoutMs: 50 }),
    (err) => err.code === 'AI_TIMEOUT' && err.statusCode === 504
  );
  assert.ok(Date.now() - started < 2000);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].timeout_ms, undefined);
  assert.notEqual(seen[0].signal, clientSignal);
});

test('the timeout holds even when the provider call ignores the abort signal', async () => {
  const deafClient = { interactions: { create: () => new Promise(() => {}) } };
  const started = Date.now();
  await assert.rejects(
    interpretVoiceCommand('add a circle', { apiKey: 'test-key', client: deafClient, signal: new AbortController().signal, timeoutMs: 50 }),
    (err) => err.code === 'AI_TIMEOUT' && err.statusCode === 504
  );
  assert.ok(Date.now() - started < 2000);
});

test('a client disconnect aborts the provider call and is reported as cancelled', async () => {
  const hangingClient = {
    interactions: {
      create: (params, requestOptions) => new Promise((resolve, reject) => {
        requestOptions.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
      })
    }
  };
  const disconnect = new AbortController();
  const pending = interpretVoiceCommand('add a circle', { apiKey: 'test-key', client: hangingClient, signal: disconnect.signal, timeoutMs: 5000 });
  disconnect.abort();
  await assert.rejects(pending, (err) => err.code === 'CLIENT_ABORTED' && err.statusCode === 499);
});

test('missing provider configuration and invalid transcripts never call the provider', async () => {
  const client = mockClient({ outputText: '{}' });
  await assert.rejects(interpretVoiceCommand('add a circle', { apiKey: '', client }), (err) => err.code === 'AI_NOT_CONFIGURED' && err.statusCode === 503);
  await assert.rejects(interpretVoiceCommand('   ', { apiKey: 'test-key', client }), (err) => err.code === 'INVALID_TRANSCRIPT');
  await assert.rejects(interpretVoiceCommand('a'.repeat(501), { apiKey: 'test-key', client }), (err) => err.code === 'INVALID_TRANSCRIPT');
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(interpretVoiceCommand('add a circle', { apiKey: 'test-key', client, signal: aborted.signal }), (err) => err.code === 'CLIENT_ABORTED');
  assert.equal(client.calls.length, 0);
});

test('empty or non-JSON provider output is reported as an invalid response', async () => {
  for (const outputText of ['', '   ', 'Sure! Here is a circle.', '```json\n{"outcome":"command"}\n```']) {
    const client = mockClient({ outputText });
    await assert.rejects(
      interpretVoiceCommand('add a circle', { apiKey: 'test-key', client }),
      (err) => err.code === 'AI_INVALID_RESPONSE' && err.statusCode === 502
    );
  }
});

test('classifyVoiceProviderError passes through typed errors', () => {
  const typed = Object.assign(new Error('x'), { code: 'AI_TIMEOUT', statusCode: 504 });
  assert.equal(classifyVoiceProviderError(typed), typed);
  assert.equal(classifyVoiceProviderError(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })).code, 'AI_TIMEOUT');
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
