import {
  OPERATION_BYTE_LIMIT,
  acceptObjects,
  applyCanvasOperation,
  buildCanvasOperation,
  changedSince,
  conflictUndoObjects,
  exceedsOperationLimits,
  indexObjects,
  mergeThreeWay,
  nextLocalBase,
  operationByteSize,
  sameObject,
  sameObjectList
} from './boardSync.js';

const DEFAULT_OPTIONS = Object.freeze({
  pullDelayMs: 150,
  gapTimeoutMs: 1500,
  ackTimeoutMs: 8000,
  maxSaveAttempts: 3,
  maxOperationAttempts: 3,
  idlePollMs: 50,
  editDelayMs: 120,
  retryBaseMs: 1000,
  retryMaxMs: 15000,
  maxRetries: 8,
  foreignJournalAgeMs: 15000,
  heartbeatMs: 5000,
  journalMaxAgeMs: 86400000,
  dedupSafeRevisions: 150
});

const STALE_CODES = new Set(['STALE_REVISION', 'REVISION_REQUIRED']);
const REBUILD_CODES = new Set(['STALE_REVISION', 'ORDER_MISMATCH']);
const SAVE_INSTEAD_CODES = new Set(['INVALID_OPERATION', 'OPERATION_TOO_LARGE']);
const FATAL_CODES = new Set(['FORBIDDEN', 'BOARD_NOT_FOUND', 'NOT_FOUND']);
const UNKNOWN_FATE_CODES = new Set(['ACK_TIMEOUT', 'EMPTY_ACK', 'NO_ACK']);
const UNRECOVERABLE_CODES = new Set(['INVALID_OPERATION', 'OPERATION_TOO_LARGE', 'FORBIDDEN', 'BOARD_NOT_FOUND', 'NOT_FOUND']);

