import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import authRoutes from './auth.routes.js';
import boardRoutes from './board.routes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/boards', boardRoutes);

export default router;
