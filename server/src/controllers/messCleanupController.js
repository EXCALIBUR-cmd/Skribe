import { error, success } from '../utils/apiResponse.js';
import { analyzeWithNemotron } from '../services/nemotronService.js';

export const analyze = async (req, res, next) => {
  const ctrlStart = Date.now();
  console.log('[Nemotron Diagnostic] Controller started');

  try {
    const { workspaceModel, image } = req.body || {};

    if (!workspaceModel || typeof workspaceModel !== 'object') {
      console.log('[Nemotron Diagnostic] Controller validation failed: missing or invalid workspaceModel');
      return error(res, 'Missing or invalid workspaceModel payload', 400);
    }

    const objects = workspaceModel.board?.objects || workspaceModel.objects;
    if (!Array.isArray(objects) || objects.length === 0) {
      console.log('[Nemotron Diagnostic] Controller validation failed: workspaceModel contains no objects');
      return error(res, 'workspaceModel contains no objects to analyze', 400);
    }

    if (!image || typeof image !== 'string' || !image.trim()) {
      console.log('[Nemotron Diagnostic] Controller validation failed: missing or invalid image/screenshot');
      return error(res, 'Missing or invalid image/screenshot payload', 400);
    }

    let organizationPlan;
    try {
      organizationPlan = await analyzeWithNemotron(workspaceModel, image);
    } catch (serviceErr) {
      console.error('[MessCleanupController] NVIDIA Nemotron Omni analysis failed:', {
        message: serviceErr.message,
        code: serviceErr.code,
        statusCode: serviceErr.statusCode
      });

      const statusCode = serviceErr.statusCode || 502;
      return error(res, serviceErr.message || 'Mess Cleanup AI analysis failed', statusCode, {
        code: serviceErr.code || 'AI_ANALYSIS_FAILED'
      });
    }

    // --- OrganizationPlan v2 contract validation ---
    console.log('[Nemotron Diagnostic] OrganizationPlan v2 validation checking...');

    if (!organizationPlan || typeof organizationPlan !== 'object') {
      console.log('[Nemotron Diagnostic] OrganizationPlan validation failed: plan is null or not an object');
      return error(res, 'AI model returned an invalid organization plan structure', 502, {
        code: 'INVALID_PLAN_SCHEMA'
      });
    }

    const planKeys = Object.keys(organizationPlan);
    console.log(`[Nemotron Diagnostic] OrganizationPlan top-level keys: ${planKeys.join(', ')}`);

    // Valid plan structure: groups (SemanticScene) OR document.sections (v2) OR sections (v1)
    const groupsOrSections = organizationPlan.groups || organizationPlan.document?.sections || organizationPlan.sections;
    if (!Array.isArray(groupsOrSections)) {
      console.log('[Nemotron Diagnostic] OrganizationPlan validation failed: no groups or sections array found in document or top-level');
      console.log(`[Nemotron Diagnostic] Actual plan structure: ${JSON.stringify(organizationPlan, null, 2).slice(0, 5000)}`);
      return error(res, 'AI model returned an invalid organization plan structure', 502, {
        code: 'INVALID_PLAN_SCHEMA'
      });
    }

    // v2 contract: workspaceType should be present
    if (typeof organizationPlan.workspaceType !== 'string') {
      console.log('[Nemotron Diagnostic] Warning: workspaceType missing from Nemotron response, will default to mixed');
    }

    // v2 diagnostics
    const relationshipCount = Array.isArray(organizationPlan.relationships) ? organizationPlan.relationships.length : 0;
    console.log(`[Nemotron Diagnostic] Validation passed: ${groupsOrSections.length} groups/sections, ${relationshipCount} relationships, workspaceType=${organizationPlan.workspaceType || 'unset'}`);
    console.log(`[Nemotron Diagnostic] Controller completed in ${Date.now() - ctrlStart}ms`);

    return success(res, { organizationPlan }, 'Mess Cleanup analysis completed successfully', 200);
  } catch (err) {
    console.error('[MessCleanupController] Unexpected exception:', err.message);
    return next(err);
  }
};

export default {
  analyze
};
