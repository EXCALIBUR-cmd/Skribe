import { verifyAccessToken } from '../utils/jwt.js';
import userRepository from '../repositories/user.repository.js';
import { error } from '../utils/apiResponse.js';
import { COOKIE_NAME } from '../utils/cookieOptions.js';

export const authenticateSession = async (req, res, next) => {
  try {
    let token = null;

    if (req.cookies && req.cookies[COOKIE_NAME]) {
      token = req.cookies[COOKIE_NAME];
    }

    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return error(res, 'Authentication token missing. Please log in.', 401, { code: 'UNAUTHENTICATED' });
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (jwtErr) {
      return error(res, 'Authentication token is invalid or expired. Please log in again.', 401, { code: 'UNAUTHENTICATED' });
    }

    const user = await userRepository.findById(decoded.id);
    if (!user) {
      return error(res, 'Authenticated user account no longer exists.', 401, { code: 'UNAUTHENTICATED' });
    }

    req.user = user.toJSON();
    next();
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

export const authenticate = (req, res, next) => authenticateSession(req, res, (err) => (err ? next(err) : requireExpectedUser(req, res, next)));

export default authenticate;
