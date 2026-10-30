export const OPERATION_BYTE_LIMIT = 900000;

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

export const createOperationId = () => {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID().replace(/-/g, '')
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `op_${Date.now().toString(36)}_${random.slice(0, 24)}`;
};

const comparable = (object) => {
  const { stackIndex, ...rest } = object;
  return JSON.stringify(rest);
};

export const sameObject = (a, b) => Boolean(a && b) && comparable(a) === comparable(b);

export const indexObjects = (objects) => new Map(
  (Array.isArray(objects) ? objects : [])
    .filter((object) => object && typeof object.id === 'string' && object.id)
    .map((object) => [object.id, object])
);

export const sameObjectList = (a, b) => (
  a.length === b.length && a.every((object, index) => object.id === b[index].id && sameObject(object, b[index]))
);

export const buildCanvasOperation = ({ serverObjects, canvasObjects, baseRevision, kind, opId = createOperationId(), storedObjects = serverObjects }) => {
  const server = indexObjects(serverObjects);
  const stored = indexObjects(storedObjects);
  const current = (Array.isArray(canvasObjects) ? canvasObjects : []).filter((object) => object && typeof object.id === 'string' && object.id);
  const currentIds = new Set(current.map((object) => object.id));

  const upserts = current
    .filter((object) => !stored.has(object.id) || !sameObject(server.get(object.id), object))
    .map((object) => {
      const previous = stored.get(object.id);
      const unset = previous ? UNSETTABLE_FIELDS.filter((field) => field in previous && !(field in object)) : [];
      return { id: object.id, data: object, unset };
    });
  const deletes = [...stored.keys()].filter((id) => !currentIds.has(id));
  const serverOrder = (Array.isArray(serverObjects) ? serverObjects : []).map((object) => object?.id).filter((id) => currentIds.has(id));
  const order = current.map((object) => object.id);
  const orderChanged = upserts.some((upsert) => !server.has(upsert.id))
    || serverOrder.length !== order.length
    || serverOrder.some((id, index) => id !== order[index]);

  if (upserts.length === 0 && deletes.length === 0 && !orderChanged) return null;
  return { opId, baseRevision, kind, upserts, deletes, order };
};

export const operationByteSize = (payload) => new TextEncoder().encode(JSON.stringify(payload)).length;

export const applyCanvasOperation = (objects, op) => {
  const deleted = new Set(op.deletes || []);
  const upserts = new Map((op.upserts || []).map((upsert) => [upsert.id, upsert]));
  const toSnapshot = (upsert) => {
    const snapshot = { ...upsert.data, id: upsert.id };
    (upsert.unset || []).forEach((field) => {
      delete snapshot[field];
    });
    return snapshot;
  };
  const replaced = new Set();
  let next = (Array.isArray(objects) ? objects : [])
    .filter((object) => object && !deleted.has(object.id))
    .map((object) => {
      if (!upserts.has(object.id)) return object;
      replaced.add(object.id);
      return toSnapshot(upserts.get(object.id));
    });
  (op.upserts || []).filter((upsert) => !replaced.has(upsert.id)).forEach((upsert) => next.push(toSnapshot(upsert)));

  if (Array.isArray(op.order)) {
    const ids = new Set(next.map((object) => object.id));
    if (ids.size !== next.length || op.order.length !== next.length || !op.order.every((id) => ids.has(id))) {
      return { ok: false, code: 'ORDER_MISMATCH' };
    }
    const position = new Map(op.order.map((id, index) => [id, index]));
    next = [...next].sort((a, b) => position.get(a.id) - position.get(b.id));
  }
  return { ok: true, objects: next };
};

const presenceChanged = (before, after) => Boolean(before) !== Boolean(after) || (Boolean(before) && !sameObject(before, after));

const sameSequence = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);

const idsOf = (objects) => (Array.isArray(objects) ? objects : []).map((object) => object?.id).filter((id) => typeof id === 'string' && id);

const reordered = (baseIds, nextIds) => {
  const nextSet = new Set(nextIds);
  const shared = new Set(baseIds.filter((id) => nextSet.has(id)));
  return !sameSequence(baseIds.filter((id) => shared.has(id)), nextIds.filter((id) => shared.has(id)));
};

const insertByNeighbour = (orderIds, id, referenceIds) => {
  const position = referenceIds.indexOf(id);
  for (let index = position - 1; index >= 0; index -= 1) {
    const anchor = orderIds.indexOf(referenceIds[index]);
    if (anchor !== -1) {
      orderIds.splice(anchor + 1, 0, id);
      return;
    }
  }
  orderIds.unshift(id);
};

