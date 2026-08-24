import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import authRoutes from './auth.routes.js';
import boardRoutes from './board.routes.js';
import messCleanupRoutes from './messCleanupRoutes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/boards', boardRoutes);
router.use('/mess-cleanup', messCleanupRoutes);

export default router;
