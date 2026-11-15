import authService from '../services/auth.service.js';
import boardService from '../services/board.service.js';
import userRepository from '../repositories/user.repository.js';
import { error, success } from '../utils/apiResponse.js';
import { COOKIE_NAME, getCookieOptions, getClearCookieOptions } from '../utils/cookieOptions.js';
import config from '../config/env.js';
import passport from 'passport';
import { GOOGLE_CALLBACK_PATH, OAUTH_STATE_TTL_MS, consumeOAuthState, issueOAuthState } from '../services/oauthState.service.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { guestPrincipal, isGuestClaims, newGuestPrincipal, setGuestSessionCookie } from '../utils/guest.js';
import { getSocketServer } from '../sockets/index.js';
import { boardRoomName } from '../sockets/boardHandlers.js';

export const GUEST_CLAIM_COOKIE = 'skribe_guest_claim';

const guestClaimCookieOptions = () => ({ httpOnly: true, secure: config.isProd, sameSite: 'lax', path: GOOGLE_CALLBACK_PATH });

const guestFromToken = (token) => {
  if (typeof token !== 'string' || !token) return null;
  try {
    return guestPrincipal(verifyAccessToken(token));
  } catch {
    return null;
  }
};

const claimGuestWork = async (guest, user, via) => {
  if (!guest || !user?.id) return [];
  try {
    const { ownedBoards } = await boardService.claimGuestWork(guest, user.id, via);
    ownedBoards.forEach((boardId) => getSocketServer()?.to(boardRoomName(boardId)).emit('board:converted', { boardId }));
    return ownedBoards;
  } catch (err) {
    console.error(JSON.stringify({ event: 'guest_conversion_failed', guestId: guest.id, via, message: err.message }));
    return [];
  }
};

export class AuthController {

  async register(req, res, next) {
    try {
      const { name, email, password } = req.body;
      const guest = guestFromToken(req.cookies?.[COOKIE_NAME]);
      const { user, token } = await authService.registerUser({ name, email, password });
      const claimedBoardIds = await claimGuestWork(guest, user, 'register');

      res.cookie(COOKIE_NAME, token, getCookieOptions());

      return success(res, { user, claimedBoardIds }, 'User registered successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  async startGuest(req, res, next) {
    try {
      const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null;
      const token = req.cookies?.[COOKIE_NAME] || bearer;
      let claims = null;
      if (token) {
        try {
          claims = verifyAccessToken(token);
        } catch {
          claims = null;
        }
      }
      if (claims && !isGuestClaims(claims)) return error(res, 'You are already signed in.', 409, { code: 'ALREADY_SIGNED_IN' });
      let guest = claims ? guestPrincipal(claims) : null;
      let issue = !guest;
      if (!guest) guest = newGuestPrincipal();
      let result = await boardService.startGuestBoard(guest);
      if (result.expired) {
        guest = newGuestPrincipal();
        issue = true;
        result = await boardService.startGuestBoard(guest);
      }
      if (issue) setGuestSessionCookie(res, guest);
      return success(res, { user: guest, board: result.board }, 'Guest board ready', result.created ? 201 : 200);
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const guest = guestFromToken(req.cookies?.[COOKIE_NAME]);
      const { user, token } = await authService.loginUser({ email, password });
      const claimedBoardIds = await claimGuestWork(guest, user, 'login');

      res.cookie(COOKIE_NAME, token, getCookieOptions());

      return success(res, { user, claimedBoardIds }, 'Login successful', 200);
    } catch (err) {
      next(err);
    }
  }

  startGoogle(req, res, next) {
    const sessionToken = req.cookies?.[COOKIE_NAME];
    if (guestFromToken(sessionToken)) res.cookie(GUEST_CLAIM_COOKIE, sessionToken, { ...guestClaimCookieOptions(), maxAge: OAUTH_STATE_TTL_MS });
    const state = issueOAuthState(res);
    return passport.authenticate('google', { scope: ['profile', 'email'], session: false, state })(req, res, next);
  }

  googleCallback(req, res, next) {
    const fail = (code) => res.redirect(`${config.clientUrl}/signin?error=${code}`);
    const claimToken = req.cookies?.[GUEST_CLAIM_COOKIE];
    if (claimToken) res.clearCookie(GUEST_CLAIM_COOKIE, guestClaimCookieOptions());
    const verdict = consumeOAuthState(req, res);
    if (verdict !== 'ok') {
      console.warn(`[AuthController] Google callback refused: state ${verdict}`);
      return fail('oauth_state');
    }
    if (typeof req.query.error === 'string') return fail(req.query.error === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed');
    return passport.authenticate('google', { session: false }, async (err, result) => {
      if (err || !result?.token) {
        if (err) console.error('[AuthController] Google sign-in failed:', err.code || err.name || 'error');
        return fail(err?.code === 'GOOGLE_EMAIL_UNVERIFIED' ? 'oauth_email_unverified' : 'oauth_failed');
      }
      await claimGuestWork(guestFromToken(claimToken), result.user, 'google');
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
