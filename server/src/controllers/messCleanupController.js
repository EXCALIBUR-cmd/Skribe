import config from '../config/env.js';
import { error, success } from '../utils/apiResponse.js';
import { analyzeWithGemini } from '../services/geminiService.js';

export const analyze = async (req, res, next) => {
  const ctrlStart = Date.now();
  console.log('[Gemini Diagnostic] Controller started');

  const clientAbortController = new AbortController();
  const handleClientClose = () => {
    if (!res.writableEnded) {
      clientAbortController.abort();
    }
  };
  if (typeof res.on === 'function') {
    res.on('close', handleClientClose);
  }

  try {
    const { workspaceModel, image } = req.body || {};

    if (!workspaceModel || typeof workspaceModel !== 'object') {
      console.log('[Gemini Diagnostic] Controller validation failed: missing or invalid workspaceModel');
      return error(res, 'Missing or invalid workspaceModel payload', 400);
    }

    const objects = workspaceModel.board?.objects || workspaceModel.objects;
    if (!Array.isArray(objects) || objects.length === 0) {
      console.log('[Gemini Diagnostic] Controller validation failed: workspaceModel contains no objects');
      return error(res, 'workspaceModel contains no objects to analyze', 400);
    }

    if (!image || typeof image !== 'string' || !image.trim()) {
      console.log('[Gemini Diagnostic] Controller validation failed: missing or invalid image/screenshot');
      return error(res, 'Missing or invalid image/screenshot payload', 400);
    }

    let organizationPlan;
    try {
      organizationPlan = await analyzeWithGemini(workspaceModel, image, {
        signal: clientAbortController.signal
      });
    } catch (serviceErr) {
      if (res.writableEnded || clientAbortController.signal.aborted) {
        return;
      }

      console.error('[MessCleanupController] Gemini 3.8 Flash analysis failed:', {
        message: serviceErr.message,
        code: serviceErr.code,
        statusCode: serviceErr.statusCode
      });

      const statusCode = serviceErr.statusCode || 502;
      return error(res, serviceErr.message || 'Mess Cleanup AI analysis failed', statusCode, {
        code: serviceErr.code || 'AI_ANALYSIS_FAILED'
      });
    }

    if (res.writableEnded || clientAbortController.signal.aborted) {
      return;
    }

    console.log('[Gemini Diagnostic] OrganizationPlan v2 validation checking...');

    if (!organizationPlan || typeof organizationPlan !== 'object') {
      console.log('[Gemini Diagnostic] OrganizationPlan validation failed: plan is null or not an object');
      return error(res, 'AI model returned an invalid organization plan structure', 502, {
        code: 'INVALID_PLAN_SCHEMA'
      });
    }

    const planKeys = Object.keys(organizationPlan);
    console.log(`[Gemini Diagnostic] OrganizationPlan top-level keys: ${planKeys.join(', ')}`);

    const groupsOrSections = organizationPlan.groups || organizationPlan.document?.sections || organizationPlan.sections;
    if (!Array.isArray(groupsOrSections)) {
      console.log('[Gemini Diagnostic] OrganizationPlan validation failed: no groups or sections array found in document or top-level');
      console.log(`[Gemini Diagnostic] Actual plan structure: ${JSON.stringify(organizationPlan, null, 2).slice(0, 5000)}`);
      return error(res, 'AI model returned an invalid organization plan structure', 502, {
        code: 'INVALID_PLAN_SCHEMA'
      });
    }

    if (typeof organizationPlan.workspaceType !== 'string') {
      console.log('[Gemini Diagnostic] Warning: workspaceType missing from Gemini response, will default to mixed');
    }

    const relationshipCount = Array.isArray(organizationPlan.relationships) ? organizationPlan.relationships.length : 0;
    console.log(`[Gemini Diagnostic] Validation passed: ${groupsOrSections.length} groups/sections, ${relationshipCount} relationships, workspaceType=${organizationPlan.workspaceType || 'unset'}`);
    console.log(`[Gemini Diagnostic] Controller completed in ${Date.now() - ctrlStart}ms`);

    return success(res, {
      organizationPlan,
      model: organizationPlan?.source?.model || config.geminiModel
    }, 'Mess Cleanup analysis completed successfully', 200);
  } catch (err) {
    if (res.writableEnded || clientAbortController.signal.aborted) {
      return;
    }
    console.error('[MessCleanupController] Unexpected exception:', err.message);
    return next(err);
  } finally {
    if (typeof res.removeListener === 'function') {
      res.removeListener('close', handleClientClose);
    }
  }
};

export default {
  analyze
};
