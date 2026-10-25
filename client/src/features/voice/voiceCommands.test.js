import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmVoiceCommandProposal,
  describeVoiceCommand,
  requestVoiceCommandInterpretation,
  runVoiceCommand,
  validateVoiceCommand
} from './voiceCommands.js';

const createCanvasSpy = (outcome = { success: true, objectId: 'shape_elem_1' }) => {
  const calls = [];
  return {
    calls,
    execute: (command) => {
      calls.push(command);
      return typeof outcome === 'function' ? outcome(command) : outcome;
    }
  };
};

const interpreterReturning = (result) => {
  const calls = [];
  const interpret = async (instruction, options) => {
    calls.push({ instruction, options });
    return { result, model: 'gemini-test-model' };
  };
  interpret.calls = calls;
  return interpret;
};

test('accepted text and sticky-note commands run exactly one canvas action', async () => {
  for (const command of [
    { action: 'create_text', text: 'Quarterly goals' },
    { action: 'create_sticky_note', text: 'Buy milk' }
  ]) {
    const canvas = createCanvasSpy();
    const interpret = interpreterReturning({ status: 'execute', command });
    const result = await runVoiceCommand('  make it  ', { interpret, execute: canvas.execute });

    assert.equal(result.status, 'executed');
    assert.deepEqual(canvas.calls, [command]);
    assert.equal(interpret.calls.length, 1);
    assert.equal(interpret.calls[0].instruction, 'make it');
    assert.equal(result.objectId, 'shape_elem_1');
  }
});

test('accepted shape commands run exactly one canvas action with the label', async () => {
  const canvas = createCanvasSpy();
  const interpret = interpreterReturning({ status: 'execute', command: { action: 'create_shape', shapeType: 'circle', label: ' Start ' } });
  const result = await runVoiceCommand('add a circle labeled start', { interpret, execute: canvas.execute });

  assert.equal(result.status, 'executed');
  assert.deepEqual(canvas.calls, [{ action: 'create_shape', shapeType: 'circle', label: 'Start' }]);
  assert.equal(result.summary, 'Created circle labeled “Start”');
});

test('rejected and unsupported results never touch the canvas', async () => {
  const canvas = createCanvasSpy();
  const interpret = interpreterReturning({ status: 'rejected', code: 'UNSUPPORTED_COMMAND', message: 'Deleting objects is not supported.' });
  const result = await runVoiceCommand('delete everything', { interpret, execute: canvas.execute });

  assert.deepEqual(result, { status: 'rejected', code: 'UNSUPPORTED_COMMAND', message: 'Deleting objects is not supported.' });
  assert.equal(canvas.calls.length, 0);
});

test('ambiguous results ask for clarification and only run after explicit confirmation', async () => {
  const canvas = createCanvasSpy();
  const interpret = interpreterReturning({
    status: 'clarify',
    message: 'Did you mean a sticky note titled Ideas?',
    proposal: { action: 'create_sticky_note', text: 'Ideas' }
  });
  const result = await runVoiceCommand('ideas', { interpret, execute: canvas.execute });

  assert.equal(result.status, 'clarify');
  assert.equal(result.message, 'Did you mean a sticky note titled Ideas?');
  assert.deepEqual(result.proposal, { action: 'create_sticky_note', text: 'Ideas' });
  assert.equal(canvas.calls.length, 0);

  const confirmed = await confirmVoiceCommandProposal(result.proposal, canvas.execute);
  assert.equal(confirmed.status, 'executed');
  assert.equal(canvas.calls.length, 1);
});

test('clarifications with an invalid proposal expose no proposal', async () => {
  const canvas = createCanvasSpy();
  const interpret = interpreterReturning({ status: 'clarify', message: 'Which shape?', proposal: { action: 'create_shape', shapeType: 'star' } });
  const result = await runVoiceCommand('add a shape', { interpret, execute: canvas.execute });

  assert.equal(result.status, 'clarify');
  assert.equal(result.proposal, null);
  assert.equal(canvas.calls.length, 0);
});

test('client action validation blocks unsafe commands even when the server says execute', async () => {
  const unsafeCommands = [
    { action: 'delete_object', objectId: 'shape_1' },
    { action: 'create_shape', shapeType: 'star' },
    { action: 'create_text', text: '   ' },
    { action: 'create_text', text: 'hi', x: 10, y: 20 },
    { action: 'create_shape', shapeType: 'circle', targetId: 'shape_1' },
    { action: 'create_sticky_note', text: 'a'.repeat(501) },
    null,
    'create_text'
  ];

  for (const command of unsafeCommands) {
    const canvas = createCanvasSpy();
    const result = await runVoiceCommand('do it', { interpret: interpreterReturning({ status: 'execute', command }), execute: canvas.execute });
    assert.equal(result.status, 'rejected', JSON.stringify(command));
    assert.equal(canvas.calls.length, 0);
  }

  const malformed = await runVoiceCommand('do it', { interpret: interpreterReturning({ status: 'run_anything' }), execute: createCanvasSpy().execute });
  assert.equal(malformed.code, 'MALFORMED_RESPONSE');
});

