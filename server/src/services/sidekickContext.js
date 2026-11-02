export const SIDEKICK_CONTEXT_LIMITS = Object.freeze({
  objects: 120,
  textPerObject: 300,
  totalText: 6000,
  connectors: 120,
  selectedIds: 100
});

const TEXT_TYPES = new Set(['textbox', 'i-text', 'text']);

const clean = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

const typeOf = (object) => String(object?.type || '').toLowerCase();

const kindOf = (object) => {
  if (object.isStickyNote) return 'sticky_note';
  if (object.isChecklistNote) return 'checklist';
  if (object.isCalloutNote) return 'callout';
  if (object.isConnector || object.isSkribeLine) return 'connector';
  const metadata = object.metadata || {};
  if (metadata.assetType === 'lucide-icon') return 'icon';
  if (metadata.kind === 'mermaid') return 'diagram';
  const type = typeOf(object);
  if (type === 'image') return 'image';
  if (type === 'path' || object.isVectorStroke) return 'drawing';
  if (TEXT_TYPES.has(type)) return metadata.textKind ? `text_${metadata.textKind}` : 'text';
  return object.shapeType || type || 'object';
};

const boundsOf = (object) => {
  const width = Math.abs((Number(object.width) || 0) * (Number(object.scaleX) || 1));
  const height = Math.abs((Number(object.height) || 0) * (Number(object.scaleY) || 1));
  let x = Number(object.left) || 0;
  let y = Number(object.top) || 0;
  if (object.originX === 'center') x -= width / 2;
  else if (object.originX === 'right') x -= width;
  if (object.originY === 'center') y -= height / 2;
  else if (object.originY === 'bottom') y -= height;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) };
};

const describeVisual = (object, kind) => {
  const metadata = object.metadata || {};
  if (kind === 'icon') return clean(`Icon: ${metadata.iconName || metadata.iconId || 'unnamed'}`, 80);
  if (kind === 'diagram') return clean(`Diagram: ${metadata.title || metadata.diagramType || 'untitled'}`, 120);
  if (kind === 'image') return 'Image (contents not analysed)';
  return '';
};

export const buildSidekickContext = (objects = [], { selectedIds = [], title = '' } = {}) => {
  const all = (Array.isArray(objects) ? objects : []).filter((object) => object && typeof object === 'object' && typeof object.id === 'string');
  const labels = new Map();
  for (const object of all) {
    if (object.parentShapeId && TEXT_TYPES.has(typeOf(object)) && object.metadata?.role !== 'timestamp') {
      const text = clean(object.text, SIDEKICK_CONTEXT_LIMITS.textPerObject);
      if (text) labels.set(object.parentShapeId, text);
    }
  }

  const selection = new Set((Array.isArray(selectedIds) ? selectedIds : []).filter((id) => typeof id === 'string').slice(0, SIDEKICK_CONTEXT_LIMITS.selectedIds));
  for (const object of all) {
    if (selection.has(object.id) && object.parentShapeId) selection.add(object.parentShapeId);
  }
  const knownSelection = all.filter((object) => selection.has(object.id) && !object.parentShapeId);
  const scope = knownSelection.length ? 'selection' : 'board';

  const entries = [];
  const connectors = [];
  const drawings = { count: 0 };
  for (const object of all) {
    if (object.parentShapeId || object.metadata?.role === 'timestamp') continue;
    const kind = kindOf(object);
    if (kind === 'connector') {
      if (object.sourceShapeId || object.targetShapeId) {
        connectors.push({ from: object.sourceShapeId || null, to: object.targetShapeId || null });
      }
      continue;
    }
    if (scope === 'selection' && !selection.has(object.id)) continue;
    if (kind === 'drawing') {
      drawings.count += 1;
      continue;
    }
    const text = labels.get(object.id) || clean(object.text, SIDEKICK_CONTEXT_LIMITS.textPerObject) || describeVisual(object, kind);
    entries.push({ id: object.id, kind, text, ...boundsOf(object) });
  }

  entries.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const withText = entries.filter((entry) => entry.text);
  const withoutText = entries.filter((entry) => !entry.text);
  const included = [];
  let textBudget = SIDEKICK_CONTEXT_LIMITS.totalText;
  for (const entry of [...withText, ...withoutText]) {
    if (included.length >= SIDEKICK_CONTEXT_LIMITS.objects) break;
    if (entry.text.length > textBudget) continue;
    textBudget -= entry.text.length;
    included.push(entry);
  }

  const includedIds = new Set(included.map((entry) => entry.id));
  const omittedByKind = {};
  for (const entry of entries) {
    if (!includedIds.has(entry.id)) omittedByKind[entry.kind] = (omittedByKind[entry.kind] || 0) + 1;
  }
  const keptConnectors = connectors
    .filter((connector) => (connector.from || connector.to) && (!connector.from || includedIds.has(connector.from)) && (!connector.to || includedIds.has(connector.to)))
    .slice(0, SIDEKICK_CONTEXT_LIMITS.connectors);

  return {
    title: clean(title, 120),
    scope,
    objectCount: entries.length,
    includedCount: included.length,
    truncated: included.length < entries.length,
    omittedByKind,
    freehandDrawings: drawings.count,
    objects: included,
    connectors: keptConnectors
  };
};

export default { buildSidekickContext, SIDEKICK_CONTEXT_LIMITS };
