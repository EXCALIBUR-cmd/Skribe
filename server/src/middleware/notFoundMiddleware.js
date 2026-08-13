import { error } from '../utils/apiResponse.js';

export const notFoundMiddleware = (req, res, next) => {
  return error(res, `Resource not found - ${req.originalUrl}`, 404);
};

export default notFoundMiddleware;
