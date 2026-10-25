import { error, success } from '../utils/apiResponse.js';
import { interpretVoiceCommand, VOICE_COMMAND_LIMITS } from '../services/voiceCommandService.js';

const MAX_PROVIDER_CALLS_PER_USER_PER_MINUTE = 20;

export const createInterpretHandler = (interpreter = interpretVoiceCommand) => {
  const providerCallsByUser = new Map();
  let windowStart = Date.now();

  return async (req, res, next) => {
    const clientAbortController = new AbortController();
    const handleClientClose = () => {
      if (!res.writableEnded) {
        clientAbortController.abort();
      }
    };
    if (typeof res.on === 'function') {
      res.on('close', handleClientClose);
    }

    try {
      const transcript = req.body?.transcript;

      if (typeof transcript !== 'string' || !transcript.trim()) {
        return error(res, 'A spoken instruction is required.', 400, { code: 'INVALID_TRANSCRIPT' });
      }

      if (transcript.trim().length > VOICE_COMMAND_LIMITS.transcript) {
        return error(res, `Instructions are limited to ${VOICE_COMMAND_LIMITS.transcript} characters.`, 400, { code: 'INVALID_TRANSCRIPT' });
      }

      if (Date.now() - windowStart >= 60000) {
        providerCallsByUser.clear();
        windowStart = Date.now();
      }
      const userKey = String(req.user?.id ?? req.ip ?? '');
      const callsThisWindow = providerCallsByUser.get(userKey) || 0;
      if (callsThisWindow >= MAX_PROVIDER_CALLS_PER_USER_PER_MINUTE) {
        return error(res, 'Too many voice commands. Wait a minute and try again. No changes were made.', 429, { code: 'VOICE_COMMAND_RATE_LIMITED' });
      }
      providerCallsByUser.set(userKey, callsThisWindow + 1);

      let interpretation;
      try {
        interpretation = await interpreter(transcript, { signal: clientAbortController.signal });
      } catch (serviceErr) {
        if (res.writableEnded || clientAbortController.signal.aborted) {
          return;
        }
        const statusCode = serviceErr.statusCode || 502;
        console.error('[VoiceCommand] Interpretation failed:', { code: serviceErr.code, statusCode });
        return error(res, serviceErr.message || 'Voice command interpretation failed. No changes were made.', statusCode, {
          code: serviceErr.code || 'AI_FAILED'
        });
      }

      if (res.writableEnded || clientAbortController.signal.aborted) {
        return;
      }

      const result = interpretation?.result;
      if (!result || typeof result.status !== 'string') {
        return error(res, 'Voice command interpretation returned no result. No changes were made.', 502, { code: 'AI_INVALID_RESPONSE' });
      }

      console.log(`[VoiceCommand] Interpreted instruction (${transcript.trim().length} chars) as ${result.status}${result.code ? ` ${result.code}` : ''}`);

      return success(res, { result, model: interpretation.model || null }, 'Voice command interpreted', 200);
    } catch (err) {
      if (res.writableEnded || clientAbortController.signal.aborted) {
        return;
      }
      return next(err);
    } finally {
      if (typeof res.removeListener === 'function') {
        res.removeListener('close', handleClientClose);
      }
    }
  };
};

export const interpret = createInterpretHandler();

export default {
  interpret,
  createInterpretHandler
};
