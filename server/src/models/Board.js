import mongoose from 'mongoose';
import { CANVAS_BACKGROUNDS } from '../constants/preferences.js';

const boardSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [function requiresOwner() { return !this.isGuest; }, 'Board owner is required'],
      index: true
    },
    isGuest: {
      type: Boolean,
      default: false
    },
    ownerGuestId: {
      type: String,
      default: undefined
    },
    expiresAt: {
      type: Date,
      default: undefined
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    title: {
      type: String,
      required: [true, 'Board title is required'],
      default: 'Untitled Board',
      trim: true,
      maxlength: [120, 'Board title cannot exceed 120 characters']
    },
    canvasData: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        version: '6.5.1',
        objects: []
      })
    },
    canvasRevision: {
      type: Number,
      default: 0,
      min: 0
    },
    lastOperationRevision: {
      type: Number,
      default: 0,
      min: 0
    },
    recentOperations: {
      select: false,
      type: [
        {
          _id: false,
          opId: { type: String, required: true },
          revision: { type: Number, required: true }
        }
      ],
      default: []
    },
    viewportStates: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    thumbnail: {
      type: String,
      default: ''
    },
    canvasBackground: {
      type: String,
      enum: CANVAS_BACKGROUNDS,
      default: 'default'
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    },
    deletedAt: {
      type: Date,
      default: null
    },
    lastOpenedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.recentOperations;
        return ret;
      }
    }
  }
);

boardSchema.index({ owner: 1, isDeleted: 1, updatedAt: -1 });
boardSchema.index({ members: 1, isDeleted: 1, updatedAt: -1 });
boardSchema.index({ owner: 1, _id: 1, isDeleted: 1 });

export const GUEST_BOARD_INDEXES = Object.freeze([
  { key: { expiresAt: 1 }, name: 'guest_board_expiry', expireAfterSeconds: 0 },
  { key: { ownerGuestId: 1 }, name: 'guest_board_single_owner', unique: true, partialFilterExpression: { isGuest: true } }
]);

GUEST_BOARD_INDEXES.forEach(({ key, ...options }) => boardSchema.index(key, options));

export const Board = mongoose.model('Board', boardSchema);

export const ensureGuestBoardIndexes = () => Board.collection.createIndexes(GUEST_BOARD_INDEXES.map((index) => ({ ...index })));
export default Board;
