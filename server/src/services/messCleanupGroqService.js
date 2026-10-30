import config from '../config/env.js';
import {
  GEMINI_ORGANIZATION_PLAN_SCHEMA,
  MESS_CLEANUP_SYSTEM_PROMPT,
  extractJsonFromText,
  parseImageData
} from './geminiService.js';

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_OBJECT_TEXT_LENGTH = 160;

export const toStrictSchema = (node) => {
  if (!node || typeof node !== 'object') return node;
  const { nullable, ...schema } = node;
  if (nullable) schema.type = [schema.type, 'null'];
  if (schema.properties) {
    schema.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toStrictSchema(value)]));
    schema.required = Object.keys(schema.properties);
    schema.additionalProperties = false;
  }
  if (schema.items) schema.items = toStrictSchema(schema.items);
  return schema;
};

export const MESS_CLEANUP_RESPONSE_SCHEMA = toStrictSchema(GEMINI_ORGANIZATION_PLAN_SCHEMA);

const createError = (code, message, statusCode) => {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
};

export const classifyGroqStatus = (status) => {
  if (status === 401 || status === 403) return createError('AUTHENTICATION_FAILED', 'The Mess Cleanup AI provider rejected the server credentials', 401);
  if (status === 429) return createError('RATE_LIMITED', 'The Mess Cleanup AI provider is rate limiting requests', 429);
  if (status === 413) return createError('RATE_LIMITED', 'The board exceeds the Mess Cleanup AI provider token limit', 429);
  if (status === 498 || status >= 500) return createError('SERVICE_UNAVAILABLE', 'The Mess Cleanup AI provider is temporarily unavailable', 503);
  return createError('INVALID_REQUEST', 'The Mess Cleanup AI provider rejected the request', 400);
};

const linksOf = (relationships) => {
  const links = {};
  for (const relationship of Array.isArray(relationships) ? relationships : []) {
    if (relationship?.targetId && !links[relationship.targetId]) links[relationship.targetId] = relationship.type;
  }
  return Object.keys(links).length ? links : undefined;
};

export const compactWorkspaceModel = (workspaceModel) => ({
  objects: (workspaceModel.board?.objects || workspaceModel.objects || []).filter((object) => object && typeof object === 'object').map((object) => {
    const bounds = object.bounds;
    const weight = object.style?.fontWeight;
    return {
      id: object.id,
      type: object.type,
      shape: object.shapeType || object.originalType || undefined,
      text: typeof object.text === 'string' ? object.text.slice(0, MAX_OBJECT_TEXT_LENGTH) : undefined,
      box: bounds ? [bounds.x, bounds.y, bounds.width, bounds.height].map((value) => Math.round(Number(value) || 0)) : undefined,
      color: object.metadata?.noteColor || object.style?.color || object.fill || object.stroke || undefined,
      fontSize: object.style?.fontSize,
      bold: weight === 'bold' || Number(weight) >= 600 || undefined,
      strokeId: object.strokeId || undefined,
      arrow: object.hasExplicitArrow || undefined,
      links: linksOf(object.relationships)
    };
  })
});

export const buildGroqMessages = (workspaceModel, image) => {
  const parsedImage = parseImageData(image);
  return [
    { role: 'system', content: MESS_CLEANUP_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Analyze the following whiteboard workspace. Use both the visual screenshot and the compact WorkspaceModel JSON. Each object has its exact id, type, optional text, box as [x, y, width, height] in canvas units, color, and links that map related object ids to relationship types.\n\nWorkspaceModel JSON:\n${JSON.stringify(compactWorkspaceModel(workspaceModel))}`
        },
        { type: 'image_url', image_url: { url: `data:${parsedImage.mime_type};base64,${parsedImage.data}` } }
      ]
    }
  ];
};

export const analyzeWithGroq = async (workspaceModel, image, options = {}) => {
  const apiKey = options.apiKey ?? config.groqMessCleanupApiKey;
  const model = options.model || config.messCleanupModel;
  const timeoutMs = options.timeoutMs ?? 22000;
  const fetchImpl = options.fetch || fetch;
  const signal = options.signal || null;

  if (!apiKey) {
    throw createError('AUTHENTICATION_FAILED', 'Mess Cleanup AI is not configured on the server', 401);
  }
  if (!workspaceModel || typeof workspaceModel !== 'object') {
    throw createError('INVALID_WORKSPACE_MODEL', 'Invalid or missing workspaceModel', 400);
  }
  const messages = buildGroqMessages(workspaceModel, image);
  if (signal?.aborted) {
    throw createError('CLIENT_ABORTED', 'Client aborted request', 499);
  }

  const requestController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, timeoutMs);
  const forwardClientAbort = () => requestController.abort();
  signal?.addEventListener('abort', forwardClientAbort, { once: true });

  const started = Date.now();
  let payload;
  try {
    const response = await fetchImpl(GROQ_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'organization_plan', strict: true, schema: MESS_CLEANUP_RESPONSE_SCHEMA }
        },
        reasoning_effort: 'none',
        reasoning_format: 'hidden'
      }),
      signal: requestController.signal
    });

    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw classifyGroqStatus(response.status);
    }

    payload = await response.json();
  } catch (err) {
    if (signal?.aborted) {
      throw createError('CLIENT_ABORTED', 'Client aborted request', 499);
    }
    if (timedOut) {
      throw createError('TIMEOUT', 'The Mess Cleanup AI provider did not respond in time', 504);
    }
    if (err?.statusCode) {
      throw err;
    }
    if (err instanceof SyntaxError) {
      throw createError('MALFORMED_JSON_RESPONSE', 'Failed to parse the Mess Cleanup AI response', 502);
    }
    throw createError('UPSTREAM_ERROR', 'The Mess Cleanup AI provider could not be reached', 502);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardClientAbort);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw createError('EMPTY_COMPLETION', 'The Mess Cleanup AI provider returned an empty completion', 502);
  }

  let plan;
  try {
    plan = extractJsonFromText(content);
  } catch (_) {
    throw createError('MALFORMED_JSON_RESPONSE', 'Failed to parse the Mess Cleanup AI response', 502);
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw createError('MALFORMED_JSON_RESPONSE', 'The Mess Cleanup AI response was not a plan object', 502);
  }

  const resolvedModel = typeof payload.model === 'string' ? payload.model : model;
  plan.source = { ...(plan.source && typeof plan.source === 'object' ? plan.source : {}), engine: 'groq', model: resolvedModel };
  console.log(`[MessCleanup] Groq analysis completed in ${Date.now() - started}ms with ${resolvedModel}`);
  return plan;
};

export default {
  MESS_CLEANUP_RESPONSE_SCHEMA,
  toStrictSchema,
  classifyGroqStatus,
  compactWorkspaceModel,
  buildGroqMessages,
  analyzeWithGroq
};
