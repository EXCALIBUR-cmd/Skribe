import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeWorkspace } from './analyzeWorkspace.js';
import { extractWorkspaceModel } from './extractWorkspaceModel.js';

test('TEST 1: Document title + body paragraphs', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'title_1', type: 'text', text: 'Project Overview', style: { fontSize: 32, fontWeight: 'bold' }, position: { x: 100, y: 50 }, size: { width: 300, height: 40 } },
        { id: 'body_1', type: 'text', text: 'This document explains the system.', style: { fontSize: 16 }, position: { x: 100, y: 120 }, size: { width: 300, height: 20 } },
        { id: 'body_2', type: 'text', text: 'Additional details follow here.', style: { fontSize: 16 }, position: { x: 100, y: 160 }, size: { width: 300, height: 20 } }
      ]
    }
  };

  const plan = analyzeWorkspace(model);
  const titleCand = plan.textCandidates.find((c) => c.objectId === 'title_1');

  assert.equal(titleCand.role, 'title');
  assert.equal(plan.hierarchy.length, 1);
  assert.equal(plan.hierarchy[0].titleObjectId, 'title_1');

  const mainSection = plan.sections.find((s) => s.titleObjectId === 'title_1');
  assert.ok(mainSection.objectIds.includes('body_1'));
  assert.ok(mainSection.objectIds.includes('body_2'));
});

test('TEST 2: Two headings + paragraphs', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'h1', type: 'text', text: 'Section Alpha', style: { fontSize: 24, fontWeight: 'bold' }, position: { x: 100, y: 50 } },
        { id: 'p1', type: 'text', text: 'Alpha content', style: { fontSize: 16 }, position: { x: 100, y: 100 } },
        { id: 'h2', type: 'text', text: 'Section Beta', style: { fontSize: 24, fontWeight: 'bold' }, position: { x: 100, y: 400 } },
        { id: 'p2', type: 'text', text: 'Beta content', style: { fontSize: 16 }, position: { x: 100, y: 450 } }
      ]
    }
  };

  const plan = analyzeWorkspace(model);
  const secAlpha = plan.sections.find((s) => s.titleObjectId === 'h1');
  const secBeta = plan.sections.find((s) => s.titleObjectId === 'h2');

  assert.ok(secAlpha);
  assert.ok(secBeta);
  assert.ok(secAlpha.objectIds.includes('p1'));
  assert.ok(secBeta.objectIds.includes('p2'));
});

test('TEST 3: Title + diagram', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'd_title', type: 'text', text: 'Architecture Diagram', style: { fontSize: 26, fontWeight: 'bold' }, position: { x: 100, y: 50 } },
        { id: 's1', type: 'shape', shapeType: 'rect', position: { x: 100, y: 150 }, size: { width: 100, height: 60 }, relationships: [{ type: 'connects_to', targetId: 's2' }] },
        { id: 's2', type: 'shape', shapeType: 'rect', position: { x: 300, y: 150 }, size: { width: 100, height: 60 }, relationships: [{ type: 'connects_from', targetId: 's1' }] },
        { id: 'conn1', type: 'connector', position: { x: 200, y: 150 }, relationshipMetadata: { sourceShapeId: 's1', targetShapeId: 's2' }, relationships: [{ type: 'connects_from', targetId: 's1' }, { type: 'connects_to', targetId: 's2' }] }
      ]
    }
  };

  const plan = analyzeWorkspace(model);
  const diagSection = plan.sections.find((s) => s.type === 'diagram');

  assert.ok(diagSection);
  assert.equal(diagSection.titleObjectId, 'd_title');
  assert.ok(diagSection.objectIds.includes('d_title'));
});

