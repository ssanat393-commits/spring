import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

export const ENV = {
  PORT: Number(process.env.PORT || 3000),
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  DB_PATH: path.resolve(process.cwd(), process.env.CICADA_DB_PATH || './data/cicada.db'),
  SESSION_SECRET: process.env.CICADA_SESSION_SECRET || 'cicada-local-dev-session-secret-2026',
  AGENT_BOOTSTRAP_KEY: process.env.CICADA_AGENT_BOOTSTRAP_KEY || 'cicada-agent-bootstrap-2026',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export function isGeminiConfigured(): boolean {
  const key = ENV.GEMINI_API_KEY.trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key.length > 10);
}

export function isFirebaseClientConfigured(): boolean {
  return Boolean(
    process.env.VITE_FIREBASE_API_KEY &&
      process.env.VITE_FIREBASE_PROJECT_ID
  );
}
