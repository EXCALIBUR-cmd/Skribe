export const SIDEKICK_ACTIONS = Object.freeze([
  'create_text',
  'create_sticky_note',
  'create_sticky_notes',
  'create_shape',
  'create_kanban',
  'create_persona',
  'create_diagram',
  'organize_board'
]);

const STICKY_COLORS = ['#fff3a0', '#dcfce7', '#e0f2fe', '#f3e8ff', '#ffe4e6', '#ffedd5'];
const STICKY_STEP = 210;
const COLUMN_STEP = 220;

export const isSupportedAction = (action) => Boolean(action && SIDEKICK_ACTIONS.includes(action.action));

const grid = (texts, { columns = 3, top = 0, colorFor = (index) => STICKY_COLORS[index % STICKY_COLORS.length] } = {}) => {
  const cols = Math.min(columns, Math.max(1, texts.length));
  return texts.map((text, index) => ({
    kind: 'sticky',
    text,
    color: colorFor(index),
    dx: ((index % cols) - (cols - 1) / 2) * STICKY_STEP,
    dy: top + Math.floor(index / cols) * STICKY_STEP
  }));
};

export const buildActionLayout = (action) => {
  if (action.action === 'create_sticky_notes') return grid(action.items);
  if (action.action === 'create_persona') {
    return [{ kind: 'text', text: action.title, dx: 0, dy: -230 }, ...grid(action.items, { top: -40, colorFor: () => '#e0f2fe' })];
  }
  if (action.action === 'create_kanban') {
    const count = action.columns.length;
    const items = action.title ? [{ kind: 'text', text: action.title, dx: 0, dy: -340 }] : [];
    action.columns.forEach((column, columnIndex) => {
      const dx = (columnIndex - (count - 1) / 2) * COLUMN_STEP;
      items.push({ kind: 'header', text: column.name, dx, dy: -230 });
      column.cards.forEach((card, cardIndex) => {
        items.push({ kind: 'sticky', text: card, color: STICKY_COLORS[columnIndex % STICKY_COLORS.length], dx, dy: -60 + cardIndex * STICKY_STEP });
      });
    });
    return items;
  }
  return [];
};

export const describeAction = (action) => {
  switch (action.action) {
    case 'create_text':
      return { icon: 'title', key: 'sidekick.do.text', vars: {}, details: [action.text] };
    case 'create_sticky_note':
      return { icon: 'sticky_note_2', key: 'sidekick.do.sticky', vars: {}, details: [action.text] };
    case 'create_sticky_notes':
      return { icon: 'sticky_note_2', key: 'sidekick.do.stickies', vars: { count: action.items.length }, details: action.items };
    case 'create_shape':
      return { icon: 'category', key: 'sidekick.do.shape', vars: { shape: action.shapeType.replace('_', ' ') }, details: action.text ? [action.text] : [] };
    case 'create_kanban':
      return {
        icon: 'view_kanban',
        key: 'sidekick.do.kanban',
        vars: { columns: action.columns.length, cards: action.columns.reduce((sum, column) => sum + column.cards.length, 0) },
        details: action.columns.map((column) => `${column.name}: ${column.cards.length ? column.cards.join(' · ') : '—'}`)
      };
    case 'create_persona':
      return { icon: 'person', key: 'sidekick.do.persona', vars: { name: action.title }, details: action.items };
    case 'create_diagram':
      return { icon: 'schema', key: 'sidekick.do.diagram', vars: {}, details: [action.diagramPrompt] };
    case 'organize_board':
      return { icon: 'auto_fix_high', key: 'sidekick.do.organize', vars: {}, details: [] };
    default:
      return null;
  }
};

export const countNewObjects = (action) => {
  if (action.action === 'create_sticky_notes' || action.action === 'create_persona' || action.action === 'create_kanban') return buildActionLayout(action).length;
  if (action.action === 'organize_board') return 0;
  return 1;
};

export const checkProposal = (proposal, { boardId, objectIds }) => {
  if (!proposal || proposal.boardId !== boardId) return { ok: false, reason: 'board' };
  const present = new Set(objectIds);
  const referenced = new Set([...(proposal.contextIds || []), ...proposal.actions.flatMap((action) => action.sourceObjectIds || [])]);
  const missing = [...referenced].filter((id) => !present.has(id));
  if (missing.length) return { ok: false, reason: 'changed', missing };
  return { ok: true };
};

export const executeSidekickAction = async (action, { canvasApi, insertDiagram, openMessCleanup }) => {
  if (!isSupportedAction(action)) return { ok: false, created: 0 };
  switch (action.action) {
    case 'create_text':
    case 'create_sticky_note': {
      const result = canvasApi.executeVoiceCommand({ action: action.action, text: action.text });
      return { ok: Boolean(result?.success), created: result?.success ? 1 : 0 };
    }
    case 'create_shape': {
      const result = canvasApi.executeVoiceCommand({ action: 'create_shape', shapeType: action.shapeType, label: action.text || null });
      return { ok: Boolean(result?.success), created: result?.success ? 1 : 0 };
    }
    case 'create_sticky_notes':
    case 'create_persona':
    case 'create_kanban': {
      const layout = buildActionLayout(action);
      const result = canvasApi.placeSidekickItems(layout);
      return { ok: result?.created?.length === layout.length, created: result?.created?.length || 0 };
    }
    case 'create_diagram': {
      if (!action.prepared?.image) return { ok: false, created: 0 };
      const inserted = await insertDiagram(action.prepared);
      return { ok: Boolean(inserted), created: inserted ? 1 : 0 };
    }
    case 'organize_board':
      await openMessCleanup();
      return { ok: true, created: 0, handedOff: true };
    default:
      return { ok: false, created: 0 };
  }
};

export const executeSidekickPlan = async (proposal, deps) => {
  const results = [];
  for (const action of proposal.actions) {
    try {
      results.push({ action: action.action, ...(await executeSidekickAction(action, deps)) });
    } catch {
      results.push({ action: action.action, ok: false, created: 0 });
    }
  }
  return {
    ok: results.every((result) => result.ok),
    created: results.reduce((sum, result) => sum + result.created, 0),
    failed: results.filter((result) => !result.ok).length,
    handedOff: results.some((result) => result.handedOff),
    results
  };
};
