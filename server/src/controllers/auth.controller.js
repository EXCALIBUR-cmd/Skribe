import authService from '../services/auth.service.js';
import boardService from '../services/board.service.js';
import userRepository from '../repositories/user.repository.js';
import { error, success } from '../utils/apiResponse.js';
import { COOKIE_NAME, getCookieOptions, getClearCookieOptions } from '../utils/cookieOptions.js';
import config from '../config/env.js';
import passport from 'passport';
import { GOOGLE_CALLBACK_PATH, OAUTH_STATE_TTL_MS, consumeOAuthState, issueOAuthState } from '../services/oauthState.service.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { guestPrincipal, isGuestClaims, isGuestUser, newGuestPrincipal, setGuestSessionCookie } from '../utils/guest.js';
import { getSocketServer } from '../sockets/index.js';
import { boardRoomName } from '../sockets/boardHandlers.js';

export const GUEST_CLAIM_COOKIE = 'skribe_guest_claim';

const guestClaimCookieOptions = () => ({ httpOnly: true, secure: config.isProd, sameSite: 'lax', path: GOOGLE_CALLBACK_PATH });

export const PENDING_CLAIM_COOKIE = 'skribe_pending_claim';

const pendingClaimCookieOptions = () => ({ httpOnly: true, secure: config.isProd, sameSite: config.isProd ? 'strict' : 'lax', path: '/api/v1/auth' });

const guestSessionFrom = (token) => {
  if (typeof token !== 'string' || !token) return null;
  try {
    const claims = verifyAccessToken(token);
    const guest = guestPrincipal(claims);
    return guest ? { guest, token, exp: claims.exp } : null;
  } catch {
    return null;
  }
};

const guestFromToken = (token) => guestSessionFrom(token)?.guest || null;

const hoursLeft = (exp) => Math.max(0, Math.ceil((exp * 1000 - Date.now()) / (60 * 60 * 1000)));

const attemptClaim = async (guest, user, via) => {
  const { ownedBoards } = await boardService.claimGuestWork(guest, user.id, via);
  ownedBoards.forEach((boardId) => getSocketServer()?.to(boardRoomName(boardId)).emit('board:converted', { boardId }));
  return ownedBoards;
};

const logClaimFailure = (guest, via, attempt, err) => console.error(JSON.stringify({ event: 'guest_conversion_failed', guestId: guest.id, via, attempt, message: err.message }));

const claimGuestWork = async (res, session, user, via) => {
  if (!session || !user?.id) return { claimedBoardIds: [] };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return { claimedBoardIds: await attemptClaim(session.guest, user, via) };
    } catch (err) {
      logClaimFailure(session.guest, via, attempt, err);
    }
  }
  res.cookie(PENDING_CLAIM_COOKIE, session.token, { ...pendingClaimCookieOptions(), maxAge: Math.max(0, session.exp * 1000 - Date.now()) });
  return { claimedBoardIds: [], pendingClaim: { hoursLeft: hoursLeft(session.exp) } };
};

export class AuthController {

  async register(req, res, next) {
    try {
      const { name, email, password } = req.body;
      const session = guestSessionFrom(req.cookies?.[COOKIE_NAME]);
      const { user, token } = await authService.registerUser({ name, email, password });
      const claim = await claimGuestWork(res, session, user, 'register');

      res.cookie(COOKIE_NAME, token, getCookieOptions());

      return success(res, { user, ...claim }, 'User registered successfully', 201);
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
      const session = guestSessionFrom(req.cookies?.[COOKIE_NAME]);
      const { user, token } = await authService.loginUser({ email, password });
      const claim = await claimGuestWork(res, session, user, 'login');

      res.cookie(COOKIE_NAME, token, getCookieOptions());

      return success(res, { user, ...claim }, 'Login successful', 200);
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
      await claimGuestWork(res, guestSessionFrom(claimToken), result.user, 'google');
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
      const pending = isGuestUser(req.user) ? null : guestSessionFrom(req.cookies?.[PENDING_CLAIM_COOKIE]);
      return success(res, { user: req.user, ...(pending ? { pendingClaim: { hoursLeft: hoursLeft(pending.exp) } } : {}) }, 'Current user profile retrieved successfully', 200);
    } catch (err) {
      next(err);
    }
  }

  async completeGuestClaim(req, res, next) {
    try {
      const session = guestSessionFrom(req.cookies?.[PENDING_CLAIM_COOKIE]);
      if (!session) {
        res.clearCookie(PENDING_CLAIM_COOKIE, pendingClaimCookieOptions());
        return error(res, 'There is no guest board waiting to be moved.', 404, { code: 'NOTHING_TO_CLAIM' });
      }
      try {
        const claimedBoardIds = await attemptClaim(session.guest, req.user, 'retry');
        res.clearCookie(PENDING_CLAIM_COOKIE, pendingClaimCookieOptions());
        return success(res, { claimedBoardIds }, 'Your board is now in your account', 200);
      } catch (err) {
        logClaimFailure(session.guest, 'retry', 1, err);
        return error(res, 'We couldn\'t move your board yet. Please try again.', 503, { code: 'CLAIM_FAILED', hoursLeft: hoursLeft(session.exp) });
      }
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
