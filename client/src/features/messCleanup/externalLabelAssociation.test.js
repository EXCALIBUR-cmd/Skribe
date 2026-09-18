import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveContainerOwnership, buildVisualObjectModel } from './visualUnits.js';

const shape = (id, x = 100, y = 100, w = 140, h = 90, extra = {}) => ({
  id,
  type: 'shape',
  shapeType: 'rect',
  position: { x, y },
  size: { width: w, height: h },
  rotation: 0,
  scale: { x: 1, y: 1 },
  ...extra
});

const text = (id, textContent, x = 100, y = 100, w = 80, h = 24, extra = {}) => ({
  id,
  type: 'text',
  text: textContent,
  position: { x, y },
  size: { width: w, height: h },
  rotation: 0,
  scale: { x: 1, y: 1 },
  ...extra
});

test('TEST POSITIVE: Canonical External Label', () => {
  const objects = [
    shape('s1', 100, 200, 160, 80),
    text('t1', 'Start', 140, 165, 80, 24)
  ];
  const model = { objects };
  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map(v => [v.objectId, v]));
  const { ownedByOwner, ownerByText, relationshipTypeByText } = resolveContainerOwnership(visualObjects, objectMap);

  assert.equal(ownerByText.get('t1'), 's1');
  assert.equal(relationshipTypeByText.get('t1'), 'inferred-external');
  assert.ok(ownedByOwner.get('s1').includes('t1'));
});

test('TEST A: Page heading above multiple shapes', () => {
  const objects = [
    shape('s1', 100, 200, 160, 80),
    shape('s2', 300, 200, 160, 80),
    text('t1', 'Main Diagram Heading', 150, 100, 300, 40)
  ];
  const model = { objects };
  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map(v => [v.objectId, v]));
  const { ownerByText } = resolveContainerOwnership(visualObjects, objectMap);
  assert.equal(ownerByText.has('t1'), false, 'Page heading should not be claimed');
});

test('TEST B: Ambiguous label', () => {
  const objects = [
    shape('s1', 100, 200, 100, 100),
    shape('s2', 220, 200, 100, 100),
    text('t1', 'Ambiguous', 160, 170, 80, 24)
  ];
  objects[2].position.x = 170;
  const model = { objects };
  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map(v => [v.objectId, v]));
  const { ownerByText } = resolveContainerOwnership(visualObjects, objectMap);
  assert.equal(ownerByText.has('t1'), false, 'Ambiguous label should not be claimed');
});

test('TEST C: Wrong-shape proximity', () => {

  const objects = [
    shape('s1', 100, 200, 100, 100),
    shape('s2', 300, 200, 100, 100),


    text('t1', 'Closer', 205, 171, 80, 24)
  ];



  const model = { objects };
  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map(v => [v.objectId, v]));
  const { ownerByText, relationshipTypeByText } = resolveContainerOwnership(visualObjects, objectMap);

});

test('TEST D: Diagonal text', () => {
  const objects = [
    shape('s1', 100, 200, 100, 100),
    text('t1', 'Diagonal', 220, 160, 80, 24)
  ];
  const model = { objects };
  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map(v => [v.objectId, v]));
  const { ownerByText } = resolveContainerOwnership(visualObjects, objectMap);
  assert.equal(ownerByText.has('t1'), false, 'Diagonal text should not be claimed');
});

test('TEST E: Distant text', () => {
  const objects = [
    shape('s1', 100, 200, 100, 100),
    text('t1', 'Distant', 100, 50, 80, 24)
  ];
  const model = { objects };
  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map(v => [v.objectId, v]));
  const { ownerByText } = resolveContainerOwnership(visualObjects, objectMap);
  assert.equal(ownerByText.has('t1'), false, 'Distant text should not be claimed');
});

test('TEST F: Explicit metadata', () => {
  const objects = [
    shape('s1', 100, 200, 100, 100, { relationshipMetadata: { attachedTextId: 't1' } }),
    shape('s2', 100, 50, 100, 100),
    text('t1', 'Explicit', 110, 160, 80, 24)
  ];
  const model = { objects };
  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map(v => [v.objectId, v]));
  const { ownerByText, relationshipTypeByText } = resolveContainerOwnership(visualObjects, objectMap);
  assert.equal(ownerByText.get('t1'), 's1');
  assert.equal(relationshipTypeByText.get('t1'), 'explicit');
});

test('TEST G: Interior text', () => {
  const objects = [
    shape('s1', 100, 200, 100, 100),
    text('t1', 'Inside', 110, 240, 80, 24)
  ];
  const model = { objects };
  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map(v => [v.objectId, v]));
  const { ownerByText, relationshipTypeByText } = resolveContainerOwnership(visualObjects, objectMap);
  assert.equal(ownerByText.get('t1'), 's1');
  assert.equal(relationshipTypeByText.get('t1'), 'interior');
});

test('TEST H: Creative/Annotation text', () => {
  const objects = [
    shape('s1', 100, 200, 100, 100),
    text('t1', 'Creative', 110, 170, 80, 24, { metadata: { isAnnotation: true } })
  ];
  const model = { objects };
  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map(v => [v.objectId, v]));
  const { ownerByText } = resolveContainerOwnership(visualObjects, objectMap);
  assert.equal(ownerByText.has('t1'), false, 'Annotation text should not be claimed');
});

test('TEST I: Multi-node flow', () => {
  const objects = [
    shape('s1', 100, 200, 100, 100),
    shape('s2', 300, 200, 100, 100),
    shape('s3', 500, 200, 100, 100),
    text('t1', 'Unique to s1', 110, 170, 80, 24),
    text('t2', 'Unique to s3', 510, 170, 80, 24)
  ];
  const model = { objects };
  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map(v => [v.objectId, v]));
  const { ownerByText } = resolveContainerOwnership(visualObjects, objectMap);
  assert.equal(ownerByText.get('t1'), 's1', 't1 should clearly belong to s1');
  assert.equal(ownerByText.get('t2'), 's3', 't2 should clearly belong to s3');
});

test('TEST J: Reassociation conflict', () => {
  const objects = [
    shape('s1', 100, 200, 100, 100, { relationshipMetadata: { attachedTextId: 't1' } }),
    shape('s2', 100, 50, 100, 100),
    text('t1', 'Explicit', 110, 60, 80, 24)
  ];
  const model = { objects };
  const visualObjects = buildVisualObjectModel(model);
  const objectMap = new Map(visualObjects.map(v => [v.objectId, v]));
  const { ownerByText, relationshipTypeByText } = resolveContainerOwnership(visualObjects, objectMap);
  assert.equal(ownerByText.get('t1'), 's1', 'Explicit ownership must prevent inferred-external from stealing');
  assert.equal(relationshipTypeByText.get('t1'), 'explicit');
});
