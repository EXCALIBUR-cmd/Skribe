import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import mongoose from 'mongoose';
import passport from 'passport';
import config from '../config/env.js';
import User from '../models/User.js';
import { GOOGLE_CALLBACK_PATH, OAUTH_STATE_TTL_MS, consumeOAuthState, issueOAuthState, stateCookieName } from '../services/oauthState.service.js';
import { loginAccountLimiter, loginAddressLimiter, registerAddressLimiter } from '../middleware/rateLimit.middleware.js';

const TEST_DB_NAME = `skribe_google_oauth_test_${process.pid}_${Date.now()}`;
const TEST_MONGO_BASE = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
let mongoAvailable = false;
try {
  await mongoose.connect(`${TEST_MONGO_BASE}/${TEST_DB_NAME}`, { serverSelectionTimeoutMS: 1500 });
  mongoAvailable = true;
} catch {
  mongoAvailable = false;
}
const needsMongo = { skip: mongoAvailable ? false : `MongoDB is not reachable at ${TEST_MONGO_BASE}` };

const saved = { ...config };
Object.assign(config, { jwtSecret: 'skribe-test-only-jwt-secret-for-google-oauth-tests-01', googleClientId: 'test-client-id', googleClientSecret: 'test-client-secret', googleCallbackUrl: 'http://127.0.0.1/api/v1/auth/google/callback', googleConfigured: true, googleAuthEnabled: true });
const { default: app } = await import('../app.js');
const strategy = passport._strategy('google');

const google = { exchange: 'ok', profile: null };
strategy._oauth2.getOAuthAccessToken = (code, params, callback) => (google.exchange === 'ok' ? callback(null, 'access-token', 'refresh-token', {}) : callback(new Error('token exchange failed')));
strategy.userProfile = (accessToken, done) => done(null, google.profile);
const profileFor = (id, email, verified = true) => ({ id, displayName: 'Google Person', emails: [{ value: email, verified }], photos: [] });

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v1/auth`;

test.after(async () => {
  Object.assign(config, saved);
  await new Promise((resolve) => server.close(resolve));
  if (mongoAvailable && mongoose.connection.name === TEST_DB_NAME) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const setCookies = (response) => response.headers.getSetCookie();
const cookiePair = (header) => header.split(';')[0];
const startAttempt = async () => {
  const response = await fetch(`${base}/google`, { redirect: 'manual' });
  const location = new URL(response.headers.get('location'));
  const cookie = setCookies(response).find((c) => c.startsWith('skribe_oauth_'));
  return { status: response.status, location, state: location.searchParams.get('state'), cookie, jar: cookie ? cookiePair(cookie) : '' };
};
const callback = async (query, jar = '') => {
  const response = await fetch(`${base}/google/callback?${new URLSearchParams(query)}`, { redirect: 'manual', headers: jar ? { cookie: jar } : {} });
  const cookies = setCookies(response);
  return { status: response.status, location: response.headers.get('location'), session: cookies.find((c) => c.startsWith('skribe_token=') && !/skribe_token=;/.test(c)) || null, cleared: cookies.filter((c) => /^skribe_oauth_[a-f0-9]{16}=;/.test(c)) };
};
const fakeRes = () => { const cookies = []; return { cookies, cookie: (name, value, options) => cookies.push({ name, value, options }), clearCookie: (name, options) => cookies.push({ name, cleared: true, options }) }; };

test('the authorization redirect carries an unpredictable per-attempt state and binds it with a short-lived, path-restricted, Lax, HttpOnly cookie', async () => {
  const a = await startAttempt();
  const b = await startAttempt();
  assert.equal(a.status, 302);
  assert.equal(a.location.hostname, 'accounts.google.com');
  assert.equal(a.location.searchParams.get('client_id'), 'test-client-id');
  assert.match(a.state, /^[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.state, b.state);
  assert.match(a.cookie, new RegExp(`^${stateCookieName(a.state.split('.')[0])}=`));
  assert.match(a.cookie, /HttpOnly/);
  assert.match(a.cookie, /SameSite=Lax/);
  assert.match(a.cookie, new RegExp(`Path=${GOOGLE_CALLBACK_PATH.replace(/\//g, '\\/')}`));
  assert.match(a.cookie, /Max-Age=600/);
  assert.equal(a.cookie.includes(a.state.split('.')[1]), false);
  assert.equal(/Secure/.test(a.cookie), false);
  config.isProd = true;
  try {
    assert.match((await startAttempt()).cookie, /Secure/);
  } finally {
    config.isProd = saved.isProd;
  }
});

