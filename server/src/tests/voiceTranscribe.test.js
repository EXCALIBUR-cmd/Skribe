import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import mongoose from 'mongoose';
import config from '../config/env.js';
import app from '../app.js';
import User from '../models/User.js';
import VoiceUsage, { ensureVoiceUsageIndexes } from '../models/VoiceUsage.js';
import { guestBoardAddressLimiter, voiceTranscribeLimiter } from '../middleware/rateLimit.middleware.js';
import { GROQ_TRANSCRIPTIONS_URL, VOICE_LIMITS } from '../services/voiceTranscription.service.js';
import { generateAccessToken } from '../utils/jwt.js';
import { COOKIE_NAME } from '../utils/cookieOptions.js';

const TEST_DB_NAME = `skribe_voice_test_${process.pid}_${Date.now()}`;
const TEST_MONGO_BASE = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
const saved = { jwtSecret: config.jwtSecret, groqVoiceApiKey: config.groqVoiceApiKey, groqApiKey: config.groqApiKey };
config.jwtSecret = 'skribe-test-only-jwt-secret-for-voice-transcribe-tests-01';
config.groqVoiceApiKey = 'test-voice-key';
config.groqApiKey = 'test-general-key';

let mongoAvailable = false;
try {
  await mongoose.connect(`${TEST_MONGO_BASE}/${TEST_DB_NAME}`, { serverSelectionTimeoutMS: 1500, autoIndex: false });
  mongoAvailable = true;
} catch {
  mongoAvailable = false;
}
const needsMongo = { skip: mongoAvailable ? false : `MongoDB is not reachable at ${TEST_MONGO_BASE}` };
if (mongoAvailable) await ensureVoiceUsageIndexes();

