import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { io as connectClient } from 'socket.io-client';
import config, { LOCAL_DEV_ORIGINS, buildConfig, validateConfig } from '../config/env.js';
import app from '../app.js';
import { initSocketIO } from '../sockets/index.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SECRETS = { JWT_SECRET: `jwt-${'s'.repeat(40)}`, GEMINI_API_KEY: 'gemini-value-should-never-print', IMAGEKIT_PRIVATE_KEY: 'imagekit-value-should-never-print', GOOGLE_CLIENT_SECRET: 'google-value-should-never-print', MONGODB_URI: 'mongodb+srv://user:password-should-never-print@cluster.example.net/skribe' };
const PRODUCTION = { NODE_ENV: 'production', CLIENT_URL: 'https://app.skribe.stream', MONGODB_URI: SECRETS.MONGODB_URI, JWT_SECRET: SECRETS.JWT_SECRET };

test('local development keeps localhost defaults, local origins and no proxy trust', () => {
  const cfg = buildConfig({});
  assert.equal(cfg.isProd, false);
  assert.equal(cfg.clientUrl, 'http://localhost:5173');
  assert.equal(cfg.mongoUri, 'mongodb://localhost:27017/skribe');
  assert.deepEqual(cfg.allowedOrigins, [...LOCAL_DEV_ORIGINS]);
  assert.equal(cfg.trustProxyHops, 0);
  assert.equal(cfg.googleAuthEnabled, false);
  assert.deepEqual(validateConfig(cfg), { errors: [], warnings: [] });
  assert.deepEqual(buildConfig({ CLIENT_URL: 'http://localhost:5241/' }).allowedOrigins, ['http://localhost:5241', ...LOCAL_DEV_ORIGINS]);
});

test('production never falls back to development values and names every missing setting', () => {
  const cfg = buildConfig({ NODE_ENV: 'production' });
  assert.equal(cfg.clientUrl, '');
  assert.equal(cfg.mongoUri, '');
  assert.deepEqual(cfg.allowedOrigins, []);
  const { errors } = validateConfig(cfg);
  assert.ok(errors.includes('MONGODB_URI is required in production.'));
  assert.ok(errors.includes('CLIENT_URL is required in production.'));
  for (const [clientUrl, message] of [['http://app.skribe.stream', /must use https/], ['https://localhost:5173', /local host/], ['https://app.skribe.stream/app', /without a path/], ['app.skribe.stream', /absolute https URL/]]) {
    assert.match(validateConfig(buildConfig({ ...PRODUCTION, CLIENT_URL: clientUrl })).errors.join(' '), message);
  }
});

test('a complete production configuration restricts origins to the app, trusts one proxy hop and never echoes secret values', () => {
  const cfg = buildConfig({ ...PRODUCTION, ...SECRETS, CLIENT_URL: 'https://app.skribe.stream/' });
  assert.equal(cfg.clientUrl, 'https://app.skribe.stream');
  assert.deepEqual(cfg.allowedOrigins, ['https://app.skribe.stream']);
  assert.equal(cfg.trustProxyHops, 1);
  const result = validateConfig(cfg);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((w) => w.startsWith('Image uploads are disabled')));
  assert.ok(result.warnings.includes('Google sign-in is disabled.'));
  const printed = JSON.stringify(result);
  for (const value of Object.values(SECRETS)) assert.equal(printed.includes(value), false);
});

