import { error } from '../utils/apiResponse.js';

export const createRateLimiter = ({ windowMs, limit, key, message, now = () => Date.now(), maxKeys = 50000 }) => {
  const hits = new Map();
  const prune = (time) => {
    if (hits.size < maxKeys) return;
    for (const [id, entry] of hits) if (entry.resetAt <= time) hits.delete(id);
  };
  const middleware = (req, res, next) => {
    const id = key(req);
    if (!id) return next();
    const time = now();
    let entry = hits.get(id);
    if (!entry || entry.resetAt <= time) {
      prune(time);
      entry = { count: 0, resetAt: time + windowMs };
      hits.set(id, entry);
    }
    entry.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - time) / 1000));
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
    res.set('RateLimit-Reset', String(retryAfterSeconds));
    if (entry.count > limit) {
      res.set('Retry-After', String(retryAfterSeconds));
      return error(res, message, 429, { code: 'RATE_LIMITED', retryAfterSeconds });
    }
    return next();
  };
  middleware.reset = () => hits.clear();
  return middleware;
};

const clientAddress = (req) => String(req.ip || req.socket?.remoteAddress || 'unknown');
const accountKey = (req) => String(req.body?.email || '').trim().toLowerCase();

export const loginAddressLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  key: (req) => `login-ip:${clientAddress(req)}`,
  message: 'Too many sign-in attempts from this network. Please wait a few minutes and try again.'
});

export const loginAccountLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  key: (req) => (accountKey(req) ? `login-account:${accountKey(req)}:${clientAddress(req)}` : null),
  message: 'Too many sign-in attempts for this account. Please wait a few minutes and try again.'
});

export const registerAddressLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  key: (req) => `register-ip:${clientAddress(req)}`,
  message: 'Too many accounts were created from this network recently. Please try again later.'
});
