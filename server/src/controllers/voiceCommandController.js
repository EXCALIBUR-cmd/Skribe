import { error, success } from '../utils/apiResponse.js';
import { interpretVoiceCommand, VOICE_COMMAND_LIMITS } from '../services/voiceCommandService.js';

export const createInterpretHandler = (interpreter = interpretVoiceCommand) => async (req, res, next) => {
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

export const interpret = createInterpretHandler();

export default {
  interpret,
  createInterpretHandler
};
