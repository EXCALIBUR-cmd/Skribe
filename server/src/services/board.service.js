import boardRepository from '../repositories/board.repository.js';
import userRepository from '../repositories/user.repository.js';

export class BoardService {
  _isOwner(board, userId) {
    if (!board || !board.owner) return false;
    const ownerId = board.owner._id ? board.owner._id.toString() : board.owner.toString();
    return ownerId === userId.toString();
  }

  _isMember(board, userId) {
    if (!board || !Array.isArray(board.members)) return false;
    return board.members.some((m) => {
      const memberId = m._id ? m._id.toString() : m.toString();
      return memberId === userId.toString();
    });
  }

  _verifyAccess(board, userId) {
    if (!board) {
      const err = new Error('Board not found');
      err.statusCode = 404;
      throw err;
    }

    if (!this._isOwner(board, userId) && !this._isMember(board, userId)) {
      const err = new Error('You do not have permission to access or modify this board');
      err.statusCode = 403;
      throw err;
    }
  }

  _verifyOwner(board, userId) {
    if (!board) {
      const err = new Error('Board not found');
      err.statusCode = 404;
      throw err;
    }

    if (!this._isOwner(board, userId)) {
      const err = new Error('Only the board owner can perform this action');
      err.statusCode = 403;
      throw err;
    }
  }

  async createBoard(userId, { title, canvasData, thumbnail }) {
    const boardTitle =
      title && typeof title === 'string' && title.trim().length > 0
        ? title.trim()
        : 'Untitled Board';

    const defaultCanvas = {
      version: '6.5.1',
      objects: []
    };

    const newBoard = await boardRepository.createBoard({
      owner: userId,
      title: boardTitle,
      canvasData: canvasData && typeof canvasData === 'object' ? canvasData : defaultCanvas,
      thumbnail: thumbnail || ''
    });

    return newBoard.toJSON();
  }

  async getUserBoards(userId, options = {}) {
    const boards = await boardRepository.findUserBoards(userId, options);
    return boards.map((b) => b.toJSON());
  }

  async getBoardById(boardId, userId) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyAccess(board, userId);

    const updatedBoard = await boardRepository.updateBoard(boardId, {
      lastOpenedAt: new Date()
    });

    return (updatedBoard || board).toJSON();
  }

  async updateBoard(boardId, userId, updatePayload) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyAccess(board, userId);

    const { owner, members, _id, createdAt, id, ...allowedUpdates } = updatePayload || {};

    if (allowedUpdates.title && typeof allowedUpdates.title === 'string') {
      allowedUpdates.title = allowedUpdates.title.trim();
    }

    const updatedBoard = await boardRepository.updateBoard(boardId, allowedUpdates);
    return updatedBoard.toJSON();
  }

  async deleteBoard(boardId, userId) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyOwner(board, userId);

    const deletedBoard = await boardRepository.softDeleteBoard(boardId);
    return deletedBoard ? deletedBoard.toJSON() : null;
  }

  async addCollaborator(boardId, ownerUserId, email) {
    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      const err = new Error('Collaborator email is required');
      err.statusCode = 400;
      throw err;
    }

    const board = await boardRepository.findBoardById(boardId);
    this._verifyOwner(board, ownerUserId);

    const targetUser = await userRepository.findByEmail(email.trim());
    if (!targetUser) {
      const err = new Error('User with this email was not found');
      err.statusCode = 404;
      throw err;
    }

    if (targetUser.id.toString() === ownerUserId.toString()) {
      const err = new Error('Owner is already the owner of this board');
      err.statusCode = 400;
      throw err;
    }

    if (this._isMember(board, targetUser.id)) {
      const err = new Error('User is already a collaborator');
      err.statusCode = 400;
      throw err;
    }

    await boardRepository.addCollaborator(boardId, targetUser.id);
    return {
      id: targetUser.id,
      name: targetUser.name,
      email: targetUser.email,
      avatar: targetUser.avatar || null
    };
  }

  async removeCollaborator(boardId, ownerUserId, collaboratorUserId) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyOwner(board, ownerUserId);

    if (!this._isMember(board, collaboratorUserId)) {
      const err = new Error('User is not a collaborator on this board');
      err.statusCode = 400;
      throw err;
    }

    await boardRepository.removeCollaborator(boardId, collaboratorUserId);
    return true;
  }

  async getCollaborators(boardId, userId) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyAccess(board, userId);

    if (!Array.isArray(board.members)) return [];

    return board.members.map((m) => ({
      id: m._id ? m._id.toString() : m.toString(),
      name: m.name || '',
      email: m.email || '',
      avatar: m.avatar || null
    }));
  }
}

export const boardService = new BoardService();
export default boardService;
