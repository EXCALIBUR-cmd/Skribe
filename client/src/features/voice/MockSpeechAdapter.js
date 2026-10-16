export class MockSpeechAdapter {
  constructor(callbacks = {}) {
    this.callbacks = {
      onStateChange: () => {},
      onTranscript: () => {},
      onError: () => {},
      onEnd: () => {},
      ...callbacks
    };
    this.supported = true;
    this.isListening = false;
    this.sessionId = 0;
    this.finalTranscript = '';
    this.interimTranscript = '';
  }

  isSupported() {
    return this.supported;
  }

  setSupported(val) {
    this.supported = Boolean(val);
  }

  start(options = {}) {
    if (this.isListening) {
      return false;
    }

    if (!this.supported) {
      this.callbacks.onError({
        code: 'NOT_SUPPORTED',
        message: 'Speech recognition is not supported in this browser'
      });
      return false;
    }

    this.sessionId += 1;
    this.isListening = true;
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.callbacks.onStateChange('LISTENING');
    return true;
  }

  simulateTranscript({ text = '', isFinal = false }) {
    if (!this.isListening) return;

    if (isFinal) {
      this.finalTranscript = this.finalTranscript
        ? `${this.finalTranscript.trim()} ${text.trim()}`
        : text.trim();
      this.interimTranscript = '';
    } else {
      this.interimTranscript = text;
    }

    const combined = this.interimTranscript
      ? (this.finalTranscript ? `${this.finalTranscript} ${this.interimTranscript}` : this.interimTranscript)
      : this.finalTranscript;

    this.callbacks.onTranscript({
      finalTranscript: this.finalTranscript,
      interimTranscript: this.interimTranscript,
      text: combined
    });
  }

  simulateError(code = 'UNKNOWN_ERROR', message = 'Simulated error') {
    if (!this.isListening) return;
    this.isListening = false;
    this.callbacks.onError({
      code,
      message
    });
  }

  stop() {
    if (!this.isListening) return;
    this.isListening = false;
    this.callbacks.onStateChange('IDLE');
    this.callbacks.onEnd({
      finalTranscript: this.finalTranscript
    });
  }

  abort() {
    this.sessionId += 1;
    this.isListening = false;
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
