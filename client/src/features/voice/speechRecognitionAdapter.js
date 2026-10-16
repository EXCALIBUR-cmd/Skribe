const getSpeechRecognitionClass = () => {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

export const isSpeechRecognitionSupported = () => {
  return Boolean(getSpeechRecognitionClass());
};

export const getSpeechProcessingDisclosure = () => {
  return {
    provider: 'Web Speech API',
    isLocal: false,
    processingLocation: 'browser-vendor-service',
    details: 'Chromium browsers process audio via vendor cloud endpoints unless local OS speech packs are installed.'
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
