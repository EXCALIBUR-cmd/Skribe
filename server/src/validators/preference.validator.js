import { error } from '../utils/apiResponse.js';
import { PREFERENCE_RULES } from '../constants/preferences.js';

export const validatePreferences = (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return error(res, 'Preferences payload must be an object', 400);
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return error(res, 'Provide at least one preference to update', 400);
  }

  const validationErrors = {};
  for (const key of keys) {
    const rule = PREFERENCE_RULES[key];
    if (!rule) {
      validationErrors[key] = 'Unknown preference';
    } else if (!rule(body[key])) {
      validationErrors[key] = 'Invalid value for this preference';
    }
  }

  if (Object.keys(validationErrors).length > 0) {
    return error(res, 'Validation failed for preferences payload', 400, validationErrors);
  }

  next();
};
