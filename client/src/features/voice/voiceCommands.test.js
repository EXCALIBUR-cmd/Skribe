import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmVoiceCommandProposal,
  describeVoiceCommand,
  requestVoiceCommandInterpretation,
  resolveVoiceCommandStyle,
  runVoiceCommand,
  validateVoiceCommand
} from './voiceCommands.js';
import { getContrastRatio } from '../../utils/contrastUtils.js';
import { TOOL_REGISTRY } from '../../components/config/ToolRegistry.js';
import { SHAPE_DEFAULT_STYLES } from '../../components/canvas/shapeDefaults.js';

const registryNote = (id) => TOOL_REGISTRY.sticky.items.find((item) => item.id === id).colorDot;

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

test('an unstyled voice sticky note gets the light yellow default and dark text even when the pen is black', () => {
  const style = resolveVoiceCommandStyle({ action: 'create_sticky_note', text: 'Ideas' }, { activeColor: '#000000' });
  assert.equal(style.fill, registryNote('sticky_yellow'));
  assert.equal(style.textColor, '#1e293b');
  assert.notEqual(style.fill, '#000000');
  assert.ok(getContrastRatio(style.fill, style.textColor) >= 4.5);
});

test('requested note background and text colors are applied independently', () => {
  assert.deepEqual(
    resolveVoiceCommandStyle({ action: 'create_sticky_note', text: 'Design', color: 'pink', textColor: 'dark blue' }),
    { fill: registryNote('sticky_pink'), textColor: '#1e3a8a' }
  );
  assert.deepEqual(resolveVoiceCommandStyle({ action: 'create_sticky_note', text: 'Design', color: 'blue' }), { fill: registryNote('sticky_blue'), textColor: '#1e293b' });
  assert.deepEqual(resolveVoiceCommandStyle({ action: 'create_sticky_note', text: 'Design', textColor: 'dark blue' }), { fill: registryNote('sticky_yellow'), textColor: '#1e3a8a' });
  assert.deepEqual(resolveVoiceCommandStyle({ action: 'create_text', text: 'Hi', textColor: 'red' }), { fill: null, textColor: '#ef4444' });
  assert.deepEqual(resolveVoiceCommandStyle({ action: 'create_text', text: 'Hi' }), { fill: null, textColor: null });
});

test('shape fill and label color are resolved separately and stay readable', () => {
  assert.deepEqual(
    resolveVoiceCommandStyle({ action: 'create_shape', shapeType: 'rectangle', label: 'Planning', color: 'blue', textColor: 'white' }),
    { fill: '#3b82f6', textColor: '#ffffff' }
  );
  const blueDefaultLabel = resolveVoiceCommandStyle({ action: 'create_shape', shapeType: 'rectangle', label: 'Planning', color: 'blue' });
  assert.equal(blueDefaultLabel.fill, '#3b82f6');
  assert.ok(getContrastRatio(blueDefaultLabel.fill, blueDefaultLabel.textColor) >= 4.5);

  const unreadable = resolveVoiceCommandStyle({ action: 'create_sticky_note', text: 'x', color: 'yellow', textColor: 'yellow' });
  assert.ok(getContrastRatio(unreadable.fill, unreadable.textColor) >= 4.5);

  for (const shapeType of ['circle', 'triangle', 'diamond', 'hexagon']) {
    assert.deepEqual(resolveVoiceCommandStyle({ action: 'create_shape', shapeType }), { fill: SHAPE_DEFAULT_STYLES[shapeType].fill, textColor: SHAPE_DEFAULT_STYLES[shapeType].textColor });
  }
  assert.deepEqual(resolveVoiceCommandStyle({ action: 'create_shape', shapeType: 'rectangle' }, { activeColor: '#000000' }), { fill: '#000000', textColor: '#ffffff' });
});

test('several notes can use distinct coordinated palette colors', () => {
  const fills = ['yellow', 'pink', 'blue', 'green', 'purple'].map((color) => resolveVoiceCommandStyle({ action: 'create_sticky_note', text: 'x', color }));
  assert.equal(new Set(fills.map((style) => style.fill)).size, 5);
  for (const style of fills) assert.ok(getContrastRatio(style.fill, style.textColor) >= 4.5);
});

test('invalid colors are rejected before any canvas action', async () => {
  for (const command of [
    { action: 'create_sticky_note', text: 'x', color: '#000000' },
    { action: 'create_sticky_note', text: 'x', color: 'navy' },
    { action: 'create_shape', shapeType: 'circle', textColor: 'url(javascript:alert(1))' },
    { action: 'create_text', text: 'x', color: 'red' }
  ]) {
    const canvas = createCanvasSpy();
    const result = await runVoiceCommand('do it', { interpret: interpreterReturning({ status: 'execute', command }), execute: canvas.execute });
    assert.equal(result.status, 'rejected', JSON.stringify(command));
    assert.equal(canvas.calls.length, 0);
  }
});

test('a styled accepted command runs exactly one canvas action carrying its colors', async () => {
  const canvas = createCanvasSpy();
  const command = { action: 'create_sticky_note', text: 'Design', color: 'pink', textColor: 'dark blue' };
  const result = await runVoiceCommand('create a pink note with dark blue text saying design', { interpret: interpreterReturning({ status: 'execute', command }), execute: canvas.execute });
  assert.equal(result.status, 'executed');
  assert.deepEqual(canvas.calls, [command]);
  assert.equal(result.summary, 'Created pink sticky note “Design” in dark blue text');
  assert.equal(describeVoiceCommand({ action: 'create_shape', shapeType: 'rectangle', label: 'Planning', color: 'blue' }), 'blue rectangle labeled “Planning”');
});

test('the shared shape defaults keep the established toolbar values', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(SHAPE_DEFAULT_STYLES)), {
    rectangle: { fill: null, textColor: '#ffffff' },
    rounded_rectangle: { fill: null, textColor: '#ffffff' },
    circle: { fill: '#79f3ea', textColor: '#006f69' },
    triangle: { fill: '#ffd600', textColor: '#3b2f2f' },
    diamond: { fill: '#e0f2fe', textColor: '#0369a1' },
    hexagon: { fill: '#f3e8ff', textColor: '#6b21a8' }
  });
});

test('an overridden unreadable text color is flagged and reported truthfully', async () => {
  const style = resolveVoiceCommandStyle({ action: 'create_sticky_note', text: 'Hi', color: 'yellow', textColor: 'white' });
  assert.equal(style.textAdjusted, true);
  assert.notEqual(style.textColor, '#ffffff');
  assert.equal(resolveVoiceCommandStyle({ action: 'create_sticky_note', text: 'Hi', color: 'pink', textColor: 'dark blue' }).textAdjusted, undefined);

  const canvas = createCanvasSpy({ success: true, objectId: 'shape_elem_9', textAdjusted: true });
  const result = await runVoiceCommand('yellow note with white text saying hi', {
    interpret: interpreterReturning({ status: 'execute', command: { action: 'create_sticky_note', text: 'Hi', color: 'yellow', textColor: 'white' } }),
    execute: canvas.execute
  });
  assert.equal(result.summary, 'Created yellow sticky note “Hi” in white text (text color adjusted for readability)');
});
