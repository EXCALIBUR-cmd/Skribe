import assert from 'node:assert/strict';
import test from 'node:test';
import { DictationAdapter, MAX_RECORDING_SECONDS, ServerWhisperAdapter, chooseSpeechEngine, getSpeechProcessingDisclosure } from './speechRecognitionAdapter.js';

const SpeechRecognition = function SpeechRecognition() {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('Chrome and Edge use Web Speech; Brave, Firefox and browsers without it use the server', () => {
  assert.equal(chooseSpeechEngine({ SpeechRecognition, navigator: {} }), 'web');
  assert.equal(chooseSpeechEngine({ webkitSpeechRecognition: SpeechRecognition, navigator: {} }), 'web');
  assert.equal(chooseSpeechEngine({ webkitSpeechRecognition: SpeechRecognition, navigator: { brave: { isBrave: () => Promise.resolve(true) } } }), 'server');
  assert.equal(chooseSpeechEngine({ navigator: {} }), 'server');
  assert.equal(chooseSpeechEngine(undefined), 'server');
});

const fakeEngine = (behaviour) => {
  const made = [];
  const create = (callbacks) => {
    const adapter = { started: [], isListening: false, destroyed: false, start(options) { this.started.push(options); behaviour(callbacks, this); return true; }, stop() {}, abort() {}, destroy() { this.destroyed = true; } };
    made.push(adapter);
    return adapter;
  };
  return { create, made };
};
const recorder = () => {
  const seen = { errors: [], transcripts: [], ends: [], states: [] };
  return { seen, callbacks: { onError: (e) => seen.errors.push(e.code), onTranscript: (p) => seen.transcripts.push(p.text), onEnd: (p) => seen.ends.push(p.finalTranscript), onStateChange: (s) => seen.states.push(s) } };
};

test('a Web Speech network error retries the same session once with the server engine', () => {
  const web = fakeEngine((cb) => { cb.onError({ code: 'NETWORK_ERROR' }); cb.onEnd({ finalTranscript: '' }); });
  const server = fakeEngine((cb) => { cb.onTranscript({ text: 'namaste board' }); cb.onEnd({ finalTranscript: 'namaste board' }); });
  const { seen, callbacks } = recorder();
  const adapter = new DictationAdapter(callbacks, { engine: 'web', createWeb: web.create, createServer: server.create });
  const options = { lang: 'hi-IN', continuous: true };
  adapter.start(options);
  assert.equal(web.made.length, 1);
  assert.equal(web.made[0].destroyed, true);
  assert.equal(server.made.length, 1);
  assert.deepEqual(server.made[0].started, [options]);
  assert.deepEqual(seen.errors, [], 'the network error reached the user');
  assert.deepEqual(seen.transcripts, ['namaste board']);
  assert.deepEqual(seen.ends, ['namaste board']);
  assert.equal(adapter.engine, 'server');
  assert.equal(adapter.transcribeTimeoutMs, 30000);
});

test('the server retry happens only once, and other Web Speech errors are not retried', () => {
  const web = fakeEngine((cb) => cb.onError({ code: 'NETWORK_ERROR' }));
  const server = fakeEngine((cb) => cb.onError({ code: 'NETWORK_ERROR' }));
  const first = recorder();
  new DictationAdapter(first.callbacks, { engine: 'web', createWeb: web.create, createServer: server.create }).start({});
  assert.equal(server.made.length, 1);
  assert.deepEqual(first.seen.errors, ['NETWORK_ERROR']);
  const denied = fakeEngine((cb) => cb.onError({ code: 'PERMISSION_DENIED' }));
  const unused = fakeEngine(() => {});
  const second = recorder();
  new DictationAdapter(second.callbacks, { engine: 'web', createWeb: denied.create, createServer: unused.create }).start({});
  assert.equal(unused.made.length, 0);
  assert.deepEqual(second.seen.errors, ['PERMISSION_DENIED']);
});

const fakeMic = () => {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { tracks, stream: { getTracks: () => tracks } };
};
class FakeRecorder {
  static isTypeSupported(type) { return type.startsWith('audio/ogg'); }
  constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType || ''; this.state = 'inactive'; FakeRecorder.last = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
}
const serverAdapter = (callbacks, overrides = {}) => {
  const mic = fakeMic();
  const timers = [];
  const uploads = [];
  const adapter = new ServerWhisperAdapter(callbacks, {
    isSupported: () => true,
    getUserMedia: async () => mic.stream,
    MediaRecorder: FakeRecorder,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    transcribe: async (blob, lang) => { uploads.push({ blob, lang }); return ' hello from whisper '; },
    ...overrides
  });
  return { adapter, mic, timers, uploads };
};

test('the server adapter records, uploads the clip, returns the text and releases the microphone', async () => {
  const { seen, callbacks } = recorder();
  const { adapter, mic, timers, uploads } = serverAdapter(callbacks);
  assert.equal(await adapter.start({ lang: 'hi-IN' }), true);
  assert.deepEqual(seen.states, ['REQUESTING_PERMISSION', 'LISTENING']);
  assert.equal(adapter.isListening, true);
  assert.equal(FakeRecorder.last.mimeType, 'audio/ogg;codecs=opus');
  assert.equal(timers[0].ms, MAX_RECORDING_SECONDS * 1000);
  FakeRecorder.last.ondataavailable({ data: new Blob(['abc']) });
  adapter.stop();
  await tick();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].lang, 'hi');
  assert.equal(uploads[0].blob.type, 'audio/ogg;codecs=opus');
  assert.equal(uploads[0].blob.size, 3);
  assert.deepEqual(seen.transcripts, ['hello from whisper']);
  assert.deepEqual(seen.ends, ['hello from whisper']);
  assert.deepEqual(seen.states.slice(2), ['TRANSCRIBING', 'IDLE']);
  assert.deepEqual(seen.errors, []);
  assert.equal(mic.tracks[0].stopped, true, 'the microphone was not released');
  assert.equal(adapter.isListening, false);
});