test('the state module rejects missing, malformed, mismatched, tampered, expired, future-dated, missing-cookie and replayed states, and accepts a valid one once', () => {
  const t0 = 1_800_000_000_000;
  const issue = () => { const res = fakeRes(); const state = issueOAuthState(res, { now: t0 }); const { name, value } = res.cookies[0]; return { state, name, value }; };
  const check = (state, cookies, now = t0 + 1000) => consumeOAuthState({ query: state === undefined ? {} : { state }, cookies }, fakeRes(), { now });
  const a = issue();
  assert.equal(check(undefined, {}), 'missing');
  for (const bad of ['x', 'abc.def', `${a.state}.extra`, `${a.state.split('.')[0]}.short`, `ZZZZ${a.state.slice(4)}`]) assert.equal(check(bad, { [a.name]: a.value }), 'malformed', bad);
  const [id, secret] = a.state.split('.');
  assert.equal(check(`${id}.${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`, { [a.name]: a.value }), 'mismatch');
  assert.equal(check(a.state, { [a.name]: `${t0}.${'x'.repeat(43)}` }), 'mismatch');
  assert.equal(check(a.state, { [a.name]: `${t0 - 1}.${a.value.split('.')[1]}` }), 'mismatch');
  assert.equal(check(a.state, {}), 'missing_cookie');
  assert.equal(check(a.state, { [a.name]: a.value }, t0 + OAUTH_STATE_TTL_MS + 1), 'expired');
  assert.equal(check(a.state, { [a.name]: a.value }, t0 - 2 * 60 * 1000), 'expired');
  const b = issue();
  const res = fakeRes();
  assert.equal(consumeOAuthState({ query: { state: b.state }, cookies: { [b.name]: b.value } }, res, { now: t0 + 1000 }), 'ok');
  assert.deepEqual(res.cookies.map((c) => [c.name, c.cleared]), [[b.name, true]]);
  assert.equal(check(b.state, { [b.name]: b.value }, t0 + 2000), 'replayed');
});

test('a valid Google sign-in issues exactly one session after state validation, and replaying the callback issues nothing', needsMongo, async () => {
  google.exchange = 'ok';
  google.profile = profileFor('google-valid-1', `valid_${Date.now()}@example.com`);
  const attempt = await startAttempt();
  const ok = await callback({ code: 'auth-code', state: attempt.state }, attempt.jar);
  assert.equal(ok.status, 302);
  assert.equal(ok.location, `${config.clientUrl}/start`);
  assert.ok(ok.session);
  assert.match(ok.session, /HttpOnly/);
  assert.equal(ok.cleared.length, 1);
  const replay = await callback({ code: 'auth-code', state: attempt.state }, attempt.jar);
  assert.equal(replay.location, `${config.clientUrl}/signin?error=oauth_state`);
  assert.equal(replay.session, null);
});

test('invalid callbacks never reach Google and never issue a session: missing, malformed, mismatched and cookie-less states', needsMongo, async () => {
  google.exchange = 'ok';
  google.profile = profileFor('google-never', `never_${Date.now()}@example.com`);
  let exchanges = 0;
  const original = strategy._oauth2.getOAuthAccessToken;
  strategy._oauth2.getOAuthAccessToken = (...args) => { exchanges += 1; return original(...args); };
  try {
    const attempt = await startAttempt();
    const [id, secret] = attempt.state.split('.');
    for (const [query, jar] of [[{ code: 'c' }, attempt.jar], [{ code: 'c', state: 'bogus' }, attempt.jar], [{ code: 'c', state: `${id}.${secret.replace(/^./, (ch) => (ch === 'A' ? 'B' : 'A'))}` }, attempt.jar], [{ code: 'c', state: attempt.state }, '']]) {
      const result = await callback(query, jar);
      assert.equal(result.location, `${config.clientUrl}/signin?error=oauth_state`);
      assert.equal(result.session, null);
    }
    assert.equal(exchanges, 0);
    assert.equal(await User.countDocuments({ googleId: 'google-never' }), 0);
  } finally {
    strategy._oauth2.getOAuthAccessToken = original;
  }
});

