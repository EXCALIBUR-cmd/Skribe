import jwt from 'jsonwebtoken';
import config from '../config/env.js';

export const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;
export const PLACEHOLDER_JWT_SECRETS = Object.freeze(['fallback_jwt_secret_dev_key', 'secret', 'changeme', 'jwt_secret', 'your_jwt_secret']);

export const assertJwtSecret = (secret = config.jwtSecret, { production = config.isProd } = {}) => {
  const value = typeof secret === 'string' ? secret.trim() : '';
  if (!value) throw new Error('JWT_SECRET is not set. Set it to a long random value before starting the server.');
  if (production && PLACEHOLDER_JWT_SECRETS.includes(value.toLowerCase())) throw new Error('JWT_SECRET is a known placeholder value. Set it to a long random value before starting the server.');
  if (production && value.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) throw new Error(`JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production.`);
  return true;
};

export const generateAccessToken = (payload, expiresIn = '7d') => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload object is required to generate access token');
  }
  assertJwtSecret();
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
};

export const verifyAccessToken = (token) => {
  if (!token) {
    throw new Error('Token string is required for verification');
  }
  assertJwtSecret();
  return jwt.verify(token, config.jwtSecret);
};

export default {
  assertJwtSecret,
  generateAccessToken,
  verifyAccessToken
};
