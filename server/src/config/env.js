import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/skribe',
  jwtSecret: process.env.JWT_SECRET || 'fallback_jwt_secret_dev_key',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  googleClientId: process.env.GOOGLE_CLIENT_ID || 'dummy_google_client_id',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy_google_client_secret',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/v1/auth/google/callback',
  nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
  nvidiaApiUrl: process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/chat/completions',
  nemotronModel: process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isProd: process.env.NODE_ENV === 'production'
};

export default config;