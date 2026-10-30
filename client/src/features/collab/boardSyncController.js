import {
  OPERATION_BYTE_LIMIT,
  acceptObjects,
  applyCanvasOperation,
  buildCanvasOperation,
  changedSince,
  conflictUndoObjects,
  mergeThreeWay,
  nextLocalBase,
  operationByteSize,
  sameObjectList
} from './boardSync.js';

const DEFAULT_OPTIONS = Object.freeze({
  pullDelayMs: 150,
  gapTimeoutMs: 1500,
  ackTimeoutMs: 8000,
  maxSaveAttempts: 3,
  idlePollMs: 50
});

const STALE_CODES = new Set(['STALE_REVISION', 'REVISION_REQUIRED']);

export const createBoardSyncController = ({
  boardId,
  api,
  socket,
  canvas,
  notify = () => {},
  requestSave = () => {},
  timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle) },
  options = {}
}) => {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  let enabled = null;
  let knownRevision = 0;
  let baseRaw = [];
  let baseLocal = null;
  const incoming = new Map();
  let gapTimer = null;
  let pullTimer = null;
  let pullTarget = 0;
  let chain = Promise.resolve();
  let disposed = false;

  const enqueue = (task) => {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  };

  const delay = (ms) => new Promise((resolve) => timers.setTimeout(resolve, ms));

  const waitForSafePoint = async () => {
    while (!disposed && canvas.isBusy()) {
      await delay(settings.idlePollMs);
    }
  };

  const localBase = () => baseLocal || baseRaw;

  const dropSeenRevisions = () => {
    [...incoming.keys()].filter((key) => key <= knownRevision).forEach((key) => incoming.delete(key));
  };

  const scheduleResync = () => {
    if (disposed || gapTimer) return;
    gapTimer = timers.setTimeout(() => {
      gapTimer = null;
      pull();
    }, settings.gapTimeoutMs);
  };

  const integrate = async (theirs, revision) => {
    if (disposed || revision < knownRevision) return;
    const candidates = changedSince(baseRaw, theirs);
    const prepared = candidates.length > 0 ? await canvas.prepare(candidates) : new Map();
    await waitForSafePoint();
    if (disposed || revision < knownRevision) return;
    const local = canvas.serialize();
    const previousBaseLocal = localBase();
    const merge = mergeThreeWay({ baseRaw, baseLocal: previousBaseLocal, theirs, local });
    if (merge.changedIds.some((id) => !prepared?.has(id))) {
      scheduleResync();
      return;
    }
    const needsUpdate = merge.changedIds.length > 0 || merge.removedIds.length > 0 || merge.orderChanged || merge.conflicts.length > 0;
    if (needsUpdate) {
      canvas.applyMerge({
        objects: merge.objects,
        changedIds: merge.changedIds,
        removedIds: merge.removedIds,
        orderChanged: merge.orderChanged,
        undoObjects: conflictUndoObjects(merge, theirs),
        prepared
      });
    }
    baseLocal = nextLocalBase({ merge, theirs, previousBaseLocal, canvasObjects: needsUpdate ? canvas.serialize() : local });
    baseRaw = theirs;
    knownRevision = revision;
    dropSeenRevisions();
    if (merge.conflicts.length > 0 || merge.orderConflict) {
      notify('conflict', { ids: merge.conflicts, orderConflict: merge.orderConflict });
    }
  };

  const pullNow = async (target = 0) => {
    if (disposed || (target && target <= knownRevision)) return;
    const board = await api.getBoard();
    if (!board || !Number.isInteger(board.revision) || board.revision < knownRevision) return;
    await integrate(board.objects, board.revision);
  };

  const pull = (target = 0) => enqueue(() => pullNow(target)).catch(() => {
    scheduleResync();
  });

  const drainIncoming = async () => {
    if (disposed) return;
    try {
      while (incoming.has(knownRevision + 1)) {
        const next = incoming.get(knownRevision + 1);
        const applied = next.baseRevision === knownRevision ? applyCanvasOperation(baseRaw, next.op) : { ok: false };
        if (!applied.ok) {
          incoming.delete(knownRevision + 1);
          await pullNow();
          return;
        }
        await integrate(applied.objects, next.revision);
        if (disposed || knownRevision < next.revision) return;
      }
    } catch {
      scheduleResync();
      return;
    }
    if (incoming.size > 0) scheduleResync();
    if (incoming.size === 0 && gapTimer) {
      timers.clearTimeout(gapTimer);
      gapTimer = null;
    }
  };

  const receiveOperation = (event) => {
    if (disposed || !event || !Number.isInteger(event.revision) || !event.op) return;
    enabled = true;
    if (event.revision <= knownRevision || incoming.has(event.revision)) return;
    incoming.set(event.revision, event);
    enqueue(drainIncoming);
  };

  const receiveRevision = (event) => {
    if (disposed || enabled !== true || !event || !Number.isInteger(event.revision) || event.revision <= knownRevision) return;
    pullTarget = Math.max(pullTarget, event.revision);
    if (pullTimer) return;
    pullTimer = timers.setTimeout(() => {
      pullTimer = null;
      const target = pullTarget;
      pullTarget = 0;
      if (target > knownRevision) pull(target);
    }, settings.pullDelayMs);
  };

  const reconnect = () => (disposed || enabled !== true ? Promise.resolve() : pull());

  const hasLocalChanges = (objects) => !sameObjectList(objects, localBase());

  const recordSaved = (objects, revision) => {
    baseRaw = objects;
    baseLocal = objects;
    if (Number.isInteger(revision)) knownRevision = revision;
  };

  const persistFinal = async (canvasData) => {
    if (!canvasData || !Array.isArray(canvasData.objects)) return { ok: false, code: 'NO_CANVAS' };
    if (enabled !== true) {
      const legacy = await api.saveBoard({ canvasData });
      return legacy?.ok ? { ok: true } : { ok: false, code: legacy?.code || 'SAVE_FAILED' };
    }
    if (!hasLocalChanges(canvasData.objects)) return { ok: true, skipped: true };
    const result = await api.saveBoard({ canvasData, baseRevision: knownRevision });
    if (result?.ok) {
      recordSaved(canvasData.objects, result.revision);
      return { ok: true };
    }
    if (!STALE_CODES.has(result?.code)) return { ok: false, code: result?.code || 'SAVE_FAILED' };
    const board = await api.getBoard();
    if (!board || !Number.isInteger(board.revision)) return { ok: false, code: result.code };
    const merge = mergeThreeWay({ baseRaw, baseLocal: localBase(), theirs: board.objects, local: canvasData.objects });
    const merged = { ...canvasData, objects: merge.objects };
    const retry = await api.saveBoard({ canvasData: merged, baseRevision: board.revision });
    if (retry?.ok) {
      recordSaved(merged.objects, retry.revision);
      return { ok: true, merged: true, conflicts: merge.conflicts };
    }
    return { ok: false, code: retry?.code || 'SAVE_FAILED' };
  };

  const persist = (canvasData, { final = false } = {}) => {
    if (final) return persistFinal(canvasData);
    return enqueue(async () => {
      if (disposed) return { ok: false, code: 'DISPOSED' };
      for (let attempt = 0; attempt < settings.maxSaveAttempts; attempt += 1) {
        const data = canvas.snapshot() || (attempt === 0 ? canvasData : null);
        if (!data || !Array.isArray(data.objects)) return { ok: false, code: 'NO_CANVAS' };
        if (enabled === true && !hasLocalChanges(data.objects)) return { ok: true, skipped: true };
        const legacy = enabled !== true;
        const result = await api.saveBoard(legacy ? { canvasData: data } : { canvasData: data, baseRevision: knownRevision });
        if (result?.ok) {
          if (!legacy) enabled = true;
          recordSaved(data.objects, result.revision);
          return { ok: true };
        }
        if (result?.code === 'REVISION_PROTOCOL_DISABLED') {
          enabled = false;
          continue;
        }
        if (STALE_CODES.has(result?.code)) {
          enabled = true;
          await pullNow();
          if (disposed) return { ok: false, code: 'DISPOSED' };
          continue;
        }
        return { ok: false, code: result?.code || 'SAVE_FAILED' };
      }
      return { ok: false, code: 'SAVE_RETRIES_EXHAUSTED' };
    });
  };

  const fallBackToSave = async (reason) => {
    await pullNow();
    requestSave();
    return { mode: 'save', reason };
  };

  const sendHistoryOperation = async ({ kind, legacyBroadcast }) => {
    if (disposed) return { mode: 'disposed' };
    await waitForSafePoint();
    if (disposed) return { mode: 'disposed' };
    const canvasObjects = canvas.serialize();
    const op = buildCanvasOperation({ serverObjects: localBase(), storedObjects: baseRaw, canvasObjects, baseRevision: knownRevision, kind });
    if (!op) return { mode: 'noop' };
    if (operationByteSize({ boardId, ...op }) > OPERATION_BYTE_LIMIT) return fallBackToSave('OPERATION_TOO_LARGE');

    const ack = await socket.emitOperation({ boardId, ...op }, settings.ackTimeoutMs);
    if (ack?.ok) {
      const applied = applyCanvasOperation(baseRaw, op);
      baseRaw = applied.ok ? applied.objects : canvasObjects;
      baseLocal = canvasObjects;
      knownRevision = ack.revision;
      dropSeenRevisions();
      return { mode: 'operation', revision: ack.revision, duplicate: Boolean(ack.duplicate) };
    }
    if (ack?.code === 'OPERATIONS_DISABLED') {
      enabled = false;
      if (legacyBroadcast) legacyBroadcast();
      requestSave();
      return { mode: 'legacy' };
    }
    return fallBackToSave(ack?.code || 'NO_ACK');
  };

  const submitHistoryOperation = ({ kind, legacyBroadcast }) => {
    if (disposed || enabled !== true) {
      if (legacyBroadcast) legacyBroadcast();
      return Promise.resolve({ mode: 'legacy' });
    }
    return enqueue(() => sendHistoryOperation({ kind, legacyBroadcast }));
  };

  const acceptRemoteObjects = (ids) => {
    if (disposed || enabled !== true || baseLocal === null) return;
    baseLocal = acceptObjects({ base: baseLocal, current: canvas.serialize(), ids });
  };

  const load = ({ revision, objects, enabled: operationsEnabled }) => {
    enabled = operationsEnabled === true ? true : operationsEnabled === false ? false : null;
    knownRevision = Number.isInteger(revision) ? revision : 0;
    baseRaw = Array.isArray(objects) ? objects : [];
    baseLocal = null;
    incoming.clear();
  };

  const markLoaded = () => {
    if (!disposed) baseLocal = canvas.serialize();
  };

  const dispose = () => {
    disposed = true;
    if (gapTimer) timers.clearTimeout(gapTimer);
    if (pullTimer) timers.clearTimeout(pullTimer);
    gapTimer = null;
    pullTimer = null;
  };

  const getState = () => ({
    enabled,
    knownRevision,
    loaded: baseLocal !== null,
    pendingRevisions: [...incoming.keys()],
    hasLocalChanges: hasLocalChanges(canvas.serialize())
  });

  const idle = () => enqueue(() => undefined);

  return { boardId, load, markLoaded, persist, submitHistoryOperation, acceptRemoteObjects, receiveOperation, receiveRevision, reconnect, pull, idle, dispose, getState };
};

export default createBoardSyncController;
