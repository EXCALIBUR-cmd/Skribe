import { Server as SocketIOServer } from 'socket.io';
import config from '../config/env.js';
import { socketAuthMiddleware } from './socketAuth.js';
import { registerBoardHandlers } from './boardHandlers.js';

export const initSocketIO = (httpServer) => {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.clientUrl,
      credentials: true,
      methods: ['GET', 'POST']
    },

    transports: ['websocket', 'polling']
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected  | User: ${socket.user.id} | Socket: ${socket.id}`);

    registerBoardHandlers(socket);

    socket.on('disconnect', (reason) => {
      console.log(
        `[Socket] Disconnected | User: ${socket.user.id} | Socket: ${socket.id} | Reason: ${reason}`
      );

    });
  });

  return io;
};

export default initSocketIO;
