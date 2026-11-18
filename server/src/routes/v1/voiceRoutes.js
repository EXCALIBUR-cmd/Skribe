import { Router } from 'express';
import voiceTranscriptionController from '../../controllers/voiceTranscription.controller.js';
import { authenticateAllowingGuests } from '../../middleware/auth.middleware.js';
import { voiceTranscribeLimiter } from '../../middleware/rateLimit.middleware.js';

const router = Router();

router.use(authenticateAllowingGuests);

router.post('/transcribe', voiceTranscribeLimiter, voiceTranscriptionController.receiveAudio, voiceTranscriptionController.transcribe);

export default router;