export const mergeThreeWay = ({ baseRaw, baseLocal, theirs, local }) => {
  const baseRawIndex = indexObjects(baseRaw);
  const baseLocalIndex = indexObjects(baseLocal);
  const theirsIndex = indexObjects(theirs);
  const localIndex = indexObjects(local);
  const ids = new Set([...baseRawIndex.keys(), ...baseLocalIndex.keys(), ...theirsIndex.keys(), ...localIndex.keys()]);

  const chosen = new Map();
  const changedIds = [];
  const conflicts = [];
  const conflictVersions = new Map();
  const oursChangedIds = new Set();
  const theirsChangedIds = new Set();

  ids.forEach((id) => {
    const theirsChanged = presenceChanged(baseRawIndex.get(id), theirsIndex.get(id));
    const converged = theirsChanged && !presenceChanged(theirsIndex.get(id), localIndex.get(id));
    const oursChanged = !converged && presenceChanged(baseLocalIndex.get(id), localIndex.get(id));
    if (theirsChanged) theirsChangedIds.add(id);
    if (oursChanged) oursChangedIds.add(id);
    if (converged || !theirsChanged || oursChanged) {
      if (localIndex.has(id)) chosen.set(id, localIndex.get(id));
      if (theirsChanged && oursChanged) {
        conflicts.push(id);
        conflictVersions.set(id, theirsIndex.get(id) || null);
      }
      return;
    }
    if (theirsIndex.has(id)) {
      chosen.set(id, theirsIndex.get(id));
      changedIds.push(id);
    }
  });

  const localIds = idsOf(local);
  const theirsIds = idsOf(theirs);
  const theirsReordered = reordered(idsOf(baseRaw), theirsIds);
  const oursReordered = reordered(idsOf(baseLocal), localIds);
  const orderConflict = theirsReordered && oursReordered;

  let orderIds;
  if (theirsReordered && !oursReordered) {
    orderIds = theirsIds.filter((id) => chosen.has(id));
    const placed = new Set(orderIds);
    localIds.filter((id) => chosen.has(id) && !placed.has(id)).forEach((id) => insertByNeighbour(orderIds, id, localIds));
  } else {
    orderIds = localIds.filter((id) => chosen.has(id));
    const placed = new Set(orderIds);
    theirsIds.filter((id) => chosen.has(id) && !placed.has(id)).forEach((id) => insertByNeighbour(orderIds, id, theirsIds));
  }

  const removedIds = localIds.filter((id) => !chosen.has(id));
  const survivingLocal = localIds.filter((id) => chosen.has(id));
  const orderChanged = !sameSequence(survivingLocal, orderIds.filter((id) => localIndex.has(id)));

  return {
    objects: orderIds.map((id) => chosen.get(id)),
    changedIds,
    removedIds,
    orderChanged,
    orderConflict,
    conflicts,
    conflictVersions,
    oursChangedIds,
    theirsChangedIds
  };
};

export const conflictUndoObjects = (merge, theirs = []) => {
  if (merge.conflicts.length === 0) return null;
  const restored = merge.objects
    .map((object) => (merge.conflictVersions.has(object.id) ? merge.conflictVersions.get(object.id) : object))
    .filter(Boolean);
  const byId = indexObjects(restored);
  const orderIds = restored.map((object) => object.id);
  const theirsIds = idsOf(theirs);
  merge.conflicts.filter((id) => !byId.has(id) && merge.conflictVersions.get(id) && theirsIds.includes(id)).forEach((id) => {
    insertByNeighbour(orderIds, id, theirsIds);
    byId.set(id, merge.conflictVersions.get(id));
  });
  return orderIds.map((id) => byId.get(id));
};

export const changedSince = (before, after) => {
  const previous = indexObjects(before);
  return (Array.isArray(after) ? after : []).filter((object) => object && typeof object.id === 'string' && object.id && !sameObject(previous.get(object.id), object));
};

export const acceptObjects = ({ base, current, ids }) => {
  const wanted = new Set((Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string' && id));
  const currentIndex = indexObjects(current);
  const kept = (Array.isArray(base) ? base : [])
    .filter((object) => object && (!wanted.has(object.id) || currentIndex.has(object.id)))
    .map((object) => (wanted.has(object.id) ? currentIndex.get(object.id) : object));
  const byId = indexObjects(kept);
  const orderIds = kept.map((object) => object.id);
  const currentIds = idsOf(current);
  [...wanted].filter((id) => currentIndex.has(id) && !byId.has(id)).forEach((id) => {
    insertByNeighbour(orderIds, id, currentIds);
    byId.set(id, currentIndex.get(id));
  });
  return orderIds.map((id) => byId.get(id));
};

export const nextLocalBase = ({ merge, theirs, previousBaseLocal, canvasObjects }) => {
  const previous = indexObjects(previousBaseLocal);
  const canvas = indexObjects(canvasObjects);
  return (Array.isArray(theirs) ? theirs : []).filter((object) => object && typeof object.id === 'string').map((object) => {
    if (!merge.oursChangedIds.has(object.id)) return canvas.get(object.id) || object;
    if (merge.theirsChangedIds.has(object.id)) return object;
    return previous.get(object.id) || object;
  });
};

export default {
  OPERATION_BYTE_LIMIT,
  UNSETTABLE_FIELDS,
  createOperationId,
  sameObject,
  sameObjectList,
  indexObjects,
  buildCanvasOperation,
  operationByteSize,
  applyCanvasOperation,
  mergeThreeWay,
  conflictUndoObjects,
  changedSince,
  acceptObjects,
  nextLocalBase
};