test('the recording stops itself at the maximum length', async () => {
  const { seen, callbacks } = recorder();
  const { adapter, timers } = serverAdapter(callbacks);
  await adapter.start({});
  FakeRecorder.last.ondataavailable({ data: new Blob(['x']) });
  timers[0].fn();
  await tick();
  assert.deepEqual(seen.transcripts, ['hello from whisper']);
});

test('server errors reach the user as voice error codes, and the microphone is released', async () => {
  const { seen, callbacks } = recorder();
  const rejected = { success: false, message: 'limit', errors: { code: 'VOICE_DAILY_LIMIT' } };
  const { adapter, mic } = serverAdapter(callbacks, { transcribe: async () => { throw rejected; } });
  await adapter.start({});
  FakeRecorder.last.ondataavailable({ data: new Blob(['abc']) });
  adapter.stop();
  await tick();
  assert.deepEqual(seen.errors, ['VOICE_DAILY_LIMIT']);
  assert.deepEqual(seen.ends, ['']);
  assert.equal(mic.tracks[0].stopped, true);
  const offline = recorder();
  const failing = serverAdapter(offline.callbacks, { transcribe: async () => { throw { success: false, message: 'Network Error' }; } });
  await failing.adapter.start({});
  FakeRecorder.last.ondataavailable({ data: new Blob(['abc']) });
  failing.adapter.stop();
  await tick();
  assert.deepEqual(offline.seen.errors, ['NETWORK_ERROR']);
});

test('denied microphone, abort and destroy all leave the microphone released', async () => {
  const denied = recorder();
  const blocked = serverAdapter(denied.callbacks, { getUserMedia: async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); } });
  assert.equal(await blocked.adapter.start({}), false);
  assert.deepEqual(denied.seen.errors, ['PERMISSION_DENIED']);
  const aborted = recorder();
  const { adapter, mic, uploads } = serverAdapter(aborted.callbacks);
  await adapter.start({});
  FakeRecorder.last.ondataavailable({ data: new Blob(['abc']) });
  adapter.abort();
  await tick();
  assert.equal(mic.tracks[0].stopped, true);
  assert.equal(uploads.length, 0, 'an aborted recording was uploaded');
  assert.deepEqual(aborted.seen.transcripts, []);
  const destroyed = serverAdapter(recorder().callbacks);
  await destroyed.adapter.start({});
  destroyed.adapter.destroy();
  assert.equal(destroyed.mic.tracks[0].stopped, true);
});

test('the privacy disclosure says some browsers send audio to Skribe and Groq', () => {
  assert.match(getSpeechProcessingDisclosure().details, /sent to Skribe's server and transcribed by Groq/);
});
