export const DEV_API_ORIGIN = 'http://localhost:5000';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

const parseOrigin = (value, name, production) => {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error(`${name} must be an absolute URL such as https://api.example.com`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${name} must use http or https`);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be an origin without a path, such as https://api.example.com`);
  if (production && url.protocol !== 'https:') throw new Error(`${name} must use https in production builds`);
  if (production && LOCAL_HOSTNAMES.has(url.hostname)) throw new Error(`${name} must not point at a local host in production builds`);
  return url.origin;
};

export const resolveEndpoints = ({ apiUrl = '', socketUrl = '', production = false } = {}) => {
  const hasApiUrl = Boolean(String(apiUrl || '').trim());
  if (!hasApiUrl && production) throw new Error('VITE_API_URL must be set for production builds, for example https://api.skribe.stream');
  const apiOrigin = hasApiUrl ? parseOrigin(apiUrl, 'VITE_API_URL', production) : DEV_API_ORIGIN;
  const socketOrigin = String(socketUrl || '').trim() ? parseOrigin(socketUrl, 'VITE_SOCKET_URL', production) : apiOrigin;
  return { apiOrigin, apiBaseUrl: `${apiOrigin}/api/v1`, socketUrl: socketOrigin };
};

const readBuildEnv = () => {
  try {
    return { apiUrl: import.meta.env.VITE_API_URL, socketUrl: import.meta.env.VITE_SOCKET_URL, production: import.meta.env.PROD === true };
  } catch {
    return {};
  }
};

export const endpoints = resolveEndpoints(readBuildEnv());

export default endpoints;
