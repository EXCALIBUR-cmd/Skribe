import { Router } from 'express';
import voiceCommandController from '../../controllers/voiceCommandController.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.post('/interpret', voiceCommandController.interpret);

export default router;
