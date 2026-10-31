export const ASSISTANT_ACTIONS = Object.freeze([
  { id: 'brainstorm', label: 'Brainstorm', icon: 'lightbulb', kind: 'response', needsPrompt: true, placeholder: 'What should we brainstorm?' },
  { id: 'architecture', label: 'Architecture Assist', icon: 'account_tree', kind: 'response', needsPrompt: true, placeholder: 'Describe the system you are designing' },
  { id: 'summarize', label: 'Summarize Canvas', icon: 'description', kind: 'response', needsPrompt: false, placeholder: 'Optional: what should the summary focus on?' },
  { id: 'sticky_gen', label: 'Generate Sticky Notes', icon: 'grid_view', kind: 'stickies', needsPrompt: true, placeholder: 'What should the sticky notes cover?' },
  { id: 'analyze_diagram', label: 'Analyze Diagram', icon: 'analytics', kind: 'response', needsPrompt: false, placeholder: 'Optional: what should the analysis focus on?' },
  { id: 'diagram', label: 'Diagram Studio', icon: 'schema', kind: 'diagram', needsPrompt: true, placeholder: 'Describe the diagram, e.g. the checkout flow of an online shop' }
]);

export const getAssistantAction = (id) => ASSISTANT_ACTIONS.find((action) => action.id === id) || null;

export const canApplyResult = (actionId) => {
  const kind = getAssistantAction(actionId)?.kind;
  return kind === 'stickies' || kind === 'diagram';
};

export const applyAssistantResult = (actionId, result, canvasApi) => {
  const kind = getAssistantAction(actionId)?.kind;
  if (kind === 'stickies') return canvasApi.addAIStickyNotes(result.points);
  if (kind === 'diagram') return canvasApi.insertDiagramImage(result.image, result.meta);
  throw new Error(`The ${actionId} action does not change the board`);
};

const textOf = (object) => (typeof object?.text === 'string' ? object.text.trim() : '');

const kindOf = (object) => {
  if (object.isStickyNote) return 'sticky';
  if (object.isConnector) return 'connector';
  if (object.type === 'textbox' || object.type === 'i-text' || object.type === 'text') return 'text';
  return object.shapeType || object.type || 'object';
};

export const buildBoardContext = (objects = []) => {
  const textByShape = new Map();
  for (const object of objects) {
    if (object?.parentShapeId && textOf(object)) textByShape.set(object.parentShapeId, textOf(object));
  }
  const labelOf = (id) => textByShape.get(id) || id;
  const context = [];
  for (const object of objects) {
    if (!object || object.parentShapeId) continue;
    if (object.isConnector) {
      if (object.sourceShapeId || object.targetShapeId) context.push({ kind: 'connector', from: labelOf(object.sourceShapeId) || '', to: labelOf(object.targetShapeId) || '' });
      continue;
    }
    const text = textByShape.get(object.id) || textOf(object);
    if (text) context.push({ kind: kindOf(object), text: text.slice(0, 160) });
  }
  return context.slice(0, 200);
};
