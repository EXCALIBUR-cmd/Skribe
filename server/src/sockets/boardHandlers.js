import boardRepository from '../repositories/board.repository.js';

export const boardRoomName = (boardId) => `board:${boardId}`;

const roomPresenceMap = new Map();
const socketRoomMap = new Map();

const removeSocketFromBoardPresence = (io, socket, boardId) => {
  const userIdKey = String(socket.user.id);
  const socketId = String(socket.id);

  if (socketRoomMap.has(socketId)) {
    socketRoomMap.get(socketId).delete(boardId);
    if (socketRoomMap.get(socketId).size === 0) {
      socketRoomMap.delete(socketId);
    }
  }

  const boardRoster = roomPresenceMap.get(boardId);
  if (!boardRoster) return;

  const userEntry = boardRoster.get(userIdKey);
  if (!userEntry) return;

  userEntry.socketIds.delete(socketId);

  if (userEntry.socketIds.size === 0) {
    boardRoster.delete(userIdKey);
    if (boardRoster.size === 0) {
      roomPresenceMap.delete(boardId);
    }

    const roomName = boardRoomName(boardId);
    io.to(roomName).emit('board:user:left', {
      boardId,
      userId: userIdKey
    });
  }
};

export const handleSocketDisconnect = (io, socket) => {
  const socketId = String(socket.id);
  const userJoinedBoards = socketRoomMap.get(socketId);
  if (!userJoinedBoards) return;

  const boardIds = Array.from(userJoinedBoards);
  for (const boardId of boardIds) {
    removeSocketFromBoardPresence(io, socket, boardId);
  }

  socketRoomMap.delete(socketId);
};

export const registerBoardHandlers = (io, socket) => {
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

      const isOwner = (board.owner._id?.toString() || board.owner.toString()) === socket.user.id.toString();
      const isMember = Array.isArray(board.members) && board.members.some((m) => (m._id?.toString() || m.toString()) === socket.user.id.toString());

      if (!isOwner && !isMember) {
        socket.emit('board-error', {
          event: 'join-board',
          message: 'You do not have permission to access this board'
        });
        return;
      }

      const room = boardRoomName(boardId);
      await socket.join(room);

      const userIdKey = String(socket.user.id);
      const socketId = String(socket.id);

      if (!socketRoomMap.has(socketId)) {
        socketRoomMap.set(socketId, new Set());
      }
      socketRoomMap.get(socketId).add(boardId);

      if (!roomPresenceMap.has(boardId)) {
        roomPresenceMap.set(boardId, new Map());
      }

      const boardRoster = roomPresenceMap.get(boardId);
      const isNewUserForBoard = !boardRoster.has(userIdKey);

      if (isNewUserForBoard) {
        boardRoster.set(userIdKey, {
          user: {
            id: userIdKey,
            name: socket.user.name,
            avatar: socket.user.avatar || null
          },
          socketIds: new Set([socketId])
        });
      } else {
        boardRoster.get(userIdKey).socketIds.add(socketId);
      }

      const activeUsers = Array.from(boardRoster.values()).map((entry) => entry.user);

      console.log(`[Socket] User ${userIdKey} joined room ${room}`);

      socket.emit('board-joined', { boardId, room });

      socket.emit('board:presence', {
        boardId,
        users: activeUsers
      });

      if (isNewUserForBoard) {
        socket.to(room).emit('board:user:joined', {
          boardId,
          user: {
            id: userIdKey,
            name: socket.user.name,
            avatar: socket.user.avatar || null
          }
        });
      }
    } catch (err) {
      console.error(`[Socket] join-board error for user ${socket.user.id}:`, err.message);
      socket.emit('board-error', { event: 'join-board', message: 'Failed to join board room' });
    }
  });

  socket.on('leave-board', async ({ boardId } = {}) => {
    if (!boardId || typeof boardId !== 'string') {
      socket.emit('board-error', { event: 'leave-board', message: 'leave-board requires boardId' });
      return;
    }

    const room = boardRoomName(boardId);
    removeSocketFromBoardPresence(io, socket, boardId);
    await socket.leave(room);

    console.log(`[Socket] User ${socket.user.id} left room ${room}`);

    socket.emit('board-left', { boardId, room });
  });
};

export default registerBoardHandlers;
