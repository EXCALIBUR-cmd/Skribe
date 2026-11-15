export const MAX_GUEST_BOARD_OBJECTS = 500;
export const GUEST_LIMIT_CODES = new Set(['GUEST_IMAGES_DISABLED', 'GUEST_OBJECT_LIMIT']);
export const GUEST_FEATURE_CODES = new Set(['GUEST_CLEANUP_LIMIT', 'GUEST_NOT_ALLOWED']);

const MAX_IMAGE_SCAN_DEPTH = 64;

export const hasImageContent = (value, depth = 0) => {
  if (value === null || typeof value !== 'object') return false;
  if (depth > MAX_IMAGE_SCAN_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => hasImageContent(item, depth + 1));
  if (typeof value.type === 'string' && value.type.toLowerCase() === 'image') return true;
  if (typeof value.assetId === 'string' && value.assetId) return true;
  if (typeof value.src === 'string' && value.src) return true;
  return Object.values(value).some((child) => hasImageContent(child, depth + 1));
};

export const planGuestRevert = ({ code, local = [], base = [] }) => {
  const baseById = new Map(base.filter((object) => object?.id).map((object) => [object.id, object]));
  let offending = [];
  if (code === 'GUEST_IMAGES_DISABLED') {
    offending = local.filter((object) => hasImageContent(object)).map((object) => object.id);
  } else if (code === 'GUEST_OBJECT_LIMIT') {
    const excess = local.length - MAX_GUEST_BOARD_OBJECTS;
    const fresh = local.filter((object) => !baseById.has(object.id));
    offending = excess > 0 ? fresh.slice(-excess).map((object) => object.id) : [];
  }
  const restorable = (id) => baseById.has(id) && !hasImageContent(baseById.get(id));
  return {
    removedIds: offending.filter((id) => !restorable(id)),
    restored: offending.filter(restorable).map((id) => baseById.get(id))
  };
};

export const guestLimitMessage = (code) => (code === 'GUEST_IMAGES_DISABLED'
  ? 'Images can\'t be added to guest boards. Sign up free to add images.'
  : `Guest boards hold up to ${MAX_GUEST_BOARD_OBJECTS} objects. Sign up free to keep adding more.`);
