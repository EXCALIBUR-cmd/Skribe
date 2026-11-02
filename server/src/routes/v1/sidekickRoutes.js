import { Router } from 'express';
import sidekickController from '../../controllers/sidekickController.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.post('/chat', sidekickController.chat);

export default router;
