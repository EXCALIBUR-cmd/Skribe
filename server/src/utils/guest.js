import crypto from 'node:crypto';
import { generateAccessToken } from './jwt.js';

export const GUEST_ROLE = 'guest';
export const GUEST_SESSION_SECONDS = 24 * 60 * 60;
export const GUEST_BOARD_LIFETIME_MS = GUEST_SESSION_SECONDS * 1000;
export const GUEST_ID_PATTERN = /^guest_[a-f0-9]{24}$/;
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
