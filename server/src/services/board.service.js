import boardRepository from '../repositories/board.repository.js';

export class BoardService {

  _verifyOwnership(board, userId) {
    if (!board) {
      const err = new Error('Board not found');
      err.statusCode = 404;
      throw err;
    }

    if (board.owner.toString() !== userId.toString()) {
      const err = new Error('You do not have permission to access or modify this board');
      err.statusCode = 403;
      throw err;
    }
  }

  async createBoard(userId, { title, canvasData, thumbnail }) {
    const boardTitle = title && typeof title === 'string' && title.trim().length > 0
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
    const boards = await boardRepository.findBoardsByOwner(userId, options);
    return boards.map((b) => b.toJSON());
  }

  async getBoardById(boardId, userId) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyOwnership(board, userId);

    const updatedBoard = await boardRepository.updateBoard(boardId, {
      lastOpenedAt: new Date()
    });

    return (updatedBoard || board).toJSON();
  }

  async updateBoard(boardId, userId, updatePayload) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyOwnership(board, userId);

    const { owner, _id, createdAt, id, ...allowedUpdates } = updatePayload || {};

    if (allowedUpdates.title && typeof allowedUpdates.title === 'string') {
      allowedUpdates.title = allowedUpdates.title.trim();
    }

    const updatedBoard = await boardRepository.updateBoard(boardId, allowedUpdates);
    return updatedBoard.toJSON();
  }

  async deleteBoard(boardId, userId) {
    const board = await boardRepository.findBoardById(boardId);
    this._verifyOwnership(board, userId);

    const deletedBoard = await boardRepository.softDeleteBoard(boardId);
    return deletedBoard ? deletedBoard.toJSON() : null;
  }
}

export const boardService = new BoardService();
export default boardService;
