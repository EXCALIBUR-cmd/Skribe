const OBJECT_MARK = '\u0000';

const readValue = (value) => {
  if (value === null || typeof value !== 'object') return value;
  try {
    return OBJECT_MARK + JSON.stringify(value);
  } catch {
    return Symbol('unreadable');
  }
};

const readProperty = (object, key) => (key === 'src' && typeof object.getSrc === 'function' ? object.getSrc() : readValue(object[key]));

const isPaintServer = (value) => value !== null && typeof value === 'object';

const isGroup = (object) => Array.isArray(object._objects) && typeof object.isType === 'function' && object.isType('Group', 'group');

const isStable = (object) => {
  if (!object || object.clipPath || isPaintServer(object.fill) || isPaintServer(object.stroke)) return false;
  if (typeof object.isType === 'function' && object.isType('ActiveSelection', 'activeselection')) return false;
  return !isGroup(object) || object._objects.every(isStable);
};

export const isMemoizable = (object) => Boolean(object) && !object.group && isStable(object);

export const createSerializationMemo = (properties = []) => {
  const entries = new WeakMap();
  const keySets = new Map();

  const internKeys = (data) => {
    const keys = [...new Set([...Object.keys(data), ...properties])];
    const signature = keys.join('\u0001');
    if (!keySets.has(signature)) keySets.set(signature, keys);
    return keySets.get(signature);
  };

  const takeProbe = (object, data) => {
    const keys = internKeys(data);
    const probe = { keys, values: keys.map((key) => readProperty(object, key)) };
    if (isGroup(object)) {
      const children = data.objects;
      if (!Array.isArray(children) || children.length !== object._objects.length) return null;
      probe.children = object._objects.map((child, index) => takeProbe(child, children[index]));
      if (probe.children.includes(null)) return null;
    }
    return probe;
  };

  const matches = (probe, object) => {
    const { keys, values, children } = probe;
    for (let index = 0; index < keys.length; index += 1) {
      if (readProperty(object, keys[index]) !== values[index]) return false;
    }
    if (!children) return true;
    if (!isGroup(object) || object._objects.length !== children.length) return false;
    return children.every((child, index) => matches(child, object._objects[index]));
  };

  const read = (object, produce, derive = (data) => data) => {
    if (!isMemoizable(object)) return derive(produce());
    const known = entries.get(object);
    if (known && matches(known.probe, object)) return known.value;
    const data = produce();
    if (!data) return data;
    const probe = takeProbe(object, data);
    const value = derive(data);
    if (probe) entries.set(object, { probe, value });
    else entries.delete(object);
    return value;
  };

  const replace = (object, value) => {
    const known = entries.get(object);
    if (known) known.value = value;
    return value;
  };

  return { read, replace };
};

export default createSerializationMemo;
