import { Router } from 'express';
import assetController from '../../controllers/asset.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.post('/images', assetController.limitConcurrentUploads, assetController.receiveImageBody, assetController.upload);

router.get('/usage', assetController.usage);

export default router;
