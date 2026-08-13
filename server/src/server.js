import { createServer } from 'http';
import app from './app.js';
import config from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { initSocketIO } from './sockets/index.js';

const startServer = async () => {
  try {

    await connectDB();

    const httpServer = createServer(app);

    const io = initSocketIO(httpServer);

    app.set('io', io);

    httpServer.listen(config.port, '0.0.0.0', () => {
      console.log(`\n==================================================`);
      console.log(`🚀 Skribe Backend Server running in [${config.nodeEnv}] mode`);
      console.log(`📡 HTTP:  http://localhost:${config.port}`);
      console.log(`🔌 WS:    ws://localhost:${config.port}`);
      console.log(`🏥 Health: http://localhost:${config.port}/api/v1/health`);
      console.log(`==================================================\n`);
    });

    process.on('unhandledRejection', (err) => {
      console.error(`[UnhandledRejection] ${err.message}`);
      httpServer.close(async () => {
        await disconnectDB();
        process.exit(1);
      });
    });

    process.on('uncaughtException', (err) => {
      console.error(`[UncaughtException] ${err.message}`);
      httpServer.close(async () => {
        await disconnectDB();
        process.exit(1);
      });
    });

    const handleShutdown = async (signal) => {
      console.log(`\n[Server] ${signal} received — closing HTTP server & MongoDB…`);
      httpServer.close(async () => {
        await disconnectDB();
        console.log('[Server] Graceful shutdown complete.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  } catch (error) {
    console.error(`[ServerStartError] ${error.message}`);
    process.exit(1);
  }
};

startServer();
