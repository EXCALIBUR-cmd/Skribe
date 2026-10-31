export const QUICK_DICTATION_MAX_HOLD_MS = 250;

export const QUICK_DICTATION_STATES = Object.freeze(['idle', 'recording', 'transcribing', 'review', 'error']);

const TRANSITIONS = {
  idle: { activate: 'recording' },
  recording: { stop: 'transcribing', cancel: 'idle', fail: 'error' },
  transcribing: { inserted: 'idle', review: 'review', empty: 'error', fail: 'error', cancel: 'idle' },
  review: { close: 'idle' },
  error: { dismiss: 'idle', activate: 'recording' }
};

export const nextQuickDictationState = (state, event) => TRANSITIONS[state]?.[event] || state;

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel']);

export const isEditableTarget = (element) => {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = String(element.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT';
};

const INTERACTIVE_ROLES = new Set(['button', 'switch', 'checkbox', 'radio', 'menuitem', 'option', 'tab', 'link', 'slider', 'combobox', 'textbox']);

export const isBlockedTarget = (element) => {
  if (isEditableTarget(element)) return true;
  const tag = String(element?.tagName || '').toUpperCase();
  if (['BUTTON', 'A', 'SUMMARY', 'VIDEO', 'AUDIO'].includes(tag)) return true;
  return INTERACTIVE_ROLES.has(String(element?.getAttribute?.('role') || '').toLowerCase());
};

export const isInsertableField = (element) => {
  if (!element || element.isConnected === false || element.disabled || element.readOnly) return false;
  if (element.getAttribute?.('data-fabric') === 'textarea') return false;
  const tag = String(element.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && TEXT_INPUT_TYPES.has(String(element.getAttribute?.('type') || element.type || '').toLowerCase());
};

export const mergeTranscript = (value, start, end, transcript) => {
  const text = String(transcript || '').trim();
  const current = String(value || '');
  const from = Number.isInteger(start) ? Math.max(0, Math.min(start, current.length)) : current.length;
  const to = Number.isInteger(end) ? Math.max(from, Math.min(end, current.length)) : from;
  if (!text) return { value: current, caret: to };
  const before = current.slice(0, from);
  const after = current.slice(to);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const inserted = `${lead}${text}${trail}`;
  return { value: `${before}${inserted}${after}`, caret: before.length + lead.length + text.length };
};

export const insertIntoField = (field, transcript) => {
  if (!isInsertableField(field)) return false;
  const { value, caret } = mergeTranscript(field.value, field.selectionStart, field.selectionEnd, transcript);
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.focus({ preventScroll: true });
  field.setSelectionRange?.(caret, caret);
  return true;
};

const isSpace = (event) => event.code === 'Space' || event.key === ' ';

export const createDoubleTapDetector = ({ getInterval, isBlocked = isBlockedTarget, maxHold = QUICK_DICTATION_MAX_HOLD_MS }) => {
  let press = null;
  let lastTapAt = null;

  const reset = () => {
    press = null;
    lastTapAt = null;
  };

  return {
    reset,
    keyDown(event, now) {
      if (!isSpace(event)) {
        reset();
        return;
      }
      if (event.repeat) {
        if (press) press.valid = false;
        return;
      }
      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.isComposing || isBlocked(event.target)) {
        reset();
        return;
      }
      if (lastTapAt !== null && now - lastTapAt > getInterval()) lastTapAt = null;
      press = { downAt: now, valid: true };
    },
    keyUp(event, now) {
      if (!isSpace(event) || !press) return false;
      const { downAt, valid } = press;
      press = null;
      if (!valid || now - downAt > maxHold) {
        reset();
        return false;
      }
      if (lastTapAt !== null && downAt - lastTapAt <= getInterval()) {
        reset();
        return true;
      }
      lastTapAt = downAt;
      return false;
    },
    pointer() {
      reset();
    }
  };
};

export const toCommandPreview = (resolved, transcript, boardId) => {
  const text = String(transcript || '').trim();
  if (resolved?.status === 'execute' && resolved.command) return { kind: 'command', command: resolved.command, text, boardId };
  if (resolved?.status === 'clarify') return { kind: 'clarify', command: resolved.proposal || null, message: resolved.message || '', text, boardId };
  return { kind: 'text', command: null, text, boardId };
};

export const canExecutePreview = (preview, transcript, activeBoardId) => Boolean(
  preview?.command
  && ['command', 'clarify'].includes(preview.kind)
  && preview.text === String(transcript || '').trim()
  && preview.boardId
  && preview.boardId === activeBoardId
);

export const describeCommandParts = (command) => {
  if (!command) return [];
  const parts = [];
  if (command.shapeType) parts.push(['shape', command.shapeType.replace(/_/g, ' ')]);
  if (command.color) parts.push(['color', command.color]);
  if (command.textColor) parts.push(['textColor', command.textColor]);
  const content = command.text || command.label;
  if (content) parts.push(['text', content]);
  return parts;
};