const createInstanceId = () => `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export const createBoardSyncController = ({
  boardId,
  api,
  socket,
  canvas,
  notify = () => {},
  requestSave = () => {},
  timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle) },
  random = Math.random,
  journal = null,
  instanceId = createInstanceId(),
  now = () => Date.now(),
  options = {}
}) => {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  let enabled = null;
  let knownRevision = 0;
  let baseRaw = [];
  let baseLocal = null;
  const incoming = new Map();
  const previews = new Map();
  let gapTimer = null;
  let pullTimer = null;
  let pullTarget = 0;
  let editTimer = null;
  let editWaiters = [];
  let retryTimer = null;
  let retryDelay = 0;
  let retryCount = 0;
  let retryKind = null;
  let inFlight = null;
  let inFlightOp = null;
  let finalBlocked = false;
  let ownEntries = [];
  let journalHealthy = true;
  let heartbeatTimer = null;
  let ended = false;
  let recoveryRetryTimer = null;
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

  const untouchedPreviewIds = (local) => {
    if (previews.size === 0) return [];
    const localIndex = indexObjects(local);
    return [...previews.entries()]
      .filter(([id, snapshot]) => (snapshot ? sameObject(localIndex.get(id), snapshot) : !localIndex.has(id)))
      .map(([id]) => id);
  };

  const withPreviewsAsBase = (base, local, previewIds) => (
    previewIds.length === 0 ? base : acceptObjects({ base, current: local, ids: previewIds })
  );

  const buildOperationFrom = ({ base, stored, objects, revision, kind }) => {
    const op = buildCanvasOperation({ serverObjects: base, storedObjects: stored, canvasObjects: objects, baseRevision: revision, kind, orderMode: 'auto' });
    const tooLarge = Boolean(op) && (operationByteSize({ boardId, ...op }) > OPERATION_BYTE_LIMIT || exceedsOperationLimits(op));
    return { op, tooLarge };
  };

  const buildPendingOperation = (canvasObjects, kind) => {
    const previewIds = untouchedPreviewIds(canvasObjects);
    const base = baseLocal && previewIds.length > 0 ? withPreviewsAsBase(baseLocal, canvasObjects, previewIds) : localBase();
    return { ...buildOperationFrom({ base, stored: baseRaw, objects: canvasObjects, revision: knownRevision, kind }), base };
  };

  const writeOwnRecord = () => {
    if (!journal) return;
    try {
      if (ownEntries.length === 0) journal.remove(instanceId);
      else journal.write(instanceId, { beat: now(), ended, entries: ownEntries });
      journalHealthy = true;
    } catch {
      journalHealthy = false;
    }
  };

  const scheduleHeartbeat = () => {
    if (!journal || heartbeatTimer || ended || disposed || ownEntries.length === 0) return;
    heartbeatTimer = timers.setTimeout(() => {
      heartbeatTimer = null;
      if (ended || disposed || ownEntries.length === 0) return;
      writeOwnRecord();
      scheduleHeartbeat();
    }, settings.heartbeatMs);
  };

  const rememberPending = (op, base, extra = {}) => {
    if (!journal) return null;
    const index = indexObjects(base);
    const touched = [...(op.upserts || []).map((upsert) => upsert.id), ...(op.deletes || [])];
    const entry = { savedAt: now(), op, base: Object.fromEntries(touched.map((id) => [id, index.get(id) || null])), ...extra };
    ownEntries = [...ownEntries.filter((existing) => existing.op.opId !== op.opId), entry];
    writeOwnRecord();
    scheduleHeartbeat();
    return entry;
  };

  const forgetPending = (opId) => {
    if (!journal || !ownEntries.some((entry) => entry.op.opId === opId)) return;
    ownEntries = ownEntries.filter((entry) => entry.op.opId !== opId);
    writeOwnRecord();
  };

  const supersedePending = (entry) => {
    if (!journal || !entry) return;
    ownEntries = ownEntries.filter((existing) => existing !== entry && existing.savedAt > entry.savedAt);
    writeOwnRecord();
  };

  const endJournalSession = () => {
    ended = true;
    if (heartbeatTimer) timers.clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
    writeOwnRecord();
  };

  const integrate = async (theirs, revision) => {
    if (disposed || revision < knownRevision) return;
    const theirsIndex = indexObjects(theirs);
    const changed = changedSince(baseRaw, theirs);
    const changedIds = new Set(changed.map((object) => object.id));
    const previewed = [...previews.keys()].map((id) => theirsIndex.get(id)).filter((object) => object && !changedIds.has(object.id));
    const candidates = [...changed, ...previewed];
    const prepared = candidates.length > 0 ? await canvas.prepare(candidates) : new Map();
    await waitForSafePoint();
    if (disposed || revision < knownRevision) return;
    const local = canvas.serialize();
    const usedPreviews = [...previews.keys()];
    const previewIds = untouchedPreviewIds(local);
    const rawBase = withPreviewsAsBase(baseRaw, local, previewIds);
    const previousBaseLocal = withPreviewsAsBase(localBase(), local, previewIds);
    const merge = mergeThreeWay({ baseRaw: rawBase, baseLocal: previousBaseLocal, theirs, local });
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
    usedPreviews.forEach((id) => previews.delete(id));
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

  const hasLocalChanges = (objects) => !sameObjectList(objects, localBase());

  const recordSaved = (objects, revision) => {
    baseRaw = objects;
    baseLocal = objects;
    if (Number.isInteger(revision)) knownRevision = revision;
  };

  const recordOperation = (op, objects, revision) => {
    const applied = applyCanvasOperation(baseRaw, op);
    baseRaw = applied.ok ? applied.objects : objects;
    baseLocal = objects;
    knownRevision = revision;
    dropSeenRevisions();
  };

  const clearRetry = () => {
    if (retryTimer) timers.clearTimeout(retryTimer);
    retryTimer = null;
    retryDelay = 0;
    retryCount = 0;
    retryKind = null;
  };

  const synced = (result) => {
    clearRetry();
    notify('synced', result);
    return result;
  };

  const persistNow = async (canvasData) => {
    for (let attempt = 0; attempt < settings.maxSaveAttempts; attempt += 1) {
      if (disposed) return { ok: false, code: 'DISPOSED' };
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
        continue;
      }
      return { ok: false, code: result?.code || 'SAVE_FAILED' };
    }
    return { ok: false, code: 'SAVE_RETRIES_EXHAUSTED' };
  };

  const saveInstead = async (reason) => {
    const saved = await persistNow(null);
    if (saved.ok) return synced({ mode: 'save', reason });
    notify('sync-error', { code: saved.code });
    return { mode: 'error', reason, code: saved.code };
  };

  const scheduleRetry = (kind) => {
    if (disposed || retryTimer) return;
    if (retryCount >= settings.maxRetries) {
      notify('sync-error', { code: 'SYNC_STALLED' });
      return;
    }
    retryCount += 1;
    retryKind = retryKind || kind;
    retryDelay = retryDelay ? Math.min(retryDelay * 2, settings.retryMaxMs) : settings.retryBaseMs;
    const wait = Math.round(retryDelay * (1 + random() * 0.2));
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      const resend = retryKind || 'edit';
      enqueue(() => sendOperation({ kind: resend }));
    }, wait);
  };

  const sendOperation = async ({ kind, legacyBroadcast }) => {
    for (let attempt = 0; attempt < settings.maxOperationAttempts; attempt += 1) {
      if (disposed) return { mode: 'disposed' };
      await waitForSafePoint();
      if (disposed) return { mode: 'disposed' };
      const canvasObjects = canvas.serialize();
      const pending = buildPendingOperation(canvasObjects, kind);
      if (baseLocal) baseLocal = pending.base;
      const { op } = pending;
      if (!op) {
        if (baseLocal && hasLocalChanges(canvasObjects)) baseLocal = canvasObjects;
        clearRetry();
        return { mode: 'noop' };
      }
      if (pending.tooLarge) return saveInstead('OPERATION_TOO_LARGE');
      const entry = rememberPending(op, pending.base);
      inFlight = socket.emitOperation({ boardId, ...op }, settings.ackTimeoutMs);
      inFlightOp = { op, objects: canvasObjects, ack: inFlight };
      let ack;
      try {
        ack = await inFlight;
      } finally {
        inFlight = null;
        inFlightOp = null;
      }
      if (ack?.ok) supersedePending(entry);
      else if (!UNKNOWN_FATE_CODES.has(ack?.code || 'NO_ACK')) forgetPending(op.opId);
      if (ack?.ok) {
        recordOperation(op, canvasObjects, ack.revision);
        return synced({ mode: 'operation', revision: ack.revision, duplicate: Boolean(ack.duplicate) });
      }
      const code = ack?.code || 'NO_ACK';
      if (code === 'OPERATIONS_DISABLED') {
        enabled = false;
        clearRetry();
        if (legacyBroadcast) legacyBroadcast();
        requestSave();
        return { mode: 'legacy' };
      }
      if (REBUILD_CODES.has(code)) {
        await pullNow();
        continue;
      }
      if (SAVE_INSTEAD_CODES.has(code)) return saveInstead(code);
      if (FATAL_CODES.has(code)) {
        clearRetry();
        notify('sync-error', { code });
        return { mode: 'error', code };
      }
      if (code === 'NOT_IN_ROOM' && typeof socket.rejoin === 'function') socket.rejoin();
      notify('sync-error', { code });
      scheduleRetry(kind);
      return { mode: 'pending', code };
    }
    return saveInstead('REBUILD_EXHAUSTED');
  };

  const fireEdits = () => {
    editTimer = null;
    const waiters = editWaiters;
    editWaiters = [];
    if (retryTimer) {
      timers.clearTimeout(retryTimer);
      retryTimer = null;
    }
    retryCount = 0;
    return enqueue(() => sendOperation({ kind: retryKind || 'edit' })).then(
      (result) => waiters.forEach((done) => done(result)),
      () => waiters.forEach((done) => done({ mode: 'error', code: 'EXCEPTION' }))
    );
  };

  const submitLocalChanges = () => {
    if (disposed || enabled !== true) return Promise.resolve({ mode: 'legacy' });
    return new Promise((resolve) => {
      editWaiters.push(resolve);
      if (editTimer) return;
      editTimer = timers.setTimeout(fireEdits, settings.editDelayMs);
    });
  };

  const submitHistoryOperation = ({ kind, legacyBroadcast }) => {
    if (disposed || enabled !== true) {
      if (legacyBroadcast) legacyBroadcast();
      return Promise.resolve({ mode: 'legacy' });
    }
    return enqueue(() => sendOperation({ kind, legacyBroadcast }));
  };

  const reconnect = async () => {
    if (disposed || enabled !== true) return;
    await pull();
    await recoverPending();
    if (!disposed && hasLocalChanges(canvas.serialize())) await submitLocalChanges();
  };

  const captureFinal = ({ predictInFlight = false } = {}) => {
    if (disposed || enabled !== true || baseLocal === null || finalBlocked) return null;
    const live = typeof canvas.finalSnapshot === 'function' ? canvas.finalSnapshot() : canvas.snapshot();
    if (!live || !Array.isArray(live.objects)) return null;
    const pendingOp = inFlightOp;
    if (predictInFlight && pendingOp) {
      const applied = applyCanvasOperation(baseRaw, pendingOp.op);
      if (applied.ok) {
        const predicted = { base: pendingOp.objects, stored: applied.objects, revision: knownRevision + 1 };
        const built = buildOperationFrom({ ...predicted, objects: live.objects, kind: 'edit' });
        return { live, ...built, baseRaw: predicted.stored, baseLocal: predicted.base, revision: predicted.revision, pending: null, after: pendingOp.op.opId };
      }
    }
    const built = buildPendingOperation(live.objects, 'edit');
    return { live, op: built.op, tooLarge: built.tooLarge, baseRaw, baseLocal: built.base, revision: knownRevision, pending: predictInFlight ? null : pendingOp, after: null };
  };

  const rebaseOnPending = async (captured) => {
    if (!captured.pending) return captured;
    const ack = await Promise.resolve(captured.pending.ack).catch(() => null);
    if (!ack?.ok) return captured;
    const applied = applyCanvasOperation(captured.baseRaw, captured.pending.op);
    if (!applied.ok) return captured;
    const next = { ...captured, baseRaw: applied.objects, baseLocal: captured.pending.objects, revision: ack.revision, pending: null };
    return { ...next, ...buildOperationFrom({ base: next.baseLocal, stored: next.baseRaw, objects: next.live.objects, revision: next.revision, kind: 'edit' }) };
  };

  const saveCaptured = async (captured) => {
    const result = await api.saveBoard({ canvasData: captured.live, baseRevision: captured.revision });
    if (result?.ok) {
      if (!disposed && knownRevision === captured.revision) recordSaved(captured.live.objects, result.revision);
      return { ok: true };
    }
    if (!STALE_CODES.has(result?.code)) return { ok: false, code: result?.code || 'SAVE_FAILED' };
    const board = await api.getBoard();
    if (!board || !Number.isInteger(board.revision)) return { ok: false, code: result.code };
    const merge = mergeThreeWay({ baseRaw: captured.baseRaw, baseLocal: captured.baseLocal, theirs: board.objects, local: captured.live.objects });
    const merged = { ...captured.live, objects: merge.objects };
    const retry = await api.saveBoard({ canvasData: merged, baseRevision: board.revision });
    if (!retry?.ok) return { ok: false, code: retry?.code || 'SAVE_FAILED' };
    finalBlocked = true;
    return { ok: true, merged: true, conflicts: merge.conflicts };
  };

  const persistFinal = async (legacyCanvasData) => {
    if (enabled !== true) {
      if (!legacyCanvasData || !Array.isArray(legacyCanvasData.objects)) return { ok: false, code: 'NO_CANVAS' };
      const legacy = await api.saveBoard({ canvasData: legacyCanvasData });
      return legacy?.ok ? { ok: true } : { ok: false, code: legacy?.code || 'SAVE_FAILED' };
    }
    const first = captureFinal();
    if (!first) return { ok: false, skipped: true, code: finalBlocked ? 'ALREADY_MERGED' : 'NO_CANVAS' };
    const captured = await rebaseOnPending(first);
    if (!captured.op) return { ok: true, skipped: true };
    const entry = rememberPending(captured.op, captured.baseLocal);
    if (!captured.tooLarge) {
      const ack = await socket.emitOperation({ boardId, ...captured.op }, settings.ackTimeoutMs);
      if (ack?.ok) {
        supersedePending(entry);
        if (!disposed && knownRevision === captured.revision) recordOperation(captured.op, captured.live.objects, ack.revision);
        return { ok: true, operation: true };
      }
    }
    const saved = await saveCaptured(captured);
    if (saved.ok) supersedePending(entry);
    return saved;
  };

  const flushOnUnload = () => {
    const captured = captureFinal({ predictInFlight: true });
    if (!captured || !captured.op) {
      endJournalSession();
      return false;
    }
    if (captured.after) {
      rememberPending(captured.op, captured.baseLocal, { after: captured.after });
      endJournalSession();
      return true;
    }
    rememberPending(captured.op, captured.baseLocal);
    endJournalSession();
    const connected = typeof socket.isConnected === 'function' ? socket.isConnected() : true;
    if (!captured.tooLarge && connected && typeof socket.send === 'function') {
      socket.send({ boardId, ...captured.op });
      return true;
    }
    if (typeof api.saveOnUnload === 'function') return api.saveOnUnload({ canvasData: captured.live, baseRevision: captured.revision }) === true;
    return canRecover();
  };

  const replayEntry = async (entry) => {
    await waitForSafePoint();
    if (disposed) return { done: false, applied: 0, conflicts: 0 };
    const local = canvas.serialize();
    const current = indexObjects(local);
    const target = new Map(local.map((object) => [object.id, object]));
    const additions = [];
    const outsideDedupWindow = knownRevision - (entry.op.baseRevision || 0) > settings.dedupSafeRevisions;
    let applied = 0;
    let conflicts = 0;
    (entry.op.upserts || []).forEach((upsert) => {
      const desired = { ...upsert.data, id: upsert.id };
      (upsert.unset || []).forEach((field) => { delete desired[field]; });
      const present = current.get(upsert.id);
      const before = entry.base?.[upsert.id] || null;
      if (present && sameObject(present, desired)) return;
      if (!before && !present && !outsideDedupWindow) {
        additions.push(desired);
        applied += 1;
        return;
      }
      if (before && present && sameObject(present, before)) {
        target.set(upsert.id, desired);
        applied += 1;
        return;
      }
      conflicts += 1;
    });
    (entry.op.deletes || []).forEach((id) => {
      const present = current.get(id);
      const before = entry.base?.[id] || null;
      if (!present) return;
      if (before && sameObject(present, before)) {
        target.delete(id);
        applied += 1;
        return;
      }
      conflicts += 1;
    });
    if (Array.isArray(entry.op.order)) conflicts += 1;
    if (applied === 0) return { done: true, applied, conflicts };
    const orderIds = local.map((object) => object.id).filter((id) => target.has(id));
    const reference = Array.isArray(entry.op.order) ? entry.op.order : [];
    additions.forEach((object) => {
      const position = reference.indexOf(object.id);
      let insertAt = orderIds.length;
      for (let index = position - 1; index >= 0; index -= 1) {
        const anchor = orderIds.indexOf(reference[index]);
        if (anchor !== -1) {
          insertAt = anchor + 1;
          break;
        }
      }
      orderIds.splice(insertAt, 0, object.id);
      target.set(object.id, object);
    });
    const objects = orderIds.map((id) => target.get(id));
    const { op, tooLarge } = buildOperationFrom({ base: localBase(), stored: baseRaw, objects, revision: knownRevision, kind: entry.op.kind || 'edit' });
    if (!op) return { done: true, applied: 0, conflicts };
    if (tooLarge) return { done: false, applied: 0, conflicts };
    const ack = await socket.emitOperation({ boardId, ...op }, settings.ackTimeoutMs);
    if (!ack?.ok) return { done: false, applied: 0, conflicts };
    await pullNow();
    return { done: true, applied, conflicts };
  };

  const recoverRecord = async (record, totals) => {
    const remaining = [];
    const committed = new Map();
    const entries = [...(record.entries || [])].filter((entry) => entry && entry.op && now() - (entry.savedAt || 0) < settings.journalMaxAgeMs).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
    let stop = false;
    for (const entry of entries) {
      if (stop || disposed) {
        remaining.push(entry);
        continue;
      }
      const exactResend = !entry.after || committed.get(entry.after) === entry.op.baseRevision;
      let code = 'STALE_REVISION';
      if (exactResend) {
        const ack = await socket.emitOperation({ boardId, ...entry.op }, settings.ackTimeoutMs);
        if (ack?.ok) {
          committed.set(entry.op.opId, ack.revision);
          if (!ack.duplicate) totals.recovered += 1;
          totals.changed = true;
          continue;
        }
        code = ack?.code || 'NO_ACK';
      }
      if (REBUILD_CODES.has(code)) {
        await pullNow();
        const result = await replayEntry(entry);
        totals.recovered += result.applied;
        totals.conflicts += result.conflicts;
        if (result.done) continue;
        remaining.push(entry);
        stop = true;
        continue;
      }
      if (UNRECOVERABLE_CODES.has(code)) {
        totals.conflicts += 1;
        continue;
      }
      remaining.push(entry);
      stop = true;
    }
    return remaining;
  };

  const recoverPending = () => enqueue(async () => {
    const totals = { recovered: 0, conflicts: 0, kept: 0, changed: false };
    if (disposed || enabled !== true || !journal || baseLocal === null) return { recovered: 0, conflicts: 0, kept: 0 };
    let records = [];
    try {
      records = journal.list();
    } catch {
      records = [];
    }
    let aliveElsewhere = false;
    for (const { instanceId: owner, record } of records) {
      if (disposed) break;
      if (owner === instanceId || !record) continue;
      const alive = !record.ended && now() - (record.beat || 0) < settings.foreignJournalAgeMs;
      if (alive) {
        if ((record.entries || []).length > 0) aliveElsewhere = true;
        continue;
      }
      const remaining = await recoverRecord(record, totals);
      totals.kept += remaining.length;
      try {
        if (remaining.length === 0) journal.remove(owner);
        else journal.write(owner, { ...record, ended: true, entries: remaining });
      } catch {
        journalHealthy = false;
      }
    }
    if (totals.changed) await pullNow();
    if (aliveElsewhere && !recoveryRetryTimer && !disposed) {
      recoveryRetryTimer = timers.setTimeout(() => {
        recoveryRetryTimer = null;
        recoverPending();
      }, settings.foreignJournalAgeMs + 1000);
    }
    const summary = { recovered: totals.recovered, conflicts: totals.conflicts, kept: totals.kept };
    if (summary.recovered > 0 || summary.conflicts > 0) notify('recovered', summary);
    return summary;
  });

  const drain = async (timeoutMs = settings.ackTimeoutMs) => {
    if (disposed || enabled !== true) return;
    if (editTimer) {
      timers.clearTimeout(editTimer);
      fireEdits();
    }
    let timer = null;
    await Promise.race([idle(), new Promise((resolve) => { timer = timers.setTimeout(resolve, timeoutMs); })]);
    if (timer) timers.clearTimeout(timer);
  };

  const hasUnsavedWork = () => {
    if (disposed || enabled !== true) return false;
    if (inFlight || editTimer) return true;
    return baseLocal !== null && hasLocalChanges(canvas.serialize());
  };

  const canRecover = () => Boolean(journal) && journal.available !== false && journalHealthy;

  const persist = (canvasData, { final = false } = {}) => {
    if (final) return persistFinal(canvasData);
    return enqueue(async () => {
      if (disposed) return { ok: false, code: 'DISPOSED' };
      return persistNow(canvasData);
    });
  };

  const acceptRemoteObjects = (ids) => {
    if (disposed || enabled !== true || baseLocal === null) return;
    baseLocal = acceptObjects({ base: baseLocal, current: canvas.serialize(), ids });
  };

  const notePreview = (ids) => {
    if (disposed || enabled !== true) return;
    const wanted = (Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string' && id);
    if (wanted.length === 0) return;
    const snapshots = indexObjects(typeof canvas.serializeIds === 'function' ? canvas.serializeIds(wanted) : canvas.serialize());
    wanted.forEach((id) => previews.set(id, snapshots.get(id) || null));
  };

  const load = ({ revision, objects, enabled: operationsEnabled }) => {
    enabled = operationsEnabled === true ? true : operationsEnabled === false ? false : null;
    knownRevision = Number.isInteger(revision) ? revision : 0;
    baseRaw = Array.isArray(objects) ? objects : [];
    baseLocal = null;
    incoming.clear();
    previews.clear();
  };

  const markLoaded = () => {
    if (!disposed) baseLocal = canvas.serialize();
  };

  const isEnabled = () => !disposed && enabled === true;

  const dispose = () => {
    disposed = true;
    if (journal) endJournalSession();
    [gapTimer, pullTimer, editTimer, retryTimer, recoveryRetryTimer].filter(Boolean).forEach((handle) => timers.clearTimeout(handle));
    recoveryRetryTimer = null;
    gapTimer = null;
    pullTimer = null;
    editTimer = null;
    retryTimer = null;
    const waiters = editWaiters;
    editWaiters = [];
    waiters.forEach((done) => done({ mode: 'disposed' }));
  };

  const getState = () => ({
    enabled,
    knownRevision,
    loaded: baseLocal !== null,
    pendingRevisions: [...incoming.keys()],
    hasLocalChanges: hasLocalChanges(canvas.serialize())
  });

  function idle() {
    return enqueue(() => undefined);
  }

  return {
    boardId,
    load,
    markLoaded,
    isEnabled,
    persist,
    flushOnUnload,
    recoverPending,
    drain,
    hasUnsavedWork,
    canRecover,
    submitLocalChanges,
    submitHistoryOperation,
    acceptRemoteObjects,
    notePreview,
    receiveOperation,
    receiveRevision,
    reconnect,
    pull,
    idle,
    dispose,
    getState
  };
};

export default createBoardSyncController;
