const getSpeechRecognitionClass = () => {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

export const isSpeechRecognitionSupported = () => {
  return Boolean(getSpeechRecognitionClass());
};

export const getSpeechProcessingDisclosure = () => {
  return {
    provider: 'Web Speech API or Groq Whisper',
    isLocal: false,
    processingLocation: 'browser-vendor-service-or-skribe-server',
    details: "In Chrome and Edge, audio is processed by the browser vendor's speech service. In other browsers, audio is sent to Skribe's server and transcribed by Groq."
  };
};

export class WebSpeechAdapter {
  constructor(callbacks = {}) {
    this.callbacks = {
      onStateChange: () => {},
      onTranscript: () => {},
      onError: () => {},
      onEnd: () => {},
      ...callbacks
    };
    this.recognition = null;
    this.sessionId = 0;
    this.isListening = false;
    this.finalTranscript = '';
    this.interimTranscript = '';
  }

  isSupported() {
    return isSpeechRecognitionSupported();
  }

  start(options = {}) {
    if (this.isListening) {
      return false;
    }

    const SpeechClass = getSpeechRecognitionClass();
    if (!SpeechClass) {
      this.callbacks.onError({
        code: 'NOT_SUPPORTED',
        message: 'Speech recognition is not supported in this browser'
      });
      return false;
    }

    this.sessionId += 1;
    const currentSession = this.sessionId;
    this.finalTranscript = '';
    this.interimTranscript = '';

    try {
      this.recognition = new SpeechClass();
      this.recognition.continuous = options.continuous !== false;
      this.recognition.interimResults = options.interimResults !== false;
      this.recognition.lang = options.lang || 'en-US';

      this.recognition.onstart = () => {
        if (currentSession !== this.sessionId) return;
        this.isListening = true;
        this.callbacks.onStateChange('LISTENING');
      };

      this.recognition.onresult = (event) => {
        if (currentSession !== this.sessionId) return;
        let interim = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript || '';
          if (result.isFinal) {
            finalChunk += text;
          } else {
            interim += text;
          }
        }

        if (finalChunk) {
          this.finalTranscript = this.finalTranscript
            ? `${this.finalTranscript.trim()} ${finalChunk.trim()}`
            : finalChunk.trim();
        }
        this.interimTranscript = interim;

        const combined = this.interimTranscript
          ? (this.finalTranscript ? `${this.finalTranscript} ${this.interimTranscript}` : this.interimTranscript)
          : this.finalTranscript;

        this.callbacks.onTranscript({
          finalTranscript: this.finalTranscript,
          interimTranscript: this.interimTranscript,
          text: combined
        });
      };

      this.recognition.onerror = (event) => {
        if (currentSession !== this.sessionId) return;
        this.isListening = false;
        const errType = event.error || 'unknown';

        let code = 'UNKNOWN_ERROR';
        let message = 'An error occurred during speech recognition';

        if (errType === 'not-allowed' || errType === 'service-not-allowed') {
          code = 'PERMISSION_DENIED';
          message = 'Microphone access was denied or is blocked';
        } else if (errType === 'no-speech') {
          code = 'NO_SPEECH';
          message = 'No speech was detected';
        } else if (errType === 'network') {
          code = 'NETWORK_ERROR';
          message = 'Network error communicating with speech recognition service';
        } else if (errType === 'audio-capture') {
          code = 'AUDIO_CAPTURE_ERROR';
          message = 'No microphone was found or microphone is busy';
        } else if (errType === 'aborted') {
          code = 'ABORTED';
          message = 'Speech recognition was aborted';
        }

        this.callbacks.onError({
          code,
          message,
          originalError: event.error
        });
      };

      this.recognition.onend = () => {
        if (currentSession !== this.sessionId) return;
        this.isListening = false;
        this.callbacks.onStateChange('IDLE');
        this.callbacks.onEnd({
          finalTranscript: this.finalTranscript
        });
      };

      this.callbacks.onStateChange('REQUESTING_PERMISSION');
      this.recognition.start();
      return true;
    } catch (err) {
      this.isListening = false;
      this.callbacks.onError({
        code: 'START_FAILED',
        message: err?.message || 'Failed to start speech recognition',
        originalError: err
      });
      return false;
    }
  }

  stop() {
    if (!this.isListening || !this.recognition) {
      return;
    }
    try {
      this.recognition.stop();
    } catch (err) {
      this.abort();
    }
  }

  abort() {
    this.sessionId += 1;
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch (e) {
      }
      this.recognition = null;
    }
    this.callbacks.onStateChange('IDLE');
  }

  destroy() {
    this.abort();
    this.callbacks = {
      onStateChange: () => {},
      onTranscript: () => {},
      onError: () => {},
      onEnd: () => {}
    };
  }
}

