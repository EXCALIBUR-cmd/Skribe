import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDoubleTapDetector,
  insertIntoField,
  isBlockedTarget,
  isInsertableField,
  mergeTranscript,
  nextQuickDictationState
} from './quickDictationLogic.js';

const body = { tagName: 'BODY' };
const space = (extra = {}) => ({ code: 'Space', key: ' ', target: body, ...extra });

const tapper = (interval = 300) => {
  const detector = createDoubleTapDetector({ getInterval: () => interval });
  const tap = (at, extra = {}, hold = 60) => {
    detector.keyDown(space(extra), at);
    return detector.keyUp(space(extra), at + hold);
  };
  return { detector, tap };
};

test('a double-tap of Space inside the interval activates once', () => {
  const { tap } = tapper();
  assert.equal(tap(0), false);
  assert.equal(tap(200), true);
  assert.equal(tap(400), false);
  assert.equal(tap(600), true);
});

test('a single tap and two taps outside the interval do not activate', () => {
  const { tap } = tapper(300);
  assert.equal(tap(0), false);
  assert.equal(tap(301), false);
  assert.equal(tap(1000), false);
});

test('the configured interval is read on every press', () => {
  let interval = 200;
  const detector = createDoubleTapDetector({ getInterval: () => interval });
  const tap = (at) => {
    detector.keyDown(space(), at);
    return detector.keyUp(space(), at + 50);
  };
  tap(0);
  assert.equal(tap(250), false);
  interval = 500;
  assert.equal(tap(700), true);
});

test('a held Space, repeated keydowns and Space-drag panning never count as taps', () => {
  const { detector, tap } = tapper();
  detector.keyDown(space(), 0);
  detector.keyDown(space({ repeat: true }), 30);
  detector.keyDown(space({ repeat: true }), 60);
  assert.equal(detector.keyUp(space(), 90), false);
  assert.equal(tap(150), false);

  const long = tapper();
  assert.equal(long.tap(0, {}, 400), false);
  assert.equal(long.tap(450), false);

  const pan = tapper();
  pan.tap(0);
  pan.detector.keyDown(space(), 150);
  pan.detector.pointer();
  assert.equal(pan.detector.keyUp(space(), 200), false);
  assert.equal(pan.tap(260), false);
});

test('modifier combinations and other keys between taps do not activate', () => {
  for (const modifier of ['ctrlKey', 'altKey', 'shiftKey', 'metaKey']) {
    const { tap } = tapper();
    tap(0);
    assert.equal(tap(150, { [modifier]: true }), false, modifier);
  }
  const { detector, tap } = tapper();
  tap(0);
  detector.keyDown({ code: 'KeyA', key: 'a', target: body }, 100);
  assert.equal(tap(150), false);
});

test('Space in inputs, textareas, editors, Fabric text and focused controls never activates', () => {
  const targets = [
    { tagName: 'INPUT', type: 'text' },
    { tagName: 'TEXTAREA' },
    { tagName: 'TEXTAREA', getAttribute: (name) => (name === 'data-fabric' ? 'textarea' : null) },
    { tagName: 'DIV', isContentEditable: true },
    { tagName: 'SELECT' },
    { tagName: 'BUTTON' },
    { tagName: 'A' },
    { tagName: 'DIV', getAttribute: (name) => (name === 'role' ? 'switch' : null) }
  ];
  for (const target of targets) {
    assert.equal(isBlockedTarget(target), true, JSON.stringify(target));
    const { tap } = tapper();
    tap(0, { target });
    assert.equal(tap(150, { target }), false);
  }
  assert.equal(isBlockedTarget(body), false);
  assert.equal(isBlockedTarget({ tagName: 'CANVAS' }), false);
});

test('the state machine allows one session at a time and recovers from errors', () => {
  assert.equal(nextQuickDictationState('idle', 'activate'), 'recording');
  assert.equal(nextQuickDictationState('recording', 'activate'), 'recording');
  assert.equal(nextQuickDictationState('recording', 'stop'), 'transcribing');
  assert.equal(nextQuickDictationState('transcribing', 'activate'), 'transcribing');
  assert.equal(nextQuickDictationState('transcribing', 'stop'), 'transcribing');
  assert.equal(nextQuickDictationState('transcribing', 'inserted'), 'idle');
  assert.equal(nextQuickDictationState('transcribing', 'review'), 'review');
  assert.equal(nextQuickDictationState('transcribing', 'empty'), 'error');
  assert.equal(nextQuickDictationState('review', 'activate'), 'review');
  assert.equal(nextQuickDictationState('review', 'close'), 'idle');
  assert.equal(nextQuickDictationState('recording', 'fail'), 'error');
  assert.equal(nextQuickDictationState('recording', 'cancel'), 'idle');
  assert.equal(nextQuickDictationState('error', 'activate'), 'recording');
  assert.equal(nextQuickDictationState('error', 'dismiss'), 'idle');
});

test('transcripts merge at the caret, keep existing text and add spacing', () => {
  assert.deepEqual(mergeTranscript('', 0, 0, ' hello world '), { value: 'hello world', caret: 11 });
  assert.deepEqual(mergeTranscript('Buy milk', 8, 8, 'and eggs'), { value: 'Buy milk and eggs', caret: 17 });
  assert.deepEqual(mergeTranscript('Buy milk', 3, 3, 'fresh'), { value: 'Buy fresh milk', caret: 9 });
  assert.deepEqual(mergeTranscript('Buy milk', 4, 8, 'bread'), { value: 'Buy bread', caret: 9 });
  assert.deepEqual(mergeTranscript('Note ', undefined, undefined, 'done'), { value: 'Note done', caret: 9 });
  assert.deepEqual(mergeTranscript('keep', 2, 2, '   '), { value: 'keep', caret: 2 });
});

const fakeField = (overrides = {}) => {
  const events = [];
  return {
    tagName: 'INPUT',
    type: 'text',
    value: 'Plan launch',
    selectionStart: 11,
    selectionEnd: 11,
    isConnected: true,
    events,
    getAttribute(name) { return name === 'type' ? this.type : null; },
    dispatchEvent(event) { events.push(event.type); },
    focus() { events.push('focus'); },
    setSelectionRange(start, end) { this.caret = [start, end]; },
    ...overrides
  };
};

test('insertion targets only connected, editable text fields and fires an input event', () => {
  const field = fakeField();
  assert.equal(insertIntoField(field, 'for Friday'), true);
  assert.equal(field.value, 'Plan launch for Friday');
  assert.deepEqual(field.caret, [22, 22]);
  assert.deepEqual(field.events, ['input', 'focus']);

  for (const blocked of [fakeField({ disabled: true }), fakeField({ readOnly: true }), fakeField({ isConnected: false }), fakeField({ type: 'password' }), fakeField({ type: 'checkbox' }), null]) {
    assert.equal(isInsertableField(blocked), false);
    assert.equal(insertIntoField(blocked, 'x'), false);
  }
  assert.equal(isInsertableField({ tagName: 'TEXTAREA', isConnected: true, getAttribute: (name) => (name === 'data-fabric' ? 'textarea' : null) }), false);
  assert.equal(isInsertableField({ tagName: 'DIV', isContentEditable: true, isConnected: true }), false);
});
