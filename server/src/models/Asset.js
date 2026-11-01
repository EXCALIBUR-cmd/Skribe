import mongoose from 'mongoose';

export const ASSET_STATUSES = Object.freeze(['pending', 'attached', 'orphaned', 'deleting', 'deleted']);

const assetSchema = new mongoose.Schema(
  {
    assetId: { type: String, required: true, unique: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    boards: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Board' }],
    status: { type: String, enum: ASSET_STATUSES, default: 'pending', index: true },
    imageKitFileId: { type: String, default: null },
    filePath: { type: String, default: null },
    url: { type: String, default: null, index: true },
    originalName: { type: String, default: '' },
    mimeType: { type: String, default: null },
    size: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: null },
    attachedAt: { type: Date, default: null },
    orphanedAt: { type: Date, default: null },
    deletingAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    cleanupRunId: { type: String, default: null },
    cleanupAttempts: { type: Number, default: 0 },
    lastCleanupError: { type: String, default: null }
  },
  { timestamps: true }
);

assetSchema.index({ status: 1, orphanedAt: 1 });

export const Asset = mongoose.model('Asset', assetSchema);
export default Asset;
