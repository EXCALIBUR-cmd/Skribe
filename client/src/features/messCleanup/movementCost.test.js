import test from "node:test";
import assert from "node:assert";
import { 
  calculateMovementCost,
  compareCompositionsGeometry 
} from "./discoverVisualStructures.js";

test("1. Movement cost dominated by object count properly penalizes large movements", () => {
  const costA = calculateMovementCost({
    objectCount: 2,
    currentQuality: 5,
    candidateQuality: 9,
    isBranchingOrMerge: false,
    totalDisplacement: 20,
    geoComparison: { materiallyMovedCount: 2, meanNodeDisplacement: 10, hasConnectorGeometryChange: false, maxNodeDisplacement: 15 }
  });

  const costB = calculateMovementCost({
    objectCount: 2,
    currentQuality: 5,
    candidateQuality: 9,
    isBranchingOrMerge: false,
    totalDisplacement: 1000,
    geoComparison: { materiallyMovedCount: 2, meanNodeDisplacement: 500, hasConnectorGeometryChange: false, maxNodeDisplacement: 500 }
  });

  assert.ok(costB > costA + 4.0, "Massive movement should cost significantly more than small movement");
});

test("2. Connector change incurs explicit penalty", () => {
  const costA = calculateMovementCost({
    objectCount: 2,
    currentQuality: 5,
    candidateQuality: 9,
    isBranchingOrMerge: false,
    totalDisplacement: 50,
    geoComparison: { materiallyMovedCount: 2, meanNodeDisplacement: 25, hasConnectorGeometryChange: false, maxNodeDisplacement: 25 }
  });

  const costB = calculateMovementCost({
    objectCount: 2,
    currentQuality: 5,
    candidateQuality: 9,
    isBranchingOrMerge: false,
    totalDisplacement: 50,
    geoComparison: { materiallyMovedCount: 2, meanNodeDisplacement: 25, hasConnectorGeometryChange: true, maxNodeDisplacement: 25 }
  });

  assert.ok(costB > costA + 0.4, "Connector rerouting increases movement cost");
});

test("3. Zero-change candidate benefit is strictly 0 and gets rejected", () => {
  const geoComparison = compareCompositionsGeometry({
    currentNodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 100 }],
    candidateNodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 100 }],
    currentConnectors: [],
    candidateConnectors: []
  });
  assert.equal(geoComparison.hasMeaningfulVisualChange, false);
});

test("4. Adaptive candidate vs Template candidate: adaptive wins on locality", () => {
  const currentQuality = 6;
  const adaptiveQuality = 8.5;
  const templateQuality = 8.8; // Template gives slightly better structural quality

  // Adaptive candidate just bumps a few nodes
  const adaptiveCost = calculateMovementCost({
    objectCount: 6,
    currentQuality,
    candidateQuality: adaptiveQuality,
    totalDisplacement: 30,
    geoComparison: { materiallyMovedCount: 2, meanNodeDisplacement: 5, hasConnectorGeometryChange: false, maxNodeDisplacement: 15 }
  });

  // Template candidate shifts all 6 nodes by 150px
  const templateCost = calculateMovementCost({
    objectCount: 6,
    currentQuality,
    candidateQuality: templateQuality,
    totalDisplacement: 900,
    geoComparison: { materiallyMovedCount: 6, meanNodeDisplacement: 150, hasConnectorGeometryChange: true, maxNodeDisplacement: 150 }
  });

  const confidence = 0.95;
  const risk = 1.0;
  
  const adaptiveBenefit = adaptiveQuality - currentQuality;
  const templateBenefit = templateQuality - currentQuality;
  
  const adaptiveUtility = (adaptiveBenefit * confidence) - adaptiveCost - risk;
  const templateUtility = (templateBenefit * confidence) - templateCost - risk;
  
  assert.ok(adaptiveUtility > templateUtility, "Adaptive should win due to significantly lower movement cost despite slightly lower quality");
});

test("5. Multi-structure scale normalization: same relative movement", () => {
  // A tiny structure moves 50px
  const tinyCost = calculateMovementCost({
    objectCount: 2,
    currentQuality: 5,
    candidateQuality: 9,
    totalDisplacement: 100,
    geoComparison: { materiallyMovedCount: 2, meanNodeDisplacement: 50, hasConnectorGeometryChange: false, maxNodeDisplacement: 50 }
  });

  // A huge structure moves 50px
  const hugeCost = calculateMovementCost({
    objectCount: 20,
    currentQuality: 5,
    candidateQuality: 9,
    totalDisplacement: 1000,
    geoComparison: { materiallyMovedCount: 20, meanNodeDisplacement: 50, hasConnectorGeometryChange: false, maxNodeDisplacement: 50 }
  });

  assert.ok(hugeCost > tinyCost, "Moving 20 nodes costs more than moving 2 nodes by the same distance");
});

test("6. Large benefit overcomes movement cost", () => {
  const currentQuality = 3;
  const candidateQuality = 9; // Enormous benefit (+6)
  
  const cost = calculateMovementCost({
    objectCount: 10,
    currentQuality,
    candidateQuality,
    totalDisplacement: 1000,
    geoComparison: { materiallyMovedCount: 10, meanNodeDisplacement: 100, hasConnectorGeometryChange: true, maxNodeDisplacement: 100 }
  });

  const confidence = 0.95;
  const risk = 1.0;
  const utility = (6 * confidence) - cost - risk;
  
  assert.ok(utility > 1.0, "Candidate should be highly viable despite cost due to massive benefit");
});
