import mongoose from 'mongoose';
import config from './env.js';

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: config.isDev
    });

    console.log(`[MongoDB] Atlas/Database Connected: ${conn.connection.host} | DB Name: ${conn.connection.name}`);

    mongoose.connection.on('error', (err) => {
      console.error(`[MongoDB] Runtime Connection Error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[MongoDB] Database Disconnected');
    });

    return conn;
  } catch (err) {
    console.error(`[MongoDB] FATAL: Initial Database Connection Failed: ${err.message}`);
    console.error('[MongoDB] Terminating process (Fail Fast Strategy)...');
    process.exit(1);
  }
};

export const disconnectDB = async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log('[MongoDB] Connection closed through graceful app termination');
    }
  } catch (err) {
    console.error(`[MongoDB] Error during disconnect: ${err.message}`);
  }
};

export default connectDB;
