import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import authRoutes from './auth.routes.js';
import boardRoutes from './board.routes.js';
import messCleanupRoutes from './messCleanupRoutes.js';
import voiceCommandRoutes from './voiceCommandRoutes.js';
import aiAssistantRoutes from './aiAssistantRoutes.js';
import sidekickRoutes from './sidekickRoutes.js';
import assetRoutes from './asset.routes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/boards', boardRoutes);
router.use('/mess-cleanup', messCleanupRoutes);
router.use('/voice-commands', voiceCommandRoutes);
router.use('/ai-assistant', aiAssistantRoutes);
router.use('/sidekick', sidekickRoutes);
router.use('/assets', assetRoutes);

export default router;
