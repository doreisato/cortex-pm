// ============================================================
// CORTEX-PM: Configuration
// All environment variables loaded and validated here.
// If a required var is missing, the process exits with a clear error.
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

// --- Helper: read env with optional default ---
function env(key: string, fallback?: string): string {
  const val = process.env[key] || fallback;
  if (!val) {
    console.error(`[CONFIG] FATAL: Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

function envNum(key: string, fallback: number): number {
  const raw = process.env[key];
  return raw ? Number(raw) : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw === 'true' || raw === '1';
}

// ============================================================
// Export config object — single source of truth
// ============================================================
export const config = {
  // --- Server ---
  port: envNum('PORT', 4000),
  nodeEnv: env('NODE_ENV', 'development'),

  // --- Supabase ---
  supabase: {
    url: env('SUPABASE_URL'),
    serviceKey: env('SUPABASE_SERVICE_KEY'),
  },

  // --- Polymarket APIs ---
  polymarket: {
    clobUrl: env('CLOB_API_URL', 'https://clob.polymarket.com'),
    dataUrl: env('DATA_API_URL', 'https://data-api.polymarket.com'),
    gammaUrl: env('GAMMA_API_URL', 'https://gamma-api.polymarket.com'),
    // Only needed for live trade execution (future)
    privateKey: process.env.POLYGON_PRIVATE_KEY || '',
    address: process.env.POLYGON_ADDRESS || '',
  },

  // --- Telegram ---
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    enabled: envBool('TELEGRAM_ENABLED', true),
  },

  // --- Convergence Detection ---
  convergence: {
    windowMinutes: envNum('CONVERGENCE_WINDOW_MINUTES', 10),
    minWallets: envNum('CONVERGENCE_MIN_WALLETS', 3),
    minScore: envNum('CONVERGENCE_MIN_SCORE', 60),
  },

  // --- Polling Intervals ---
  polling: {
    walletIntervalMs: envNum('POLL_INTERVAL_MS', 10000),
    priceTrackIntervalMs: envNum('PRICE_TRACK_INTERVAL_MS', 300000),
    marketSnapshotIntervalMs: envNum('MARKET_SNAPSHOT_INTERVAL_MS', 600000),
  },

  // --- Paper Trading ---
  paperTrading: {
    enabled: envBool('PAPER_TRADING_ENABLED', true),
    defaultSizeUsd: envNum('PAPER_TRADE_SIZE_USD', 100),
    stopLossPct: envNum('PAPER_STOP_LOSS_PCT', 15),
    takeProfitPct: envNum('PAPER_TAKE_PROFIT_PCT', 30),
  },
} as const;

// --- Log config on startup (redact secrets) ---
console.log('[CONFIG] Loaded configuration:');
console.log(`  PORT=${config.port}`);
console.log(`  NODE_ENV=${config.nodeEnv}`);
console.log(`  SUPABASE_URL=${config.supabase.url}`);
console.log(`  CLOB_API=${config.polymarket.clobUrl}`);
console.log(`  CONVERGENCE: ${config.convergence.minWallets}+ wallets, ${config.convergence.windowMinutes}min window`);
console.log(`  PAPER_TRADING: ${config.paperTrading.enabled ? 'ON' : 'OFF'}`);
console.log(`  TELEGRAM: ${config.telegram.enabled ? 'ON' : 'OFF'}`);
