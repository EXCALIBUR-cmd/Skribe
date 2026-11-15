const SHARE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BOARD_PATH_PATTERN = /^\/board\/[a-f0-9]{24}$/;
const RETURN_KEY = 'skribe-return-to';
const shareKey = (boardId) => `skribe-share-link:${boardId}`;

export const isGuestUser = (user) => user?.role === 'guest';

export const guestHoursLeft = (expiresAt, now = Date.now()) => {
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - now) / (60 * 60 * 1000)));
};

export const buildShareLink = (origin, boardId, secret) => `${origin}/join/${boardId}#${secret}`;

export const readShareSecret = (hash) => {
  const secret = String(hash || '').replace(/^#/, '');
  return SHARE_SECRET_PATTERN.test(secret) ? secret : null;
};

const storage = (kind) => {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

const safely = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};

export const rememberShareSecret = (boardId, secret) => safely(() => storage('local')?.setItem(shareKey(boardId), secret));

export const recallShareSecret = (boardId) => {
  const secret = safely(() => storage('local')?.getItem(shareKey(boardId)));
  return readShareSecret(secret);
};

export const rememberReturnPath = (path) => {
  if (BOARD_PATH_PATTERN.test(String(path))) safely(() => storage('session')?.setItem(RETURN_KEY, path));
};

export const takeReturnPath = () => {
  const path = safely(() => storage('session')?.getItem(RETURN_KEY));
  safely(() => storage('session')?.removeItem(RETURN_KEY));
  return BOARD_PATH_PATTERN.test(String(path)) ? path : null;
};

export const GUEST_HIDDEN_NAV_PATHS = new Set(['/boards', '/ai-assist']);

export const navItemsFor = (items, isGuest) => (isGuest ? items.filter((item) => !GUEST_HIDDEN_NAV_PATHS.has(item.path)) : items);

export const pendingClaimMessage = (hours) => `We couldn't move your board yet; it's safe for ${hours} more ${hours === 1 ? 'hour' : 'hours'}.`;
