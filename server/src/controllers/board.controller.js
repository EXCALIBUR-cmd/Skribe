import boardService from '../services/board.service.js';
import config from '../config/env.js';
import { error, success } from '../utils/apiResponse.js';
import { getSocketServer } from '../sockets/index.js';
import { boardRoomName } from '../sockets/boardHandlers.js';
import { syncBoardReferences } from '../services/asset.service.js';
import { operationFate } from '../services/boardOperation.service.js';

export class BoardController {
  async create(req, res, next) {
    try {
      const userId = req.user.id;
      const { title, canvasData, thumbnail } = req.body || {};
      const board = await boardService.createBoard(userId, { title, canvasData, thumbnail });
      if (canvasData) void syncBoardReferences(board.id, canvasData);

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

      return success(res, { board, collaboration: { operationsEnabled: config.collabOperationsEnabled } }, 'Board retrieved successfully', 200);
    } catch (err) {
      next(err);
    }
  }

  async operationFate(req, res, next) {
    try {
      const result = await operationFate({ boardId: req.params.id, userId: req.user.id, opId: req.params.opId, baseRevision: Number(req.query.baseRevision) });
      if (result.status === 'invalid') return error(res, 'Invalid operation query', 400, { code: 'INVALID_OPERATION' });
      if (result.status === 'not_found') return error(res, 'Board not found', 404, { code: 'BOARD_NOT_FOUND' });
      if (result.status === 'forbidden') return error(res, 'You do not have access to this board', 403, { code: 'FORBIDDEN' });
      return success(res, { fate: result.fate, revision: result.revision ?? null }, 'Operation fate', 200);
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

      if (updatePayload.canvasData !== undefined) {
        void syncBoardReferences(boardId, updatePayload.canvasData);
        getSocketServer()?.to(boardRoomName(boardId)).emit('board:revision', { boardId, revision: board.canvasRevision, source: 'save' });
      }
      if (updatePayload.canvasBackground !== undefined) {
        getSocketServer()?.to(boardRoomName(boardId)).emit('board:preferences', { boardId, canvasBackground: board.canvasBackground });
      }

      return success(res, { board }, 'Board updated successfully', 200);
    } catch (err) {
      if (err.code && err.statusCode >= 400 && err.statusCode < 500) {
        return error(res, err.message, err.statusCode, err.currentRevision === undefined ? { code: err.code } : { code: err.code, currentRevision: err.currentRevision });
      }
      next(err);
    }
  }

  async saveViewport(req, res, next) {
    try {
      const userId = req.user.id;
      const boardId = req.params.id;
      const { x, y, zoom } = req.body || {};
      await boardService.saveViewport(boardId, userId, { x, y, zoom });

      return success(res, { viewport: { x, y, zoom } }, 'Viewport saved successfully', 200);
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