test('TEST 4: Heading + sticky notes', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'n_heading', type: 'text', text: 'Action Items', style: { fontSize: 24, fontWeight: 'bold' }, position: { x: 100, y: 50 } },
        { id: 'note1', type: 'shape', metadata: { isStickyNote: true, noteColor: '#ffff00' }, position: { x: 100, y: 120 }, size: { width: 100, height: 100 } },
        { id: 'note2', type: 'shape', metadata: { isStickyNote: true, noteColor: '#ffff00' }, position: { x: 220, y: 120 }, size: { width: 100, height: 100 } }
      ]
    }
  };

  const plan = analyzeWorkspace(model);
  const notesSection = plan.sections.find((s) => s.type === 'notes');

  assert.ok(notesSection);
  assert.equal(notesSection.titleObjectId, 'n_heading');
  assert.ok(notesSection.objectIds.includes('n_heading'));
});

test('TEST 5: Colored sticky-note groups', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'noteA1', type: 'shape', metadata: { isStickyNote: true, noteColor: '#ef4444' }, position: { x: 100, y: 100 } },
        { id: 'noteA2', type: 'shape', metadata: { isStickyNote: true, noteColor: '#ef4444' }, position: { x: 200, y: 100 } }
      ]
    }
  };

  const plan = analyzeWorkspace(model);
  const cluster = plan.spatialClusterCandidates[0];

  assert.ok(cluster);
  assert.ok(cluster.evidence.includes('color-match'));
  assert.equal(cluster.strength, 'strong');
});

test('TEST 6: Shape + recreated text', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'shape_1', elementId: 'elem_99', relationshipMetadata: { attachedTextId: 'text_99' }, relationships: [{ type: 'contains_text', targetId: 'text_99' }], type: 'rect', position: { x: 100, y: 100 } },
        { id: 'text_99', elementId: 'elem_99', relationshipMetadata: { parentShapeId: 'shape_1' }, relationships: [{ type: 'contained_by', targetId: 'shape_1' }], type: 'text', text: 'Shape Text', style: { fontSize: 24, fontWeight: 'bold' }, position: { x: 100, y: 100 } }
      ]
    }
  };

  const plan = analyzeWorkspace(model);
  const unit = plan.structuralUnits.find((u) => u.objectIds.includes('shape_1'));

  assert.ok(unit);
  assert.ok(unit.objectIds.includes('text_99'));

  const textCand = plan.textCandidates.find((tc) => tc.objectId === 'text_99');
  assert.equal(textCand.role, 'label');
});

test('TEST 7: Diagram labels', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'node_text', elementId: 'elem_node', relationshipMetadata: { parentShapeId: 'node_shape' }, type: 'text', text: 'Database Node', style: { fontSize: 26, fontWeight: 'bold' }, position: { x: 100, y: 100 } }
      ]
    }
  };

  const plan = analyzeWorkspace(model);
  const cand = plan.textCandidates.find((c) => c.objectId === 'node_text');

  assert.equal(cand.role, 'label');
  assert.notEqual(cand.role, 'title');
});

test('TEST 8: Freehand annotation', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'shape_target', type: 'rect', position: { x: 100, y: 100 }, size: { width: 100, height: 80 } },
        { id: 'stroke_arrow', type: 'stroke', position: { x: 120, y: 110 }, size: { width: 30, height: 30 } }
      ]
    }
  };

  const plan = analyzeWorkspace(model);
  const targetSec = plan.sections.find((s) => s.objectIds.includes('shape_target'));

  assert.ok(targetSec);
  assert.ok(targetSec.objectIds.includes('stroke_arrow'));
  assert.ok(targetSec.evidence.includes('freehand-annotation'));
});

test('TEST 9: Unrelated freehand stroke', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'shape_far', type: 'rect', position: { x: 100, y: 100 }, size: { width: 100, height: 80 } },
        { id: 'stroke_distant', type: 'stroke', position: { x: 1000, y: 1000 }, size: { width: 50, height: 50 } }
      ]
    }
  };

  const plan = analyzeWorkspace(model);
  const strokeSec = plan.sections.find((s) => s.objectIds.includes('stroke_distant'));

  assert.ok(strokeSec);
  assert.equal(strokeSec.type, 'freeform');
});

