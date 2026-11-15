import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_GUEST_BOARD_OBJECTS, guestLimitMessage, hasImageContent, planGuestRevert } from './guestLimits.js';
import { buildShareLink, guestHoursLeft, isGuestUser, readShareSecret } from './guestSession.js';

const rect = (id, extra = {}) => ({ id, type: 'rect', left: 1, top: 1, width: 5, height: 5, ...extra });
const image = (id, extra = {}) => ({ id, type: 'image', src: 'https://ik.imagekit.io/x.png', ...extra });

test('image content is found in images, asset references, sources and nested groups, and not in plain shapes', () => {
  assert.equal(hasImageContent(image('a')), true);
  assert.equal(hasImageContent({ type: 'Image' }), true);
  assert.equal(hasImageContent(rect('r', { assetId: 'asset_1' })), true);
  assert.equal(hasImageContent(rect('r', { src: 'data:image/png;base64,AAAA' })), true);
  assert.equal(hasImageContent({ id: 'g', type: 'group', objects: [rect('in'), image('deep')] }), true);
  assert.equal(hasImageContent([rect('a'), rect('b', { fill: '#fff' })]), false);
  assert.equal(hasImageContent(rect('r', { src: '' })), false);
});

test('a refused image is removed if it is new and restored if an existing object was changed into one', () => {
  const base = [rect('kept'), rect('changed')];
  const local = [rect('kept'), rect('changed', { src: 'https://x/y.png' }), image('pasted')];
  const plan = planGuestRevert({ code: 'GUEST_IMAGES_DISABLED', local, base });
  assert.deepEqual(plan.removedIds, ['pasted']);
  assert.deepEqual(plan.restored, [rect('changed')]);
});

test('over the object cap only the newest unsaved objects are reverted, never ones already on the server', () => {
  const base = Array.from({ length: MAX_GUEST_BOARD_OBJECTS }, (_, i) => rect(`s_${i}`));
  const local = [...base, rect('new_1'), rect('new_2')];
  assert.deepEqual(planGuestRevert({ code: 'GUEST_OBJECT_LIMIT', local, base }).removedIds, ['new_1', 'new_2']);
  const mixed = [...base.slice(0, 499), rect('new_a'), rect('new_b'), rect('new_c')];
  assert.deepEqual(planGuestRevert({ code: 'GUEST_OBJECT_LIMIT', local: mixed, base }).removedIds, ['new_b', 'new_c']);
  assert.deepEqual(planGuestRevert({ code: 'GUEST_OBJECT_LIMIT', local: base, base }), { removedIds: [], restored: [] });
  assert.deepEqual(planGuestRevert({ code: 'SOMETHING_ELSE', local, base }), { removedIds: [], restored: [] });
});

test('limit messages tell the user what happened and how to keep going', () => {
  assert.match(guestLimitMessage('GUEST_IMAGES_DISABLED'), /Images can't be added to guest boards\. Sign up free/);
  assert.match(guestLimitMessage('GUEST_OBJECT_LIMIT'), /up to 500 objects\. Sign up free/);
});

test('share links carry the secret only in the fragment, and only well-formed secrets are read back', () => {
  const secret = 'A'.repeat(43);
  const link = buildShareLink('https://skribe.stream', '0123456789abcdef01234567', secret);
  assert.equal(link, `https://skribe.stream/join/0123456789abcdef01234567#${secret}`);
  assert.equal(new URL(link).search, '');
  assert.equal(readShareSecret(new URL(link).hash), secret);
  assert.equal(readShareSecret('#short'), null);
  assert.equal(readShareSecret(''), null);
  assert.equal(readShareSecret(`#${secret}&x=1`), null);
});

test('hours left round up and never go negative', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(guestHoursLeft(new Date(now + 24 * 3600 * 1000).toISOString(), now), 24);
  assert.equal(guestHoursLeft(new Date(now + 90 * 60 * 1000).toISOString(), now), 2);
  assert.equal(guestHoursLeft(new Date(now + 60 * 1000).toISOString(), now), 1);
  assert.equal(guestHoursLeft(new Date(now - 1000).toISOString(), now), 0);
  assert.equal(guestHoursLeft('not a date', now), null);
  assert.equal(isGuestUser({ role: 'guest' }), true);
  assert.equal(isGuestUser({ id: 'x' }), false);
});

test('a used-up guest Mess Cleanup shows the server message instead of falling back to a local cleanup', async () => {
  const { analyzeWorkspace } = await import('../messCleanup/analyzeWorkspace.js');
  const sent = [];
  const apiClient = { post: async (path, body) => { sent.push(body); throw { success: false, message: 'Sign up free to keep using Mess Cleanup.', errors: { code: 'GUEST_CLEANUP_LIMIT' } }; } };
  const workspaceModel = { version: 1, board: { objects: [{ id: 't1', type: 'text', text: 'Notes', position: { x: 1, y: 1 }, size: { width: 10, height: 10 } }] } };
  await assert.rejects(
    analyzeWorkspace(workspaceModel, 'data:image/png;base64,AAAA', { apiClient, boardId: '0123456789abcdef01234567' }),
    (err) => err.code === 'GUEST_CLEANUP_LIMIT' && err.message === 'Sign up free to keep using Mess Cleanup.'
  );
  assert.equal(sent[0].boardId, '0123456789abcdef01234567');
});

test('guests do not see Boards or AI Assist in the navigation, and accounts see everything', async () => {
  const { navItemsFor } = await import('./guestSession.js');
  const items = [{ path: '/' }, { path: '/boards' }, { path: '/ai-assist' }, { path: '/mobile' }];
  assert.deepEqual(navItemsFor(items, true).map((item) => item.path), ['/', '/mobile']);
  assert.deepEqual(navItemsFor(items, false).map((item) => item.path), ['/', '/boards', '/ai-assist', '/mobile']);
});

test('a pending board transfer says how long the board is safe', async () => {
  const { pendingClaimMessage } = await import('./guestSession.js');
  assert.equal(pendingClaimMessage(23), 'We couldn\'t move your board yet; it\'s safe for 23 more hours.');
  assert.equal(pendingClaimMessage(1), 'We couldn\'t move your board yet; it\'s safe for 1 more hour.');
});
