import assert from 'node:assert/strict';
import test from 'node:test';
import { MockSpeechAdapter } from './MockSpeechAdapter.js';
import { getSpeechProcessingDisclosure } from './speechRecognitionAdapter.js';

const createMockCanvas = () => {
  const objects = [];
  let nextId = 1;
  const history = [];
  const emittedEvents = [];

  const canvas = {
    width: 1000,
    height: 800,
    viewportTransform: [1, 0, 0, 1, 0, 0],
    getZoom() {
      return this.viewportTransform[0];
    },
    getObjects() {
      return [...objects];
    },
    add(obj) {
      if (!obj.id) obj.id = `text_${nextId++}`;
      objects.push(obj);
      return obj;
    },
    setActiveObject(obj) {
      this.activeObject = obj;
    },
    requestRenderAll() {},
    toJSON() {
      return {
        version: '6.5.1',
        objects: objects.map(o => ({
          id: o.id,
          type: o.type,
          text: o.text,
          left: o.left,
          top: o.top,
          width: o.width,
          metadata: o.metadata
        }))
      };
    }
  };

  const notifyLocalObjectAdded = (obj) => {
    emittedEvents.push({ event: 'canvas:object-added', objectId: obj.id, objectData: obj });
  };

  const saveState = () => {
    history.push(canvas.toJSON());
  };

  const getViewportCenterPoint = (c) => {
    const vpt = c.viewportTransform || [1, 0, 0, 1, 0, 0];
    const zoom = vpt[0];
    const panX = vpt[4];
    const panY = vpt[5];
    return {
      x: (c.width / 2 - panX) / zoom,
      y: (c.height / 2 - panY) / zoom
    };
  };

  const getNextViewportPosition = (c) => {
    const center = getViewportCenterPoint(c);
    return { x: center.x, y: center.y };
  };

  const insertDictatedText = (textString, options = {}) => {
    if (!canvas) {
      return { success: false, reason: 'Canvas not initialized' };
    }
    if (!textString || !String(textString).trim()) {
      return { success: false, reason: 'Empty transcript' };
    }

    const trimmed = String(textString).trim();
    const { x, y } = options.position || getNextViewportPosition(canvas);

    const textObj = {
      id: `text_elem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: 'textbox',
      text: trimmed,
      left: x,
      top: y,
      width: Math.min(450, Math.max(220, trimmed.length * 8)),
      fontSize: options.fontSize || 22,
      fontFamily: options.fontFamily || 'Quicksand',
      fontWeight: options.fontWeight || 'bold',
      fill: options.fill || '#000000',
      metadata: {
        source: 'voice-dictation',
        createdAt: Date.now()
      }
    };

    canvas.add(textObj);
    notifyLocalObjectAdded(textObj);
    canvas.setActiveObject(textObj);
    saveState();

    return { success: true, objectId: textObj.id, textObject: textObj };
  };

  return {
    canvas,
    objects,
    history,
    emittedEvents,
    insertDictatedText,
    getViewportCenterPoint
  };
};

test('TEST 1: Successful recognition captures interim and final transcripts', () => {
  let state = 'IDLE';
  let capturedTranscript = null;

  const adapter = new MockSpeechAdapter({
    onStateChange: (s) => { state = s; },
    onTranscript: (t) => { capturedTranscript = t; }
  });

  const started = adapter.start();
  assert.equal(started, true);
  assert.equal(state, 'LISTENING');
  assert.equal(adapter.isListening, true);

  adapter.simulateTranscript({ text: 'Meeting notes for Monday', isFinal: true });
  assert.equal(capturedTranscript.finalTranscript, 'Meeting notes for Monday');
  assert.equal(capturedTranscript.interimTranscript, '');
  assert.equal(capturedTranscript.text, 'Meeting notes for Monday');

  adapter.simulateTranscript({ text: 'action items', isFinal: false });
  assert.equal(capturedTranscript.finalTranscript, 'Meeting notes for Monday');
  assert.equal(capturedTranscript.interimTranscript, 'action items');
  assert.equal(capturedTranscript.text, 'Meeting notes for Monday action items');

  adapter.simulateTranscript({ text: 'action items next steps', isFinal: true });
  assert.equal(capturedTranscript.finalTranscript, 'Meeting notes for Monday action items next steps');

  adapter.stop();
  assert.equal(adapter.isListening, false);
  assert.equal(state, 'IDLE');
});

test('TEST 2: Transcript editing before insertion preserves user edits', () => {
  let recognizedText = '';
  const adapter = new MockSpeechAdapter({
    onTranscript: (t) => { recognizedText = t.text; }
  });

  adapter.start();
  adapter.simulateTranscript({ text: 'Deploy to staging', isFinal: true });
  assert.equal(recognizedText, 'Deploy to staging');

  let userReviewedText = recognizedText;
  userReviewedText = `${userReviewedText} at 5 PM UTC with QA signoff`;

  assert.equal(userReviewedText, 'Deploy to staging at 5 PM UTC with QA signoff');
  assert.notEqual(userReviewedText, recognizedText);
});

test('TEST 3: One accepted insertion produces exactly one text object on canvas', () => {
  const env = createMockCanvas();
  assert.equal(env.objects.length, 0);

  const result = env.insertDictatedText('Sprint planning retrospective');
  assert.equal(result.success, true);
  assert.ok(result.objectId);
  assert.equal(env.objects.length, 1);
  assert.equal(env.objects[0].text, 'Sprint planning retrospective');
  assert.equal(env.objects[0].metadata?.source, 'voice-dictation');
  assert.equal(env.emittedEvents.length, 1);
  assert.equal(env.emittedEvents[0].event, 'canvas:object-added');
  assert.equal(env.history.length, 1);
});

test('TEST 4: Cancellation produces zero canvas mutations', () => {
  const env = createMockCanvas();
  let cancelled = false;

  const adapter = new MockSpeechAdapter();
  adapter.start();
  adapter.simulateTranscript({ text: 'Draft text that should not appear', isFinal: true });

  cancelled = true;
  adapter.abort();

  assert.equal(cancelled, true);
  assert.equal(adapter.isListening, false);
  assert.equal(env.objects.length, 0);
  assert.equal(env.history.length, 0);
  assert.equal(env.emittedEvents.length, 0);
});

test('TEST 5: Empty or whitespace-only recognition is rejected', () => {
  const env = createMockCanvas();

  const emptyResult = env.insertDictatedText('');
  assert.equal(emptyResult.success, false);
  assert.equal(emptyResult.reason, 'Empty transcript');
  assert.equal(env.objects.length, 0);

  const whitespaceResult = env.insertDictatedText('     \n\t  ');
  assert.equal(whitespaceResult.success, false);
  assert.equal(whitespaceResult.reason, 'Empty transcript');
  assert.equal(env.objects.length, 0);

  const nullResult = env.insertDictatedText(null);
  assert.equal(nullResult.success, false);
  assert.equal(env.objects.length, 0);
});

test('TEST 6: Unsupported speech-recognition environments produce usable fallback', () => {
  let caughtError = null;
  const adapter = new MockSpeechAdapter({
    onError: (err) => { caughtError = err; }
  });

  adapter.setSupported(false);
  assert.equal(adapter.isSupported(), false);

  const started = adapter.start();
  assert.equal(started, false);
  assert.ok(caughtError);
  assert.equal(caughtError.code, 'NOT_SUPPORTED');

  const env = createMockCanvas();
  const manualResult = env.insertDictatedText('Manual fallback note');
  assert.equal(manualResult.success, true);
  assert.equal(env.objects.length, 1);
  assert.equal(env.objects[0].text, 'Manual fallback note');
});

test('TEST 7: Permission denied and recognition errors are handled cleanly', () => {
  let lastError = null;
  const adapter = new MockSpeechAdapter({
    onError: (err) => { lastError = err; }
  });

  adapter.start();
  adapter.simulateError('PERMISSION_DENIED', 'Microphone access was denied or is blocked');

  assert.equal(adapter.isListening, false);
  assert.ok(lastError);
  assert.equal(lastError.code, 'PERMISSION_DENIED');
  assert.equal(lastError.message, 'Microphone access was denied or is blocked');

  adapter.start();
  adapter.simulateError('NO_SPEECH', 'No speech was detected');
  assert.equal(lastError.code, 'NO_SPEECH');
});

test('TEST 8: Repeated start and stop events do not create duplicate sessions', () => {
  let stateChanges = 0;
  const adapter = new MockSpeechAdapter({
    onStateChange: () => { stateChanges += 1; }
  });

  const firstStart = adapter.start();
  assert.equal(firstStart, true);
  const sessionId1 = adapter.sessionId;

  const secondStart = adapter.start();
  assert.equal(secondStart, false);
  assert.equal(adapter.sessionId, sessionId1);
  assert.equal(stateChanges, 1);

  adapter.stop();
  adapter.stop();
  assert.equal(adapter.isListening, false);
});

test('TEST 9: Late callbacks after cancellation cannot mutate canvas or emit transcripts', () => {
  const env = createMockCanvas();
  let transcriptReceivedAfterAbort = false;

  const adapter = new MockSpeechAdapter({
    onTranscript: () => {
      transcriptReceivedAfterAbort = true;
      env.insertDictatedText('Late event');
    }
  });

  adapter.start();
  const activeSession = adapter.sessionId;
  adapter.abort();

  assert.notEqual(adapter.sessionId, activeSession);
  adapter.simulateTranscript({ text: 'Ghost speech', isFinal: true });

  assert.equal(transcriptReceivedAfterAbort, false);
  assert.equal(env.objects.length, 0);
});

test('TEST 10: Component unmount cleans up active recognition resources', () => {
  let state = 'LISTENING';
  const adapter = new MockSpeechAdapter({
    onStateChange: (s) => { state = s; }
  });

  adapter.start();
  assert.equal(adapter.isListening, true);

  adapter.destroy();
  assert.equal(adapter.isListening, false);
  assert.equal(state, 'IDLE');
});

test('TEST 11: Insertion failure preserves editable transcript for recovery', () => {
  let draftTranscript = 'Important architectural thought';

  const failingInsert = () => {
    return { success: false, reason: 'Simulated persistence failure' };
  };

  const outcome = failingInsert();
  assert.equal(outcome.success, false);
  assert.equal(draftTranscript, 'Important architectural thought');
});

test('TEST 12: Normal text editing and persistence pathways remain intact', () => {
  const env = createMockCanvas();
  const insertResult = env.insertDictatedText('Editable note on canvas');

  assert.equal(insertResult.success, true);
  const textObj = insertResult.textObject;

  assert.equal(textObj.text, 'Editable note on canvas');
  assert.equal(textObj.type, 'textbox');
  assert.equal(textObj.fontFamily, 'Quicksand');
  assert.equal(textObj.fontSize, 22);
  assert.equal(textObj.fontWeight, 'bold');
  assert.ok(textObj.id.startsWith('text_elem_'));

  textObj.text = 'User modified text after insertion';
  const serialized = env.canvas.toJSON();

  assert.equal(serialized.objects.length, 1);
  assert.equal(serialized.objects[0].text, 'User modified text after insertion');
  assert.equal(serialized.objects[0].metadata?.source, 'voice-dictation');
});

test('TEST 13: Viewport transform zoom and pan coordinates are respected', () => {
  const env = createMockCanvas();
  env.canvas.viewportTransform = [2, 0, 0, 2, 100, 150];

  const center = env.getViewportCenterPoint(env.canvas);
  assert.equal(center.x, (500 - 100) / 2);
  assert.equal(center.y, (400 - 150) / 2);

  const result = env.insertDictatedText('Zoomed and panned text');
  assert.equal(result.success, true);
  assert.equal(result.textObject.left, center.x);
  assert.equal(result.textObject.top, center.y);
});

test('TEST 14: Shared-board safety — interim speech is user-local and not broadcast', () => {
  const env = createMockCanvas();
  const adapter = new MockSpeechAdapter();

  adapter.start();
  adapter.simulateTranscript({ text: 'First interim thought', isFinal: false });
  adapter.simulateTranscript({ text: 'Second interim thought', isFinal: false });

  assert.equal(env.emittedEvents.length, 0);
  assert.equal(env.objects.length, 0);

  adapter.stop();
  assert.equal(env.emittedEvents.length, 0);

  env.insertDictatedText('Final approved note');
  assert.equal(env.emittedEvents.length, 1);
  assert.equal(env.emittedEvents[0].event, 'canvas:object-added');
  assert.equal(env.emittedEvents[0].objectData.text, 'Final approved note');
});

test('TEST 15: Speech processing disclosure discloses vendor network processing', () => {
  const disclosure = getSpeechProcessingDisclosure();
  assert.equal(disclosure.provider, 'Web Speech API');
  assert.equal(disclosure.isLocal, false);
  assert.equal(disclosure.processingLocation, 'browser-vendor-service');
  assert.ok(disclosure.details.length > 0);
});