test('provider failures and timeouts are reported truthfully with no canvas mutation', async () => {
  for (const [code, message] of [
    ['AI_UNAVAILABLE', 'The AI provider is temporarily unavailable. No changes were made.'],
    ['AI_TIMEOUT', 'The AI provider did not respond in time. No changes were made.'],
    ['AI_NOT_CONFIGURED', 'AI voice commands are not configured on the server. No changes were made.']
  ]) {
    const canvas = createCanvasSpy();
    let interpretCalls = 0;
    const interpret = async () => {
      interpretCalls += 1;
      throw Object.assign(new Error(message), { code });
    };
    const result = await runVoiceCommand('add a circle', { interpret, execute: canvas.execute });

    assert.deepEqual(result, { status: 'error', code, message });
    assert.equal(interpretCalls, 1);
    assert.equal(canvas.calls.length, 0);
  }
});

test('cancelling before or during interpretation never mutates the canvas', async () => {
  const canvas = createCanvasSpy();
  const before = new AbortController();
  before.abort();
  const interpret = interpreterReturning({ status: 'execute', command: { action: 'create_text', text: 'hi' } });
  assert.equal((await runVoiceCommand('add text hi', { interpret, execute: canvas.execute, signal: before.signal })).status, 'cancelled');
  assert.equal(interpret.calls.length, 0);

  const during = new AbortController();
  const slowInterpret = async () => {
    during.abort();
    return { result: { status: 'execute', command: { action: 'create_text', text: 'hi' } } };
  };
  assert.equal((await runVoiceCommand('add text hi', { interpret: slowInterpret, execute: canvas.execute, signal: during.signal })).status, 'cancelled');
  assert.equal(canvas.calls.length, 0);
});

test('empty or oversized instructions are rejected without a network request', async () => {
  const canvas = createCanvasSpy();
  const interpret = interpreterReturning({ status: 'execute', command: { action: 'create_text', text: 'hi' } });

  assert.equal((await runVoiceCommand('   ', { interpret, execute: canvas.execute })).code, 'EMPTY_TRANSCRIPT');
  assert.equal((await runVoiceCommand('a'.repeat(501), { interpret, execute: canvas.execute })).code, 'TRANSCRIPT_TOO_LONG');
  assert.equal(interpret.calls.length, 0);
  assert.equal(canvas.calls.length, 0);
});

test('a failed canvas action is reported once and never retried', async () => {
  const canvas = createCanvasSpy({ success: false, reason: 'Canvas not initialized' });
  const interpret = interpreterReturning({ status: 'execute', command: { action: 'create_shape', shapeType: 'hexagon' } });
  const result = await runVoiceCommand('add a hexagon', { interpret, execute: canvas.execute });

  assert.deepEqual(result, { status: 'error', code: 'CANVAS_ACTION_FAILED', message: 'Canvas not initialized' });
  assert.equal(canvas.calls.length, 1);
});

test('the request helper posts only the transcript and maps server errors', async () => {
  const posts = [];
  const okClient = {
    post: async (url, body, config) => {
      posts.push({ url, body, config });
      return { success: true, data: { result: { status: 'clarify', message: 'Which shape?', proposal: null }, model: 'm' } };
    }
  };
  const signal = new AbortController().signal;
  const data = await requestVoiceCommandInterpretation('add a shape', { apiClient: okClient, signal });

  assert.equal(data.result.status, 'clarify');
  assert.equal(posts[0].url, '/voice-commands/interpret');
  assert.deepEqual(posts[0].body, { transcript: 'add a shape' });
  assert.equal(posts[0].config.signal, signal);
  assert.equal(typeof posts[0].config.timeout, 'number');

  const cases = [
    [{ success: false, message: 'The AI provider is temporarily unavailable. No changes were made.', errors: { code: 'AI_UNAVAILABLE' } }, 'AI_UNAVAILABLE'],
    [{ success: false, message: 'canceled' }, 'CANCELLED'],
    [{ success: false, message: 'timeout of 20000ms exceeded' }, 'REQUEST_TIMEOUT'],
    [{ success: false, message: 'Network Error' }, 'NETWORK_ERROR']
  ];
  for (const [rejection, code] of cases) {
    const failingClient = { post: async () => { throw rejection; } };
    await assert.rejects(requestVoiceCommandInterpretation('add a circle', { apiClient: failingClient }), (err) => err.code === code);
  }
});

test('validation and descriptions cover every supported shape', () => {
  for (const shapeType of ['rectangle', 'rounded_rectangle', 'circle', 'triangle', 'diamond', 'hexagon']) {
    const validation = validateVoiceCommand({ action: 'create_shape', shapeType });
    assert.equal(validation.valid, true);
    assert.ok(describeVoiceCommand(validation.command).length > 0);
  }
  assert.equal(describeVoiceCommand({ action: 'create_sticky_note', text: 'Buy milk' }), 'sticky note “Buy milk”');
  assert.equal(describeVoiceCommand({ action: 'create_text', text: 'Hi' }), 'text “Hi”');
});
