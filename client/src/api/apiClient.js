import axios from 'axios';

export const apiClient = axios.create({
  baseURL: 'http://localhost:5000/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

let expectedUserId = null;
let sessionUserId;
let refusedHandler = null;

const OPEN_PATHS = new Set(['/auth/me', '/auth/login', '/auth/register', '/auth/logout']);

const IDENTITY_REFUSAL = Object.freeze({ success: false, message: 'This page was opened by a different account than the one now signed in. Nothing was changed.', errors: { code: 'IDENTITY_MISMATCH' } });

export const setExpectedUser = (id) => {
  expectedUserId = id ? String(id) : null;
};

export const getExpectedUser = () => expectedUserId;

export const setSessionUser = (id) => {
  sessionUserId = id === undefined ? undefined : (id ? String(id) : null);
};

export const setSessionRefusedHandler = (handler) => {
  refusedHandler = typeof handler === 'function' ? handler : null;
};

apiClient.interceptors.request.use((config) => {
  if (expectedUserId && sessionUserId !== undefined && sessionUserId !== expectedUserId && !OPEN_PATHS.has(String(config.url || '').split('?')[0])) {
    return Promise.reject(Object.assign(new Error(IDENTITY_REFUSAL.message), { skribeLocal: true, response: { status: 409, data: IDENTITY_REFUSAL } }));
  }
  if (expectedUserId) config.headers['X-Skribe-User'] = expectedUserId;
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    if (!error?.skribeLocal && error?.response?.data?.errors?.code === 'IDENTITY_MISMATCH') refusedHandler?.();
    const errorResponse = error.response?.data || {
      success: false,
      message: error.message || 'Network error occurred. Please check your connection.'
    };
    return Promise.reject(errorResponse);
  }
);

export default apiClient;
