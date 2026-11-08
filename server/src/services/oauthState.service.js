import crypto from 'crypto';
import config from '../config/env.js';

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const OAUTH_STATE_COOKIE_PREFIX = 'skribe_oauth_';
export const GOOGLE_CALLBACK_PATH = '/api/v1/auth/google/callback';

const ID_PATTERN = /^[a-f0-9]{16}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CLOCK_SKEW_MS = 60 * 1000;
const consumedStates = new Map();

const signingKey = () => crypto.createHash('sha256').update(`skribe-oauth-state:${config.jwtSecret}`).digest();
const sign = (id, secret, issuedAt) => crypto.createHmac('sha256', signingKey()).update(`${id}.${secret}.${issuedAt}`).digest('base64url');

export const stateCookieName = (id) => `${OAUTH_STATE_COOKIE_PREFIX}${id}`;

const cookieBase = () => ({ httpOnly: true, secure: config.isProd, sameSite: 'lax', path: GOOGLE_CALLBACK_PATH });

const pruneConsumed = (now) => {
  for (const [id, expiresAt] of consumedStates) if (expiresAt <= now) consumedStates.delete(id);
};

export const issueOAuthState = (res, { now = Date.now() } = {}) => {
  const id = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  res.cookie(stateCookieName(id), `${now}.${sign(id, secret, now)}`, { ...cookieBase(), maxAge: OAUTH_STATE_TTL_MS });
  return `${id}.${secret}`;
};

export const consumeOAuthState = (req, res, { now = Date.now() } = {}) => {
  pruneConsumed(now);
  const raw = typeof req.query?.state === 'string' ? req.query.state : '';
  if (!raw) return 'missing';
  const [id, secret, extra] = raw.split('.');
  if (extra !== undefined || !ID_PATTERN.test(id || '') || !SECRET_PATTERN.test(secret || '')) return 'malformed';
  const name = stateCookieName(id);
  const cookie = req.cookies?.[name];
  res.clearCookie(name, cookieBase());
  if (consumedStates.has(id)) return 'replayed';
  if (typeof cookie !== 'string') return 'missing_cookie';
  const [issuedAtRaw, cookieSignature, more] = cookie.split('.');
  const issuedAt = Number(issuedAtRaw);
  if (more !== undefined || !Number.isSafeInteger(issuedAt) || typeof cookieSignature !== 'string') return 'malformed';
  const expected = Buffer.from(sign(id, secret, issuedAt));
  const given = Buffer.from(cookieSignature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return 'mismatch';
  if (now - issuedAt > OAUTH_STATE_TTL_MS || issuedAt - now > CLOCK_SKEW_MS) return 'expired';
  consumedStates.set(id, issuedAt + OAUTH_STATE_TTL_MS);
  return 'ok';
};

export default { issueOAuthState, consumeOAuthState, stateCookieName };
