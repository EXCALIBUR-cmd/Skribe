import { Router } from 'express';
import boardController from '../../controllers/board.controller.js';
import { validateBoardId, validateCreateBoard, validateUpdateBoard, validateViewport } from '../../validators/board.validator.js';
import { authenticate, requireExpectedUser } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.post('/', requireExpectedUser, validateCreateBoard, boardController.create);

router.get('/', boardController.getAll);

router.get('/:id', validateBoardId, boardController.getById);

router.patch('/:id', requireExpectedUser, validateBoardId, validateUpdateBoard, boardController.update);

router.get('/:id/operations/:opId', validateBoardId, boardController.operationFate);

router.patch('/:id/viewport', requireExpectedUser, validateBoardId, validateViewport, boardController.saveViewport);

router.delete('/:id', requireExpectedUser, validateBoardId, boardController.delete);

router.get('/:id/collaborators', validateBoardId, boardController.getCollaborators);

router.post('/:id/collaborators', requireExpectedUser, validateBoardId, boardController.addCollaborator);

router.delete('/:id/collaborators/:userId', requireExpectedUser, validateBoardId, boardController.removeCollaborator);

export default router;
