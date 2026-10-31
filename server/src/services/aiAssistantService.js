import config from '../config/env.js';
import {
  AI_ASSISTANT_ACTIONS,
  DIAGRAM_SCHEMA,
  RESPONSE_SCHEMA,
  buildSystemPrompt,
  buildUserMessage
} from './aiAssistantPrompts.js';

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const AI_ASSISTANT_LIMITS = Object.freeze({
  prompt: 1000,
  boardItems: 200,
  boardText: 160,
  points: 12,
  pointText: 300,
  stickyText: 120,
  title: 120,
  description: 240,
  source: 6000
});

const DIAGRAM_HEADERS = {
  flowchart: /^(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/,
  sequence: /^sequenceDiagram\b/,
  class: /^classDiagram\b/,
  er: /^erDiagram\b/,
  state: /^stateDiagram(-v2)?\b/,
  gantt: /^gantt\b/,
  mindmap: /^mindmap\b/
};

const UNSAFE_SOURCE = /<\s*\/?\s*(script|iframe|object|embed|style|svg|foreignobject|img|a|link|meta)\b|javascript:|data:|%%\{|^\s*click\s|\bhref\b|\bon[a-z]+\s*=/im;

const createError = (code, message, statusCode) => {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
};

const classifyStatus = (status) => {
  if (status === 401 || status === 403) return createError('AUTHENTICATION_FAILED', 'The AI Assistant provider rejected the server credentials', 401);
  if (status === 429 || status === 413) return createError('RATE_LIMITED', 'The AI Assistant provider is rate limiting requests. Try again shortly.', 429);
  if (status === 498 || status >= 500) return createError('SERVICE_UNAVAILABLE', 'The AI Assistant provider is temporarily unavailable', 503);
  return createError('INVALID_REQUEST', 'The AI Assistant provider rejected the request', 400);
};

const cleanText = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export const sanitizeBoard = (board) => (Array.isArray(board) ? board : [])
  .slice(0, AI_ASSISTANT_LIMITS.boardItems)
  .filter((item) => item && typeof item === 'object')
  .map((item) => {
    const entry = { kind: cleanText(item.kind, 20) || 'object' };
    const text = cleanText(item.text, AI_ASSISTANT_LIMITS.boardText);
    if (text) entry.text = text;
    const from = cleanText(item.from, AI_ASSISTANT_LIMITS.boardText);
    const to = cleanText(item.to, AI_ASSISTANT_LIMITS.boardText);
    if (from) entry.from = from;
    if (to) entry.to = to;
    return entry;
  })
  .filter((entry) => entry.text || entry.from || entry.to);

export const stripFences = (source) => source.trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();

export const validateDiagram = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw createError('MALFORMED_RESPONSE', 'The AI Assistant returned an invalid diagram', 502);
  }
  const source = typeof raw.source === 'string' ? stripFences(raw.source) : '';
  if (!source) throw createError('EMPTY_DIAGRAM', 'The AI Assistant returned an empty diagram', 502);
  if (source.length > AI_ASSISTANT_LIMITS.source) throw createError('DIAGRAM_TOO_LARGE', 'The generated diagram is too large', 502);
  const header = DIAGRAM_HEADERS[raw.diagramType];
  if (!header) throw createError('UNSUPPORTED_DIAGRAM', 'The AI Assistant returned an unsupported diagram type', 502);
  const firstLine = source.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('%%')) || '';
  if (!header.test(firstLine)) throw createError('MALFORMED_DIAGRAM', 'The generated Mermaid source does not match its diagram type', 502);
  if (UNSAFE_SOURCE.test(source)) throw createError('UNSAFE_DIAGRAM', 'The generated diagram contained disallowed content', 502);
  return {
    title: cleanText(raw.title, AI_ASSISTANT_LIMITS.title) || 'Diagram',
    description: cleanText(raw.description, AI_ASSISTANT_LIMITS.description),
    diagramType: raw.diagramType,
    source
  };
};

export const validateResponse = (raw, action) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.points)) {
    throw createError('MALFORMED_RESPONSE', 'The AI Assistant returned an invalid response', 502);
  }
  const maxText = action === 'sticky_gen' ? AI_ASSISTANT_LIMITS.stickyText : AI_ASSISTANT_LIMITS.pointText;
  const points = raw.points.map((point) => cleanText(point, maxText)).filter(Boolean).slice(0, action === 'sticky_gen' ? 8 : AI_ASSISTANT_LIMITS.points);
  if (!points.length) throw createError('EMPTY_RESPONSE', 'The AI Assistant returned an empty response', 502);
  return { title: cleanText(raw.title, AI_ASSISTANT_LIMITS.title) || 'AI Assistant', points };
};

export const generateAssistantResult = async (action, input = {}, options = {}) => {
  const apiKey = options.apiKey ?? config.groqAiAssistantApiKey;
  const model = options.model || config.aiAssistantModel;
  const timeoutMs = options.timeoutMs ?? 30000;
  const fetchImpl = options.fetch || fetch;
  const signal = options.signal || null;

  if (!AI_ASSISTANT_ACTIONS.includes(action)) throw createError('INVALID_ACTION', 'Unknown AI Assistant action', 400);
  if (!apiKey) throw createError('AI_ASSISTANT_NOT_CONFIGURED', 'The AI Assistant is not configured on the server. Set GROQ_AI_ASSISTANT_API_KEY.', 503);

  const isDiagram = action === 'diagram';
  const requestController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, timeoutMs);
  const forwardClientAbort = () => requestController.abort();
  signal?.addEventListener('abort', forwardClientAbort, { once: true });

  let payload;
  try {
    const response = await fetchImpl(GROQ_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt(action) },
          { role: 'user', content: buildUserMessage(input.prompt, sanitizeBoard(input.board)) }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: isDiagram ? 'mermaid_diagram' : 'assistant_response', strict: true, schema: isDiagram ? DIAGRAM_SCHEMA : RESPONSE_SCHEMA }
        },
        reasoning_effort: 'low',
        include_reasoning: false
      }),
      signal: requestController.signal
    });
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw classifyStatus(response.status);
    }
    payload = await response.json();
  } catch (err) {
    if (signal?.aborted) throw createError('CLIENT_ABORTED', 'Client aborted request', 499);
    if (timedOut) throw createError('TIMEOUT', 'The AI Assistant provider did not respond in time', 504);
    if (err?.statusCode) throw err;
    if (err instanceof SyntaxError) throw createError('MALFORMED_RESPONSE', 'Failed to parse the AI Assistant response', 502);
    throw createError('UPSTREAM_ERROR', 'The AI Assistant provider could not be reached', 502);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardClientAbort);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw createError('EMPTY_RESPONSE', 'The AI Assistant returned an empty response', 502);
  let raw;
  try {
    raw = JSON.parse(content);
  } catch {
    throw createError('MALFORMED_RESPONSE', 'Failed to parse the AI Assistant response', 502);
  }
  const result = isDiagram ? validateDiagram(raw) : validateResponse(raw, action);
  return { action, result, model: typeof payload.model === 'string' ? payload.model : model };
};

export default { generateAssistantResult, validateDiagram, validateResponse, sanitizeBoard };
