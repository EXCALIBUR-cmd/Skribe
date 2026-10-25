import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { WebSpeechAdapter, isSpeechRecognitionSupported, getSpeechProcessingDisclosure } from './speechRecognitionAdapter.js';
import { describeVoiceCommand } from './voiceCommands.js';

const COMMAND_RESULT_STYLES = {
  running: { icon: 'hourglass_top', className: 'bg-primary/5 border-primary/20 text-on-surface' },
  executed: { icon: 'check_circle', className: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200' },
  clarify: { icon: 'help', className: 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200' },
  rejected: { icon: 'block', className: 'bg-error-container/40 border-error/30 text-error' },
  error: { icon: 'cloud_off', className: 'bg-error-container/40 border-error/30 text-error' },
  cancelled: { icon: 'cancel', className: 'bg-surface-container-high border-outline-variant text-on-surface-variant' }
};

export const VoiceDictationModal = ({
  isOpen,
  onClose,
  onInsert,
  onCommand = null,
  onConfirmCommand = null,
  adapter = null,
  initialText = ''
}) => {
  const [dictationState, setDictationState] = useState('IDLE');
  const [transcript, setTranscript] = useState(initialText);
  const [interimText, setInterimText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isInserting, setIsInserting] = useState(false);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const [mode, setMode] = useState('dictation');
  const [commandResult, setCommandResult] = useState(null);
  const [isRunningCommand, setIsRunningCommand] = useState(false);

  const commandAbortRef = useRef(null);
  const adapterRef = useRef(null);
  const textareaRef = useRef(null);
  const disclosure = getSpeechProcessingDisclosure();
  const supported = isSpeechRecognitionSupported();

  const handleStateChange = useCallback((newState) => {
    setDictationState(newState);
  }, []);

  const hasUserEditedRef = useRef(false);
  hasUserEditedRef.current = hasUserEdited;

  const handleTranscript = useCallback(({ finalTranscript, interimTranscript, text }) => {
    setInterimText(interimTranscript);
    if (!hasUserEditedRef.current) {
      setTranscript(text || finalTranscript);
    }
  }, []);

  const handleError = useCallback(({ code, message }) => {
    setErrorMessage(message || 'An error occurred during speech recognition');
    setDictationState('ERROR');
  }, []);

  const handleEnd = useCallback(() => {
    setInterimText('');
    setDictationState((prev) => (prev === 'LISTENING' ? 'REVIEW' : prev));
  }, []);

  useEffect(() => {
    if (!isOpen) {
      if (adapterRef.current) {
        adapterRef.current.abort();
      }
      if (commandAbortRef.current) {
        commandAbortRef.current.abort();
        commandAbortRef.current = null;
      }
      setDictationState('IDLE');
      setInterimText('');
      setErrorMessage('');
      setIsInserting(false);
      setHasUserEdited(false);
      setMode('dictation');
      setCommandResult(null);
      setIsRunningCommand(false);
      return;
    }

    setTranscript(initialText);
    setHasUserEdited(false);
    setErrorMessage('');
    setIsInserting(false);

    if (adapter) {
      adapterRef.current = adapter;
      adapterRef.current.callbacks = {
        onStateChange: handleStateChange,
        onTranscript: handleTranscript,
        onError: handleError,
        onEnd: handleEnd
      };
    } else {
      adapterRef.current = new WebSpeechAdapter({
        onStateChange: handleStateChange,
        onTranscript: handleTranscript,
        onError: handleError,
        onEnd: handleEnd
      });
    }

    if (!adapterRef.current.isSupported()) {
      setDictationState('UNSUPPORTED');
    } else {
      setDictationState('IDLE');
    }

    return () => {
      if (adapterRef.current) {
        adapterRef.current.destroy();
        adapterRef.current = null;
      }
    };
  }, [isOpen, adapter, initialText, handleStateChange, handleTranscript, handleError, handleEnd]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleStartListening = () => {
    setErrorMessage('');
    setInterimText('');
    setHasUserEdited(false);
    if (adapterRef.current) {
      adapterRef.current.start();
    }
  };

  const handleStopListening = () => {
    if (adapterRef.current) {
      adapterRef.current.stop();
    }
    setInterimText('');
    setDictationState('REVIEW');
  };

  const handleTextChange = (e) => {
    setTranscript(e.target.value);
    setHasUserEdited(true);
  };

  const handleCancel = () => {
    if (adapterRef.current) {
      adapterRef.current.abort();
    }
    if (commandAbortRef.current) {
      commandAbortRef.current.abort();
      commandAbortRef.current = null;
    }
    setInterimText('');
    setDictationState('IDLE');
    onClose();
  };

  const handleInsert = async () => {
    const textToInsert = transcript.trim();
    if (!textToInsert || isInserting) return;

    if (adapterRef.current) {
      adapterRef.current.abort();
    }

    setIsInserting(true);
    try {
      const result = await onInsert(textToInsert);
      if (result && result.success === false) {
        setErrorMessage(result.reason || 'Failed to insert text onto canvas');
        setIsInserting(false);
        return;
      }
      onClose();
    } catch (err) {
      setErrorMessage(err?.message || 'Error inserting text');
      setIsInserting(false);
    }
  };

  const handleClear = () => {
    setTranscript('');
    setInterimText('');
    setHasUserEdited(true);
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === mode || isInserting || isRunningCommand) return;
    setMode(nextMode);
    setCommandResult(null);
  };

  const finishCommand = (result) => {
    setIsRunningCommand(false);
    setCommandResult(result || { status: 'error', message: 'The voice command failed. No changes were made.' });
    if (result?.status === 'executed') {
      setTranscript('');
      setHasUserEdited(false);
    }
  };

  const handleRunCommand = async () => {
    const instruction = transcript.trim();
    if (!instruction || isRunningCommand || typeof onCommand !== 'function') return;

    if (adapterRef.current) {
      adapterRef.current.abort();
    }

    const controller = new AbortController();
    commandAbortRef.current = controller;
    setIsRunningCommand(true);
    setCommandResult({ status: 'running', message: 'Interpreting your instruction…' });

    let result;
    try {
      result = await onCommand(instruction, { signal: controller.signal });
    } catch (err) {
      result = { status: 'error', message: err?.message || 'The voice command failed. No changes were made.' };
    }

    if (commandAbortRef.current !== controller || controller.signal.aborted) return;
    commandAbortRef.current = null;
    finishCommand(result);
  };

  const handleConfirmProposal = async () => {
    const proposal = commandResult?.proposal;
    if (!proposal || isRunningCommand || typeof onConfirmCommand !== 'function') return;

    setIsRunningCommand(true);
    let result;
    try {
      result = await onConfirmCommand(proposal);
    } catch (err) {
      result = { status: 'error', message: err?.message || 'The voice command failed. No changes were made.' };
    }
    finishCommand(result);
  };

  if (!isOpen) return null;

  const isListening = dictationState === 'LISTENING';
  const isRequesting = dictationState === 'REQUESTING_PERMISSION';
  const isUnsupported = dictationState === 'UNSUPPORTED';
  const isError = dictationState === 'ERROR';
  const canInsert = Boolean(transcript.trim()) && !isInserting;
  const commandsAvailable = typeof onCommand === 'function';
  const isCommandMode = commandsAvailable && mode === 'command';
  const canRunCommand = Boolean(transcript.trim()) && !isRunningCommand;
  const commandStyle = commandResult ? (COMMAND_RESULT_STYLES[commandResult.status] || COMMAND_RESULT_STYLES.error) : null;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 select-none pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-dictation-title"
    >
      <div className="relative w-full max-w-lg bg-surface border border-outline-variant/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-on-surface animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/60 bg-surface-container-low">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              isListening
                ? 'bg-red-500/10 text-red-600 animate-pulse'
                : 'bg-primary/10 text-primary'
            }`}>
              <span className="material-symbols-outlined text-xl">
                {isListening ? 'mic' : 'mic_none'}
              </span>
            </div>
            <div>
              <h2 id="voice-dictation-title" className="text-base font-bold font-headline leading-tight">
                {isCommandMode ? 'Voice Command' : 'Voice Dictation'}
              </h2>
              <span className="text-[11px] font-medium text-on-surface-variant">
                {isListening
                  ? 'Listening... Speak into your microphone'
                  : isRequesting
                  ? 'Requesting microphone permission...'
                  : isUnsupported
                  ? 'Speech recognition unavailable — manual entry mode'
                  : isError
                  ? 'Recognition paused'
                  : isCommandMode
                  ? 'Say what to create, then run the command'
                  : 'Speak or edit text, then insert to canvas'}
              </span>
            </div>
          </div>

          <button
            onClick={handleCancel}
            className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors cursor-pointer"
            aria-label="Close voice dictation"
            title="Close (Esc)"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          {commandsAvailable && (
            <div
              role="radiogroup"
              aria-label="Voice mode"
              className="self-center inline-flex items-center gap-1 p-1 rounded-full bg-surface-container-high border border-outline-variant/60"
            >
              {[
                { id: 'dictation', label: 'Dictation', icon: 'notes' },
                { id: 'command', label: 'Command', icon: 'auto_awesome' }
              ].map((option) => {
                const isActive = (option.id === 'command') === isCommandMode;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => handleModeChange(option.id)}
                    disabled={isInserting || isRunningCommand}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-primary text-on-primary shadow-xs'
                        : 'text-on-surface-variant hover:bg-surface-container-highest'
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">{option.icon}</span>
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-col items-center justify-center py-2">
            {!isUnsupported ? (
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={isListening ? handleStopListening : handleStartListening}
                  disabled={isRequesting || isInserting}
                  className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-md cursor-pointer ${
                    isListening
                      ? 'bg-red-500 text-white ring-8 ring-red-500/20 scale-105 active:scale-95'
                      : isRequesting
                      ? 'bg-primary/60 text-white animate-pulse cursor-wait'
                      : 'bg-primary text-on-primary hover:scale-105 hover:shadow-lg active:scale-95'
                  }`}
                  aria-label={isListening ? 'Stop recording dictation' : 'Start recording dictation'}
                  title={isListening ? 'Click to stop dictation' : 'Click to start dictation'}
                >
                  <span className="material-symbols-outlined text-3xl">
                    {isListening ? 'stop' : isRequesting ? 'hourglass_top' : 'mic'}
                  </span>
                </button>
                <span className="text-xs font-semibold text-on-surface-variant">
                  {isListening ? 'Click to Stop Dictating' : 'Click to Speak'}
                </span>
              </div>
            ) : null}
          </div>

          {isError && errorMessage && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-error-container/40 border border-error/30 text-error text-xs">
              <span className="material-symbols-outlined text-base shrink-0 mt-0.5">error</span>
              <div className="flex-1 leading-relaxed">{errorMessage}</div>
              <button
                type="button"
                onClick={handleStartListening}
                className="font-bold underline hover:no-underline text-xs shrink-0 cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {isUnsupported && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs">
              <span className="material-symbols-outlined text-base shrink-0 mt-0.5">info</span>
              <div className="leading-relaxed">
                Speech recognition is not supported in this browser. You can type or paste text manually into the editor below and insert it onto the canvas.
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-on-surface-variant">
              <label htmlFor="voice-transcript-editor" className="font-semibold">
                {isCommandMode ? 'Instruction' : 'Transcript & Text Review'}
              </label>
              <div className="flex items-center gap-3">
                {transcript && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="hover:text-primary transition-colors cursor-pointer text-[11px]"
                    title="Clear text"
                  >
                    Clear
                  </button>
                )}
                <span className="font-mono text-[11px]">
                  {transcript.length} chars • {transcript.trim() ? transcript.trim().split(/\s+/).length : 0} words
                </span>
              </div>
            </div>

            <div className="relative">
              <textarea
                id="voice-transcript-editor"
                ref={textareaRef}
                value={transcript}
                onChange={handleTextChange}
                placeholder={isListening
                  ? 'Listening for speech...'
                  : isCommandMode
                  ? 'Try “add a sticky note that says buy milk” or “add a circle labeled start”'
                  : 'Recognized speech will appear here. You can also type or edit text directly...'}
                rows={5}
                className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm font-sans text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all resize-none"
              />

              {interimText && (
                <div className="absolute bottom-2.5 left-3.5 right-3.5 text-xs text-primary font-medium italic truncate pointer-events-none bg-surface/80 px-1 py-0.5 rounded">
                  {interimText}...
                </div>
              )}
            </div>

            {isCommandMode && (
              <p className="text-[11px] text-on-surface-variant leading-relaxed px-1">
                Supported: text, sticky notes, and rectangles, rounded rectangles, circles, triangles, diamonds or hexagons with an optional label. New objects appear in your current view.
              </p>
            )}
          </div>

          {isCommandMode && commandResult && commandStyle && (
            <div
              data-testid="voice-command-result"
              data-status={commandResult.status}
              role={commandResult.status === 'running' ? 'status' : 'alert'}
              className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs ${commandStyle.className}`}
            >
              <span className={`material-symbols-outlined text-base shrink-0 mt-0.5 ${commandResult.status === 'running' ? 'animate-pulse' : ''}`}>
                {commandStyle.icon}
              </span>
              <div className="flex-1 flex flex-col gap-1.5 leading-relaxed">
                <span className="font-semibold">
                  {commandResult.status === 'executed' ? commandResult.summary : commandResult.message}
                </span>
                {commandResult.status === 'clarify' && commandResult.proposal && (
                  <div className="flex items-center justify-between gap-3">
                    <span>Suggested: {describeVoiceCommand(commandResult.proposal)}</span>
                    <button
                      type="button"
                      onClick={handleConfirmProposal}
                      disabled={isRunningCommand}
                      className="shrink-0 px-3 py-1 rounded-full bg-primary text-on-primary font-bold hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Create it
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="text-[11px] text-on-surface-variant/75 flex items-center justify-between px-1">
            <span title={disclosure.details}>
              Processing: {disclosure.provider} ({disclosure.processingLocation})
              {isCommandMode ? ' • Commands: Groq via Skribe server' : ''}
            </span>
            <span className="text-[10px] text-on-surface-variant/60">
              Esc to cancel
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-6 py-3.5 bg-surface-container-low border-t border-outline-variant/60">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 rounded-full text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            Cancel
          </button>

          {isCommandMode ? (
            <button
              type="button"
              onClick={handleRunCommand}
              disabled={!canRunCommand}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-bold transition-all shadow-xs cursor-pointer ${
                canRunCommand
                  ? 'bg-primary text-on-primary hover:bg-primary/90 hover:scale-102 active:scale-98'
                  : 'bg-outline-variant/40 text-on-surface-variant/40 cursor-not-allowed shadow-none'
              }`}
            >
              <span className="material-symbols-outlined text-base">
                {isRunningCommand ? 'hourglass_bottom' : 'auto_awesome'}
              </span>
              <span>{isRunningCommand ? 'Interpreting...' : 'Run Command'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleInsert}
              disabled={!canInsert}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-bold transition-all shadow-xs cursor-pointer ${
                canInsert
                  ? 'bg-primary text-on-primary hover:bg-primary/90 hover:scale-102 active:scale-98'
                  : 'bg-outline-variant/40 text-on-surface-variant/40 cursor-not-allowed shadow-none'
              }`}
            >
              <span className="material-symbols-outlined text-base">
                {isInserting ? 'hourglass_bottom' : 'add'}
              </span>
              <span>{isInserting ? 'Inserting...' : 'Insert into Canvas'}</span>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default VoiceDictationModal;
