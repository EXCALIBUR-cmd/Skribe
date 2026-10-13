import { GoogleGenAI } from '@google/genai';
import config from '../config/env.js';

export const MESS_CLEANUP_SYSTEM_PROMPT = `You are the visual semantic organization engine for Skribe's infinite whiteboard.

You receive:
1. A visual screenshot of the whiteboard.
2. A structured WorkspaceModel JSON representation of the board.

Your responsibility is to understand what a human has drawn and written on the board and return its pure semantic organization.

You MUST:
- Identify titles, headings, body text, and labels
- Identify diagrams, flowcharts, and system architectures (keep connected nodes and arrows grouped together)
- Identify sticky-note groups and brainstorming clusters
- Identify concept blocks and explanatory text
- Identify freehand drawings and multi-stroke handwriting (keep strokes of the same drawing grouped together)
- Identify annotations (circles, arrows, underlines) and their target objects
- Identify meaningful semantic relationships (heading-body, connects-to, attached-text, annotation-target, concept-explanation, diagram-title)
- Determine semantic reading order (e.g. title -> concepts -> flowcharts -> notes -> annotations)
- Preserve exact object IDs from the WorkspaceModel
- Treat visual proximity, alignment, containment, typography, colors, and connectors as visual evidence

You MUST NOT:
- Calculate, invent, or output pixel coordinates, x/y positions, margins, spacing, row/column indices, or canvas dimensions
- Invent, generate, or hallucinate object IDs that do not exist in the WorkspaceModel
- Recreate, modify, or delete objects
- Split a diagram into unrelated objects
- Split multi-stroke handwriting
- Treat connector lines as independent content

YOU MUST INFER AND RETURN A JSON OBJECT WITH:
- version: 1
- workspaceType: "mixed" | "diagram" | "flowchart" | "notes" | "document" | "freeform"
- groups: array of semantic groups:
  * id: string (e.g. "group_flow_1", "group_notes_1", "group_concept_1")
  * type: "flowchart" | "diagram" | "notes" | "concept" | "freeform" | "annotated-diagram"
  * titleObjectId: string ID (or null)
  * purpose: short description of what this group represents
  * objectIds: array of object IDs belonging to this group
- relationships: array of relationships:
  * sourceObjectId: string
  * targetObjectIds: array of strings
  * type: "heading-body" | "diagram-title" | "notes-heading" | "annotation-target" | "connects-to" | "attached-text" | "concept-explanation" | "note-group" | "label-of"
  * confidence: number between 0 and 1
  * evidence: array of strings
- annotations: array of annotations:
  * objectId: string
  * targetObjectIds: array of strings
  * type: "freehand-annotation" | "annotation" | "highlight" | "callout"
  * confidence: number between 0 and 1
- readingOrder: array of group IDs or object IDs in semantic reading order
- hierarchy:
  * rootTitleObjectId: string (or null)
  * mainConceptIds: array of group IDs

OUTPUT FORMAT:
Output the valid JSON matching the required schema. Do NOT return Markdown fences, explanations, or commentary outside the JSON object.`;

export const GEMINI_ORGANIZATION_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    version: { type: 'integer' },
    workspaceType: {
      type: 'string',
      enum: ['mixed', 'diagram', 'flowchart', 'notes', 'document', 'freeform']
    },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          titleObjectId: { type: 'string', nullable: true },
          purpose: { type: 'string' },
          objectIds: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['id', 'type', 'objectIds']
      }
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceObjectId: { type: 'string' },
          targetObjectIds: {
            type: 'array',
            items: { type: 'string' }
          },
          type: { type: 'string' },
          confidence: { type: 'number' },
          evidence: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['sourceObjectId', 'targetObjectIds', 'type']
      }
    },
    annotations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          objectId: { type: 'string' },
          targetObjectIds: {
            type: 'array',
            items: { type: 'string' }
          },
          type: { type: 'string' },
          confidence: { type: 'number' }
        },
        required: ['objectId', 'targetObjectIds']
      }
    },
    readingOrder: {
      type: 'array',
      items: { type: 'string' }
    },
    hierarchy: {
      type: 'object',
      properties: {
        rootTitleObjectId: { type: 'string', nullable: true },
        mainConceptIds: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    }
  },
  required: ['version', 'workspaceType', 'groups', 'relationships']
};

export const parseImageData = (image) => {
  if (typeof image !== 'string' || !image.trim()) {
    const err = new Error('Invalid or missing image/screenshot');
    err.code = 'INVALID_IMAGE';
    err.statusCode = 400;
    throw err;
  }
  const trimmed = image.trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return {
      mime_type: match[1],
      data: match[2]
    };
  }
  return {
    mime_type: 'image/jpeg',
    data: trimmed
  };
};

export const cleanWorkspaceModelForGemini = (model) => {
  if (!model || typeof model !== 'object') return model;
  const objects = (model.board?.objects || model.objects || []).map((obj) => {
    const copy = { ...obj };
    if (Array.isArray(copy.path) && copy.path.length > 8) {
      delete copy.path;
    }
    if (copy.connector?.path && Array.isArray(copy.connector.path) && copy.connector.path.length > 8) {
      delete copy.connector.path;
    }
    return copy;
  });
  return {
    ...model,
    ...(model.board ? { board: { ...model.board, objects } } : {}),
    ...(model.objects ? { objects } : {})
  };
};

