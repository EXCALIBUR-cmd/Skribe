import mongoose from 'mongoose';
import { error } from '../utils/apiResponse.js';

export const validateBoardId = (req, res, next) => {
  const { id } = req.params;

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return error(res, 'Invalid Board ID format', 400);
  }

  next();
};

export const validateCreateBoard = (req, res, next) => {
  const { title } = req.body || {};
  const validationErrors = {};

  if (title !== undefined && (typeof title !== 'string' || title.trim().length > 120)) {
    validationErrors.title = 'Board title must be a string under 120 characters';
  }

  if (Object.keys(validationErrors).length > 0) {
    return error(res, 'Validation failed for board creation payload', 400, validationErrors);
  }

  next();
};

export const validateUpdateBoard = (req, res, next) => {
  const { title, canvasData, isArchived, thumbnail } = req.body || {};
  const validationErrors = {};

  if (title !== undefined && (typeof title !== 'string' || title.trim().length > 120)) {
    validationErrors.title = 'Board title must be a string under 120 characters';
  }

  if (canvasData !== undefined && (typeof canvasData !== 'object' || canvasData === null || Array.isArray(canvasData))) {
    validationErrors.canvasData = 'canvasData must be a valid Fabric JSON object';
  }

  if (isArchived !== undefined && typeof isArchived !== 'boolean') {
    validationErrors.isArchived = 'isArchived must be a boolean value';
  }

  if (thumbnail !== undefined && typeof thumbnail !== 'string') {
    validationErrors.thumbnail = 'thumbnail must be a string URL/base64 data';
  }

  if (Object.keys(validationErrors).length > 0) {
    return error(res, 'Validation failed for board update payload', 400, validationErrors);
  }

  next();
};

export const validateViewport = (req, res, next) => {
  const { x, y, zoom } = req.body || {};
  const values = [x, y, zoom];

  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return error(res, 'Viewport values must be finite numbers', 400);
  }

  if (zoom < 0.2 || zoom > 5) {
    return error(res, 'Viewport zoom must be between 0.2 and 5', 400);
  }

  next();
};

export default {
  validateBoardId,
  validateCreateBoard,
  validateUpdateBoard,
  validateViewport
};
