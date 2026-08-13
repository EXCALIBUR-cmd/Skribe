import mongoose from 'mongoose';
import { success } from '../utils/apiResponse.js';
import config from '../config/env.js';

const formatUptime = (seconds) => {
  const sec = Math.floor(seconds);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hrs = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hrs}h ${remMin}m ${remSec}s`;
};

const getDatabaseStatus = () => {
  const state = mongoose.connection.readyState;
  switch (state) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    case 0:
    default:
      return 'disconnected';
  }
};

export const getHealthStatus = (req, res) => {
  const dbStatus = getDatabaseStatus();
  const uptimeStr = formatUptime(process.uptime());

  const healthData = {
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    environment: config.nodeEnv,
    uptime: uptimeStr,
    database: dbStatus,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  };

  return success(res, healthData, 'Backend is healthy', 200);
};

export default {
  getHealthStatus
};
