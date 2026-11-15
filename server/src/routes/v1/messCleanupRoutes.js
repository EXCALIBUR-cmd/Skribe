import { Router } from 'express';
import messCleanupController from '../../controllers/messCleanupController.js';
import { authenticateAllowingGuests } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticateAllowingGuests);

router.post('/analyze', messCleanupController.analyze);

export default router;