export const buildGeminiInput = (workspaceModel, image) => {
  const parsedImage = parseImageData(image);
  const cleanModel = cleanWorkspaceModelForGemini(workspaceModel);
  const textPrompt = `${MESS_CLEANUP_SYSTEM_PROMPT}\n\nAnalyze the following whiteboard workspace. Use both the visual screenshot and the structured WorkspaceModel JSON.\n\nWorkspaceModel JSON:\n${JSON.stringify(cleanModel)}`;
  return [
    {
      type: 'text',
      text: textPrompt
    },
    {
      type: 'image',
      data: parsedImage.data,
      mime_type: parsedImage.mime_type
    }
  ];
};

export const extractJsonFromText = (content) => {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Empty string provided for JSON extraction');
  }

  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (_) {}
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      try {
        const sanitizedCandidate = candidate.replace(/,\s*([\}\]])/g, '$1');
        return JSON.parse(sanitizedCandidate);
      } catch (_) {}
    }
  }

  throw new Error('No valid JSON structure could be extracted');
};

const sleepWithSignal = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    const err = new Error('Client disconnected');
    err.name = 'AbortError';
    err.code = 'CLIENT_ABORTED';
    return reject(err);
  }
  let timer = null;
  const onAbort = () => {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
    const err = new Error('Client disconnected');
    err.name = 'AbortError';
    err.code = 'CLIENT_ABORTED';
    reject(err);
  };
  timer = setTimeout(() => {
    if (signal) signal.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
  }
});

const classifyGeminiError = (err) => {
  if (err.code === 'MALFORMED_JSON_RESPONSE' || err.code === 'EMPTY_COMPLETION' || err.code === 'INVALID_WORKSPACE_MODEL' || err.code === 'INVALID_IMAGE') {
    return err;
  }

  const status = err.status || err.statusCode || err.response?.status;
  const msg = String(err.message || '').toLowerCase();
  const name = String(err.name || '');

  if (name === 'APIUserAbortError' || msg.includes('aborted by client') || err.code === 'CLIENT_ABORTED') {
    const abortErr = new Error('Client aborted request');
    abortErr.code = 'CLIENT_ABORTED';
    abortErr.statusCode = 499;
    return abortErr;
  }

  if (name === 'APIConnectionTimeoutError' || name === 'RequestTimeoutError' || msg.includes('timed out') || msg.includes('timeout') || err.code === 'TIMEOUT') {
    const timeoutErr = new Error(err.message || 'Gemini API request timed out');
    timeoutErr.code = 'TIMEOUT';
    timeoutErr.statusCode = 504;
    return timeoutErr;
  }

  if (status === 401 || status === 403 || msg.includes('api key not valid') || msg.includes('api_key_invalid') || msg.includes('unauthorized')) {
    const authErr = new Error('Gemini API authentication failed');
    authErr.code = 'AUTHENTICATION_FAILED';
    authErr.statusCode = 401;
    return authErr;
  }

  if (status === 429 || msg.includes('resource_exhausted') || msg.includes('quota exceeded') || msg.includes('rate limit')) {
    const rateErr = new Error(err.message || 'Gemini API rate limit or quota exceeded');
    rateErr.code = 'RATE_LIMITED';
    rateErr.statusCode = 429;
    return rateErr;
  }

  if (status === 503 || msg.includes('503') || msg.includes('high demand') || msg.includes('service unavailable') || msg.includes('spikes in demand')) {
    const unavailableErr = new Error(err.message || 'Gemini API service temporarily unavailable');
    unavailableErr.code = 'SERVICE_UNAVAILABLE';
    unavailableErr.statusCode = 503;
    return unavailableErr;
  }

  if (status === 400 || msg.includes('invalid argument') || msg.includes('bad request')) {
    const invalidErr = new Error(err.message || 'Invalid Gemini request payload');
    invalidErr.code = 'INVALID_REQUEST';
    invalidErr.statusCode = 400;
    return invalidErr;
  }

  const genericErr = new Error(err.message || 'Gemini API request failed');
  genericErr.code = 'UPSTREAM_ERROR';
  genericErr.statusCode = status >= 500 ? 502 : (status || 502);
  return genericErr;
};

