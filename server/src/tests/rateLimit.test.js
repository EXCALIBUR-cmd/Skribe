import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import app from '../app.js';
import { createRateLimiter, loginAccountLimiter, loginAddressLimiter, registerAddressLimiter } from '../middleware/rateLimit.middleware.js';

const fakeRes = () => {
  const headers = {};
  return { headers, statusCode: 200, body: null, set(k, v) { headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
};

test('requests under the limit pass, the next is refused with a structured 429, and the window resets', () => {
  let clock = 1_000_000;
  const limiter = createRateLimiter({ windowMs: 60_000, limit: 3, key: (req) => req.id, message: 'Slow down', now: () => clock });
  const run = (id) => { const res = fakeRes(); let passed = false; limiter({ id }, res, () => { passed = true; }); return { passed, res }; };
  for (let i = 0; i < 3; i += 1) assert.equal(run('a').passed, true);
  const refused = run('a');
  assert.equal(refused.passed, false);
  assert.equal(refused.res.statusCode, 429);
  assert.deepEqual(refused.res.body, { success: false, message: 'Slow down', errors: { code: 'RATE_LIMITED', retryAfterSeconds: 60 } });
  assert.equal(refused.res.headers['Retry-After'], '60');
  assert.equal(run('b').passed, true);
  clock += 59_000;
  assert.equal(run('a').passed, false);
  clock += 1_000;
  assert.equal(run('a').passed, true);
  assert.equal(run('a').res.headers['RateLimit-Remaining'], '1');
});

test('requests with no identity are not limited, and stale entries are pruned when the table is full', () => {
  let clock = 0;
  const limiter = createRateLimiter({ windowMs: 1000, limit: 1, key: (req) => req.id, message: 'x', now: () => clock, maxKeys: 2 });
  let passed = 0;
  for (let i = 0; i < 5; i += 1) limiter({ id: null }, fakeRes(), () => { passed += 1; });
  assert.equal(passed, 5);
  limiter({ id: 'a' }, fakeRes(), () => {});
  limiter({ id: 'b' }, fakeRes(), () => {});
  clock = 2000;
  let fresh = false;
  limiter({ id: 'c' }, fakeRes(), () => { fresh = true; });
  assert.equal(fresh, true);
  let again = false;
  limiter({ id: 'a' }, fakeRes(), () => { again = true; });
  assert.equal(again, true);
});

test('the real login route limits each account per network, independently of other accounts', async () => {
  loginAddressLimiter.reset();
  loginAccountLimiter.reset();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const login = (email) => fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  try {
    const statuses = [];
    for (let i = 0; i < 10; i += 1) statuses.push((await login('Target@Example.com')).status);
    assert.ok(statuses.every((s) => s === 400));
    const limited = await login('target@example.com');
    assert.equal(limited.status, 429);
    const body = await limited.json();
    assert.equal(body.errors.code, 'RATE_LIMITED');
    assert.ok(body.errors.retryAfterSeconds > 0 && body.errors.retryAfterSeconds <= 900);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await login('someone-else@example.com')).status, 400);
    for (let i = 0; i < 9; i += 1) await login(`spray-${i}@example.com`);
    assert.equal((await login('one-more@example.com')).status, 400);
  } finally {
    loginAddressLimiter.reset();
    loginAccountLimiter.reset();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the real registration route allows 30 sign-ups an hour from one network and then refuses', async () => {
  registerAddressLimiter.reset();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const register = () => fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    for (let i = 0; i < 30; i += 1) assert.equal((await register()).status, 400);
    assert.equal((await register()).status, 429);
  } finally {
    registerAddressLimiter.reset();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('query strings are parsed with the simple parser, not the qs library', () => {
  assert.equal(app.get('query parser'), 'simple');
});
