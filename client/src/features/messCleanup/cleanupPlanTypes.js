
export const HIGH_CONFIDENCE = 0.90;
export const MEDIUM_CONFIDENCE = 0.70;
export const LOW_CONFIDENCE = 0.00;

export const SUPPORTED_ACTION_TYPES = new Set([
  'attachText',
  'align',
  'equalizeSpacing',
  'arrangeGrid',
  'cleanFlowchart',
  'normalizeText',
  'preserve'
]);

export const FORBIDDEN_COORDINATE_FIELDS = new Set([
  'x',
  'y',
  'left',
  'top',
  'width',
  'height',
  'bounds',
  'margins',
  'path',
  'pathData',
  'pathCommands',
  'dx',
  'dy',
  'position',
  'size',
  'centerX',
  'centerY'
]);

export const ALIGN_AXES = new Set(['x', 'y', 'centerX', 'centerY']);
export const SPACING_AXES = new Set(['x', 'y']);

export const validateCleanupPlan = (plan, workspaceModel = null) => {
  const errors = [];
  const warnings = [];

  if (!plan || typeof plan !== 'object') {
    return { valid: false, errors: ['Plan must be a non-null object'], warnings: [] };
  }

  if (plan.version !== 1) {
    errors.push(`Invalid or unsupported plan version: ${plan.version}. Expected version 1.`);
  }

  if (!Array.isArray(plan.actions)) {
    errors.push('Plan.actions must be an array');
  }

  if (!Array.isArray(plan.untouchedObjectIds)) {
    errors.push('Plan.untouchedObjectIds must be an array');
  }

  if (!plan.diagnostics || typeof plan.diagnostics !== 'object') {
    errors.push('Plan.diagnostics must be an object');
  }

  const knownObjectIds = new Set();
  if (workspaceModel && typeof workspaceModel === 'object') {
    const rawObjs = workspaceModel.board?.objects || workspaceModel.objects || [];
    rawObjs.forEach((o) => {
      if (o && o.id) {
        knownObjectIds.add(String(o.id));
      }
      if (o && o.sourceObjectId) {
        knownObjectIds.add(String(o.sourceObjectId));
      }
    });
  }

  const actionIds = new Set();
  const modifiedObjectMap = new Map();
  const preservedObjectIds = new Set();
  const alignActionAxes = new Map();

  const actions = Array.isArray(plan.actions) ? plan.actions : [];

  actions.forEach((action, idx) => {
    const prefix = `Action[${idx}]`;
    if (!action || typeof action !== 'object') {
      errors.push(`${prefix} must be a non-null object`);
      return;
    }

    if (!action.id || typeof action.id !== 'string') {
      errors.push(`${prefix} missing required string 'id'`);
    } else {
      if (actionIds.has(action.id)) {
        errors.push(`Duplicate action ID detected: '${action.id}'`);
      }
      actionIds.add(action.id);
    }

    if (!action.type || typeof action.type !== 'string') {
      errors.push(`${prefix} missing required string 'type'`);
    } else if (!SUPPORTED_ACTION_TYPES.has(action.type)) {
      errors.push(`${prefix} has unsupported action type: '${action.type}'`);
    }

    if (typeof action.confidence !== 'number' || Number.isNaN(action.confidence) || action.confidence < 0 || action.confidence > 1) {
      errors.push(`${prefix} confidence must be a number between 0.0 and 1.0 (got ${action.confidence})`);
    }

    if (!action.reason || typeof action.reason !== 'string' || !action.reason.trim()) {
      errors.push(`${prefix} missing required string 'reason'`);
    }

    if (!Array.isArray(action.objectIds) || action.objectIds.length === 0) {
      errors.push(`${prefix} objectIds must be a non-empty array of strings`);
    } else {
      action.objectIds.forEach((objId) => {
        if (!objId || typeof objId !== 'string') {
          errors.push(`${prefix} contains invalid object ID: ${JSON.stringify(objId)}`);
        } else if (knownObjectIds.size > 0 && !knownObjectIds.has(objId)) {
          errors.push(`${prefix} references unknown object ID '${objId}' not found in workspaceModel`);
        }
      });
    }

    if (action.type === 'align') {
      if (!action.axis || !ALIGN_AXES.has(action.axis)) {
        errors.push(`${prefix} (align) requires valid axis: 'x', 'y', 'centerX', or 'centerY' (got ${action.axis})`);
      }
    }

    if (action.type === 'equalizeSpacing') {
      if (!action.axis || !SPACING_AXES.has(action.axis)) {
        errors.push(`${prefix} (equalizeSpacing) requires valid axis: 'x' or 'y' (got ${action.axis})`);
      }
    }

    if (action.type === 'attachText') {
      if (Array.isArray(action.objectIds) && action.objectIds.length !== 2) {
        errors.push(`${prefix} (attachText) must specify exactly [shapeId, textId] (got ${action.objectIds.length} IDs)`);
      }
    }

    if (action.type === 'cleanFlowchart') {
      if (action.connectorIds !== undefined) {
        if (!Array.isArray(action.connectorIds)) {
          errors.push(`${prefix} (cleanFlowchart) connectorIds must be an array if specified`);
        } else {
          action.connectorIds.forEach((connId) => {
            if (knownObjectIds.size > 0 && !knownObjectIds.has(connId)) {
              errors.push(`${prefix} (cleanFlowchart) references unknown connector ID '${connId}'`);
            }
          });
        }
      }
    }

    Object.keys(action).forEach((key) => {
      if (FORBIDDEN_COORDINATE_FIELDS.has(key)) {
        errors.push(`${prefix} forbidden coordinate field '${key}' found. CleanupPlan must describe intent only, not geometry.`);
      }
    });

    if (Array.isArray(action.objectIds)) {
      action.objectIds.forEach((objId) => {
        if (action.type === 'preserve') {
          preservedObjectIds.add(objId);
        } else {
          if (action.type === 'align' && action.axis) {
            if (!alignActionAxes.has(objId)) alignActionAxes.set(objId, new Set());
            const axes = alignActionAxes.get(objId);
            if (axes.has(action.axis)) {
              errors.push(`Conflicting duplicate alignment on axis '${action.axis}' for object '${objId}' in action '${action.id}'`);
            }
            axes.add(action.axis);
          }
          modifiedObjectMap.set(objId, action.id);
        }
      });
    }
  });

  const untouched = Array.isArray(plan.untouchedObjectIds) ? plan.untouchedObjectIds : [];
  untouched.forEach((objId) => {
    if (knownObjectIds.size > 0 && !knownObjectIds.has(objId)) {
      errors.push(`untouchedObjectIds contains unknown object ID '${objId}' not found in workspaceModel`);
    }
  });

  preservedObjectIds.forEach((objId) => {
    if (modifiedObjectMap.has(objId)) {
      errors.push(`Conflict: object '${objId}' is simultaneously referenced in modifying action '${modifiedObjectMap.get(objId)}' and a preserve action`);
    }
  });

  untouched.forEach((objId) => {
    if (modifiedObjectMap.has(objId)) {
      errors.push(`Conflict: object '${objId}' is referenced in modifying action '${modifiedObjectMap.get(objId)}' but is also listed in untouchedObjectIds`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};

export const assertValidCleanupPlan = (plan, workspaceModel = null) => {
  const result = validateCleanupPlan(plan, workspaceModel);
  if (!result.valid) {
    throw new Error(`[CleanupPlan Validation Error] ${result.errors.join('; ')}`);
  }
  return true;
};
