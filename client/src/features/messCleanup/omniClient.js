import { apiClient } from '../../api/apiClient.js';

export const analyzeWorkspaceWithOmni = async (workspaceModel, image, options = {}) => {
  const client = options.apiClient || apiClient;

  if (!workspaceModel || typeof workspaceModel !== 'object') {
    const error = new Error('Invalid or missing workspaceModel');
    error.code = 'INVALID_WORKSPACE_MODEL';
    error.status = 400;
    throw error;
  }

  if (!image || typeof image !== 'string' || !image.trim()) {
    const error = new Error('Invalid or missing image/screenshot Data URL');
    error.code = 'INVALID_IMAGE';
    error.status = 400;
    throw error;
  }

  const clientReqStart = Date.now();
  console.log('[MessCleanup Diagnostic] Client request started');

  try {
    const response = await client.post('/mess-cleanup/analyze', {
      workspaceModel,
      image
    }, { timeout: 90000 });

    console.log(`[MessCleanup Diagnostic] Client request completed in ${Date.now() - clientReqStart}ms`);
    console.log(`[Nemotron Client Diagnostic] Response top-level keys: ${Object.keys(response || {}).join(', ')}`);

    const plan = response?.data?.organizationPlan || response?.organizationPlan;
    if (!plan || typeof plan !== 'object') {
      console.log('[Nemotron Client Diagnostic] Validation failed: plan is null or invalid object');
      const error = new Error('Server returned an empty or invalid organization plan structure');
      error.code = 'INVALID_SERVER_RESPONSE';
      error.status = 502;
      throw error;
    }

    // Validation: groups (SemanticScene) OR document.sections (v2) OR sections (v1)
    const groupsOrSections = plan.groups || plan.document?.sections || plan.sections;
    if (!Array.isArray(groupsOrSections)) {
      console.log('[Nemotron Client Diagnostic] Validation failed: no groups or sections array in plan');
      const error = new Error('Server returned an organization plan without valid groups or sections');
      error.code = 'INVALID_PLAN_SCHEMA';
      error.status = 502;
      throw error;
    }

    const relationshipCount = Array.isArray(plan.relationships) ? plan.relationships.length : 0;
    console.log(`[Nemotron Client Diagnostic] Plan received: ${groupsOrSections.length} groups/sections, ${relationshipCount} relationships, workspaceType=${plan.workspaceType || 'unset'}`);

    return plan;
  } catch (err) {
    const status = err?.status || err?.response?.status || 500;
    const message = err?.message || err?.response?.data?.message || 'Mess Cleanup AI server request failed';
    const code = err?.code || err?.response?.data?.errors?.code || 'OMNI_CLIENT_ERROR';

    console.log(`[Nemotron Client Diagnostic] Request error: HTTP ${status} (${code}) - ${message}`);

    const clientError = new Error(message);
    clientError.status = status;
    clientError.code = code;
    clientError.originalError = err;
    throw clientError;
  }
};

export default analyzeWorkspaceWithOmni;
