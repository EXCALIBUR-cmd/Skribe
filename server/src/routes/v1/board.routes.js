import { Router } from 'express';
import boardController from '../../controllers/board.controller.js';
import { validateBoardId, validateCreateBoard, validateUpdateBoard } from '../../validators/board.validator.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.post('/', validateCreateBoard, boardController.create);

router.get('/', boardController.getAll);

router.get('/:id', validateBoardId, boardController.getById);

router.patch('/:id', validateBoardId, validateUpdateBoard, boardController.update);

router.delete('/:id', validateBoardId, boardController.delete);

export default router;
