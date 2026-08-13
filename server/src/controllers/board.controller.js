import boardService from '../services/board.service.js';
import { success } from '../utils/apiResponse.js';

export class BoardController {
  async create(req, res, next) {
    try {
      const userId = req.user.id;
      const { title, canvasData, thumbnail } = req.body || {};
      const board = await boardService.createBoard(userId, { title, canvasData, thumbnail });

      return success(res, { board }, 'Board created successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  async getAll(req, res, next) {
    try {
      const userId = req.user.id;
      const { page, limit } = req.query;
      const boards = await boardService.getUserBoards(userId, {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 0
      });

      return success(res, { boards, count: boards.length }, 'Boards retrieved successfully', 200);
    } catch (err) {
      next(err);
    }
  }

  async getById(req, res, next) {
    try {
      const userId = req.user.id;
      const boardId = req.params.id;
      const board = await boardService.getBoardById(boardId, userId);

      return success(res, { board }, 'Board retrieved successfully', 200);
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const userId = req.user.id;
      const boardId = req.params.id;
      const updatePayload = req.body || {};

      console.log('[BOARD UPDATE DEBUG] Board ID:', boardId);
      console.log('[BOARD UPDATE DEBUG] Authenticated User:', userId);
      console.log('[BOARD UPDATE DEBUG] Received fields:', Object.keys(updatePayload));

      const board = await boardService.updateBoard(boardId, userId, updatePayload);

      return success(res, { board }, 'Board updated successfully', 200);
    } catch (err) {
      next(err);
    }
  }

  async delete(req, res, next) {
    try {
      const userId = req.user.id;
      const boardId = req.params.id;

      await boardService.deleteBoard(boardId, userId);

      return success(res, null, 'Board deleted successfully', 200);
    } catch (err) {
      next(err);
    }
  }

  async addCollaborator(req, res, next) {
    try {
      const userId = req.user.id;
      const boardId = req.params.id;
      const { email } = req.body || {};

      const collaborator = await boardService.addCollaborator(boardId, userId, email);

      return success(res, { collaborator }, 'Collaborator added successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  async removeCollaborator(req, res, next) {
    try {
      const userId = req.user.id;
      const { id: boardId, userId: collaboratorUserId } = req.params;

      await boardService.removeCollaborator(boardId, userId, collaboratorUserId);

      return success(res, null, 'Collaborator removed successfully', 200);
    } catch (err) {
      next(err);
    }
  }

  async getCollaborators(req, res, next) {
    try {
      const userId = req.user.id;
      const boardId = req.params.id;

      const collaborators = await boardService.getCollaborators(boardId, userId);

      return success(res, { collaborators }, 'Collaborators retrieved successfully', 200);
    } catch (err) {
      next(err);
    }
  }
}

export const boardController = new BoardController();
export default boardController;