test('cancellation, provider errors and a failed token exchange leave the browser signed out and consume the state', needsMongo, async () => {
  google.profile = profileFor('google-cancel', `cancel_${Date.now()}@example.com`);
  const cancelled = await startAttempt();
  assert.deepEqual((await callback({ error: 'access_denied', state: cancelled.state }, cancelled.jar)).location, `${config.clientUrl}/signin?error=oauth_cancelled`);
  const provider = await startAttempt();
  const providerResult = await callback({ error: 'server_error', state: provider.state }, provider.jar);
  assert.equal(providerResult.location, `${config.clientUrl}/signin?error=oauth_failed`);
  assert.equal(providerResult.session, null);
  google.exchange = 'fail';
  const failing = await startAttempt();
  const failed = await callback({ code: 'auth-code', state: failing.state }, failing.jar);
  assert.equal(failed.location, `${config.clientUrl}/signin?error=oauth_failed`);
  assert.equal(failed.session, null);
  google.exchange = 'ok';
  assert.equal((await callback({ code: 'auth-code', state: failing.state }, failing.jar)).location, `${config.clientUrl}/signin?error=oauth_state`);
  assert.equal(await User.countDocuments({ googleId: 'google-cancel' }), 0);
});

test('two tabs can sign in independently in either order, and neither state works with the other tab\'s secret', needsMongo, async () => {
  google.exchange = 'ok';
  const first = await startAttempt();
  const second = await startAttempt();
  const [firstId] = first.state.split('.');
  const [, secondSecret] = second.state.split('.');
  const crossed = await callback({ code: 'c', state: `${firstId}.${secondSecret}` }, `${first.jar}; ${second.jar}`);
  assert.equal(crossed.location, `${config.clientUrl}/signin?error=oauth_state`);
  const third = await startAttempt();
  const fourth = await startAttempt();
  google.profile = profileFor('google-tab-b', `tab_b_${Date.now()}@example.com`);
  const b = await callback({ code: 'c', state: fourth.state }, `${third.jar}; ${fourth.jar}`);
  google.profile = profileFor('google-tab-a', `tab_a_${Date.now()}@example.com`);
  const a = await callback({ code: 'c', state: third.state }, `${third.jar}; ${fourth.jar}`);
  assert.ok(b.session);
  assert.ok(a.session);
  assert.equal(b.location, `${config.clientUrl}/start`);
  assert.equal(a.location, `${config.clientUrl}/start`);
});

test('an unverified Google email signs no one in and never attaches to an existing password account; a verified one links by policy', needsMongo, async () => {
  google.exchange = 'ok';
  const email = `existing_${Date.now()}@example.com`;
  const existing = await User.create({ name: 'Existing Person', email, password: 'password123' });
  google.profile = profileFor('google-unverified', email, false);
  const unverified = await startAttempt();
  const refused = await callback({ code: 'c', state: unverified.state }, unverified.jar);
  assert.equal(refused.location, `${config.clientUrl}/signin?error=oauth_email_unverified`);
  assert.equal(refused.session, null);
  assert.equal((await User.findById(existing._id).lean()).googleId ?? null, null);
  google.profile = profileFor('google-verified', email, true);
  const verified = await startAttempt();
  const linked = await callback({ code: 'c', state: verified.state }, verified.jar);
  assert.ok(linked.session);
  assert.equal((await User.findById(existing._id).lean()).googleId, 'google-verified');
});

test('email and password registration and sign-in still work', needsMongo, async () => {
  loginAddressLimiter.reset();
  loginAccountLimiter.reset();
  registerAddressLimiter.reset();
  const email = `password_${Date.now()}@example.com`;
  const register = await fetch(`${base}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Password Person', email, password: 'Verify12345!' }) });
  assert.equal(register.status, 201);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Verify12345!' }) });
  assert.equal(login.status, 200);
  assert.ok(setCookies(login).some((c) => c.startsWith('skribe_token=') && /HttpOnly/.test(c)));
  const wrong = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Wrong12345!' }) });
  assert.equal(wrong.status, 401);
});