const realFetch = globalThis.fetch;
const groq = { calls: [], reply: () => new Response(JSON.stringify({ text: ' hello board ' }), { status: 200, headers: { 'Content-Type': 'application/json' } }) };
globalThis.fetch = async (url, init) => {
  if (String(url) !== GROQ_TRANSCRIPTIONS_URL) return realFetch(url, init);
  groq.calls.push({ auth: init.headers.Authorization, form: init.body });
  return groq.reply();
};

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v1`;

test.after(async () => {
  Object.assign(config, saved);
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
  if (mongoAvailable && mongoose.connection.name === TEST_DB_NAME) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test.beforeEach(() => {
  voiceTranscribeLimiter.reset();
  guestBoardAddressLimiter.reset();
  groq.calls = [];
  config.groqVoiceApiKey = 'test-voice-key';
  config.groqApiKey = 'test-general-key';
});

const account = async () => {
  const user = await User.create({ name: 'Voice', email: `voice.${Date.now()}.${Math.random().toString(16).slice(2)}@example.com`, password: 'Verify12345!' });
  return { user, token: generateAccessToken({ id: String(user._id) }) };
};
const guest = async () => {
  const res = await realFetch(`${base}/auth/guest`, { method: 'POST' });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`));
  const body = await res.json();
  return { token: cookie.split(';')[0].slice(COOKIE_NAME.length + 1), id: body.data.user.id };
};
const send = async (token, { type = 'audio/webm;codecs=opus', bytes = 2048, lang } = {}) => {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(bytes).fill(7)], { type }), 'clip.webm');
  if (lang) form.append('lang', lang);
  const res = await realFetch(`${base}/voice/transcribe`, { method: 'POST', headers: token ? { cookie: `${COOKIE_NAME}=${token}` } : {}, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const today = () => new Date().toISOString().slice(0, 10);

test('a recording is sent to Groq Whisper and the text comes back', needsMongo, async () => {
  const { token } = await account();
  const res = await send(token, { lang: 'hi' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.text, 'hello board');
  assert.equal(groq.calls.length, 1);
  const { auth, form } = groq.calls[0];
  assert.equal(auth, 'Bearer test-voice-key');
  assert.equal(form.get('model'), 'whisper-large-v3-turbo');
  assert.equal(form.get('response_format'), 'json');
  assert.equal(form.get('language'), 'hi');
  assert.equal(form.get('file').size, 2048);
  assert.match(form.get('file').name, /\.webm$/);
  await send(token);
  assert.equal(groq.calls[1].form.get('language'), 'en');
});

test('without GROQ_VOICE_API_KEY the general GROQ_API_KEY is used', needsMongo, async () => {
  config.groqVoiceApiKey = '';
  const { token } = await account();
  assert.equal((await send(token)).status, 200);
  assert.equal(groq.calls[0].auth, 'Bearer test-general-key');
});

test('unsupported audio types are refused with 415', needsMongo, async () => {
  const { token } = await account();
  const res = await send(token, { type: 'text/plain' });
  assert.equal(res.status, 415);
  assert.equal(res.body.errors?.code, 'UNSUPPORTED_AUDIO');
  assert.equal(groq.calls.length, 0);
});

test('with no Groq key the endpoint returns 503 VOICE_UNAVAILABLE and uses no quota', needsMongo, async () => {
  config.groqVoiceApiKey = '';
  config.groqApiKey = '';
  const { user, token } = await account();
  const res = await send(token);
  assert.equal(res.status, 503);
  assert.equal(res.body.errors?.code, 'VOICE_UNAVAILABLE');
  assert.equal(await VoiceUsage.countDocuments({ key: `user:${user._id}` }), 0);
});

test('signed-in users get 20 transcriptions a day', needsMongo, async () => {
  const { user, token } = await account();
  await VoiceUsage.create({ key: `user:${user._id}`, day: today(), count: VOICE_LIMITS.account - 1, expiresAt: new Date(Date.now() + 86400000) });
  assert.equal((await send(token)).status, 200);
  const blocked = await send(token);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.errors?.code, 'VOICE_DAILY_LIMIT');
  assert.equal(blocked.body.message, 'You\'ve used today\'s voice limit. It resets tomorrow.');
  assert.equal(groq.calls.length, 1, 'Groq was called after the limit');
  assert.equal(VOICE_LIMITS.account, 20);
});

test('guests get 5 transcriptions a day, counted by their guest session', needsMongo, async () => {
  const visitor = await guest();
  for (let i = 0; i < VOICE_LIMITS.guest; i += 1) assert.equal((await send(visitor.token)).status, 200, `use ${i + 1}`);
  const blocked = await send(visitor.token);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.errors?.code, 'VOICE_DAILY_LIMIT');
  const usage = await VoiceUsage.findOne({ key: `guest:${visitor.id}`, day: today() }).lean();
  assert.equal(usage.count, 5);
  assert.equal(VOICE_LIMITS.guest, 5);
});

test('the global daily budget of 1500 stops everyone and does not use up personal quota', needsMongo, async () => {
  await VoiceUsage.updateOne({ key: 'global', day: today() }, { $set: { count: VOICE_LIMITS.global }, $setOnInsert: { expiresAt: new Date(Date.now() + 86400000) } }, { upsert: true });
  const { user, token } = await account();
  const blocked = await send(token);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.errors?.code, 'VOICE_DAILY_LIMIT');
  assert.equal((await VoiceUsage.findOne({ key: `user:${user._id}` }).lean()).count, 0);
  assert.equal(groq.calls.length, 0);
  assert.equal(VOICE_LIMITS.global, 1500);
  await VoiceUsage.deleteOne({ key: 'global' });
});

test('Groq rate limits map to VOICE_RATE_LIMITED and other failures to VOICE_FAILED', needsMongo, async () => {
  const { token } = await account();
  groq.reply = () => new Response('{}', { status: 429 });
  const limited = await send(token);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.errors?.code, 'VOICE_RATE_LIMITED');
  groq.reply = () => new Response('{}', { status: 500 });
  const failed = await send(token);
  assert.equal(failed.status, 502);
  assert.equal(failed.body.errors?.code, 'VOICE_FAILED');
  groq.reply = () => new Response(JSON.stringify({ text: ' hello board ' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

test('usage counters expire through a TTL index, and the endpoint needs a session', needsMongo, async () => {
  const indexes = await VoiceUsage.collection.indexes();
  assert.equal(indexes.find((index) => index.name === 'voice_usage_expiry')?.expireAfterSeconds, 0);
  assert.equal(indexes.find((index) => index.name === 'voice_usage_key_day')?.unique, true);
  const { user, token } = await account();
  await send(token);
  const usage = await VoiceUsage.findOne({ key: `user:${user._id}` }).lean();
  assert.ok(usage.expiresAt.getTime() > Date.now() + 24 * 3600 * 1000, 'the counter expires before the day is over');
  assert.equal((await send(null)).status, 401);
});
