import authService from '../services/auth.service.js';
import { success } from '../utils/apiResponse.js';
import { COOKIE_NAME, getCookieOptions, getClearCookieOptions } from '../utils/cookieOptions.js';
import config from '../config/env.js';

export class AuthController {

  async register(req, res, next) {
    try {
      const { name, email, password } = req.body;
      const { user, token } = await authService.registerUser({ name, email, password });

      res.cookie(COOKIE_NAME, token, getCookieOptions());

      return success(res, { user }, 'User registered successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const { user, token } = await authService.loginUser({ email, password });

      res.cookie(COOKIE_NAME, token, getCookieOptions());

      return success(res, { user }, 'Login successful', 200);
    } catch (err) {
      next(err);
    }
  }

  async googleCallback(req, res, next) {
    try {
      if (!req.user || !req.user.token) {
        return res.redirect(`${config.clientUrl}/signin?error=oauth_failed`);
      }

      res.cookie(COOKIE_NAME, req.user.token, getCookieOptions());

      return res.redirect(`${config.clientUrl}/boards`);
    } catch (err) {
      console.error('[AuthController] Google callback error:', err.message);
      return res.redirect(`${config.clientUrl}/signin?error=oauth_failed`);
    }
  }

  async getMe(req, res, next) {
    try {
      return success(res, { user: req.user }, 'Current user profile retrieved successfully', 200);
    } catch (err) {
      next(err);
    }
  }

  async logout(req, res, next) {
    try {

      res.clearCookie(COOKIE_NAME, getClearCookieOptions());

      return success(res, null, 'Logged out successfully', 200);
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
export default authController;
