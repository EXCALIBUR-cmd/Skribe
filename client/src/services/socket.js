import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

let socket = null;

export const connect = () => {
  if (socket && socket.connected) return socket;

  if (socket) {
    socket.connect();
    return socket;
  }

  socket = io(SOCKET_URL, {

    withCredentials: true,

    transports: ['websocket', 'polling'],

    autoConnect: true
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected — socket id:', socket.id);
  });

  socket.on('connect_error', (err) => {
    console.error('[Socket] Connection error:', err.message);
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected — reason:', reason);
  });

  socket.on('board-joined', ({ boardId, room }) => {
    console.log(`[Socket] Joined board room: ${room} (boardId: ${boardId})`);
  });

  socket.on('board-left', ({ boardId, room }) => {
    console.log(`[Socket] Left board room: ${room} (boardId: ${boardId})`);
  });

  socket.on('board-error', ({ event, message }) => {
    console.error(`[Socket] Board error on "${event}": ${message}`);
  });

  return socket;
};

export const disconnect = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
    console.log('[Socket] Disconnected and instance cleared (logout)');
  }
};

export const joinBoard = (boardId) => {
  if (!socket || !socket.connected) {
    console.warn('[Socket] joinBoard called but socket is not connected');
    return;
  }
  socket.emit('join-board', { boardId });
};

export const leaveBoard = (boardId) => {
  if (!socket || !socket.connected) return;
  socket.emit('leave-board', { boardId });
};

export const on = (event, handler) => {
  if (socket) socket.on(event, handler);
};

export const off = (event, handler) => {
  if (socket) socket.off(event, handler);
};

export const emit = (event, data) => {
  if (socket && socket.connected) socket.emit(event, data);
};

export const getSocket = () => socket;

const socketService = {
  connect,
  disconnect,
  joinBoard,
  leaveBoard,
  on,
  off,
  emit,
  getSocket
};

export default socketService;
