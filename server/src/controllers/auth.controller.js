import authService from '../services/auth.service.js';
import boardService from '../services/board.service.js';
import userRepository from '../repositories/user.repository.js';
import { error, success } from '../utils/apiResponse.js';
import { COOKIE_NAME, getCookieOptions, getClearCookieOptions } from '../utils/cookieOptions.js';
import config from '../config/env.js';
import passport from 'passport';
import { consumeOAuthState, issueOAuthState } from '../services/oauthState.service.js';

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

  startGoogle(req, res, next) {
    const state = issueOAuthState(res);
    return passport.authenticate('google', { scope: ['profile', 'email'], session: false, state })(req, res, next);
  }

  googleCallback(req, res, next) {
    const fail = (code) => res.redirect(`${config.clientUrl}/signin?error=${code}`);
    const verdict = consumeOAuthState(req, res);
    if (verdict !== 'ok') {
      console.warn(`[AuthController] Google callback refused: state ${verdict}`);
      return fail('oauth_state');
    }
    if (typeof req.query.error === 'string') return fail(req.query.error === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed');
    return passport.authenticate('google', { session: false }, (err, result) => {
      if (err || !result?.token) {
        if (err) console.error('[AuthController] Google sign-in failed:', err.code || err.name || 'error');
        return fail(err?.code === 'GOOGLE_EMAIL_UNVERIFIED' ? 'oauth_email_unverified' : 'oauth_failed');
      }
      res.cookie(COOKIE_NAME, result.token, getCookieOptions());
      return res.redirect(`${config.clientUrl}/start`);
    })(req, res, next);
  }

  providers(req, res) {
    return success(res, { google: config.googleAuthEnabled }, 'Sign-in options', 200);
  }

  requireGoogle(req, res, next) {
    if (config.googleAuthEnabled) return next();
    return error(res, 'Google sign-in is not available.', 404, { code: 'GOOGLE_AUTH_DISABLED' });
  }

  async getMe(req, res, next) {
    try {
      return success(res, { user: req.user }, 'Current user profile retrieved successfully', 200);
    } catch (err) {
      next(err);
    }
  }

  async updatePreferences(req, res, next) {
    try {
      const updates = Object.fromEntries(Object.entries(req.body).map(([key, value]) => [`preferences.${key}`, value]));
      const user = await userRepository.updateUser(req.user.id, updates);
      if (!user) {
        const err = new Error('User not found');
        err.statusCode = 404;
        throw err;
      }
      return success(res, { preferences: user.toJSON().preferences }, 'Preferences updated successfully', 200);
    } catch (err) {
      next(err);
    }
  }

  async getLanding(req, res, next) {
    try {
      const path = await boardService.resolveLandingPath(req.user);
      return success(res, { path }, 'Landing page resolved', 200);
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
