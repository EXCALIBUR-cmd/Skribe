import React, { useEffect, useRef, useState } from 'react';
import AIPanelWrapper from '../ui/AIPanelWrapper';
import apiClient from '../../api/apiClient';
import { canApplyResult, getAssistantAction } from '../../features/aiAssistant/assistantActions';
import { renderMermaid } from '../../features/aiAssistant/mermaidRenderer';

const BUTTON = 'inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-[12px] font-label text-sm font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const PRIMARY = `${BUTTON} bg-primary text-on-primary hover:bg-primary/90`;
const SECONDARY = `${BUTTON} bg-surface-container-high text-on-surface hover:bg-surface-container-highest`;

export const AIAssistantPanel = ({ actionId, onClose, getBoardContext, onApply }) => {
  const action = getAssistantAction(actionId);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState(null);
  const requestRef = useRef({ seq: 0, controller: null });
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    const request = requestRef.current;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      request.seq += 1;
      request.controller?.abort();
    };
  }, [onClose]);

  if (!action) return null;

  const isLoading = status === 'loading';
  const canSubmit = !isLoading && (!action.needsPrompt || prompt.trim().length > 0);

  const generate = async () => {
    if (!canSubmit) return;
    const request = requestRef.current;
    request.controller?.abort();
    const controller = new AbortController();
    const seq = request.seq + 1;
    request.seq = seq;
    request.controller = controller;
    setStatus('loading');
    setErrorMessage('');
    try {
      const res = await apiClient.post('/ai-assistant/generate', { action: action.id, prompt: prompt.trim(), board: getBoardContext() }, { signal: controller.signal });
      if (request.seq !== seq) return;
      const data = res?.data?.result;
      if (!data) throw new Error('The AI Assistant returned no result.');
      const image = action.kind === 'diagram' ? await renderMermaid(data.source) : null;
      if (request.seq !== seq) return;
      setResult({ ...data, image });
      setStatus('ready');
    } catch (err) {
      if (request.seq !== seq || controller.signal.aborted) return;
      setErrorMessage(err?.message || 'The AI Assistant failed. Nothing was changed.');
      setStatus('error');
    }
  };

  const apply = () => {
    if (!result || !canApplyResult(action.id)) return;
    onApply(action.id, action.kind === 'diagram'
      ? { image: result.image, meta: { kind: 'mermaid', title: result.title, diagramType: result.diagramType, source: result.source } }
      : { points: result.points });
    onClose();
  };

  const applyLabel = action.kind === 'diagram' ? 'Insert into canvas' : `Add ${result?.points?.length || ''} sticky notes`;

  return (
    <div
      role="dialog"
      aria-label={action.label}
      data-ai-assistant-panel
      className="fixed z-50 right-4 top-32 w-[min(440px,calc(100vw-32px))] max-h-[calc(100dvh-240px)] overflow-y-auto pointer-events-auto rounded-xl"
    >
      <AIPanelWrapper title={action.label} icon={action.kind === 'diagram' ? 'schema' : 'psychology'}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            generate();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              {action.needsPrompt ? 'Request' : 'Focus (optional)'}
            </span>
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  generate();
                }
              }}
              maxLength={1000}
              rows={3}
              placeholder={action.placeholder}
              className="w-full resize-y rounded-[12px] border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-2 focus:outline-primary"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={PRIMARY} disabled={!canSubmit} aria-busy={isLoading}>
              <span className={`material-symbols-outlined text-[18px] ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true">{isLoading ? 'progress_activity' : result ? 'refresh' : 'auto_awesome'}</span>
              {isLoading ? 'Generating…' : result ? 'Regenerate' : 'Generate'}
            </button>
            <button type="button" className={SECONDARY} onClick={onClose}>Close</button>
          </div>
        </form>

        <div aria-live="polite" className="mt-3 flex flex-col gap-3">
          {status === 'error' && (
            <p role="alert" className="rounded-[12px] bg-error-container px-3 py-2 text-sm text-on-error-container">{errorMessage}</p>
          )}
          {result && (
            <section className={`flex flex-col gap-2 ${isLoading ? 'opacity-60' : ''}`}>
              <h3 className="font-headline text-base font-bold text-on-surface">{result.title}</h3>
              {result.description && <p className="text-sm text-on-surface-variant">{result.description}</p>}
              {result.image ? (
                <div className="max-h-[360px] overflow-auto rounded-[12px] border border-outline-variant bg-white p-2">
                  <img src={result.image.dataUrl} alt={`${result.title} diagram preview`} width={result.image.width} height={result.image.height} className="max-w-full h-auto mx-auto" />
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5 list-disc pl-5 text-sm text-on-surface">
                  {result.points.map((point, index) => <li key={index}>{point}</li>)}
                </ul>
              )}
              {canApplyResult(action.id) && (
                <button type="button" className={PRIMARY} onClick={apply} disabled={isLoading}>
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add_to_photos</span>
                  {applyLabel}
                </button>
              )}
            </section>
          )}
        </div>
      </AIPanelWrapper>
    </div>
  );
};

export default AIAssistantPanel;
