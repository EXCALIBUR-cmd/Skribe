import crypto from 'node:crypto';
import { generateAccessToken } from './jwt.js';
import { COOKIE_NAME, getCookieOptions } from './cookieOptions.js';

export const GUEST_ROLE = 'guest';
export const GUEST_SESSION_SECONDS = 24 * 60 * 60;
export const GUEST_BOARD_LIFETIME_MS = GUEST_SESSION_SECONDS * 1000;
export const GUEST_ID_PATTERN = /^guest_[a-f0-9]{24}$/;
export const MAX_GUEST_BOARD_OBJECTS = 500;
export const GUEST_CLEANUP_LIMIT = 3;
const GUEST_NAME_PATTERN = /^Guest-\d{4}$/;

export const createGuestIdentity = () => ({
  guestId: `guest_${crypto.randomBytes(12).toString('hex')}`,
  name: `Guest-${crypto.randomInt(1000, 10000)}`
});

export const issueGuestToken = ({ guestId, name }) => generateAccessToken({ role: GUEST_ROLE, guestId, name }, GUEST_SESSION_SECONDS);

export const isGuestClaims = (claims) => claims?.role === GUEST_ROLE;

export const guestPrincipal = (claims) => {
  if (!isGuestClaims(claims) || !GUEST_ID_PATTERN.test(String(claims.guestId)) || !GUEST_NAME_PATTERN.test(String(claims.name))) return null;
  return { id: claims.guestId, name: claims.name, role: GUEST_ROLE, isGuest: true, avatar: null };
};

export const isGuestUser = (user) => user?.role === GUEST_ROLE;

const MAX_IMAGE_SCAN_DEPTH = 64;

export const hasImageContent = (value, depth = 0) => {
  if (value === null || typeof value !== 'object') return false;
  if (depth > MAX_IMAGE_SCAN_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => hasImageContent(item, depth + 1));
  if (typeof value.type === 'string' && value.type.toLowerCase() === 'image') return true;
  if (typeof value.assetId === 'string' && value.assetId) return true;
  if (typeof value.src === 'string' && value.src) return true;
  return Object.values(value).some((child) => hasImageContent(child, depth + 1));
};

export const newGuestPrincipal = () => guestPrincipal({ role: GUEST_ROLE, ...createGuestIdentity() });

export const setGuestSessionCookie = (res, guest) => res.cookie(COOKIE_NAME, issueGuestToken({ guestId: guest.id, name: guest.name }), { ...getCookieOptions(), maxAge: GUEST_BOARD_LIFETIME_MS });
