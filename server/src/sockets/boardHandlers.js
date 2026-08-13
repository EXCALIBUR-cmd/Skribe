import boardRepository from '../repositories/board.repository.js';

export const boardRoomName = (boardId) => `board:${boardId}`;

export const registerBoardHandlers = (socket) => {

  socket.on('join-board', async ({ boardId } = {}) => {
    if (!boardId || typeof boardId !== 'string') {
      socket.emit('board-error', { event: 'join-board', message: 'boardId is required' });
      return;
    }

    try {

      const board = await boardRepository.findBoardById(boardId);

      if (!board) {
        socket.emit('board-error', { event: 'join-board', message: 'Board not found' });
        return;
      }

      if (board.owner.toString() !== socket.user.id.toString()) {
        socket.emit('board-error', {
          event: 'join-board',
          message: 'You do not have permission to access this board'
        });
        return;
      }

      const room = boardRoomName(boardId);
      await socket.join(room);

      console.log(`[Socket] User ${socket.user.id} joined room ${room}`);

      socket.emit('board-joined', { boardId, room });
    } catch (err) {
      console.error(`[Socket] join-board error for user ${socket.user.id}:`, err.message);
      socket.emit('board-error', { event: 'join-board', message: 'Failed to join board room' });
    }
  });

  socket.on('leave-board', async ({ boardId } = {}) => {
    if (!boardId || typeof boardId !== 'string') {
      socket.emit('board-error', { event: 'leave-board', message: 'boardId is required' });
      return;
    }

    const room = boardRoomName(boardId);
    await socket.leave(room);

    console.log(`[Socket] User ${socket.user.id} left room ${room}`);

    socket.emit('board-left', { boardId, room });
  });
};

export default registerBoardHandlers;