export const analyzeWithGemini = async (workspaceModel, image, options = {}) => {
  const apiKey = options.apiKey || config.geminiApiKey;
  const modelName = options.model || config.geminiModel || 'gemini-3.8-flash';
  const timeoutMs = options.timeout_ms ?? options.timeoutMs ?? 22000;
  const retryDelayMs = options.retryDelayMs ?? 1500;
  const clientSignal = options.signal || null;
  const thinkingLevel = options.thinkingLevel || 'low';

  if (!apiKey) {
    const err = new Error('Gemini API key is not configured');
    err.code = 'AUTHENTICATION_FAILED';
    err.statusCode = 401;
    throw err;
  }

  if (!workspaceModel || typeof workspaceModel !== 'object') {
    const err = new Error('Invalid or missing workspaceModel');
    err.code = 'INVALID_WORKSPACE_MODEL';
    err.statusCode = 400;
    throw err;
  }

  if (!image) {
    const err = new Error('Invalid or missing image/screenshot');
    err.code = 'INVALID_IMAGE';
    err.statusCode = 400;
    throw err;
  }

  if (clientSignal?.aborted) {
    const err = new Error('Client disconnected');
    err.name = 'AbortError';
    err.code = 'CLIENT_ABORTED';
    err.statusCode = 499;
    throw err;
  }

  const client = options.client || new GoogleGenAI({
    apiKey,
    httpOptions: options.fetch ? { fetch: options.fetch } : undefined
  });

  const maxAttempts = options.maxAttempts ?? (options.maxRetries !== undefined ? options.maxRetries : 1);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (clientSignal?.aborted) {
      const err = new Error('Client disconnected');
      err.name = 'AbortError';
      err.code = 'CLIENT_ABORTED';
      err.statusCode = 499;
      throw err;
    }

    const input = buildGeminiInput(workspaceModel, image);
    const reqStart = Date.now();
    console.log(`[Gemini Diagnostic] Gemini request started (attempt ${attempt}/${maxAttempts})`);

    try {
      const interaction = await client.interactions.create(
        {
          model: modelName,
          input,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: GEMINI_ORGANIZATION_PLAN_SCHEMA
          },
          generation_config: {
            thinking_level: thinkingLevel
          }
        },
        {
          timeout_ms: timeoutMs,
          signal: clientSignal || undefined,
          retries: options.retries || { strategy: 'none' }
        }
      );

      const duration = ((Date.now() - reqStart) / 1000).toFixed(2);
      console.log(`[Gemini Diagnostic] Interaction completed in ${duration}s (attempt ${attempt}/${maxAttempts})`);

      const resolvedModel = interaction?.model || modelName;
      if (interaction?.model) {
        console.log(`[Gemini Diagnostic] Model: ${interaction.model}`);
      }
      if (interaction?.usage) {
        console.log(`[Gemini Diagnostic] Usage: prompt_tokens=${interaction.usage.prompt_tokens}, completion_tokens=${interaction.usage.completion_tokens}, total_tokens=${interaction.usage.total_tokens}`);
      }

      const outputText = interaction?.output_text;
      if (!outputText || typeof outputText !== 'string' || !outputText.trim()) {
        console.log('[Gemini Diagnostic] Parsing failure: output_text is missing or empty');
        const err = new Error('Gemini API returned an empty completion');
        err.code = 'EMPTY_COMPLETION';
        err.statusCode = 502;
        throw err;
      }

      console.log(`[Gemini Diagnostic] Completion length: ${outputText.length}`);

      let parsedPlan;
      try {
        parsedPlan = extractJsonFromText(outputText);
        console.log('[Gemini Diagnostic] Parsed JSON successfully');
        if (parsedPlan && typeof parsedPlan === 'object') {
          console.log(`[Gemini Diagnostic] Top-level keys: ${Object.keys(parsedPlan).join(', ')}`);
          if (!parsedPlan.source) {
            parsedPlan.source = {
              engine: 'gemini',
              model: resolvedModel
            };
          } else {
            parsedPlan.source.engine = 'gemini';
            parsedPlan.source.model = resolvedModel;
          }
        }
      } catch (parseErr) {
        console.log(`[Gemini Diagnostic] Parsing failure: JSON parse failed - ${parseErr.message}`);
        const err = new Error('Failed to parse Gemini API JSON response');
        err.code = 'MALFORMED_JSON_RESPONSE';
        err.statusCode = 502;
        err.rawContent = outputText;
        throw err;
      }

      return parsedPlan;
    } catch (rawErr) {
      const err = classifyGeminiError(rawErr);
      lastError = err;

      console.log(`[Gemini Diagnostic] Request error: HTTP ${err.statusCode} (${err.code}) - ${err.message}`);

      if (err.code === 'CLIENT_ABORTED' || clientSignal?.aborted) {
        throw err;
      }

      if (err.code === 'AUTHENTICATION_FAILED' || err.code === 'RATE_LIMITED' || err.code === 'SERVICE_UNAVAILABLE' || err.code === 'TIMEOUT' || err.code === 'INVALID_REQUEST') {
        throw err;
      }

      if (attempt < maxAttempts && [500, 502].includes(err.statusCode)) {
        console.log(`[Gemini Diagnostic] Retrying transient error in ${retryDelayMs}ms...`);
        await sleepWithSignal(retryDelayMs, clientSignal);
        continue;
      }

      throw err;
    }
  }

  throw lastError || new Error('Gemini API request failed');
};

export default {
  MESS_CLEANUP_SYSTEM_PROMPT,
  GEMINI_ORGANIZATION_PLAN_SCHEMA,
  parseImageData,
  cleanWorkspaceModelForGemini,
  buildGeminiInput,
  extractJsonFromText,
  analyzeWithGemini
};
