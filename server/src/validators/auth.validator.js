import { error } from '../utils/apiResponse.js';

const EMAIL_REGEX = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/;

export const validateRegister = (req, res, next) => {
  const { name, email, password } = req.body || {};
  const validationErrors = {};

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    validationErrors.name = 'Name must be at least 2 characters long';
  }

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    validationErrors.email = 'Please provide a valid email address';
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    validationErrors.password = 'Password must be at least 6 characters long';
  }

  if (Object.keys(validationErrors).length > 0) {
    return error(res, 'Validation failed for registration input', 400, validationErrors);
  }

  next();
};

export const validateLogin = (req, res, next) => {
  const { email, password } = req.body || {};
  const validationErrors = {};

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    validationErrors.email = 'Please provide a valid email address';
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    validationErrors.password = 'Password is required';
  }

  if (Object.keys(validationErrors).length > 0) {
    return error(res, 'Validation failed for login input', 400, validationErrors);
  }

  next();
};

export default {
  validateRegister,
  validateLogin
};
