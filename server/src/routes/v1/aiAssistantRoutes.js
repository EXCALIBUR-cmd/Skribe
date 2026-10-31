import { Router } from 'express';
import aiAssistantController from '../../controllers/aiAssistantController.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.post('/generate', aiAssistantController.generate);

export default router;
