import express from 'express';
import { error, success } from '../utils/apiResponse.js';
import { MAX_IMAGE_BYTES } from '../utils/imageFormat.js';
import { getStorageUsage, reserveUploadSlot, uploadBoardImage } from '../services/asset.service.js';

const readImageBody = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });

export const limitConcurrentUploads = (req, res, next) => {
  const release = reserveUploadSlot(req.user.id);
  if (!release) return error(res, 'Too many uploads are in progress. Please wait a moment and try again.', 429);
  res.on('finish', release);
  res.on('close', release);
  next();
};

export const receiveImageBody = (req, res, next) => {
  readImageBody(req, res, (err) => {
    if (!err) return next();
    if (err.type === 'entity.too.large') return error(res, 'Images must be 5 MB or smaller', 413, { code: 'FILE_TOO_LARGE' });
    return error(res, 'The image upload could not be read', 400, { code: 'MALFORMED_UPLOAD' });
  });
};

const decodeFileName = (value) => {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return '';
  }
};

export const createUploadHandler = (upload = uploadBoardImage) => async (req, res, next) => {
  try {
    const asset = await upload({
      userId: req.user.id,
      boardId: req.query.boardId,
      buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      originalName: decodeFileName(req.get('x-file-name'))
    });
    return success(res, { asset }, 'Image uploaded', 201);
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) return error(res, err.message, err.statusCode, err.code ? { code: err.code } : null);
    if (err.code) return error(res, err.message, err.statusCode, { code: err.code });
    next(err);
  }
};

export const usage = async (req, res, next) => {
  try {
    return success(res, { usage: await getStorageUsage(req.user.id) }, 'Storage usage retrieved', 200);
  } catch (err) {
    next(err);
  }
};

export default { limitConcurrentUploads, receiveImageBody, upload: createUploadHandler(), usage };
