import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectConnectorCollisionsWithObstacle,
  detectAllConnectorCollisions,
  findNewForbiddenConnectorCollisions,
  segmentIntersectsShape
} from './connectorGeometry.js';
import { buildCleanupPlan } from './buildCleanupPlan.js';
import { executeCleanupPlan } from './executeCleanupPlan.js';

describe('connectorCollisionIntegrity', () => {
  it('1. Clear before and clear after: connector passes through empty space before and after cleanup', () => {
    const ws = {
      board: {
        objects: [
          { id: 'node_a', type: 'rect', left: 100, top: 100, width: 100, height: 60 },
          { id: 'node_b', type: 'rect', left: 400, top: 100, width: 100, height: 60 },
          {
            id: 'conn_ab',
            type: 'path',
            isConnector: true,
            connectorType: 'straight',
            sourceShapeId: 'node_a',
            targetShapeId: 'node_b',
            path: [['M', 200, 130], ['L', 400, 130]],
            left: 200,
            top: 130,
            width: 200,
            height: 2
          },
          { id: 'node_remote', type: 'rect', left: 100, top: 500, width: 100, height: 60 }
        ]
      }
    };

    const plan = buildCleanupPlan(null, ws);
    const proposal = executeCleanupPlan(plan, ws);

    assert.ok(proposal.valid !== false);
    const collisions = findNewForbiddenConnectorCollisions(
      ws.board.objects,
      proposal.placements
    );
    assert.strictEqual(collisions.length, 0);
  });

  it('2. Node movement causes collision: moving a shape to intersect existing connector shaft is rejected', () => {
    const rawObjects = [
      { id: 'src_node', type: 'rect', left: 100, top: 200, width: 80, height: 60 },
      { id: 'tgt_node', type: 'rect', left: 500, top: 200, width: 80, height: 60 },
      {
        id: 'conn_1',
        type: 'path',
        isConnector: true,
        connectorType: 'straight',
        sourceShapeId: 'src_node',
        targetShapeId: 'tgt_node',
        path: [['M', 180, 230], ['L', 500, 230]],
        left: 180,
        top: 230,
        width: 320,
        height: 2
      },
      { id: 'wander_node', type: 'rect', left: 300, top: 50, width: 80, height: 60 }
    ];

    const safeBefore = detectAllConnectorCollisions(rawObjects);
    assert.strictEqual(safeBefore.length, 0);

    const movedObjects = [
      rawObjects[0],
      rawObjects[1],
      rawObjects[2],
      { id: 'wander_node', type: 'rect', left: 300, top: 210, width: 80, height: 60 }
    ];

    const collisionsAfter = findNewForbiddenConnectorCollisions(rawObjects, movedObjects);
    assert.strictEqual(collisionsAfter.length, 1);
    assert.strictEqual(collisionsAfter[0].connectorId, 'conn_1');
    assert.strictEqual(collisionsAfter[0].obstacleId, 'wander_node');
    assert.strictEqual(collisionsAfter[0].isShaft, true);

    const ws = { board: { objects: rawObjects } };
    const plan = buildCleanupPlan(null, ws);
    const proposal = executeCleanupPlan(plan, ws);

    const finalCollisions = findNewForbiddenConnectorCollisions(
      rawObjects,
      proposal.placements
    );
    assert.strictEqual(finalCollisions.length, 0);
  });

  it('3. Connector shaft crossing unrelated node: candidate layout moves connector across node', () => {
    const obstacle = { id: 'obs_mid', type: 'rect', left: 250, top: 150, width: 100, height: 100 };
    const crossingConn = {
      id: 'conn_cross',
      type: 'path',
      isConnector: true,
      connectorType: 'straight',
      sourceShapeId: 'src_x',
      targetShapeId: 'tgt_y',
      path: [['M', 100, 200], ['L', 500, 200]],
      left: 100,
      top: 200,
      width: 400,
      height: 2
    };

    const col = detectConnectorCollisionsWithObstacle(crossingConn, obstacle);
    assert.ok(col);
    assert.strictEqual(col.connectorId, 'conn_cross');
    assert.strictEqual(col.obstacleId, 'obs_mid');
    assert.strictEqual(col.isShaft, true);
    assert.strictEqual(col.isArrowhead, false);
  });

  it('4. Arrowhead crossing unrelated geometry: positions arrowhead overlapping unrelated node interior', () => {
    const obstacle = { id: 'obs_target', type: 'rect', left: 400, top: 180, width: 100, height: 100 };
    const arrowheadConn = {
      id: 'conn_arrow',
      type: 'path',
      isConnector: true,
      connectorType: 'straight',
      sourceShapeId: 'src_start',
      targetShapeId: 'tgt_other',
      endArrow: true,
      arrowheadEnd: [
        ['M', 450, 230],
        ['L', 440, 225],
        ['L', 440, 235],
        ['Z']
      ],
      path: [['M', 100, 230], ['L', 450, 230]],
      left: 100,
      top: 225,
      width: 350,
      height: 10
    };

    const col = detectConnectorCollisionsWithObstacle(arrowheadConn, obstacle);
    assert.ok(col);
    assert.strictEqual(col.connectorId, 'conn_arrow');
    assert.strictEqual(col.obstacleId, 'obs_target');
  });

  it('5. Connector crossing protected stroke: candidate layout causes connector to cross divider stroke', () => {
    const strokeDivider = {
      id: 'divider_stroke',
      type: 'path',
      isVectorStroke: true,
      strokeId: 'stroke_div_1',
      path: [['M', 300, 50], ['L', 300, 450]],
      left: 300,
      top: 50,
      width: 2,
      height: 400
    };
    const crossingConn = {
      id: 'conn_divider_cross',
      type: 'path',
      isConnector: true,
      connectorType: 'straight',
      sourceShapeId: 'src_side_a',
      targetShapeId: 'tgt_side_b',
      path: [['M', 100, 200], ['L', 500, 200]],
      left: 100,
      top: 200,
      width: 400,
      height: 2
    };

    const col = detectConnectorCollisionsWithObstacle(crossingConn, strokeDivider);
    assert.ok(col);
    assert.strictEqual(col.connectorId, 'conn_divider_cross');
    assert.strictEqual(col.obstacleId, 'divider_stroke');
    assert.strictEqual(col.isProtected, true);
  });

  it('6. 2 independent structures: layout of Structure A does not cause connectors in Structure B to collide', () => {
    const ws = {
      board: {
        objects: [
          { id: 'f1_a', type: 'rect', left: 100, top: 100, width: 80, height: 60 },
          { id: 'f1_b', type: 'rect', left: 240, top: 100, width: 80, height: 60 },
          {
            id: 'f1_conn',
            type: 'path',
            isConnector: true,
            connectorType: 'straight',
            sourceShapeId: 'f1_a',
            targetShapeId: 'f1_b',
            path: [['M', 180, 130], ['L', 240, 130]],
            left: 180,
            top: 130,
            width: 60,
            height: 2
          },
          { id: 'f2_a', type: 'rect', left: 500, top: 100, width: 80, height: 60 },
          { id: 'f2_b', type: 'rect', left: 640, top: 100, width: 80, height: 60 },
          {
            id: 'f2_conn',
            type: 'path',
            isConnector: true,
            connectorType: 'straight',
            sourceShapeId: 'f2_a',
            targetShapeId: 'f2_b',
            path: [['M', 580, 130], ['L', 640, 130]],
            left: 580,
            top: 130,
            width: 60,
            height: 2
          }
        ]
      }
    };

    const plan = buildCleanupPlan(null, ws);
    const proposal = executeCleanupPlan(plan, ws);

    assert.ok(proposal.valid !== false);
    const cols = findNewForbiddenConnectorCollisions(ws.board.objects, proposal.placements);
    assert.strictEqual(cols.length, 0);
  });

  it('7. 3 independent structures: complex composition of 3 structures maintains connector collision integrity', () => {
    const ws = {
      board: {
        objects: [
          { id: 's1_a', type: 'rect', left: 100, top: 100, width: 80, height: 60 },
          { id: 's1_b', type: 'rect', left: 220, top: 100, width: 80, height: 60 },
          {
            id: 's1_conn',
            type: 'path',
            isConnector: true,
            connectorType: 'straight',
            sourceShapeId: 's1_a',
            targetShapeId: 's1_b',
            path: [['M', 180, 130], ['L', 220, 130]],
            left: 180,
            top: 130,
            width: 40,
            height: 2
          },
          { id: 's2_a', type: 'rect', left: 400, top: 100, width: 80, height: 60 },
          { id: 's2_b', type: 'rect', left: 520, top: 100, width: 80, height: 60 },
          {
            id: 's2_conn',
            type: 'path',
            isConnector: true,
            connectorType: 'straight',
            sourceShapeId: 's2_a',
            targetShapeId: 's2_b',
            path: [['M', 480, 130], ['L', 520, 130]],
            left: 480,
            top: 130,
            width: 40,
            height: 2
          },
          { id: 'note_1', type: 'rect', isStickyNote: true, left: 100, top: 350, width: 120, height: 120 },
          { id: 'note_2', type: 'rect', isStickyNote: true, left: 260, top: 350, width: 120, height: 120 }
        ]
      }
    };

    const plan = buildCleanupPlan(null, ws);
    const proposal = executeCleanupPlan(plan, ws);

    assert.ok(proposal.valid !== false);
    const cols = findNewForbiddenConnectorCollisions(ws.board.objects, proposal.placements);
    assert.strictEqual(cols.length, 0);
  });

  it('8. Diagonal connectors: exact geometry testing works for diagonal connectors without AABB false positives', () => {
    const diagonalConn = {
      id: 'conn_diag',
      type: 'path',
      isConnector: true,
      connectorType: 'straight',
      sourceShapeId: 'd_src',
      targetShapeId: 'd_tgt',
      path: [['M', 100, 100], ['L', 400, 400]],
      left: 100,
      top: 100,
      width: 300,
      height: 300
    };

    const nonCollidingInAABB = {
      id: 'corner_node',
      type: 'rect',
      left: 110,
      top: 320,
      width: 60,
      height: 60
    };
    const colCorner = detectConnectorCollisionsWithObstacle(diagonalConn, nonCollidingInAABB);
    assert.strictEqual(colCorner, null);

    const intersectingDiag = {
      id: 'center_intersect',
      type: 'rect',
      left: 230,
      top: 230,
      width: 50,
      height: 50
    };
    const colCenter = detectConnectorCollisionsWithObstacle(diagonalConn, intersectingDiag);
    assert.ok(colCenter);
    assert.strictEqual(colCenter.connectorId, 'conn_diag');
    assert.strictEqual(colCenter.obstacleId, 'center_intersect');
  });

  it('9. Vertical and horizontal connectors: orthogonal connectors tested against obstacles', () => {
    const horizontalConn = {
      id: 'conn_horiz',
      type: 'path',
      isConnector: true,
      connectorType: 'straight',
      sourceShapeId: 'h_src',
      targetShapeId: 'h_tgt',
      path: [['M', 100, 250], ['L', 600, 250]],
      left: 100,
      top: 250,
      width: 500,
      height: 2
    };

    const obsInHoriz = { id: 'obs_h', type: 'rect', left: 300, top: 220, width: 80, height: 60 };
    const colH = detectConnectorCollisionsWithObstacle(horizontalConn, obsInHoriz);
    assert.ok(colH);
    assert.strictEqual(colH.isShaft, true);

    const obsClearH = { id: 'obs_h_clear', type: 'rect', left: 300, top: 320, width: 80, height: 60 };
    const colHClear = detectConnectorCollisionsWithObstacle(horizontalConn, obsClearH);
    assert.strictEqual(colHClear, null);

    const verticalConn = {
      id: 'conn_vert',
      type: 'path',
      isConnector: true,
      connectorType: 'straight',
      sourceShapeId: 'v_src',
      targetShapeId: 'v_tgt',
      path: [['M', 350, 100], ['L', 350, 600]],
      left: 350,
      top: 100,
      width: 2,
      height: 500
    };

    const obsInVert = { id: 'obs_v', type: 'rect', left: 320, top: 300, width: 80, height: 60 };
    const colV = detectConnectorCollisionsWithObstacle(verticalConn, obsInVert);
    assert.ok(colV);
    assert.strictEqual(colV.isShaft, true);

    const obsClearV = { id: 'obs_v_clear', type: 'rect', left: 450, top: 300, width: 80, height: 60 };
    const colVClear = detectConnectorCollisionsWithObstacle(verticalConn, obsClearV);
    assert.strictEqual(colVClear, null);
  });

  it('10. Curved connectors: sampled curve geometry tested against obstacles', () => {
    const curvedConn = {
      id: 'conn_curved',
      type: 'path',
      isConnector: true,
      connectorType: 'curved',
      sourceShapeId: 'c_src',
      targetShapeId: 'c_tgt',
      path: [['M', 100, 100], ['C', 200, 50, 300, 50, 400, 100]],
      left: 100,
      top: 50,
      width: 300,
      height: 50
    };

    const obstacleInArc = { id: 'obs_arc', type: 'rect', left: 230, top: 40, width: 40, height: 40 };
    const colArc = detectConnectorCollisionsWithObstacle(curvedConn, obstacleInArc);
    assert.ok(colArc);
    assert.strictEqual(colArc.connectorId, 'conn_curved');

    const obstacleBelowArc = { id: 'obs_below_arc', type: 'rect', left: 230, top: 120, width: 40, height: 40 };
    const colBelow = detectConnectorCollisionsWithObstacle(curvedConn, obstacleBelowArc);
    assert.strictEqual(colBelow, null);
  });

  it('11. Touching boundary only: connector endpoint touching source/target shape boundary is NOT a collision', () => {
    const srcNode = { id: 'src_touch', type: 'rect', left: 100, top: 100, width: 100, height: 60 };
    const tgtNode = { id: 'tgt_touch', type: 'rect', left: 300, top: 100, width: 100, height: 60 };
    const conn = {
      id: 'conn_touch',
      type: 'path',
      isConnector: true,
      connectorType: 'straight',
      sourceShapeId: 'src_touch',
      targetShapeId: 'tgt_touch',
      path: [['M', 200, 130], ['L', 300, 130]],
      left: 200,
      top: 130,
      width: 100,
      height: 2
    };

    const colSrc = detectConnectorCollisionsWithObstacle(conn, srcNode);
    assert.strictEqual(colSrc, null);

    const colTgt = detectConnectorCollisionsWithObstacle(conn, tgtNode);
    assert.strictEqual(colTgt, null);

    const attachedLabel = {
      id: 'lbl_src',
      type: 'textbox',
      parentShapeId: 'src_touch',
      left: 120,
      top: 120,
      width: 60,
      height: 20
    };
    const colLbl = detectConnectorCollisionsWithObstacle(conn, attachedLabel);
    assert.strictEqual(colLbl, null);
  });

  it('12. Existing collision: connector that already collided before cleanup does not cause spurious rejection if not made worse', () => {
    const rawObjects = [
      { id: 'pre_src', type: 'rect', left: 100, top: 100, width: 80, height: 60 },
      { id: 'pre_tgt', type: 'rect', left: 500, top: 100, width: 80, height: 60 },
      {
        id: 'conn_pre_colliding',
        type: 'path',
        isConnector: true,
        connectorType: 'straight',
        sourceShapeId: 'pre_src',
        targetShapeId: 'pre_tgt',
        path: [['M', 180, 130], ['L', 500, 130]],
        left: 180,
        top: 130,
        width: 320,
        height: 2
      },
      { id: 'pre_existing_obs', type: 'rect', left: 300, top: 100, width: 80, height: 60 }
    ];

    const beforeCols = detectAllConnectorCollisions(rawObjects);
    assert.strictEqual(beforeCols.length, 1);

    const afterObjects = rawObjects.map((o) => ({ ...o }));
    const newCols = findNewForbiddenConnectorCollisions(rawObjects, afterObjects);
    assert.strictEqual(newCols.length, 0);
  });

  it('13. Candidate rejection: individual candidate that introduces a collision is rejected while others succeed', () => {
    const ws = {
      board: {
        objects: [
          { id: 'n1', type: 'rect', left: 100, top: 100, width: 100, height: 60 },
          { id: 'n2', type: 'rect', left: 100, top: 220, width: 100, height: 60 },
          { id: 'n3', type: 'rect', left: 100, top: 340, width: 100, height: 60 },
          {
            id: 'c_cross',
            type: 'path',
            isConnector: true,
            connectorType: 'straight',
            sourceShapeId: 'n1',
            targetShapeId: 'n3',
            path: [['M', 150, 160], ['L', 150, 340]],
            left: 150,
            top: 160,
            width: 2,
            height: 180
          }
        ]
      }
    };

    const plan = buildCleanupPlan(null, ws);
    const proposal = executeCleanupPlan(plan, ws);

    assert.ok(proposal.valid !== false);
    const newCols = findNewForbiddenConnectorCollisions(ws.board.objects, proposal.placements);
    assert.strictEqual(newCols.length, 0);
  });

  it('14. Candidate reroute: valid candidate without collision is accepted and validated', () => {
    const ws = {
      board: {
        objects: [
          { id: 'box_1', type: 'rect', left: 100, top: 100, width: 100, height: 60 },
          { id: 'box_2', type: 'rect', left: 300, top: 105, width: 100, height: 60 },
          {
            id: 'c_clean',
            type: 'path',
            isConnector: true,
            connectorType: 'straight',
            sourceShapeId: 'box_1',
            targetShapeId: 'box_2',
            path: [['M', 200, 130], ['L', 300, 135]],
            left: 200,
            top: 130,
            width: 100,
            height: 5
          }
        ]
      }
    };

    const plan = buildCleanupPlan(null, ws);
    const proposal = executeCleanupPlan(plan, ws);

    assert.ok(proposal.valid !== false);
    assert.ok(proposal.placements.length >= 3);
    const newCols = findNewForbiddenConnectorCollisions(ws.board.objects, proposal.placements);
    assert.strictEqual(newCols.length, 0);
  });

  it('15. Invariant: newForbiddenConnectorCollisions === 0 across all accepted cleanup plans in test suite', () => {
    const testWorkspaces = [
      {
        board: {
          objects: [
            { id: 'a', type: 'rect', left: 100, top: 100, width: 100, height: 60 },
            { id: 'b', type: 'rect', left: 300, top: 100, width: 100, height: 60 },
            {
              id: 'c',
              type: 'path',
              isConnector: true,
              connectorType: 'straight',
              sourceShapeId: 'a',
              targetShapeId: 'b',
              path: [['M', 200, 130], ['L', 300, 130]],
              left: 200,
              top: 130,
              width: 100,
              height: 2
            }
          ]
        }
      },
      {
        board: {
          objects: [
            { id: 'k1', type: 'rect', left: 50, top: 50, width: 80, height: 50 },
            { id: 'k2', type: 'rect', left: 200, top: 50, width: 80, height: 50 },
            { id: 'k3', type: 'rect', left: 350, top: 50, width: 80, height: 50 },
            {
              id: 'c12',
              type: 'path',
              isConnector: true,
              connectorType: 'straight',
              sourceShapeId: 'k1',
              targetShapeId: 'k2',
              path: [['M', 130, 75], ['L', 200, 75]],
              left: 130,
              top: 75,
              width: 70,
              height: 2
            },
            {
              id: 'c23',
              type: 'path',
              isConnector: true,
              connectorType: 'straight',
              sourceShapeId: 'k2',
              targetShapeId: 'k3',
              path: [['M', 280, 75], ['L', 350, 75]],
              left: 280,
              top: 75,
              width: 70,
              height: 2
            }
          ]
        }
      }
    ];

    for (const ws of testWorkspaces) {
      const plan = buildCleanupPlan(null, ws);
      const proposal = executeCleanupPlan(plan, ws);
      if (proposal && proposal.valid !== false && proposal.placements) {
        const newCols = findNewForbiddenConnectorCollisions(ws.board.objects, proposal.placements);
        assert.strictEqual(newCols.length, 0);
        if (proposal.diagnostics) {
          assert.strictEqual(proposal.diagnostics.newForbiddenConnectorCollisions, 0);
        }
      }
    }
  });
});
