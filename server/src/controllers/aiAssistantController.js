import { error, success } from '../utils/apiResponse.js';
import { AI_ASSISTANT_ACTIONS } from '../services/aiAssistantPrompts.js';
import { AI_ASSISTANT_LIMITS, generateAssistantResult } from '../services/aiAssistantService.js';

const PROMPT_REQUIRED = new Set(['brainstorm', 'architecture', 'sticky_gen', 'diagram']);

export const createGenerateHandler = (generator = generateAssistantResult) => async (req, res, next) => {
  const clientAbortController = new AbortController();
  const handleClientClose = () => {
    if (!res.writableEnded) clientAbortController.abort();
  };
  if (typeof res.on === 'function') res.on('close', handleClientClose);

  try {
    const { action, prompt = '', board = [] } = req.body || {};
    if (!AI_ASSISTANT_ACTIONS.includes(action)) {
      return error(res, 'Unknown AI Assistant action.', 400, { code: 'INVALID_ACTION' });
    }
    if (typeof prompt !== 'string' || prompt.length > AI_ASSISTANT_LIMITS.prompt) {
      return error(res, `Requests are limited to ${AI_ASSISTANT_LIMITS.prompt} characters.`, 400, { code: 'INVALID_PROMPT' });
    }
    if (!Array.isArray(board)) {
      return error(res, 'Board context must be a list.', 400, { code: 'INVALID_BOARD' });
    }
    if (PROMPT_REQUIRED.has(action) && !prompt.trim()) {
      return error(res, 'Describe what you want the AI Assistant to create.', 400, { code: 'INVALID_PROMPT' });
    }
    if (!PROMPT_REQUIRED.has(action) && !board.length) {
      return error(res, 'The board is empty. Add some content first.', 400, { code: 'EMPTY_BOARD' });
    }

    let output;
    try {
      output = await generator(action, { prompt: prompt.trim(), board }, { signal: clientAbortController.signal });
    } catch (serviceErr) {
      if (res.writableEnded || clientAbortController.signal.aborted) return;
      console.error('[AIAssistant] Generation failed:', { action, code: serviceErr.code, statusCode: serviceErr.statusCode });
      return error(res, serviceErr.message || 'The AI Assistant failed. Nothing was changed.', serviceErr.statusCode || 502, {
        code: serviceErr.code || 'AI_FAILED'
      });
    }
    if (res.writableEnded || clientAbortController.signal.aborted) return;
    return success(res, output, 'AI Assistant result generated', 200);
  } catch (err) {
    if (res.writableEnded || clientAbortController.signal.aborted) return;
    return next(err);
  } finally {
    if (typeof res.removeListener === 'function') res.removeListener('close', handleClientClose);
  }
};

export const generate = createGenerateHandler();

export default { generate, createGenerateHandler };
