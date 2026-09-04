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
CRITICAL EFFICIENCY REQUIREMENT: Keep reasoning brief (under 50 words). Output the SemanticScene JSON immediately.
Return ONLY raw, valid JSON. Do NOT return Markdown fences (\`\`\`json), explanations, or commentary outside the JSON object.`;

export const formatImageUrl = (image) => {
  if (typeof image !== 'string' || !image.trim()) return '';
  const trimmed = image.trim();
  if (trimmed.startsWith('data:image/')) return trimmed;
  return `data:image/png;base64,${trimmed}`;
};

export const cleanWorkspaceModelForNemotron = (model) => {
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

export const buildMultimodalPayload = (workspaceModel, image, modelName = config.nemotronModel) => {
  const imageUrl = formatImageUrl(image);
  const cleanModel = cleanWorkspaceModelForNemotron(workspaceModel);

  return {
    model: modelName,
    messages: [
      {
        role: 'system',
        content: MESS_CLEANUP_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze the following whiteboard workspace. Use both the visual screenshot and the structured WorkspaceModel JSON.\n\nWorkspaceModel JSON:\n${JSON.stringify(cleanModel)}`
          },
          {
            type: 'image_url',
            image_url: {
              url: imageUrl
            }
          }
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: 2048,
    response_format: { type: 'json_object' },
    chat_template_kwargs: {
      enable_thinking: false
    }
  };
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

export const analyzeWithNemotron = async (workspaceModel, image, options = {}) => {
  const apiKey = options.apiKey || config.nvidiaApiKey;
  const apiUrl = options.apiUrl || config.nvidiaApiUrl;
  const modelName = options.model || config.nemotronModel;
  const timeoutMs = options.timeoutMs || 15000;
  const fetchFn = options.fetch || globalThis.fetch;

  if (!apiKey) {
    const err = new Error('NVIDIA API key is not configured');
    err.code = 'NO_API_KEY';
    err.statusCode = 530;
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

  const maxRetries = options.maxRetries ?? 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const payload = buildMultimodalPayload(workspaceModel, image, modelName);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const reqStart = Date.now();

    console.log(`[Nemotron Diagnostic] NVIDIA request started (attempt ${attempt}/${maxRetries})`);

    try {
      const response = await fetchFn(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timer);
      const duration = ((Date.now() - reqStart) / 1000).toFixed(2);

      console.log(`[Nemotron Diagnostic] HTTP status: ${response.status} (attempt ${attempt}/${maxRetries}, duration ${duration}s)`);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.log(`[Nemotron Diagnostic] Response failed with status ${response.status}`);
        console.log(`[Nemotron Diagnostic] Raw error response:\n${errorText.slice(0, 15000)}`);

        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < maxRetries) {
          const delayMs = attempt * 1500;
          console.log(`[Nemotron Diagnostic] Transient status ${response.status} (Worker pool busy/exhausted). Retrying in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        const err = new Error(`NVIDIA API request failed with status ${response.status}: ${response.statusText}`);
        err.code = 'NVIDIA_API_ERROR';
        err.statusCode = response.status >= 500 ? 502 : response.status;
        err.details = errorText;
        throw err;
      }

      const data = await response.json();
      console.log(`[Nemotron Diagnostic] Response keys: ${Object.keys(data || {}).join(', ')}`);
      if (data?.model) console.log(`[Nemotron Diagnostic] Model: ${data.model}`);

      const choice0 = data?.choices?.[0];
      if (choice0?.finish_reason) console.log(`[Nemotron Diagnostic] Finish reason: ${choice0.finish_reason}`);

      const content = choice0?.message?.content;

      if (!content || typeof content !== 'string') {
        console.log('[Nemotron Diagnostic] Parsing failure: choices[0].message.content is missing or empty');
        const err = new Error('NVIDIA API returned an empty or missing completion payload');
        err.code = 'EMPTY_COMPLETION';
        err.statusCode = 502;
        throw err;
      }

      const contentLen = content.length;
      console.log(`[Nemotron Diagnostic] Completion length: ${contentLen}`);
      const rawToLog = contentLen > 15000 ? `${content.slice(0, 15000)}\n[TRUNCATED AT 15000 CHARS]` : content;
      console.log(`[Nemotron Diagnostic] Raw completion:\n${rawToLog}`);

      let parsedPlan;
      try {
        parsedPlan = extractJsonFromText(content);
        console.log('[Nemotron Diagnostic] Parsed JSON successfully');
        if (parsedPlan && typeof parsedPlan === 'object') {
          console.log(`[Nemotron Diagnostic] Top-level keys: ${Object.keys(parsedPlan).join(', ')}`);
        }
      } catch (parseErr) {
        console.log(`[Nemotron Diagnostic] Parsing failure: JSON.parse failed - ${parseErr.message}`);
        const err = new Error('Failed to parse NVIDIA API JSON response');
        err.code = 'MALFORMED_JSON_RESPONSE';
        err.statusCode = 502;
        err.rawContent = content;
        throw err;
      }

      return parsedPlan;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      if (err.name === 'AbortError') {
        console.log(`[Nemotron Diagnostic] Request timed out after ${timeoutMs}ms`);
        const timeoutError = new Error(`NVIDIA API request timed out after ${timeoutMs}ms`);
        timeoutError.code = 'TIMEOUT';
        timeoutError.statusCode = 504;
        throw timeoutError;
      }

      if (attempt < maxRetries && [429, 500, 502, 503, 504].includes(err.statusCode)) {
        const delayMs = attempt * 1500;
        console.log(`[Nemotron Diagnostic] Retrying after error in ${delayMs}ms:`, err.message);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      throw err;
    }
  }

  throw lastError || new Error('NVIDIA API request failed after retries');
};

export default {
  MESS_CLEANUP_SYSTEM_PROMPT,
  formatImageUrl,
  buildMultimodalPayload,
  extractJsonFromText,
  analyzeWithNemotron
};
