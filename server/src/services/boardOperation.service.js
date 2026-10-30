import boardRepository from '../repositories/board.repository.js';
import boardService from './board.service.js';

export const OPERATION_KINDS = Object.freeze(['apply', 'undo', 'redo', 'edit']);

export const UNSETTABLE_FIELDS = Object.freeze([
  'elementId',
  'strokeId',
  'parentShapeId',
  'attachedTextId',
  'attachedTimestampId',
  'createdAt',
  'metadata',
  'aiMetadata',
  'isStickyNote',
  'isChecklistNote',
  'isCalloutNote',
  'checklistItems',
  'noteColor',
  'contrastResolved',
  'isConnector',
  'connectorType',
  'startArrow',
  'endArrow',
  'sourceShapeId',
  'targetShapeId',
  'skribeLine',
  'locked',
  'protected',
  'system',
  'isVectorStroke',
  'vectorStrokeData',
  'isStraightLine',
  'isSkribeLine',
  'shapeType',
  'padding'
]);

export const OPERATION_LIMITS = Object.freeze({
  maxBytes: 900000,
  maxUpserts: 1000,
  maxDeletes: 1000,
  maxOrder: 5000,
  maxIdLength: 200,
  maxDepth: 32
});

const OP_ID_PATTERN = /^[A-Za-z0-9_:-]{8,128}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const invalid = (message, code = 'INVALID_OPERATION') => ({ ok: false, code, message });

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isObjectId = (value) => typeof value === 'string' && value.length > 0 && value.length <= OPERATION_LIMITS.maxIdLength;

const hasUnsafeKeys = (value, depth = 0) => {
  if (depth > OPERATION_LIMITS.maxDepth) return true;
  if (Array.isArray(value)) return value.some((item) => hasUnsafeKeys(item, depth + 1));
  if (!isPlainObject(value)) return false;
  return Object.keys(value).some((key) => FORBIDDEN_KEYS.has(key) || key.startsWith('$') || hasUnsafeKeys(value[key], depth + 1));
};

export const validateCanvasOperation = (payload) => {
  if (!isPlainObject(payload)) return invalid('Operation must be an object');
  const { opId, baseRevision, kind, upserts = [], deletes = [], order } = payload;

  if (typeof opId !== 'string' || !OP_ID_PATTERN.test(opId)) return invalid('opId is invalid');
  if (!Number.isInteger(baseRevision) || baseRevision < 0) return invalid('baseRevision must be a non-negative integer');
  if (!OPERATION_KINDS.includes(kind)) return invalid('kind is invalid');
  if (!Array.isArray(upserts) || upserts.length > OPERATION_LIMITS.maxUpserts) return invalid('upserts must be a bounded array');
  if (!Array.isArray(deletes) || deletes.length > OPERATION_LIMITS.maxDeletes || !deletes.every(isObjectId)) return invalid('deletes must be a bounded array of ids');
  if (order !== undefined && (!Array.isArray(order) || order.length > OPERATION_LIMITS.maxOrder || !order.every(isObjectId) || new Set(order).size !== order.length)) {
    return invalid('order must be a bounded list of unique ids');
  }
  if (upserts.length === 0 && deletes.length === 0 && order === undefined) return invalid('Operation has no changes');

  const upsertIds = new Set();
  for (const upsert of upserts) {
    if (!isPlainObject(upsert) || !isObjectId(upsert.id) || !isPlainObject(upsert.data) || upsert.data.id !== upsert.id || typeof upsert.data.type !== 'string' || !upsert.data.type) {
      return invalid('Each upsert needs an id and a complete data snapshot');
    }
    if (upsertIds.has(upsert.id)) return invalid('An object appears in more than one upsert');
    upsertIds.add(upsert.id);
    const unset = upsert.unset === undefined ? [] : upsert.unset;
    if (!Array.isArray(unset) || !unset.every((field) => UNSETTABLE_FIELDS.includes(field))) return invalid('unset contains a field that cannot be removed');
  }
  if (deletes.some((id) => upsertIds.has(id))) return invalid('An object cannot be both upserted and deleted');
  if (hasUnsafeKeys(upserts)) return invalid('Operation data contains a forbidden key');

  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(payload));
  } catch {
    return invalid('Operation is not serializable');
  }
  if (size > OPERATION_LIMITS.maxBytes) return invalid('Operation is too large', 'OPERATION_TOO_LARGE');

  return {
    ok: true,
    op: {
      opId,
      baseRevision,
      kind,
      upserts: upserts.map(({ id, data, unset }) => ({ id, data, unset: unset || [] })),
      deletes: [...deletes],
      ...(order !== undefined ? { order: [...order] } : {})
    }
  };
};

