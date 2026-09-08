import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { buildSemanticScene } from '../src/features/messCleanup/semanticSceneAdapter.js';
import {
  discoverVisualStructures,
  generateCompositionCandidates
} from '../src/features/messCleanup/discoverVisualStructures.js';
import {
  detectCleanupOpportunities,
  rankAndSelectOpportunities
} from '../src/features/messCleanup/cleanupOpportunities.js';
import { resolveCleanupOpportunity } from '../src/features/messCleanup/resolveCleanupOpportunity.js';
import { buildCleanupPlan } from '../src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../src/features/messCleanup/executeCleanupPlan.js';
import { buildCleanupResult } from '../src/features/messCleanup/buildCleanupResult.js';
import { computeGeometryDiagnostics } from '../src/features/messCleanup/auditCleanupPipeline.js';
import { normalizeObject } from '../src/features/messCleanup/normalizeObjects.js';
import { recoverConnectorTopology } from '../src/features/messCleanup/connectorTopology.js';

dotenv.config({ path: 'c:/Skribe/server/.env' });
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/skribe');
const db = mongoose.connection.db;
const board = await db.collection('boards').findOne({ _id: new mongoose.Types.ObjectId('6a9c6e3233c10e861b77e4e7') });
await mongoose.disconnect();

console.log('=== TEST 1 FORENSICS ON BOARD', board._id.toString(), '===');
console.log('Raw board objects:');
board.canvasData.objects.forEach(o => {
  console.log(`- id=${o.id}, type=${o.type}, shapeType=${o.shapeType}, left=${o.left}, top=${o.top}, width=${o.width}, height=${o.height}, origin=(${o.originX},${o.originY}), attachedTextId=${o.attachedTextId}, sourceShapeId=${o.sourceShapeId}, targetShapeId=${o.targetShapeId}`);
});

const normalizedObjs = board.canvasData.objects.map(o => normalizeObject(o));
const workspaceModel = { board: { objects: normalizedObjs } };

console.log('\n--- Normalizing objects ---');
normalizedObjs.forEach(o => {
  console.log(`- id=${o.id}, type=${o.type}, pos=(${o.position?.x}, ${o.position?.y}), size=(${o.size?.width}, ${o.size?.height}), bounds=(${o.bounds?.x}, ${o.bounds?.y}, ${o.bounds?.width}, ${o.bounds?.height}), src=${o.sourceShapeId}, tgt=${o.targetShapeId}`);
});

const semanticScene = buildSemanticScene(workspaceModel);
const discovered = discoverVisualStructures(workspaceModel, semanticScene);
console.log('\n--- Discovered structures ---', discovered.length);
discovered.forEach(s => {
  console.log(`Structure ${s.id}: type=${s.type}, members=${s.members || s.objectIds}, connectors=${s.connectorIds}, orientation=${s.orientation}`);
});

const opportunities = detectCleanupOpportunities(workspaceModel, semanticScene);
console.log('\n--- Detected opportunities ---', opportunities.length);
opportunities.forEach(o => {
  console.log(`Opp ${o.id}: type=${o.type}, benefit=${o.visualBenefit}, cost=${o.movementCost}, risk=${o.risk}, objects=${o.objectIds}, meta=${JSON.stringify(o.metadata)}`);
});

const { selectedOpportunities, rejectedOpportunities } = rankAndSelectOpportunities(opportunities, workspaceModel);
console.log('\n--- Selected opportunities ---', selectedOpportunities.length);
selectedOpportunities.forEach(o => {
  console.log(`Selected ${o.id}: type=${o.type}, benefit=${o.visualBenefit}`);
});
console.log('\n--- Rejected opportunities ---', rejectedOpportunities.length);
rejectedOpportunities.forEach(o => {
  console.log(`Rejected ${o.id}: reason=${o.reason}`);
});

const cleanupPlan = buildCleanupPlan(selectedOpportunities, workspaceModel);
console.log('\n--- Cleanup Plan Actions ---', cleanupPlan.actions.length);
cleanupPlan.actions.forEach(a => {
  console.log(`Action ${a.id}: type=${a.type}, objects=${a.objectIds}, axis=${a.axis}, params=${JSON.stringify(a.params)}`);
});

const layoutProposal = executeCleanupPlan(cleanupPlan, workspaceModel);
console.log('\n--- Layout Proposal Placements ---', layoutProposal.placements.length);
layoutProposal.placements.forEach(p => {
  console.log(`Placement ${p.objectId}: pos=(${p.position?.x}, ${p.position?.y}), bounds=(${p.bounds?.x}, ${p.bounds?.y}, ${p.bounds?.width}, ${p.bounds?.height}), path=${p.pathCommands ? JSON.stringify(p.pathCommands) : 'none'}`);
});

const result = buildCleanupResult(cleanupPlan, layoutProposal, workspaceModel);
const diags = computeGeometryDiagnostics(workspaceModel, layoutProposal, result);
console.log('\n--- Geometry Diagnostics ---');
console.log(JSON.stringify(diags, null, 2));

console.log('\n--- Cleanup Result ---');
console.log('humanSummary:', result.summary.humanSummary);
console.log('objectsMoved:', result.summary.objectsMoved);
console.log('objectsPreserved:', result.summary.objectsPreserved);
console.log('connectorsRerouted:', result.summary.connectorsRerouted);
console.log('actions:', result.actions.map(a => ({ type: a.type, impact: a.impact })));

