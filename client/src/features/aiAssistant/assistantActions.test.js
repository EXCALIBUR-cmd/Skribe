import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ASSISTANT_ACTIONS, applyAssistantResult, buildBoardContext, canApplyResult } from './assistantActions.js';

const mockCanvasApi = () => {
  const calls = { stickies: [], diagrams: [] };
  return {
    calls,
    addAIStickyNotes: (points) => calls.stickies.push(points),
    insertDiagramImage: (image, meta) => calls.diagrams.push({ image, meta })
  };
};

test('every assistant action has an explicit, unique identifier and kind', () => {
  const ids = ASSISTANT_ACTIONS.map((action) => action.id);
  assert.deepEqual(ids, ['brainstorm', 'architecture', 'summarize', 'sticky_gen', 'analyze_diagram', 'diagram']);
  assert.equal(new Set(ids).size, ids.length);
  for (const action of ASSISTANT_ACTIONS) assert.ok(['response', 'stickies', 'diagram'].includes(action.kind), action.id);
});

test('display actions never create sticky notes or diagrams', () => {
  for (const id of ['brainstorm', 'architecture', 'summarize', 'analyze_diagram']) {
    const api = mockCanvasApi();
    assert.equal(canApplyResult(id), false, id);
    assert.throws(() => applyAssistantResult(id, { title: 't', points: ['a', 'b'] }, api), id);
    assert.deepEqual(api.calls, { stickies: [], diagrams: [] }, id);
  }
});

test('Diagram Studio inserts only a diagram and never sticky notes', () => {
  const api = mockCanvasApi();
  const image = { dataUrl: 'data:image/svg+xml,x', width: 10, height: 10 };
  applyAssistantResult('diagram', { image, meta: { kind: 'mermaid' } }, api);
  assert.equal(api.calls.stickies.length, 0);
  assert.deepEqual(api.calls.diagrams, [{ image, meta: { kind: 'mermaid' } }]);
});

test('Generate Sticky Notes creates sticky notes from the generated points', () => {
  const api = mockCanvasApi();
  applyAssistantResult('sticky_gen', { points: ['One', 'Two'] }, api);
  assert.deepEqual(api.calls.stickies, [['One', 'Two']]);
  assert.equal(api.calls.diagrams.length, 0);
});

test('unknown actions are refused', () => {
  const api = mockCanvasApi();
  assert.throws(() => applyAssistantResult('generate_flow', { points: ['x'] }, api));
  assert.deepEqual(api.calls, { stickies: [], diagrams: [] });
});

test('no generic AI handler routes actions to the sticky cluster', () => {
  const canvasSource = readFileSync(new URL('../../components/canvas/FabricCanvas.jsx', import.meta.url), 'utf8');
  const pageSource = readFileSync(new URL('../../pages/MainCanvasPage.jsx', import.meta.url), 'utf8');
  assert.equal(canvasSource.includes('triggerAIAction'), false);
  assert.equal(pageSource.includes('triggerAIAction'), false);
  assert.equal(canvasSource.match(/generateAIStickyCluster\(/g).length, 1);
});

test('board context keeps linked labels and connections and drops child objects', () => {
  const context = buildBoardContext([
    { id: 's1', type: 'rect', shapeType: 'rect' },
    { id: 't1', type: 'textbox', text: 'Login', parentShapeId: 's1' },
    { id: 's2', type: 'circle' },
    { id: 't2', type: 'textbox', text: 'Dashboard', parentShapeId: 's2' },
    { id: 'c1', isConnector: true, sourceShapeId: 's1', targetShapeId: 's2' },
    { id: 'n1', isStickyNote: true, type: 'rect' },
    { id: 'n1t', type: 'textbox', text: 'Idea', parentShapeId: 'n1' },
    { id: 'x', type: 'textbox', text: '   ' }
  ]);
  assert.deepEqual(context, [
    { kind: 'rect', text: 'Login' },
    { kind: 'circle', text: 'Dashboard' },
    { kind: 'connector', from: 'Login', to: 'Dashboard' },
    { kind: 'sticky', text: 'Idea' }
  ]);
});
