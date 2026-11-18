import mongoose from 'mongoose';

const voiceUsageSchema = new mongoose.Schema({
  key: { type: String, required: true },
  day: { type: String, required: true },
  count: { type: Number, default: 0, min: 0 },
  expiresAt: { type: Date, required: true }
});

export const VOICE_USAGE_INDEXES = Object.freeze([
  { key: { key: 1, day: 1 }, name: 'voice_usage_key_day', unique: true },
  { key: { expiresAt: 1 }, name: 'voice_usage_expiry', expireAfterSeconds: 0 }
]);

VOICE_USAGE_INDEXES.forEach(({ key, ...options }) => voiceUsageSchema.index(key, options));

export const VoiceUsage = mongoose.model('VoiceUsage', voiceUsageSchema);

export const ensureVoiceUsageIndexes = () => VoiceUsage.collection.createIndexes(VOICE_USAGE_INDEXES.map((index) => ({ ...index })));

export default VoiceUsage;