export const MAX_RECORDING_SECONDS = 120;
export const SERVER_TRANSCRIBE_TIMEOUT_MS = 30000;
export const RECORDING_MIME_TYPES = Object.freeze(['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']);
const SERVER_ERROR_CODES = new Set(['VOICE_DAILY_LIMIT', 'VOICE_RATE_LIMITED', 'VOICE_UNAVAILABLE']);
const SERVER_ERROR_MESSAGES = Object.freeze({
  VOICE_DAILY_LIMIT: "You've used today's voice limit. It resets tomorrow.",
  VOICE_RATE_LIMITED: 'Voice is busy right now. Try again in a minute.',
  VOICE_UNAVAILABLE: "Voice dictation isn't available right now.",
  NETWORK_ERROR: 'The speech service could not be reached. Try again, or use Chrome or Edge.',
  UNKNOWN_ERROR: 'Voice transcription failed. Please try again.'
});

const browserWindow = () => (typeof window === 'undefined' ? undefined : window);

export const chooseSpeechEngine = (win = browserWindow()) => {
  const hasWebSpeech = Boolean(win && (win.SpeechRecognition || win.webkitSpeechRecognition));
  return hasWebSpeech && !win.navigator?.brave?.isBrave ? 'web' : 'server';
};

export const isServerTranscriptionSupported = (win = browserWindow()) => Boolean(win?.navigator?.mediaDevices?.getUserMedia && win.MediaRecorder);

export const isDictationSupported = (win = browserWindow()) => (chooseSpeechEngine(win) === 'web' ? true : isServerTranscriptionSupported(win));

export const pickRecordingMimeType = (Recorder) => RECORDING_MIME_TYPES.find((type) => typeof Recorder?.isTypeSupported !== 'function' || Recorder.isTypeSupported(type)) || '';

const uploadForTranscription = async (blob, lang) => {
  const { default: apiClient } = await import('../../api/apiClient');
  const form = new FormData();
  form.append('audio', blob, `dictation.${blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`);
  form.append('lang', lang);
  const res = await apiClient.post('/voice/transcribe', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: SERVER_TRANSCRIBE_TIMEOUT_MS });
  return res?.data?.text || '';
};

const serverErrorFor = (err) => {
  const code = err?.errors?.code;
  if (SERVER_ERROR_CODES.has(code)) return { code, message: SERVER_ERROR_MESSAGES[code] };
  if (!code && (err?.code === 'ERR_NETWORK' || /network/i.test(String(err?.message)))) return { code: 'NETWORK_ERROR', message: SERVER_ERROR_MESSAGES.NETWORK_ERROR };
  return { code: 'UNKNOWN_ERROR', message: SERVER_ERROR_MESSAGES.UNKNOWN_ERROR };
};

const silentCallbacks = () => ({ onStateChange: () => {}, onTranscript: () => {}, onError: () => {}, onEnd: () => {} });

export class ServerWhisperAdapter {
  constructor(callbacks = {}, deps = {}) {
    this.callbacks = { ...silentCallbacks(), ...callbacks };
    const win = browserWindow();
    this.deps = {
      getUserMedia: (constraints) => win.navigator.mediaDevices.getUserMedia(constraints),
      MediaRecorder: win?.MediaRecorder,
      transcribe: uploadForTranscription,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      isSupported: () => isServerTranscriptionSupported(win),
      ...deps
    };
    this.sessionId = 0;
    this.isListening = false;
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.limitTimer = null;
    this.transcribeTimeoutMs = SERVER_TRANSCRIBE_TIMEOUT_MS;
  }

  isSupported() {
    return this.deps.isSupported();
  }

  releaseMic() {
    if (this.limitTimer) this.deps.clearTimeout(this.limitTimer);
    this.limitTimer = null;
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
  }

