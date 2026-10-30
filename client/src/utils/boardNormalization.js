const TEXT_TYPES = new Set(['textbox', 'i-text', 'text']);

export const isTextObject = (object) => TEXT_TYPES.has(String(object?.type || '').toLowerCase());

export const isTimestampObject = (object) => object?.metadata?.role === 'timestamp' || (typeof object?.id === 'string' && object.id.startsWith('timestamp_'));

const compareIds = (a, b) => {
  const left = String(a.id);
  const right = String(b.id);
  if (left < right) return -1;
  return left > right ? 1 : 0;
};

const cloneValue = (value) => (value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value);

const labelPreference = (elementId) => (a, b) => {
  const rank = (object) => {
    if (object.id === `text_${elementId}`) return 0;
    if (String(object.type || '').toLowerCase() !== 'text') return 1;
    return 2;
  };
  return rank(a) - rank(b) || compareIds(a, b);
};

export const resolveElementLinks = (objects) => {
  const groups = new Map();
  (Array.isArray(objects) ? objects : []).forEach((object) => {
    if (!object || !object.elementId || typeof object.id !== 'string') return;
    if (!groups.has(object.elementId)) groups.set(object.elementId, []);
    groups.get(object.elementId).push(object);
  });

  const links = new Map();
  groups.forEach((members, elementId) => {
    const shapes = members.filter((object) => !isTextObject(object)).sort(compareIds);
    const labels = members.filter((object) => isTextObject(object) && !isTimestampObject(object)).sort(labelPreference(elementId));
    const texts = members.filter((object) => isTextObject(object));
    if (shapes.length === 0) return;
    const shapeIds = new Set(shapes.map((shape) => shape.id));
    const labelIds = new Set(labels.map((label) => label.id));

    shapes.forEach((shape) => {
      if (labels.length === 0) return;
      const attachedTextId = labelIds.has(shape.attachedTextId) ? shape.attachedTextId : labels[0].id;
      links.set(shape.id, { ...(links.get(shape.id) || {}), attachedTextId });
    });
    texts.forEach((text) => {
      const parentShapeId = shapeIds.has(text.parentShapeId) ? text.parentShapeId : shapes[0].id;
      links.set(text.id, { ...(links.get(text.id) || {}), parentShapeId });
    });
  });
  return links;
};

export const serializeCanvasObject = (canvas, object, properties) => {
  if (!object || typeof object.toJSON !== 'function') return null;
  const realized = canvas && typeof canvas._realizeGroupTransformOnObject === 'function'
    ? canvas._realizeGroupTransformOnObject(object)
    : {};
  try {
    const data = object.toJSON([...properties]);
    if (!data) return null;
    properties.forEach((property) => {
      if (object[property] !== undefined) data[property] = cloneValue(object[property]);
    });
    return data;
  } finally {
    if (realized && Object.keys(realized).length > 0) object.set(realized);
  }
};

export const longestIncreasingIndices = (values) => {
  const tails = [];
  const previous = new Array(values.length).fill(-1);
  values.forEach((value, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]] < value) low = middle + 1;
      else high = middle;
    }
    previous[index] = low > 0 ? tails[low - 1] : -1;
    tails[low] = index;
  });
  const keep = new Set();
  for (let index = tails.length > 0 ? tails[tails.length - 1] : -1; index >= 0; index = previous[index]) keep.add(index);
  return keep;
};

export default {
  longestIncreasingIndices,
  isTextObject,
  isTimestampObject,
  resolveElementLinks,
  serializeCanvasObject
};