const toSnapshot = (upsert) => {
  const snapshot = { ...upsert.data, id: upsert.id };
  upsert.unset.forEach((field) => {
    delete snapshot[field];
  });
  return snapshot;
};

export const applyCanvasOperation = (canvasData, op) => {
  const base = isPlainObject(canvasData) ? canvasData : { version: '6.5.1', objects: [] };
  const deleted = new Set(op.deletes);
  const upsertById = new Map(op.upserts.map((upsert) => [upsert.id, upsert]));
  const replaced = new Set();

  let objects = (Array.isArray(base.objects) ? base.objects : [])
    .filter((object) => isPlainObject(object) && !deleted.has(object.id))
    .map((object) => {
      if (!upsertById.has(object.id)) return object;
      replaced.add(object.id);
      return toSnapshot(upsertById.get(object.id));
    });
  op.upserts.filter((upsert) => !replaced.has(upsert.id)).forEach((upsert) => objects.push(toSnapshot(upsert)));

  if (op.order) {
    const ids = new Set(objects.map((object) => object.id));
    if (ids.size !== objects.length || op.order.length !== objects.length || !op.order.every((id) => ids.has(id))) {
      return { ok: false, code: 'ORDER_MISMATCH' };
    }
    const position = new Map(op.order.map((id, index) => [id, index]));
    objects = [...objects].sort((a, b) => position.get(a.id) - position.get(b.id));
  }

  return { ok: true, canvasData: { ...base, objects } };
};

const hasBoardAccess = (board, userId) => boardService._isOwner(board, userId) || boardService._isMember(board, userId);

const committedRevision = (board, opId) => (board?.recentOperations || []).find((entry) => entry.opId === opId)?.revision;

export const commitCanvasOperation = async ({ boardId, userId, op }) => {
  const board = await boardRepository.findBoardRevisionState(boardId);
  if (!board) return { status: 'not_found' };
  if (!hasBoardAccess(board, userId)) return { status: 'forbidden' };

  const previous = committedRevision(board, op.opId);
  if (previous !== undefined) return { status: 'duplicate', revision: previous };

  const currentRevision = board.canvasRevision || 0;
  if (currentRevision !== op.baseRevision) return { status: 'stale', currentRevision };

  const applied = applyCanvasOperation(board.canvasData, op);
  if (!applied.ok) return { status: 'conflict', code: applied.code, currentRevision };

  const committed = await boardRepository.commitCanvasOperation(boardId, { baseRevision: op.baseRevision, opId: op.opId, canvasData: applied.canvasData });
  if (committed) return { status: 'committed', revision: committed.canvasRevision };

  const latest = await boardRepository.findBoardRevisionState(boardId);
  if (!latest) return { status: 'not_found' };
  const raced = committedRevision(latest, op.opId);
  if (raced !== undefined) return { status: 'duplicate', revision: raced };
  return { status: 'stale', currentRevision: latest.canvasRevision || 0 };
};

export default {
  OPERATION_KINDS,
  UNSETTABLE_FIELDS,
  OPERATION_LIMITS,
  validateCanvasOperation,
  applyCanvasOperation,
  commitCanvasOperation
};
