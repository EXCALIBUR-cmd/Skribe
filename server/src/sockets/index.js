import { Server as SocketIOServer } from 'socket.io';
import config from '../config/env.js';
import { socketAuthMiddleware } from './socketAuth.js';
import { registerBoardHandlers, handleSocketDisconnect } from './boardHandlers.js';

export const initSocketIO = (httpServer) => {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: [
        config.clientUrl,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5174'
      ],
      credentials: true,
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected  | User: ${socket.user.id} | Socket: ${socket.id}`);

    registerBoardHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      console.log(
        `[Socket] Disconnected | User: ${socket.user.id} | Socket: ${socket.id} | Reason: ${reason}`
      );
      handleSocketDisconnect(io, socket);
    });
  });

  return io;
};

export default initSocketIO;
