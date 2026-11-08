import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

export const LOCAL_DEV_ORIGINS = Object.freeze(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

const parseUrl = (value) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export const buildConfig = (env = process.env) => {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const clientUrl = String(env.CLIENT_URL || (isProd ? '' : 'http://localhost:5173')).trim().replace(/\/+$/, '');
  const googleClientId = env.GOOGLE_CLIENT_ID || '';
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET || '';
  const googleCallbackUrl = env.GOOGLE_CALLBACK_URL || '';
  const googleConfigured = Boolean(googleClientId && googleClientSecret && googleCallbackUrl);
  const googleAuthRequested = env.GOOGLE_AUTH_ENABLED === 'true';
  return {
    port: env.PORT || 5000,
    nodeEnv,
    mongoUri: env.MONGODB_URI || (isProd ? '' : 'mongodb://localhost:27017/skribe'),
    jwtSecret: env.JWT_SECRET || '',
    clientUrl,
    allowedOrigins: isProd ? [clientUrl].filter(Boolean) : [...new Set([clientUrl, ...LOCAL_DEV_ORIGINS].filter(Boolean))],
    trustProxyHops: isProd ? 1 : 0,
    googleClientId,
    googleClientSecret,
    googleCallbackUrl,
    googleConfigured,
    googleAuthRequested,
    googleAuthEnabled: googleConfigured && (isProd ? googleAuthRequested : env.GOOGLE_AUTH_ENABLED !== 'false'),
    geminiApiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.GEMINI_MODEL || 'gemini-3.8-flash',
    groqApiKey: env.GROQ_API_KEY || '',
    voiceCommandModel: env.VOICE_COMMAND_MODEL || 'openai/gpt-oss-20b',
    groqMessCleanupApiKey: env.GROQ_MESS_CLEANUP_API_KEY || '',
    messCleanupModel: env.MESS_CLEANUP_MODEL || 'qwen/qwen3.8-27b',
    groqAiAssistantApiKey: env.GROQ_AI_ASSISTANT_API_KEY || '',
    aiAssistantModel: env.AI_ASSISTANT_MODEL || 'openai/gpt-oss-20b',
    groqAiSidekickApiKey: env.GROQ_AI_SIDEKICK_API_KEY || '',
    aiSidekickModel: env.AI_SIDEKICK_MODEL || 'openai/gpt-oss-20b',
    collabOperationsEnabled: env.COLLAB_OPERATIONS_ENABLED === 'true',
    imageKitPublicKey: env.IMAGEKIT_PUBLIC_KEY || '',
    imageKitPrivateKey: env.IMAGEKIT_PRIVATE_KEY || '',
    imageKitUrlEndpoint: env.IMAGEKIT_URL_ENDPOINT || '',
    imageKitSignedUrlTtlSeconds: Math.min(86400, Math.max(10, Number.parseInt(env.IMAGEKIT_SIGNED_URL_TTL_SECONDS, 10) || 3600)),
    isDev: nodeEnv === 'development',
    isProd
  };
};

const checkPublicHttpsUrl = (value, name, errors, { originOnly = false } = {}) => {
  const url = parseUrl(value);
  if (!url) {
    errors.push(`${name} must be an absolute https URL.`);
    return;
  }
  if (url.protocol !== 'https:') errors.push(`${name} must use https in production.`);
  if (LOCAL_HOSTNAMES.has(url.hostname)) errors.push(`${name} must not point at a local host in production.`);
  if (originOnly && (url.pathname !== '/' || url.search || url.hash)) errors.push(`${name} must be an origin without a path, for example https://app.example.com.`);
};

export const validateConfig = (cfg) => {
  const errors = [];
  const warnings = [];
  if (!cfg.isProd) return { errors, warnings };
  if (!cfg.mongoUri) errors.push('MONGODB_URI is required in production.');
  if (!cfg.clientUrl) errors.push('CLIENT_URL is required in production.');
  else checkPublicHttpsUrl(cfg.clientUrl, 'CLIENT_URL', errors, { originOnly: true });
  if (cfg.googleAuthRequested && !cfg.googleConfigured) errors.push('GOOGLE_AUTH_ENABLED is true but GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL are not all set.');
  if (cfg.googleAuthEnabled) checkPublicHttpsUrl(cfg.googleCallbackUrl, 'GOOGLE_CALLBACK_URL', errors);
  if (!(cfg.imageKitPublicKey && cfg.imageKitPrivateKey && cfg.imageKitUrlEndpoint)) warnings.push('Image uploads are disabled: IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT are not all set.');
  if (!cfg.geminiApiKey) warnings.push('GEMINI_API_KEY is not set: features that need it fall back or stay unavailable.');
  for (const [name, value] of [['GROQ_API_KEY', cfg.groqApiKey], ['GROQ_MESS_CLEANUP_API_KEY', cfg.groqMessCleanupApiKey], ['GROQ_AI_ASSISTANT_API_KEY', cfg.groqAiAssistantApiKey], ['GROQ_AI_SIDEKICK_API_KEY', cfg.groqAiSidekickApiKey]]) {
    if (!value) warnings.push(`${name} is not set: the feature that uses it is unavailable.`);
  }
  if (!cfg.googleAuthEnabled) warnings.push('Google sign-in is disabled.');
  return { errors, warnings };
};

export const config = buildConfig(process.env);

export default config;
