import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActionLayout, checkProposal, countNewObjects, describeAction, executeSidekickPlan, isSupportedAction } from './sidekickPlan.js';
import { classifyBoard, getSidekickSuggestions, SUGGESTION_SETS } from './sidekickSuggestions.js';
import en from '../i18n/en.js';
import hi from '../i18n/hi.js';

const sticky = (id, text) => [{ id, isStickyNote: true, type: 'rect' }, { id: `${id}_t`, type: 'textbox', text, parentShapeId: id }];

const fakeCanvas = () => {
  const calls = [];
  return {
    calls,
    executeVoiceCommand: (command) => { calls.push(['voice', command]); return { success: true, objectId: 'x' }; },
    placeSidekickItems: (items) => { calls.push(['place', items]); return { success: true, created: items.map((item, index) => `p${index}`) }; }
  };
};

test('suggestions follow what is actually on the board', () => {
  assert.equal(classifyBoard([]), 'empty');
  assert.equal(classifyBoard([...sticky('a', 'Auth service calls the API'), ...sticky('b', 'Database cache')]), 'technical');
  assert.equal(classifyBoard([...sticky('a', 'Q3 launch milestones'), ...sticky('b', 'Backlog tasks')]), 'planning');
  assert.equal(classifyBoard([{ id: 'r1', type: 'rect' }, { id: 'r2', type: 'rect' }, { id: 'c1', isConnector: true, sourceShapeId: 'r1', targetShapeId: 'r2' }, { id: 'c2', isConnector: true, sourceShapeId: 'r2', targetShapeId: 'r1' }]), 'workflow');
  assert.equal(classifyBoard([...sticky('a', 'idea one'), ...sticky('b', 'idea two'), ...sticky('c', 'idea three'), ...sticky('d', 'idea four')]), 'brainstorm');
  assert.equal(classifyBoard(sticky('a', 'Hello')), 'general');
  assert.deepEqual(getSidekickSuggestions([]).keys, SUGGESTION_SETS.empty);
  for (const key of Object.values(SUGGESTION_SETS).flat()) {
    assert.ok(en[key], `en ${key}`);
    assert.ok(hi[key], `hi ${key}`);
  }
});

test('layouts are deterministic, bounded and never take positions from the model', () => {
  const kanban = { action: 'create_kanban', title: 'Launch', columns: [{ name: 'To do', cards: ['A', 'B'] }, { name: 'Done', cards: ['C'] }] };
  const layout = buildActionLayout(kanban);
  assert.deepEqual(layout.map((item) => item.kind), ['text', 'header', 'sticky', 'sticky', 'header', 'sticky']);
  assert.deepEqual(layout.filter((item) => item.kind === 'header').map((item) => item.dx), [-110, 110]);
  assert.equal(countNewObjects(kanban), 6);
  const persona = buildActionLayout({ action: 'create_persona', title: 'Sam', items: ['Goals', 'Needs', 'Pains', 'Habits'] });
  assert.equal(persona[0].kind, 'text');
  assert.equal(persona.length, 5);
  assert.equal(buildActionLayout({ action: 'create_sticky_notes', items: ['a', 'b'] }).length, 2);
  assert.equal(describeAction({ action: 'create_kanban', ...kanban }).vars.cards, 3);
  assert.equal(describeAction({ action: 'rm -rf' }), null);
  assert.equal(isSupportedAction({ action: 'delete_board' }), false);
});

test('a proposal is rejected for another board or when its source objects are gone', () => {
  const proposal = { boardId: 'b1', actions: [{ action: 'create_text', text: 'x', sourceObjectIds: ['s1'] }] };
  assert.deepEqual(checkProposal(proposal, { boardId: 'b1', objectIds: ['s1', 's2'] }), { ok: true });
  assert.equal(checkProposal(proposal, { boardId: 'b2', objectIds: ['s1'] }).reason, 'board');
  assert.deepEqual(checkProposal(proposal, { boardId: 'b1', objectIds: ['s2'] }), { ok: false, reason: 'changed', missing: ['s1'] });
  const readOnly = { boardId: 'b1', contextIds: ['n1', 'n2'], actions: [{ action: 'create_sticky_notes', items: ['a', 'b'], sourceObjectIds: [] }] };
  assert.deepEqual(checkProposal(readOnly, { boardId: 'b1', objectIds: ['n1', 'n2', 'new'] }), { ok: true });
  assert.deepEqual(checkProposal(readOnly, { boardId: 'b1', objectIds: ['n1', 'new'] }), { ok: false, reason: 'changed', missing: ['n2'] });
});

test('applying a plan routes each action to an existing Skribe path and skips anything unknown', async () => {
  const canvasApi = fakeCanvas();
  const inserted = [];
  let organised = 0;
  const result = await executeSidekickPlan({
    actions: [
      { action: 'create_text', text: 'Summary' },
      { action: 'create_shape', shapeType: 'diamond', text: 'Valid?' },
      { action: 'create_kanban', columns: [{ name: 'To do', cards: ['A'] }, { name: 'Done', cards: [] }] },
      { action: 'create_diagram', diagramPrompt: 'flow', prepared: { image: { dataUrl: 'data:image/png;base64,x' }, meta: { kind: 'mermaid' } } },
      { action: 'organize_board' },
      { action: 'delete_everything' }
    ]
  }, { canvasApi, insertDiagram: async (prepared) => { inserted.push(prepared); return {}; }, openMessCleanup: async () => { organised += 1; } });
  assert.deepEqual(canvasApi.calls.map(([kind, payload]) => kind === 'voice' ? payload.action : `place:${payload.length}`), ['create_text', 'create_shape', 'place:3']);
  assert.equal(canvasApi.calls[1][1].label, 'Valid?');
  assert.equal(inserted.length, 1);
  assert.equal(organised, 1);
  assert.equal(result.created, 6);
  assert.equal(result.failed, 1);
  assert.equal(result.handedOff, true);
  assert.equal(result.ok, false);
  const unprepared = await executeSidekickPlan({ actions: [{ action: 'create_diagram', diagramPrompt: 'x' }] }, { canvasApi, insertDiagram: async () => ({}) , openMessCleanup: async () => {} });
  assert.equal(unprepared.ok, false);
});