  async start(options = {}) {
    if (this.isListening) return false;
    if (!this.isSupported()) {
      this.callbacks.onError({ code: 'NOT_SUPPORTED', message: 'Voice recording is not supported in this browser' });
      return false;
    }
    this.sessionId += 1;
    const session = this.sessionId;
    this.lang = String(options.lang || 'en').toLowerCase().startsWith('hi') ? 'hi' : 'en';
    this.callbacks.onStateChange('REQUESTING_PERMISSION');
    let stream;
    try {
      stream = await this.deps.getUserMedia({ audio: true });
    } catch (err) {
      if (session !== this.sessionId) return false;
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      this.callbacks.onError({ code: denied ? 'PERMISSION_DENIED' : 'AUDIO_CAPTURE_ERROR', message: denied ? 'Microphone access was denied or is blocked' : 'No microphone was found or microphone is busy', originalError: err });
      this.callbacks.onStateChange('IDLE');
      return false;
    }
    if (session !== this.sessionId) {
      stream.getTracks?.().forEach((track) => track.stop());
      return false;
    }
    this.stream = stream;
    const Recorder = this.deps.MediaRecorder;
    const mimeType = pickRecordingMimeType(Recorder);
    this.mimeType = mimeType;
    this.chunks = [];
    this.recorder = new Recorder(stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (event) => {
      if (session === this.sessionId && event.data?.size) this.chunks.push(event.data);
    };
    this.recorder.onstop = () => this.finish(session);
    this.recorder.start();
    this.isListening = true;
    this.callbacks.onStateChange('LISTENING');
    this.limitTimer = this.deps.setTimeout(() => this.stop(), MAX_RECORDING_SECONDS * 1000);
    return true;
  }

  async finish(session) {
    this.releaseMic();
    if (session !== this.sessionId) return;
    this.isListening = false;
    const type = this.recorder?.mimeType || this.mimeType || 'audio/webm';
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    this.recorder = null;
    if (!blob.size) {
      this.callbacks.onError({ code: 'NO_SPEECH', message: 'No speech was detected' });
      this.callbacks.onStateChange('IDLE');
      this.callbacks.onEnd({ finalTranscript: '' });
      return;
    }
    this.callbacks.onStateChange('TRANSCRIBING');
    let text = '';
    try {
      text = String(await this.deps.transcribe(blob, this.lang)).trim();
    } catch (err) {
      if (session !== this.sessionId) return;
      this.callbacks.onError({ ...serverErrorFor(err), originalError: err });
      this.callbacks.onStateChange('IDLE');
      this.callbacks.onEnd({ finalTranscript: '' });
      return;
    }
    if (session !== this.sessionId) return;
    if (text) this.callbacks.onTranscript({ finalTranscript: text, interimTranscript: '', text });
    else this.callbacks.onError({ code: 'NO_SPEECH', message: 'No speech was detected' });
    this.callbacks.onStateChange('IDLE');
    this.callbacks.onEnd({ finalTranscript: text });
  }

  stop() {
    if (!this.isListening || !this.recorder) return;
    try {
      this.recorder.stop();
    } catch {
      this.abort();
    }
  }

  abort() {
    this.sessionId += 1;
    this.isListening = false;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      try {
        if (this.recorder.state !== 'inactive') this.recorder.stop();
      } catch {
        this.recorder = null;
      }
      this.recorder = null;
    }
    this.chunks = [];
    this.releaseMic();
    this.callbacks.onStateChange('IDLE');
  }

  destroy() {
    this.abort();
    this.callbacks = silentCallbacks();
  }
}

export class DictationAdapter {
  constructor(callbacks = {}, { engine = chooseSpeechEngine(), createWeb, createServer } = {}) {
    this.callbacks = { ...silentCallbacks(), ...callbacks };
    this.createWeb = createWeb || ((cb) => new WebSpeechAdapter(cb));
    this.createServer = createServer || ((cb) => new ServerWhisperAdapter(cb));
    this.engine = engine;
    this.inner = null;
    this.retried = false;
  }

  get isListening() {
    return Boolean(this.inner?.isListening);
  }

  get transcribeTimeoutMs() {
    return this.engine === 'server' ? SERVER_TRANSCRIBE_TIMEOUT_MS : undefined;
  }

  isSupported() {
    return this.engine === 'web' ? true : isServerTranscriptionSupported();
  }

  launch(options) {
    const relay = {};
    const adapter = (this.engine === 'web' ? this.createWeb : this.createServer)({
      onStateChange: (state) => relay.onStateChange(state),
      onTranscript: (payload) => relay.onTranscript(payload),
      onError: (payload) => relay.onError(payload),
      onEnd: (payload) => relay.onEnd(payload)
    });
    const current = () => this.inner === adapter;
    relay.onStateChange = (state) => { if (current()) this.callbacks.onStateChange(state); };
    relay.onTranscript = (payload) => { if (current()) this.callbacks.onTranscript(payload); };
    relay.onEnd = (payload) => { if (current()) this.callbacks.onEnd(payload); };
    relay.onError = (payload) => {
      if (!current()) return;
      if (this.engine === 'web' && payload?.code === 'NETWORK_ERROR' && !this.retried) {
        this.retried = true;
        this.engine = 'server';
        this.inner = null;
        adapter.destroy();
        this.launch(this.options);
        return;
      }
      this.callbacks.onError(payload);
    };
    this.inner = adapter;
    return adapter.start(options);
  }

  start(options = {}) {
    if (this.isListening) return false;
    this.options = options;
    this.retried = false;
    return this.launch(options);
  }

  stop() {
    this.inner?.stop();
  }

  abort() {
    this.inner?.abort();
  }

  destroy() {
    const inner = this.inner;
    this.inner = null;
    inner?.destroy();
    this.callbacks = silentCallbacks();
  }
}

export const createSpeechAdapter = (callbacks, options) => new DictationAdapter(callbacks, options);
