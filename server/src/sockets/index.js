import { Server as SocketIOServer } from 'socket.io';
import config from '../config/env.js';
import { socketAuthMiddleware } from './socketAuth.js';
import { registerBoardHandlers, handleSocketDisconnect } from './boardHandlers.js';

let socketServer = null;

export const getSocketServer = () => socketServer;

export const initSocketIO = (httpServer) => {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling'],
    allowRequest: (req, callback) => callback(null, !req.headers.origin || config.allowedOrigins.includes(req.headers.origin))
  });

  socketServer = io;
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
