import assert from 'node:assert/strict';
import test from 'node:test';
import { LEAVE_GRACE_MS, createPresenceNotices } from './presenceNotices.js';

const setup = ({ enabled = true, selfId = 'me' } = {}) => {
  const notices = [];
  const timers = new Map();
  let nextTimer = 1;
  let now = 0;
  const state = { enabled };
  const presence = createPresenceNotices({
    notify: (kind, name) => notices.push(`${kind}:${name}`),
    isEnabled: () => state.enabled,
    selfId,
    schedule: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, at: now + ms }); return id; },
    cancel: (id) => timers.delete(id)
  });
  const advance = (ms) => {
    now += ms;
    [...timers.entries()].filter(([, timer]) => timer.at <= now).forEach(([id, timer]) => { timers.delete(id); timer.fn(); });
  };
  return { presence, notices, advance, state, timers };
};

test('the opening roster is silent and a newcomer is announced once', () => {
  const { presence, notices } = setup();
  presence.roster([{ id: 'me', name: 'Me' }, { id: 'b', name: 'Bea' }]);
  assert.deepEqual(notices, []);
  presence.joined({ id: 'c', name: 'Cal' });
  presence.joined({ id: 'c', name: 'Cal' });
  presence.joined({ id: 'b', name: 'Bea' });
  presence.joined({ id: 'me', name: 'Me' });
  assert.deepEqual(notices, ['joined:Cal']);
});

test('a leave is announced once after the grace period', () => {
  const { presence, notices, advance } = setup();
  presence.roster([{ id: 'me', name: 'Me' }, { id: 'b', name: 'Bea' }]);
  presence.left('b');
  presence.left('b');
  advance(LEAVE_GRACE_MS - 1);
  assert.deepEqual(notices, []);
  advance(1);
  assert.deepEqual(notices, ['left:Bea']);
  presence.left('b');
  advance(LEAVE_GRACE_MS);
  assert.deepEqual(notices, ['left:Bea']);
  presence.joined({ id: 'b', name: 'Bea' });
  assert.deepEqual(notices, ['left:Bea', 'joined:Bea']);
});

test('a quick reconnect produces no leave and no join notice', () => {
  const { presence, notices, advance, timers } = setup();
  presence.roster([{ id: 'b', name: 'Bea' }]);
  presence.left('b');
  advance(1500);
  presence.joined({ id: 'b', name: 'Bea' });
  advance(LEAVE_GRACE_MS * 2);
  assert.deepEqual(notices, []);
  assert.equal(timers.size, 0);
  presence.left('b');
  presence.roster([{ id: 'b', name: 'Bea' }]);
  advance(LEAVE_GRACE_MS * 2);
  assert.deepEqual(notices, []);
});

test('turning notifications off suppresses notices, including a pending leave, while tracking continues', () => {
  const { presence, notices, advance, state } = setup();
  presence.roster([{ id: 'b', name: 'Bea' }]);
  presence.left('b');
  state.enabled = false;
  advance(LEAVE_GRACE_MS);
  presence.joined({ id: 'c', name: 'Cal' });
  assert.deepEqual(notices, []);
  state.enabled = true;
  presence.joined({ id: 'c', name: 'Cal' });
  presence.left('c');
  advance(LEAVE_GRACE_MS);
  assert.deepEqual(notices, ['left:Cal']);
});

test('the current user, unknown users and disposal never notify', () => {
  const { presence, notices, advance, timers } = setup();
  presence.roster([{ id: 'me', name: 'Me' }, { id: 'b', name: 'Bea' }]);
  presence.left('me');
  presence.left('stranger');
  presence.left(null);
  presence.joined(null);
  presence.left('b');
  presence.dispose();
  advance(LEAVE_GRACE_MS);
  assert.deepEqual(notices, []);
  assert.equal(timers.size, 0);
});
