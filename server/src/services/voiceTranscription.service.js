import config from '../config/env.js';
import VoiceUsage from '../models/VoiceUsage.js';
import { isGuestUser } from '../utils/guest.js';

export const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const VOICE_MODEL = 'whisper-large-v3-turbo';
export const VOICE_TIMEOUT_MS = 20000;
export const VOICE_LIMITS = Object.freeze({ account: 20, guest: 5, global: 1500 });

const EXTENSIONS = Object.freeze({ 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' });
export const AUDIO_TYPES = Object.freeze(Object.keys(EXTENSIONS));

export const baseAudioType = (mimeType) => String(mimeType || '').split(';')[0].trim().toLowerCase();
export const voiceApiKey = () => config.groqVoiceApiKey || config.groqApiKey;

const httpError = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, code });
const dayOf = (now) => now.toISOString().slice(0, 10);
const expiryOf = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2));

const claim = async (key, limit, now) => {
  try {
    const usage = await VoiceUsage.findOneAndUpdate(
      { key, day: dayOf(now), count: { $lt: limit } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: expiryOf(now) } },
      { upsert: true, new: true }
    ).lean();
    return Boolean(usage);
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
};

const release = (key, now) => VoiceUsage.updateOne({ key, day: dayOf(now), count: { $gt: 0 } }, { $inc: { count: -1 } });

export const reserveVoiceQuota = async (user, now = new Date()) => {
  const own = isGuestUser(user) ? { key: `guest:${user.id}`, limit: VOICE_LIMITS.guest } : { key: `user:${user.id}`, limit: VOICE_LIMITS.account };
  if (!(await claim(own.key, own.limit, now))) return false;
  if (await claim('global', VOICE_LIMITS.global, now)) return true;
  await release(own.key, now);
  return false;
};

export const transcribeAudio = async ({ buffer, mimeType, lang }) => {
  const type = baseAudioType(mimeType);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), `audio.${EXTENSIONS[type] || 'webm'}`);
  form.append('model', VOICE_MODEL);
  form.append('response_format', 'json');
  form.append('language', lang === 'hi' ? 'hi' : 'en');
  let response;
  try {
    response = await fetch(GROQ_TRANSCRIPTIONS_URL, { method: 'POST', headers: { Authorization: `Bearer ${voiceApiKey()}` }, body: form, signal: AbortSignal.timeout(VOICE_TIMEOUT_MS) });
  } catch {
    throw httpError(502, 'Voice transcription failed. Please try again.', 'VOICE_FAILED');
  }
  if (response.status === 429) throw httpError(429, 'Voice is busy right now. Try again in a minute.', 'VOICE_RATE_LIMITED');
  const body = response.ok ? await response.json().catch(() => null) : null;
  if (typeof body?.text !== 'string') throw httpError(502, 'Voice transcription failed. Please try again.', 'VOICE_FAILED');
  return body.text.trim();
};
