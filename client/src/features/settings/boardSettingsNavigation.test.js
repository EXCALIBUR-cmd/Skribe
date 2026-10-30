import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBoardReturnPath,
  flushCanvasBeforeNavigate,
  openSettingsFromBoard
} from './boardSettingsNavigation.js';

const legacyController = (persistResult, calls) => ({
  isEnabled: () => false,
  persist: async (data) => {
    calls.push(['persist', data]);
    return persistResult;
  }
});

const operationsController = ({ unsavedAfterDrain, persistResult, unsavedAfterPersist }, calls) => {
  let unsaved = unsavedAfterDrain;
  return {
    isEnabled: () => true,
    drain: async () => {
      calls.push(['drain']);
    },
    hasUnsavedWork: () => unsaved,
    persist: async (data) => {
      calls.push(['persist', data]);
      unsaved = unsavedAfterPersist;
      return persistResult;
    }
  };
};

test('legacy pending changes are persisted after the viewport flush and before reporting success', async () => {
  const calls = [];
  const canvasData = { objects: [{ id: 'a' }] };
  const result = await flushCanvasBeforeNavigate({
    controller: legacyController({ ok: true }, calls),
    canvasData,
    hasUnsavedLegacyChanges: true,
    flushViewport: async () => calls.push(['viewport'])
  });
  assert.deepEqual(result, { ok: true, saved: true });
  assert.deepEqual(calls, [['viewport'], ['persist', canvasData]]);
});

test('legacy save failure is reported with its code', async () => {
  const result = await flushCanvasBeforeNavigate({
    controller: legacyController({ ok: false, code: 'NETWORK_ERROR' }, []),
    canvasData: { objects: [] },
    hasUnsavedLegacyChanges: true
  });
  assert.deepEqual(result, { ok: false, code: 'NETWORK_ERROR' });
});

test('legacy board with nothing unsaved does not persist again', async () => {
  const calls = [];
  const result = await flushCanvasBeforeNavigate({
    controller: legacyController({ ok: true }, calls),
    canvasData: { objects: [] },
    hasUnsavedLegacyChanges: false
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, []);
});

test('operations mode drains pending edits and succeeds when nothing is left unsaved', async () => {
  const calls = [];
  const result = await flushCanvasBeforeNavigate({
    controller: operationsController({ unsavedAfterDrain: false }, calls)
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [['drain']]);
});

test('operations mode persists leftover work and fails if it stays unsaved', async () => {
  const saved = [];
  assert.deepEqual(
    await flushCanvasBeforeNavigate({
      controller: operationsController({ unsavedAfterDrain: true, persistResult: { ok: true }, unsavedAfterPersist: false }, saved)
    }),
    { ok: true }
  );
  assert.deepEqual(saved, [['drain'], ['persist', null]]);

  assert.deepEqual(
    await flushCanvasBeforeNavigate({
      controller: operationsController({ unsavedAfterDrain: true, persistResult: { ok: false, code: 'STALE_REVISION' }, unsavedAfterPersist: true }, [])
    }),
    { ok: false, code: 'STALE_REVISION' }
  );
});

test('a missing controller or a thrown error is a failure, never a success', async () => {
  assert.equal((await flushCanvasBeforeNavigate({ controller: null })).ok, false);
  const throwing = { isEnabled: () => false, persist: async () => { throw new Error('boom'); } };
  assert.deepEqual(
    await flushCanvasBeforeNavigate({ controller: throwing, canvasData: {}, hasUnsavedLegacyChanges: true }),
    { ok: false, code: 'SAVE_FAILED' }
  );
});

test('the gear flow navigates to settings with the originating board only after a successful flush', async () => {
  const order = [];
  const navigations = [];
  await openSettingsFromBoard({
    flush: async () => {
      order.push('flush');
      return { ok: true };
    },
    navigate: (to, options) => {
      order.push('navigate');
      navigations.push([to, options]);
    },
    from: '/board/6adc7903994ab42ea2f7b055'
  });
  assert.deepEqual(order, ['flush', 'navigate']);
  assert.deepEqual(navigations, [['/settings', { state: { from: '/board/6adc7903994ab42ea2f7b055' } }]]);
});

test('the gear flow stays on the board and reports a failed flush', async () => {
  const navigations = [];
  const failures = [];
  const result = await openSettingsFromBoard({
    flush: async () => ({ ok: false, code: 'NETWORK_ERROR' }),
    navigate: (...args) => navigations.push(args),
    from: '/board/abc',
    onFailure: (failure) => failures.push(failure)
  });
  assert.equal(result.ok, false);
  assert.deepEqual(navigations, []);
  assert.deepEqual(failures, [{ ok: false, code: 'NETWORK_ERROR' }]);
});

test('only same-app board paths are accepted as a return destination', () => {
  assert.equal(getBoardReturnPath({ from: '/board/6adc7903994ab42ea2f7b055' }), '/board/6adc7903994ab42ea2f7b055');
  assert.equal(getBoardReturnPath({ from: '/canvas' }), '/canvas');
  assert.equal(getBoardReturnPath({ from: 'https://evil.example/board/x' }), null);
  assert.equal(getBoardReturnPath({ from: '//evil.example' }), null);
  assert.equal(getBoardReturnPath({ from: '/board/a/../../boards' }), null);
  assert.equal(getBoardReturnPath({ from: '/boards' }), null);
  assert.equal(getBoardReturnPath(null), null);
});
