export interface Env {
  DB: D1Database;
  AI: Ai;
  OWNER_GOOGLE_SUB: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY_B64: string;
  SESSION_HASH_KEY: string;
  PUBLIC_APP_ORIGIN: string;
}
