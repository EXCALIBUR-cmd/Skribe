import { Router } from 'express';
import boardController from '../../controllers/board.controller.js';
import { validateBoardId, validateCreateBoard, validateUpdateBoard, validateViewport } from '../../validators/board.validator.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.post('/', validateCreateBoard, boardController.create);

router.get('/', boardController.getAll);

router.get('/:id', validateBoardId, boardController.getById);

router.patch('/:id', validateBoardId, validateUpdateBoard, boardController.update);

router.patch('/:id/viewport', validateBoardId, validateViewport, boardController.saveViewport);

router.delete('/:id', validateBoardId, boardController.delete);

router.get('/:id/collaborators', validateBoardId, boardController.getCollaborators);

router.post('/:id/collaborators', validateBoardId, boardController.addCollaborator);

router.delete('/:id/collaborators/:userId', validateBoardId, boardController.removeCollaborator);

export default router;
