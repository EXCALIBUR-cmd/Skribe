import React, { useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useT } from '../../context/PreferencesContext';
import { checkProposal, countNewObjects, describeAction, isSupportedAction } from '../../features/sidekick/sidekickPlan';
import { getSidekickSuggestions } from '../../features/sidekick/sidekickSuggestions';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const CHIP = `rounded-full border border-outline-variant bg-surface px-3 py-1.5 text-left text-xs font-semibold text-on-surface hover:border-primary hover:bg-surface-container-high cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const ICON_BUTTON = `flex h-9 w-9 items-center justify-center rounded-[10px] text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;

let nextMessageId = 0;
const newId = () => {
  nextMessageId += 1;
  return `m${nextMessageId}`;
};

const toHistory = (messages) => messages
  .filter((message) => message.role === 'user' || message.response)
  .slice(-8)
  .map((message) => (message.role === 'user'
    ? { role: 'user', content: message.text }
    : { role: 'assistant', content: [message.response.message, ...message.response.sections.flatMap((section) => [section.heading, ...section.points])].filter(Boolean).join(' • ') }));

const ProposalCard = ({ message, onApply, onCancel, busy }) => {
  const t = useT();
  const { proposal } = message;
  const sourceCount = new Set(proposal.actions.flatMap((action) => action.sourceObjectIds || [])).size;
  const newCount = proposal.actions.reduce((sum, action) => sum + countNewObjects(action), 0);
  const waiting = proposal.actions.some((action) => action.action === 'create_diagram' && !action.prepared && !action.prepareError);
  const blocked = proposal.actions.some((action) => action.action === 'create_diagram' && action.prepareError);
  const settled = proposal.status !== 'pending';

  return (
    <section aria-label={t('sidekick.proposalTitle')} className="mt-2 rounded-[12px] border-2 border-dashed border-primary/60 bg-surface p-3">
      <div className="flex items-center gap-1.5 text-primary">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">pending_actions</span>
        <h4 className="font-label text-xs font-bold uppercase tracking-wider">{t('sidekick.proposalTitle')}</h4>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {proposal.actions.map((action, index) => {
          const info = describeAction(action);
          if (!info) return null;
          return (
            <li key={index} className="rounded-[10px] bg-surface-container-low p-2">
              <p className="flex items-start gap-1.5 text-sm font-semibold text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-secondary" aria-hidden="true">{info.icon}</span>
                <span>{t(info.key, info.vars)}</span>
              </p>
              {info.details.length > 0 && (
                <ul className="mt-1 ml-6 list-disc text-xs text-on-surface-variant">
                  {info.details.slice(0, 8).map((detail, detailIndex) => <li key={detailIndex} className="break-words">{detail}</li>)}
                </ul>
              )}
              {action.action === 'create_diagram' && (
                <div className="mt-2 ml-6">
                  {action.prepared?.image && (
                    <img src={action.prepared.image.dataUrl} alt={action.prepared.meta.title} className="max-h-48 w-full rounded-[8px] border border-outline-variant bg-white object-contain" />
                  )}
                  {!action.prepared && !action.prepareError && <p className="text-xs text-on-surface-variant" role="status">{t('sidekick.preparingDiagram')}</p>}
                  {action.prepareError && <p className="text-xs text-error" role="alert">{t('sidekick.diagramFailed')}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-on-surface-variant">
        {sourceCount > 0 && <span>{t('sidekick.basedOn', { count: sourceCount })} · </span>}
        {newCount > 0 && <span>{t('sidekick.newObjects', { count: newCount })} · </span>}
        <span className="font-semibold">{t('sidekick.proposalNote')}</span>
      </p>
      {!settled ? (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => onApply(message.id)} disabled={busy || waiting || blocked} className={`flex-1 min-h-10 rounded-[10px] bg-primary px-3 font-label text-sm font-bold text-on-primary hover:bg-primary/90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`}>
            {t('sidekick.apply')}
          </button>
          <button type="button" onClick={() => onCancel(message.id)} disabled={busy} className={`flex-1 min-h-10 rounded-[10px] bg-surface-container-high px-3 font-label text-sm font-bold text-on-surface hover:bg-surface-container-highest cursor-pointer disabled:opacity-50 ${FOCUS}`}>
            {t('sidekick.cancel')}
          </button>
        </div>
      ) : (
        <p role="status" className={`mt-3 rounded-[10px] px-3 py-2 text-xs font-semibold ${proposal.status === 'applied' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'}`}>
          {proposal.status === 'applying' ? t('sidekick.applying') : proposal.outcome}
        </p>
      )}
    </section>
  );
};

const AssistantMessage = ({ message, onFollowUp, onApply, onCancel, busy }) => {
  const t = useT();
  if (message.error) {
    return <p role="alert" className="rounded-[12px] bg-error-container px-3 py-2 text-sm text-on-error-container">{message.error}</p>;
  }
  const { response, context } = message;
  return (
    <div className="rounded-[12px] border border-outline-variant bg-surface-container-low p-3">
      <p className="text-sm text-on-surface">{response.message}</p>
      {response.sections.map((section, index) => (
        <div key={index} className="mt-2">
          {section.heading && <h4 className="font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">{section.heading}</h4>}
          {section.points.length > 0 && (
            <ul className="mt-1 ml-4 list-disc text-sm text-on-surface">
              {section.points.map((point, pointIndex) => <li key={pointIndex} className="break-words">{point}</li>)}
            </ul>
          )}
        </div>
      ))}
      {context?.truncated && <p className="mt-2 text-xs text-on-surface-variant">{t('sidekick.truncated', { included: context.includedCount, total: context.objectCount })}</p>}
      {response.rejectedActions > 0 && <p className="mt-2 text-xs text-on-surface-variant">{t('sidekick.rejected', { count: response.rejectedActions })}</p>}
      {message.proposal && <ProposalCard message={message} onApply={onApply} onCancel={onCancel} busy={busy} />}
      {response.followUps.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <span className="font-label text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{t('sidekick.followUps')}</span>
          <div className="flex flex-wrap gap-1.5">
            {response.followUps.map((followUp) => (
              <button key={followUp} type="button" onClick={() => onFollowUp(followUp)} disabled={busy} className={CHIP}>{followUp}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const SidekickPanel = ({ boardId, onClose, getSnapshot, flushBoard, prepareDiagram, applyProposal }) => {
  const t = useT();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const snapshot = getSnapshot();
  const suggestions = useMemo(() => getSidekickSuggestions(snapshot.scopeObjects).keys, [snapshot.scopeObjects]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    return () => controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const updateMessage = (id, update) => setMessages((current) => current.map((message) => (message.id === id ? update(message) : message)));

  const prepareDiagrams = (messageId, actions) => {
    actions.forEach((action, index) => {
      if (action.action !== 'create_diagram') return;
      prepareDiagram(action.diagramPrompt)
        .then((prepared) => updateMessage(messageId, (message) => {
          const next = message.proposal.actions.slice();
          next[index] = { ...next[index], prepared };
          return { ...message, proposal: { ...message.proposal, actions: next } };
        }))
        .catch(() => updateMessage(messageId, (message) => {
          const next = message.proposal.actions.slice();
          next[index] = { ...next[index], prepareError: true };
          return { ...message, proposal: { ...message.proposal, actions: next } };
        }));
    });
  };

  const send = async (raw) => {
    const text = raw.trim();
    if (!text || busy) return;
    const history = toHistory(messages);
    setMessages((current) => [...current, { id: newId(), role: 'user', text }]);
    setInput('');
    setBusy(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const saved = await flushBoard();
      if (!saved?.ok) throw new Error(t('sidekick.saveFailed'));
      const { selectedIds } = getSnapshot();
      const res = await apiClient.post('/sidekick/chat', { boardId, message: text, selectedObjectIds: selectedIds, history }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const { response, context } = res.data;
      const actions = response.actions.filter(isSupportedAction);
      const id = newId();
      setMessages((current) => [...current, { id, role: 'assistant', response, context, proposal: actions.length ? { boardId, actions, contextIds: context.objectIds || [], status: 'pending' } : null }]);
      if (actions.length) prepareDiagrams(id, actions);
    } catch (err) {
      if (controller.signal.aborted) return;
      setMessages((current) => [...current, { id: newId(), role: 'assistant', error: err?.message || t('sidekick.error') }]);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  };

  const apply = async (messageId) => {
    const message = messages.find((item) => item.id === messageId);
    if (!message?.proposal || message.proposal.status !== 'pending') return;
    const check = checkProposal(message.proposal, { boardId, objectIds: getSnapshot().objectIds });
    if (!check.ok) {
      updateMessage(messageId, (item) => ({ ...item, proposal: { ...item.proposal, status: 'stale', outcome: t('sidekick.stale') } }));
      return;
    }
    updateMessage(messageId, (item) => ({ ...item, proposal: { ...item.proposal, status: 'applying' } }));
    const result = await applyProposal(message.proposal);
    const outcome = result.handedOff && !result.created
      ? t('sidekick.handedOff')
      : result.failed
        ? t('sidekick.appliedPartial', { count: result.created, failed: result.failed })
        : [t('sidekick.applied', { count: result.created }), result.handedOff ? t('sidekick.handedOff') : ''].filter(Boolean).join(' ');
    updateMessage(messageId, (item) => ({ ...item, proposal: { ...item.proposal, status: result.created || result.handedOff ? 'applied' : 'failed', outcome } }));
  };

  const cancel = (messageId) => updateMessage(messageId, (item) => ({ ...item, proposal: { ...item.proposal, status: 'cancelled', outcome: t('sidekick.cancelled') } }));

  const reset = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  };

  const contextLabel = snapshot.selectedIds.length
    ? t('sidekick.contextSelection', { count: snapshot.selectionCount })
    : snapshot.objectCount ? t('sidekick.contextBoard', { count: snapshot.objectCount }) : t('sidekick.contextEmpty');

  return (
    <aside
      aria-label={t('sidekick.title')}
      data-sidekick-panel
      className="fixed right-4 top-[132px] bottom-24 z-40 flex w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border-2 border-secondary bg-surface sticker-shadow"
    >
      <header className="flex items-center gap-2 border-b-2 border-surface-container bg-surface-container-low px-3 py-2.5">
        <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">auto_awesome</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-headline text-base font-bold text-on-surface">{t('sidekick.title')}</h2>
          <p className="flex items-center gap-1 truncate text-[11px] font-semibold text-on-surface-variant" aria-live="polite">
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{snapshot.selectedIds.length ? 'select_all' : 'dashboard'}</span>
            {contextLabel}
          </p>
        </div>
        <button type="button" onClick={reset} disabled={!messages.length && !busy} className={ICON_BUTTON} title={t('sidekick.newChat')} aria-label={t('sidekick.newChat')}>
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">add_comment</span>
        </button>
        <button type="button" onClick={onClose} className={ICON_BUTTON} title={t('sidekick.close')} aria-label={t('sidekick.close')}>
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
        </button>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border-l-4 border-secondary bg-secondary-container/30 p-3">
              <p className="text-sm text-on-surface">{t('sidekick.welcome')}</p>
            </div>
            <span className="font-label text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{t('sidekick.tryAsking')}</span>
            <div className="flex flex-col items-start gap-1.5">
              {suggestions.map((key) => (
                <button key={key} type="button" onClick={() => send(t(key))} disabled={busy} className={CHIP}>{t(key)}</button>
              ))}
            </div>
          </div>
        )}
        <ol className="flex flex-col gap-3">
          {messages.map((message) => (
            <li key={message.id} className={message.role === 'user' ? 'self-end max-w-[85%]' : 'w-full'}>
              {message.role === 'user' ? (
                <p className="rounded-[12px] rounded-br-sm bg-primary px-3 py-2 text-sm text-on-primary break-words whitespace-pre-wrap">
                  <span className="sr-only">{t('sidekick.you')}: </span>{message.text}
                </p>
              ) : (
                <AssistantMessage message={message} onFollowUp={send} onApply={apply} onCancel={cancel} busy={busy} />
              )}
            </li>
          ))}
        </ol>
        {busy && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-on-surface-variant">
            <span className="material-symbols-outlined animate-spin text-[18px]" aria-hidden="true">progress_activity</span>
            {t('sidekick.thinking')}
          </p>
        )}
      </div>

      <form
        className="border-t-2 border-surface-container bg-surface-container-lowest p-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-[14px] border-2 border-transparent bg-surface-container px-2 py-1.5 focus-within:border-primary">
          <label htmlFor="sidekick-input" className="sr-only">{t('sidekick.inputLabel')}</label>
          <textarea
            id="sidekick-input"
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send(input);
              }
            }}
            rows={2}
            maxLength={1000}
            placeholder={t('sidekick.placeholder')}
            aria-describedby="sidekick-input-hint"
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-on-surface outline-none placeholder:text-on-surface-variant"
          />
          <button type="submit" disabled={busy || !input.trim()} aria-busy={busy} className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary hover:bg-primary/90 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`} aria-label={t('sidekick.send')} title={t('sidekick.send')}>
            <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">arrow_upward</span>
          </button>
        </div>
        <p id="sidekick-input-hint" className="mt-1 px-1 text-[10px] text-on-surface-variant">{t('sidekick.inputHint')}</p>
      </form>
    </aside>
  );
};

export default SidekickPanel;
