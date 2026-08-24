import { Router } from 'express';
import messCleanupController from '../../controllers/messCleanupController.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.post('/analyze', messCleanupController.analyze);

export default router;
