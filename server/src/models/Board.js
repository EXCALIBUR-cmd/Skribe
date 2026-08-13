import mongoose from 'mongoose';

const boardSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Board owner is required'],
      index: true
    },
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
    thumbnail: {
      type: String,
      default: ''
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
        return ret;
      }
    }
  }
);

boardSchema.index({ owner: 1, isDeleted: 1, updatedAt: -1 });
boardSchema.index({ owner: 1, _id: 1, isDeleted: 1 });

export const Board = mongoose.model('Board', boardSchema);
export default Board;