test('Google sign-in is off in production unless explicitly enabled and fully configured with an https callback', () => {
  const creds = { GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: SECRETS.GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL: 'https://api.skribe.stream/api/v1/auth/google/callback' };
  assert.equal(buildConfig({ ...PRODUCTION, ...creds }).googleAuthEnabled, false);
  assert.equal(buildConfig({ ...PRODUCTION, ...creds, GOOGLE_AUTH_ENABLED: 'true' }).googleAuthEnabled, true);
  assert.deepEqual(validateConfig(buildConfig({ ...PRODUCTION, ...creds, GOOGLE_AUTH_ENABLED: 'true' })).errors, []);
  assert.match(validateConfig(buildConfig({ ...PRODUCTION, GOOGLE_AUTH_ENABLED: 'true' })).errors.join(' '), /GOOGLE_AUTH_ENABLED is true but/);
  assert.match(validateConfig(buildConfig({ ...PRODUCTION, ...creds, GOOGLE_CALLBACK_URL: 'http://api.skribe.stream/cb', GOOGLE_AUTH_ENABLED: 'true' })).errors.join(' '), /GOOGLE_CALLBACK_URL must use https/);
  assert.equal(buildConfig(creds).googleAuthEnabled, true);
  assert.equal(buildConfig({ ...creds, GOOGLE_AUTH_ENABLED: 'false' }).googleAuthEnabled, false);
});

test('a production server refuses to start with incomplete configuration and does not print secret values', async () => {
  const child = spawn(process.execPath, ['src/server.js'], { cwd: SERVER_DIR, windowsHide: true, env: { ...process.env, NODE_ENV: 'production', PORT: '0', JWT_SECRET: SECRETS.JWT_SECRET, CLIENT_URL: '', MONGODB_URI: '', GEMINI_API_KEY: SECRETS.GEMINI_API_KEY, GOOGLE_AUTH_ENABLED: 'false' } });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const code = await new Promise((resolve) => { const t = setTimeout(() => child.kill(), 20000); child.on('exit', (c) => { clearTimeout(t); resolve(c); }); });
  assert.equal(code, 1);
  assert.match(output, /\[ServerStartError\] Production configuration is incomplete\..*MONGODB_URI is required.*CLIENT_URL is required/);
  for (const value of [SECRETS.JWT_SECRET, SECRETS.GEMINI_API_KEY]) assert.equal(output.includes(value), false);
});

const listen = async (server) => { await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); return server.address().port; };

test('HTTP CORS answers only allowed origins, with credentials, and Google endpoints report and enforce availability', async () => {
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const ask = (origin, p = '/api/v1/health') => fetch(`http://127.0.0.1:${port}${p}`, { headers: origin ? { Origin: origin } : {} });
    const allowed = await ask(config.allowedOrigins[0]);
    assert.equal(allowed.headers.get('access-control-allow-origin'), config.allowedOrigins[0]);
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
    const foreign = await ask('https://evil.example');
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    const providers = await (await ask(null, '/api/v1/auth/providers')).json();
    assert.deepEqual(providers.data, { google: config.googleAuthEnabled });
    if (!config.googleAuthEnabled) {
      const google = await ask(null, '/api/v1/auth/google');
      assert.equal(google.status, 404);
      assert.equal((await google.json()).errors.code, 'GOOGLE_AUTH_DISABLED');
    }
    const saved = [...config.allowedOrigins];
    config.allowedOrigins.splice(0, config.allowedOrigins.length, 'https://app.skribe.stream');
    try {
      assert.equal((await ask('https://app.skribe.stream')).headers.get('access-control-allow-origin'), 'https://app.skribe.stream');
      assert.equal((await ask('http://localhost:5173')).headers.get('access-control-allow-origin'), null);
    } finally {
      config.allowedOrigins.splice(0, config.allowedOrigins.length, ...saved);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Socket.IO refuses WebSocket connections from origins that are not allowed', async () => {
  const server = http.createServer();
  const io = initSocketIO(server);
  const port = await listen(server);
  const attempt = (origin) => new Promise((resolve) => {
    const client = connectClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { origin } });
    client.once('connect', () => { client.disconnect(); resolve('connected'); });
    client.once('connect_error', (err) => { client.disconnect(); resolve(`refused: ${err.message}`); });
  });
  try {
    assert.match(await attempt('https://evil.example'), /^refused/);
    assert.match(await attempt(config.allowedOrigins[0]), /^refused: Authentication required/);
  } finally {
    io.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
