import mongoose from 'mongoose';
import { APPEARANCES, DEFAULT_PREFERENCES, LANDING_PAGES, LANGUAGES } from '../constants/preferences.js';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/, 'Please provide a valid email address']
    },
    password: {
      type: String,
      required: [
        function () {
          return this.provider === 'local';
        },
        'Password is required for local email accounts'
      ],
      select: false
    },
    provider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local'
    },
    googleId: {
      type: String,
      default: null,
      sparse: true,
      index: true
    },
    avatar: {
      type: String,
      default: ''
    },
    preferences: {
      appearance: { type: String, enum: APPEARANCES, default: DEFAULT_PREFERENCES.appearance },
      language: { type: String, enum: LANGUAGES, default: DEFAULT_PREFERENCES.language },
      landingPage: { type: String, enum: LANDING_PAGES, default: DEFAULT_PREFERENCES.landingPage },
      reduceMotion: { type: Boolean, default: DEFAULT_PREFERENCES.reduceMotion }
    },
    lastOpenedBoard: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.password;
        return ret;
      }
    }
  }
);

export const User = mongoose.model('User', userSchema);
export default User;
