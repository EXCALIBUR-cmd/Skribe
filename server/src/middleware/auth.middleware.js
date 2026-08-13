import { verifyAccessToken } from '../utils/jwt.js';
import userRepository from '../repositories/user.repository.js';
import { error } from '../utils/apiResponse.js';
import { COOKIE_NAME } from '../utils/cookieOptions.js';

export const authenticate = async (req, res, next) => {
  try {
    let token = null;

    if (req.cookies && req.cookies[COOKIE_NAME]) {
      token = req.cookies[COOKIE_NAME];
    }

    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return error(res, 'Authentication token missing. Please log in.', 401);
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (jwtErr) {
      return error(res, 'Authentication token is invalid or expired. Please log in again.', 401);
    }

    const user = await userRepository.findById(decoded.id);
    if (!user) {
      return error(res, 'Authenticated user account no longer exists.', 401);
    }

    req.user = user.toJSON();
    next();
  } catch (err) {
    next(err);
  }
};

export default authenticate;