test('TEST 10: Nested headings', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 't1', type: 'text', text: 'Main Title', style: { fontSize: 32, fontWeight: 'bold' }, position: { x: 100, y: 50 } },
        { id: 'h1', type: 'text', text: 'Section Heading', style: { fontSize: 24, fontWeight: 'bold' }, position: { x: 100, y: 150 } },
        { id: 'sub1', type: 'text', text: 'Subheading', style: { fontSize: 18, fontWeight: 'bold' }, position: { x: 100, y: 250 } },
        { id: 'p1', type: 'text', text: 'Body paragraph', style: { fontSize: 14 }, position: { x: 100, y: 300 } }
      ]
    }
  };

  const plan = analyzeWorkspace(model);
  const titleCand = plan.textCandidates.find((c) => c.objectId === 't1');
  const hCand = plan.textCandidates.find((c) => c.objectId === 'h1');
  const subCand = plan.textCandidates.find((c) => c.objectId === 'sub1');

  assert.equal(titleCand.role, 'title');
  assert.equal(hCand.role, 'heading');
  assert.equal(subCand.role, 'subheading');
});

test('TEST 11: Mixed workspace', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'title', type: 'text', text: 'System Design', style: { fontSize: 32, fontWeight: 'bold' }, position: { x: 100, y: 50 } },
        { id: 's1', type: 'shape', shapeType: 'rect', position: { x: 100, y: 150 }, size: { width: 100, height: 60 }, relationships: [{ type: 'connects_to', targetId: 's2' }] },
        { id: 's2', type: 'shape', shapeType: 'rect', position: { x: 300, y: 150 }, size: { width: 100, height: 60 }, relationships: [{ type: 'connects_from', targetId: 's1' }] },
        { id: 'conn1', type: 'connector', position: { x: 200, y: 150 }, relationshipMetadata: { sourceShapeId: 's1', targetShapeId: 's2' }, relationships: [{ type: 'connects_from', targetId: 's1' }, { type: 'connects_to', targetId: 's2' }] },
        { id: 'n1', type: 'shape', metadata: { isStickyNote: true, noteColor: '#ffff00' }, position: { x: 100, y: 400 } },
        { id: 'n2', type: 'shape', metadata: { isStickyNote: true, noteColor: '#ffff00' }, position: { x: 220, y: 400 } }
      ]
    }
  };

  const plan = analyzeWorkspace(model);
  assert.ok(plan.sections.length >= 2);
});

test('TEST 12: Determinism', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'h1', type: 'text', text: 'Header', style: { fontSize: 24 }, position: { x: 100, y: 50 } },
        { id: 'b1', type: 'text', text: 'Body', style: { fontSize: 16 }, position: { x: 100, y: 100 } }
      ]
    }
  };

  const plan1 = JSON.stringify(analyzeWorkspace(model));
  const plan2 = JSON.stringify(analyzeWorkspace(model));

  assert.equal(plan1, plan2);
});

test('TEST 13: Immutability', () => {
  const model = {
    version: 1,
    board: {
      objects: [
        { id: 'h1', type: 'text', text: 'Header', style: { fontSize: 24 }, position: { x: 100, y: 50 } }
      ]
    }
  };

  const clone = JSON.parse(JSON.stringify(model));
  analyzeWorkspace(model);

  assert.deepEqual(model, clone);
});

test('TEST 14: Existing regression behavior', () => {
  const canvas = {
    getObjects: () => [
      { id: 's1', type: 'rect', left: 0, top: 0, width: 100, height: 100 },
      { id: 't1', type: 'textbox', text: 'Text', left: 0, top: 0, width: 80, height: 20 }
    ]
  };

  const model = extractWorkspaceModel(canvas);
  const plan = analyzeWorkspace(model);

  assert.equal(plan.version, 1);
  assert.ok(Array.isArray(plan.sections));
});
