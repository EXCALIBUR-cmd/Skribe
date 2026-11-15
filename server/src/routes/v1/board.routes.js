import { Router } from 'express';
import boardController from '../../controllers/board.controller.js';
import assetController from '../../controllers/asset.controller.js';
import { validateBoardId, validateCreateBoard, validateUpdateBoard, validateViewport } from '../../validators/board.validator.js';
import { authenticateAllowingGuests, rejectGuests } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticateAllowingGuests);

router.post('/', rejectGuests, validateCreateBoard, boardController.create);

router.get('/', rejectGuests, boardController.getAll);

router.get('/:id', validateBoardId, boardController.getById);

router.patch('/:id', validateBoardId, validateUpdateBoard, boardController.update);

router.get('/:id/operations/:opId', validateBoardId, boardController.operationFate);

router.post('/:id/assets/urls', validateBoardId, assetController.signBoardAssetUrls);

router.patch('/:id/viewport', validateBoardId, validateViewport, boardController.saveViewport);

router.delete('/:id', rejectGuests, validateBoardId, boardController.delete);

router.get('/:id/collaborators', rejectGuests, validateBoardId, boardController.getCollaborators);

router.post('/:id/collaborators', rejectGuests, validateBoardId, boardController.addCollaborator);

router.delete('/:id/collaborators/:userId', rejectGuests, validateBoardId, boardController.removeCollaborator);

export default router;
