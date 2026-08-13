import config from '../config/env.js';

export const COOKIE_NAME = 'skribe_token';

export const getCookieOptions = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: config.isProd ? 'strict' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
});

export const getClearCookieOptions = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: config.isProd ? 'strict' : 'lax'
});

export default {
  COOKIE_NAME,
  getCookieOptions,
  getClearCookieOptions
};
