import { verifyAccessToken } from '../utils/jwt.js';
import userRepository from '../repositories/user.repository.js';
import { error } from '../utils/apiResponse.js';
import { COOKIE_NAME } from '../utils/cookieOptions.js';
import { guestPrincipal, isGuestClaims, isGuestUser } from '../utils/guest.js';

const INVALID_SESSION = 'Authentication token is invalid or expired. Please log in again.';

const resolveSession = async (req) => {
  let token = null;

  if (req.cookies && req.cookies[COOKIE_NAME]) {
    token = req.cookies[COOKIE_NAME];
  }

  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) return { message: 'Authentication token missing. Please log in.' };

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (jwtErr) {
    return { message: INVALID_SESSION };
  }

  if (isGuestClaims(decoded)) {
    const guest = guestPrincipal(decoded);
    return guest ? { user: guest } : { message: INVALID_SESSION };
  }

  const user = await userRepository.findById(decoded.id);
  if (!user) return { message: 'Authenticated user account no longer exists.' };
  return { user: user.toJSON() };
};

export const authenticateSession = async (req, res, next) => {
  try {
    const { user, message } = await resolveSession(req);
    if (!user) return error(res, message, 401, { code: 'UNAUTHENTICATED' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

export const optionalSession = async (req, res, next) => {
  try {
    req.user = (await resolveSession(req)).user || null;
    if (!req.user) return next();
    return requireExpectedUser(req, res, next);
  } catch (err) {
    next(err);
  }
};

export const EXPECTED_USER_HEADER = 'x-skribe-user';

export const requireExpectedUser = (req, res, next) => {
  const expected = req.headers?.[EXPECTED_USER_HEADER];
  if (expected && expected !== String(req.user?.id ?? '')) {
    return error(res, 'This page was opened by a different account than the one now signed in. Nothing was changed.', 409, { code: 'IDENTITY_MISMATCH' });
  }
  return next();
};

export const rejectGuests = (req, res, next) => {
  if (isGuestUser(req.user)) return error(res, 'Sign up free to use this feature.', 403, { code: 'GUEST_NOT_ALLOWED' });
  return next();
};

export const authenticateAllowingGuests = (req, res, next) => authenticateSession(req, res, (err) => (err ? next(err) : requireExpectedUser(req, res, next)));

export const authenticate = (req, res, next) => authenticateSession(req, res, (err) => (err ? next(err) : rejectGuests(req, res, (guestErr) => (guestErr ? next(guestErr) : requireExpectedUser(req, res, next)))));

export default authenticate;
