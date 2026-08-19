import mongoose from 'mongoose';
import config from './env.js';


export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: config.isDev
    });

    console.log(`[MongoDB] Atlas/Database Connected: ${conn.connection.host} | DB Name: ${conn.connection.name}`);

    // Register Mongoose connection lifecycle listeners
    mongoose.connection.on('error', (err) => {
      console.error(`[MongoDB] Runtime Connection Error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[MongoDB] Database Disconnected');
    });

    return conn;
  } catch (error) {
    console.error(`[MongoDB] Initial Connection Failed: ${error.message}`);
    // In dev mode with local MongoDB fallback, do not crash immediately if Mongo is not running locally
    if (config.isProd) {
      process.exit(1);
    } else {
      console.warn('[MongoDB] Server continuing in offline DB mode for local development');
    }
  }
};

/**
 * Gracefully close MongoDB connection on application termination.
 */
export const disconnectDB = async () => {
  try {
    await mongoose.connection.close();
    console.log('[MongoDB] Connection closed through graceful app termination');
  } catch (err) {
    console.error(`[MongoDB] Error during disconnect: ${err.message}`);
  }
};

export default connectDB;
