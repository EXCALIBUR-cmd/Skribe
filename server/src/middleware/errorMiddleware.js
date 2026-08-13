import { error } from '../utils/apiResponse.js';
import config from '../config/env.js';

export const errorMiddleware = (err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  if (statusCode >= 500) {
    console.error(`[ServerError] Path: ${req.method} ${req.originalUrl} | Message: ${err.message}`);
  }

  const errorDetails = config.isDev && statusCode >= 500 ? err.stack : null;

  return error(res, message, statusCode, errorDetails);
};

export default errorMiddleware;
