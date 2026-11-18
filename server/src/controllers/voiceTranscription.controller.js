import multer from 'multer';
import { error, success } from '../utils/apiResponse.js';
import { AUDIO_TYPES, baseAudioType, reserveVoiceQuota, transcribeAudio, voiceApiKey } from '../services/voiceTranscription.service.js';

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
  fileFilter: (req, file, done) => (AUDIO_TYPES.includes(baseAudioType(file.mimetype)) ? done(null, true) : done(Object.assign(new Error('Unsupported audio type'), { code: 'UNSUPPORTED_AUDIO' })))
}).single('audio');

export const receiveAudio = (req, res, next) => upload(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'UNSUPPORTED_AUDIO') return error(res, 'This audio format is not supported.', 415, { code: 'UNSUPPORTED_AUDIO' });
  if (err.code === 'LIMIT_FILE_SIZE') return error(res, 'Recordings must be 10 MB or smaller.', 413, { code: 'FILE_TOO_LARGE' });
  return error(res, 'The recording could not be read.', 400, { code: 'MALFORMED_UPLOAD' });
});

export const transcribe = async (req, res, next) => {
  try {
    if (!req.file?.buffer?.length) return error(res, 'No recording was received.', 400, { code: 'AUDIO_REQUIRED' });
    if (!voiceApiKey()) return error(res, 'Voice dictation isn\'t available right now.', 503, { code: 'VOICE_UNAVAILABLE' });
    if (!(await reserveVoiceQuota(req.user))) return error(res, 'You\'ve used today\'s voice limit. It resets tomorrow.', 429, { code: 'VOICE_DAILY_LIMIT' });
    const text = await transcribeAudio({ buffer: req.file.buffer, mimeType: req.file.mimetype, lang: req.body?.lang });
    return success(res, { text }, 'Transcription complete', 200);
  } catch (err) {
    if (err.code && err.statusCode) return error(res, err.message, err.statusCode, { code: err.code });
    next(err);
  }
};

export default { receiveAudio, transcribe };
