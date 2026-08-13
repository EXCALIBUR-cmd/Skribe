import jwt from 'jsonwebtoken';
import config from '../config/env.js';

export const generateAccessToken = (payload, expiresIn = '7d') => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload object is required to generate access token');
  }
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
};

export const verifyAccessToken = (token) => {
  if (!token) {
    throw new Error('Token string is required for verification');
  }
  return jwt.verify(token, config.jwtSecret);
};

export default {
  generateAccessToken,
  verifyAccessToken
};
