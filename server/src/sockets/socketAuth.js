import { verifyAccessToken } from '../utils/jwt.js';
import userRepository from '../repositories/user.repository.js';
import { COOKIE_NAME } from '../utils/cookieOptions.js';

const parseCookies = (cookieHeader = '') => {
  const result = {};
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    result[key] = decodeURIComponent(val);
  });
  return result;
};

export const socketAuthMiddleware = async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const cookies = parseCookies(cookieHeader);
    const token = cookies[COOKIE_NAME];

    if (!token) {
      return next(new Error('Authentication required: no session cookie present'));
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (jwtErr) {
      return next(new Error('Authentication required: token invalid or expired'));
    }

    const user = await userRepository.findById(decoded.id);
    if (!user) {
      return next(new Error('Authentication required: user account not found'));
    }

    const userJson = user.toJSON();
    socket.user = {
      id: userJson.id,
      name: userJson.name,
      email: userJson.email,
      avatar: userJson.avatar || null
    };

    next();
  } catch (err) {
    next(new Error(`Socket authentication error: ${err.message}`));
  }
};

export default socketAuthMiddleware;
