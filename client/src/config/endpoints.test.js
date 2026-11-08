import assert from 'node:assert/strict';
import test from 'node:test';
import { DEV_API_ORIGIN, endpoints, resolveEndpoints } from './endpoints.js';
import apiClient from '../api/apiClient.js';
import { GOOGLE_SIGN_IN_URL, fetchAuthProviders } from '../api/authProviders.js';

test('local development defaults to the local API and socket server', () => {
  assert.deepEqual(resolveEndpoints({}), { apiOrigin: DEV_API_ORIGIN, apiBaseUrl: `${DEV_API_ORIGIN}/api/v1`, socketUrl: DEV_API_ORIGIN });
  assert.equal(endpoints.apiBaseUrl, `${DEV_API_ORIGIN}/api/v1`);
  assert.equal(apiClient.defaults.baseURL, endpoints.apiBaseUrl);
  assert.equal(GOOGLE_SIGN_IN_URL, `${endpoints.apiBaseUrl}/auth/google`);
});

test('one configured API origin drives requests and sockets, with an optional socket override', () => {
  assert.deepEqual(resolveEndpoints({ apiUrl: 'https://api.skribe.stream/', production: true }), { apiOrigin: 'https://api.skribe.stream', apiBaseUrl: 'https://api.skribe.stream/api/v1', socketUrl: 'https://api.skribe.stream' });
  assert.equal(resolveEndpoints({ apiUrl: 'https://api.skribe.stream', socketUrl: 'https://ws.skribe.stream', production: true }).socketUrl, 'https://ws.skribe.stream');
  assert.equal(resolveEndpoints({ apiUrl: 'http://localhost:5141' }).apiBaseUrl, 'http://localhost:5141/api/v1');
});

test('production builds refuse a missing, insecure, local or path-bearing API URL instead of targeting localhost', () => {
  assert.throws(() => resolveEndpoints({ production: true }), /VITE_API_URL must be set/);
  assert.throws(() => resolveEndpoints({ apiUrl: '   ', production: true }), /VITE_API_URL must be set/);
  assert.throws(() => resolveEndpoints({ apiUrl: 'http://api.skribe.stream', production: true }), /must use https/);
  assert.throws(() => resolveEndpoints({ apiUrl: 'https://localhost:5000', production: true }), /must not point at a local host/);
  assert.throws(() => resolveEndpoints({ apiUrl: 'https://127.0.0.1', production: true }), /must not point at a local host/);
  assert.throws(() => resolveEndpoints({ apiUrl: 'https://api.skribe.stream/api/v1', production: true }), /without a path/);
  assert.throws(() => resolveEndpoints({ apiUrl: 'api.skribe.stream', production: true }), /absolute URL/);
  assert.throws(() => resolveEndpoints({ apiUrl: 'ftp://api.skribe.stream', production: true }), /http or https/);
  assert.throws(() => resolveEndpoints({ apiUrl: 'https://api.skribe.stream', socketUrl: 'http://api.skribe.stream', production: true }), /VITE_SOCKET_URL must use https/);
});

test('the Google option is shown only when the server says it is available, and stays hidden on any failure', async () => {
  assert.deepEqual(await fetchAuthProviders({ get: async () => ({ data: { google: true } }) }), { google: true });
  assert.deepEqual(await fetchAuthProviders({ get: async () => ({ data: { google: 'yes' } }) }), { google: false });
  assert.deepEqual(await fetchAuthProviders({ get: async () => { throw new Error('offline'); } }), { google: false });
});
