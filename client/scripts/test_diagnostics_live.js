import fs from 'fs';
import { normalizeObject } from '../../client/src/features/messCleanup/normalizeObjects.js';
import { buildCleanupPlan } from '../../client/src/features/messCleanup/buildCleanupPlan.js';
import { executeCleanupPlan } from '../../client/src/features/messCleanup/executeCleanupPlan.js';
import { buildPreviewRenderModel } from '../../client/src/features/messCleanup/previewModel.js';
import { buildCleanupResult } from '../../client/src/features/messCleanup/buildCleanupResult.js';
import { auditCleanupPipeline, computeGeometryDiagnostics } from '../../client/src/features/messCleanup/auditCleanupPipeline.js';

const rawBoard = JSON.parse(fs.readFileSync('C:/Users/singh/.gemini/antigravity-ide/brain/50fd7c5f-98be-4727-87e0-21e02f97850b/scratch/canonical_board.json', 'utf8'));
const normalizedObjects = rawBoard.objects.map(normalizeObject);
const workspaceModel = { board: { objects: normalizedObjects } };

const cleanupPlan = buildCleanupPlan(null, workspaceModel);
const layoutProposal = executeCleanupPlan(cleanupPlan, workspaceModel);
const previewModel = buildPreviewRenderModel(workspaceModel, layoutProposal);
const cleanupResult = buildCleanupResult(cleanupPlan, layoutProposal, workspaceModel);

const diagnostics = computeGeometryDiagnostics(workspaceModel, layoutProposal, cleanupResult);

console.log('DIAGNOSTICS RESULT:');
console.log(JSON.stringify(diagnostics, null, 2));
