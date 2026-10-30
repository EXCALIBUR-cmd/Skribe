import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLandingTarget, resolvePostSignInPath } from './landing.js';

test('an explicitly requested in-app page wins over the landing preference', () => {
  assert.equal(resolvePostSignInPath({ pathname: '/board/abc123', search: '' }), '/board/abc123');
  assert.equal(resolvePostSignInPath({ pathname: '/settings/general', search: '?x=1' }), '/settings/general?x=1');
  assert.equal(resolvePostSignInPath('/boards'), '/boards');
});

test('no request, auth pages or unsafe targets fall through to the landing resolver', () => {
  assert.equal(resolvePostSignInPath(undefined), '/start');
  assert.equal(resolvePostSignInPath({ pathname: '/signin' }), '/start');
  assert.equal(resolvePostSignInPath({ pathname: '/start' }), '/start');
  assert.equal(resolvePostSignInPath({ pathname: '//evil.example/board/x' }), '/start');
  assert.equal(resolvePostSignInPath({ pathname: 'https://evil.example' }), '/start');
  assert.equal(resolvePostSignInPath({ pathname: '/board/abc', search: 'javascript:1' }), '/board/abc');
});

test('the landing target only accepts the boards list or a board path, so it can never loop back to /start', () => {
  assert.equal(resolveLandingTarget('/board/6adc7903994ab42ea2f7b055'), '/board/6adc7903994ab42ea2f7b055');
  assert.equal(resolveLandingTarget('/boards'), '/boards');
  assert.equal(resolveLandingTarget('/start'), '/boards');
  assert.equal(resolveLandingTarget('https://evil.example'), '/boards');
  assert.equal(resolveLandingTarget(null), '/boards');
});
