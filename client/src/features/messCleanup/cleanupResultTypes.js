
export const validateCleanupResult = (result, workspaceModel = null) => {
  const errors = [];
  const warnings = [];

  if (!result || typeof result !== 'object') {
    return { valid: false, errors: ['CleanupResult must be a non-null object'], warnings: [] };
  }

  if (result.version !== 1) {
    errors.push(`Invalid result version: ${result.version}. Expected version 1.`);
  }

  if (!result.summary || typeof result.summary !== 'object') {
    errors.push('CleanupResult.summary must be an object');
  } else {
    if (typeof result.summary.actionCount !== 'number') {
      errors.push('CleanupResult.summary.actionCount must be a number');
    }
    if (typeof result.summary.modifiedObjectCount !== 'number') {
      errors.push('CleanupResult.summary.modifiedObjectCount must be a number');
    }
    if (typeof result.summary.untouchedObjectCount !== 'number') {
      errors.push('CleanupResult.summary.untouchedObjectCount must be a number');
    }
    if (typeof result.summary.highConfidenceCount !== 'number') {
      errors.push('CleanupResult.summary.highConfidenceCount must be a number');
    }
  }

  if (!Array.isArray(result.actions)) {
    errors.push('CleanupResult.actions must be an array');
  } else {
    result.actions.forEach((act, idx) => {
      const prefix = `Action[${idx}]`;
      if (!act.id || typeof act.id !== 'string') {
        errors.push(`${prefix} missing string 'id'`);
      }
      if (!act.type || typeof act.type !== 'string') {
        errors.push(`${prefix} missing string 'type'`);
      }
      if (!Array.isArray(act.objectIds)) {
        errors.push(`${prefix} missing array 'objectIds'`);
      }
      if (typeof act.confidence !== 'number' || act.confidence < 0 || act.confidence > 1) {
        errors.push(`${prefix} confidence must be between 0 and 1`);
      }
      if (!act.reason || typeof act.reason !== 'string') {
        errors.push(`${prefix} missing string 'reason'`);
      }
      if (!act.impact || typeof act.impact !== 'object') {
        errors.push(`${prefix} missing object 'impact'`);
      } else {
        if (typeof act.impact.objectsAffected !== 'number') {
          errors.push(`${prefix}.impact missing number 'objectsAffected'`);
        }
      }
    });
  }

  if (!Array.isArray(result.preserved)) {
    errors.push('CleanupResult.preserved must be an array');
  } else {
    result.preserved.forEach((p, idx) => {
      const prefix = `Preserved[${idx}]`;
      if (!p.category || typeof p.category !== 'string') {
        errors.push(`${prefix} missing string 'category'`);
      }
      if (!Array.isArray(p.objectIds)) {
        errors.push(`${prefix} missing array 'objectIds'`);
      }
      if (!p.reason || typeof p.reason !== 'string') {
        errors.push(`${prefix} missing string 'reason'`);
      }
    });
  }

  if (!result.safety || typeof result.safety !== 'object') {
    errors.push('CleanupResult.safety must be an object');
  } else {
    if (typeof result.safety.isFullyConserved !== 'boolean') {
      errors.push('CleanupResult.safety.isFullyConserved must be a boolean');
    }
    if (typeof result.safety.untouchedInvariantMet !== 'boolean') {
      errors.push('CleanupResult.safety.untouchedInvariantMet must be a boolean');
    }
  }

  if (!result.diagnostics || typeof result.diagnostics !== 'object') {
    errors.push('CleanupResult.diagnostics must be an object');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};

export const assertValidCleanupResult = (result, workspaceModel = null) => {
  const validation = validateCleanupResult(result, workspaceModel);
  if (!validation.valid) {
    throw new Error(`[CleanupResult] Invalid: ${validation.errors.join('; ')}`);
  }
};
