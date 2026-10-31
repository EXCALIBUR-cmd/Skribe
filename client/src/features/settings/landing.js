import { getBoardReturnPath } from './boardSettingsNavigation.js';

const AUTH_PATHS = new Set(['/signin', '/signup', '/start']);

export const resolvePostSignInPath = (from) => {
  const pathname = typeof from === 'string' ? from : from?.pathname;
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//') || AUTH_PATHS.has(pathname)) return '/start';
  const search = typeof from?.search === 'string' && from.search.startsWith('?') ? from.search : '';
  return `${pathname}${search}`;
};

export const resolveLandingTarget = (path) => (path === '/boards' || getBoardReturnPath({ from: path }) ? path : '/boards');
