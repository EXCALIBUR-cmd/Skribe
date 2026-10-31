import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { usePreferences } from '../../context/PreferencesContext';
import { WebSpeechAdapter } from './speechRecognitionAdapter';
import {
  createDoubleTapDetector,
  insertIntoField,
  isInsertableField,
  nextQuickDictationState
} from './quickDictationLogic';

const MAX_RECORDING_SECONDS = 120;
const TRANSCRIBE_TIMEOUT_MS = 8000;
const ERROR_DISMISS_MS = 6000;
const ERROR_CODES = new Set(['PERMISSION_DENIED', 'AUDIO_CAPTURE_ERROR', 'NOT_SUPPORTED', 'NO_SPEECH', 'NETWORK_ERROR']);
const BAR_DELAYS = [0, 180, 360, 120, 300];

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const capsuleButton = `inline-flex items-center justify-center gap-1 min-h-9 px-3 rounded-full font-label text-xs font-bold cursor-pointer transition-colors ${focusRing}`;
const keepFocus = (event) => event.preventDefault();
const formatElapsed = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export const QuickDictation = () => {
  const { user } = useAuth();
  const { preferences, t } = usePreferences();
  const [state, setState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [errorCode, setErrorCode] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const stateRef = useRef('idle');
  const prefsRef = useRef(preferences);
  const sessionRef = useRef(null);
  const reviewRef = useRef(null);
  const lastFieldRef = useRef(null);

  prefsRef.current = preferences;

  const dispatch = useCallback((event) => {
    const next = nextQuickDictationState(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  const endSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    clearInterval(session.ticker);
    clearTimeout(session.transcribeTimer);
    session.adapter.destroy();
  }, []);

  const fail = useCallback((code) => {
    endSession();
    setErrorCode(ERROR_CODES.has(code) ? code : 'UNKNOWN');
    dispatch(code === 'NO_SPEECH' && stateRef.current === 'transcribing' ? 'empty' : 'fail');
  }, [dispatch, endSession]);

  const finish = useCallback((text) => {
    const session = sessionRef.current;
    if (!session || !['recording', 'transcribing'].includes(stateRef.current)) return;
    if (stateRef.current === 'recording') {
      session.stopFocus = document.activeElement;
      dispatch('stop');
    }
    const stopFocus = session.stopFocus;
    endSession();
    const clean = String(text || '').trim();
    if (!clean) {
      setErrorCode('NO_SPEECH');
      dispatch('empty');
      return;
    }
    const target = [document.activeElement, stopFocus].find((field) => isInsertableField(field));
    if (target && insertIntoField(target, clean)) {
      setTranscript('');
      dispatch('inserted');
      return;
    }
    setTranscript(clean);
    dispatch('review');
  }, [dispatch, endSession]);

  const start = useCallback(() => {
    if (!['idle', 'error'].includes(stateRef.current) || sessionRef.current) return;
    setErrorCode(null);
    setTranscript('');
    setElapsed(0);
    setCopied(false);
    const session = { text: '', stopFocus: null, ticker: null, transcribeTimer: null, adapter: null };
    session.adapter = new WebSpeechAdapter({
      onTranscript: ({ text }) => {
        if (sessionRef.current !== session) return;
        session.text = text;
        setTranscript(text);
      },
      onError: ({ code }) => {
        if (sessionRef.current !== session) return;
        if (code === 'NO_SPEECH') finish(session.text);
        else fail(code);
      },
      onEnd: ({ finalTranscript }) => {
        if (sessionRef.current !== session) return;
        finish(finalTranscript || session.text);
      }
    });
    sessionRef.current = session;
    dispatch('activate');
    session.ticker = setInterval(() => {
      setElapsed((value) => {
        if (value + 1 >= MAX_RECORDING_SECONDS) stopRef.current();
        return value + 1;
      });
    }, 1000);
    const started = session.adapter.start({ lang: prefsRef.current.language === 'hi' ? 'hi-IN' : 'en-US', continuous: true, interimResults: true });
    if (!started && sessionRef.current === session) fail('UNKNOWN');
  }, [dispatch, fail, finish]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session || stateRef.current !== 'recording') return;
    session.stopFocus = document.activeElement;
    clearInterval(session.ticker);
    dispatch('stop');
    if (!session.adapter.isListening) {
      finish(session.text);
      return;
    }
    session.transcribeTimer = setTimeout(() => finish(session.text), TRANSCRIBE_TIMEOUT_MS);
    session.adapter.stop();
  }, [dispatch, finish]);

  const cancel = useCallback(() => {
    if (!['recording', 'transcribing'].includes(stateRef.current)) return;
    endSession();
    setTranscript('');
    dispatch('cancel');
  }, [dispatch, endSession]);

  const stopRef = useRef(stop);
  stopRef.current = stop;
  const startRef = useRef(start);
  startRef.current = start;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  useEffect(() => {
    if (!user) return undefined;
    const detector = createDoubleTapDetector({ getInterval: () => prefsRef.current.quickDictationInterval });
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && ['recording', 'transcribing'].includes(stateRef.current)) {
        cancelRef.current();
        return;
      }
      detector.keyDown(event, event.timeStamp);
    };
    const handleKeyUp = (event) => {
      if (!detector.keyUp(event, event.timeStamp) || !prefsRef.current.quickDictation) return;
      if (stateRef.current === 'recording') stopRef.current();
      else startRef.current();
    };
    const handlePointer = () => detector.pointer();
    const handleFocusIn = (event) => {
      if (isInsertableField(event.target)) lastFieldRef.current = event.target;
    };
    const stopWhenAway = () => {
      detector.reset();
      if (stateRef.current === 'recording' && sessionRef.current?.adapter.isListening) stopRef.current();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') stopWhenAway();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('pointerdown', handlePointer, true);
    window.addEventListener('blur', stopWhenAway);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('pointerdown', handlePointer, true);
      window.removeEventListener('blur', stopWhenAway);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('visibilitychange', handleVisibility);
      cancelRef.current();
    };
  }, [user]);

  useEffect(() => () => endSession(), [endSession]);

  useEffect(() => {
    if (!preferences.quickDictation) cancel();
  }, [preferences.quickDictation, cancel]);

  useEffect(() => {
    if (state !== 'error') return undefined;
    const timer = setTimeout(() => dispatch('dismiss'), ERROR_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [state, dispatch]);

  useEffect(() => {
    if (state === 'review') reviewRef.current?.focus({ preventScroll: true });
  }, [state]);

  const closeReview = useCallback(() => {
    setTranscript('');
    dispatch('close');
  }, [dispatch]);

  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const insertLater = () => {
    const field = lastFieldRef.current;
    if (isInsertableField(field) && insertIntoField(field, transcript)) closeReview();
  };

  if (!user || state === 'idle') return null;

  const wrapper = 'fixed left-1/2 -translate-x-1/2 bottom-40 z-50 max-w-[calc(100vw-32px)] pointer-events-auto';

  if (state === 'review') {
    const canInsert = isInsertableField(lastFieldRef.current);
    return (
      <div
        role="dialog"
        aria-labelledby="quick-dictation-review-title"
        data-quick-dictation-review
        className={`${wrapper} w-[min(480px,calc(100vw-32px))] rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-xl`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            closeReview();
          }
        }}
      >
        <h2 id="quick-dictation-review-title" className="font-label text-sm font-bold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">mic</span>
          {t('quickDictation.reviewTitle')}
        </h2>
        <p className="mt-1 text-xs text-on-surface-variant">{t('quickDictation.reviewHint')}</p>
        <textarea
          ref={reviewRef}
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          rows={3}
          aria-label={t('quickDictation.reviewTitle')}
          className="mt-3 w-full resize-y rounded-[12px] border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary"
        />
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={copyTranscript} className={`${capsuleButton} bg-surface-container-high text-on-surface hover:bg-surface-container-highest`}>
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>
            {copied ? t('quickDictation.copied') : t('quickDictation.copy')}
          </button>
          {canInsert && (
            <button type="button" onClick={insertLater} className={`${capsuleButton} bg-surface-container-high text-on-surface hover:bg-surface-container-highest`}>
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">input</span>
              {t('quickDictation.insert')}
            </button>
          )}
          <button type="button" onClick={closeReview} className={`${capsuleButton} bg-primary text-on-primary hover:bg-primary/90`}>
            {t('quickDictation.close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-quick-dictation-capsule className={`${wrapper} flex items-center gap-3 rounded-full border border-outline-variant bg-surface-container-lowest/95 py-2 pl-3 pr-2 shadow-xl backdrop-blur`}>
      {state === 'recording' && (
        <>
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-error text-on-error">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">mic</span>
          </span>
          <span className="flex h-6 items-center gap-[3px]" aria-hidden="true">
            {BAR_DELAYS.map((delay, index) => (
              <span key={index} className="w-[3px] rounded-full bg-error animate-pulse" style={{ height: `${10 + ((index * 7) % 14)}px`, animationDelay: `${delay}ms` }} />
            ))}
          </span>
          <span role="status" className="flex min-w-0 flex-col">
            <span className="font-label text-xs font-bold text-on-surface">
              {t('quickDictation.recording')} <span className="tabular-nums text-on-surface-variant">{formatElapsed(elapsed)}</span>
            </span>
            <span className="max-w-[220px] truncate text-xs text-on-surface-variant">{transcript || t('quickDictation.recordingHint')}</span>
          </span>
          <button type="button" onMouseDown={keepFocus} onClick={stop} className={`${capsuleButton} bg-primary text-on-primary hover:bg-primary/90`}>
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">stop</span>
            {t('quickDictation.stop')}
          </button>
          <button type="button" onMouseDown={keepFocus} onClick={cancel} aria-label={t('quickDictation.cancel')} title={t('quickDictation.cancel')} className={`${capsuleButton} w-9 px-0 text-on-surface-variant hover:bg-surface-container-high`}>
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
          </button>
        </>
      )}
      {state === 'transcribing' && (
        <span role="status" className="flex items-center gap-2 pr-2 font-label text-xs font-bold text-on-surface">
          <span className="material-symbols-outlined text-[18px] text-primary animate-spin" aria-hidden="true">progress_activity</span>
          {t('quickDictation.transcribing')}
        </span>
      )}
      {state === 'error' && (
        <>
          <span role="alert" className="flex items-center gap-2 font-label text-xs font-bold text-on-surface">
            <span className="material-symbols-outlined text-[18px] text-error" aria-hidden="true">mic_off</span>
            {t(`quickDictation.error.${errorCode || 'UNKNOWN'}`)}
          </span>
          <button type="button" onClick={() => dispatch('dismiss')} className={`${capsuleButton} text-on-surface-variant hover:bg-surface-container-high`}>
            {t('quickDictation.dismiss')}
          </button>
        </>
      )}
    </div>
  );
};

export const MicrophoneStatus = () => {
  const { t } = usePreferences();
  const [status, setStatus] = useState('unknown');

  useEffect(() => {
    let permission = null;
    let active = true;
    const update = () => active && setStatus(permission?.state || 'unknown');
    navigator.permissions?.query({ name: 'microphone' }).then((result) => {
      permission = result;
      update();
      permission.addEventListener('change', update);
    }).catch(() => {});
    return () => {
      active = false;
      permission?.removeEventListener('change', update);
    };
  }, []);

  return <p className="font-label text-sm font-bold text-on-surface">{t(`quickDictation.mic.${status}`)}</p>;
};

export default QuickDictation;
