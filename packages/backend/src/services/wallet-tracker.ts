// ============================================================
// CORTEX-PM: Wallet Tracker
// Polls Polymarket Data API for new trades from tracked wallets.
// Stores raw trades in Supabase. Emits events for convergence detection.
//
// Flow:
//   1. Load active wallets from Supabase
//   2. For each wallet, fetch trades since last check
//   3. Deduplicate against existing trades (polymarket_trade_id)
//   4. Insert new trades into wallet_trades table
//   5. Emit 'new_trades' event for convergence detector
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { getWalletTrades, getMarketByCondition, type PolymarketTrade } from './polymarket.js';
import { EventEmitter } from 'events';

export const walletEvents = new EventEmitter();

// --- Types ---
interface TrackedWallet {
  id: string;
  address: string;
  label: string;
  tier: string;
  is_active: boolean;
}

interface NewTradeRecord {
  wallet_id: string;
  wallet_address: string;
  market_slug: string;
  condition_id: string;
  token_id: string;
  outcome: string;
  side: string;
  price: number;
  size: number;
  total_cost: number;
  polymarket_trade_id: string;
  transaction_hash: string;
  market_question: string;
  traded_at: string;
}

function normalizeTradeTimestamp(ts: unknown): string {
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    const ms = ts < 10_000_000_000 ? ts * 1000 : ts;
    return new Date(ms).toISOString();
  }
  if (typeof ts === 'string' && ts) {
    const asNum = Number(ts);
    if (!Number.isNaN(asNum) && Number.isFinite(asNum)) {
      const ms = asNum < 10_000_000_000 ? asNum * 1000 : asNum;
      return new Date(ms).toISOString();
    }
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// --- State ---
let supabase: SupabaseClient;
let lastCheckTimestamps: Map<string, string> = new Map();
let isRunning = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;

// Circuit breaker state + tracker metrics
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
let circuitProbeMode = false;
let lastPollTime: string | null = null;

export function getWalletTrackerStatus() {
  return {
    wallets_tracked: lastKnownWalletCount,
    last_poll_time: lastPollTime,
    circuit_open: Date.now() < circuitOpenUntil,
    consecutive_failures: consecutiveFailures,
  };
}

let lastKnownWalletCount = 0;

// ============================================================
// Initialize
// ============================================================
export function initWalletTracker(): void {
  supabase = createClient(config.supabase.url, config.supabase.serviceKey);
  console.log('[WALLET-TRACKER] Initialized');
}

// ============================================================
// Start polling loop
// ============================================================
export function startPolling(): void {
  if (isRunning) {
    console.warn('[WALLET-TRACKER] Already running');
    return;
  }
  isRunning = true;
  console.log(`[WALLET-TRACKER] Starting poll loop (interval: ${config.polling.walletIntervalMs}ms)`);

  // --- Run immediately, then on interval ---
  pollAllWallets();
  pollInterval = setInterval(pollAllWallets, config.polling.walletIntervalMs);
}

export function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  isRunning = false;
  console.log('[WALLET-TRACKER] Stopped');
}

// ============================================================
// Core poll cycle
// ============================================================
async function pollAllWallets(): Promise<void> {
  if (pollInFlight) {
    console.log('[WALLET-TRACKER] Previous poll still running, skipping tick');
    return;
  }
  pollInFlight = true;

  const cycleStart = Date.now();
  lastPollTime = new Date().toISOString();

  // Circuit breaker: pause cycles while open.
  if (Date.now() < circuitOpenUntil) {
    pollInFlight = false;
    return;
  }

  // --- 1. Load active wallets ---
  const { data: wallets, error: walletsErr } = await supabase
    .from('tracked_wallets')
    .select('id, address, label, tier')
    .eq('is_active', true);

  if (walletsErr || !wallets) {
    console.error('[WALLET-TRACKER] Failed to load wallets:', walletsErr?.message);
    consecutiveFailures += 1;
    if (consecutiveFailures >= 5) {
      circuitOpenUntil = Date.now() + 60000;
      circuitProbeMode = true;
      console.error('[WALLET-TRACKER] Circuit breaker OPEN. Pausing 60s.');
    }
    pollInFlight = false;
    return;
  }

  lastKnownWalletCount = wallets.length;
  console.log(`[WALLET-TRACKER] Polling ${wallets.length} wallets...`);

  // --- 2. Poll each wallet in parallel (batched to avoid rate limits) ---
  const BATCH_SIZE = 5;
  let totalNewTrades = 0;

  if (circuitProbeMode) {
    const probeWallet = wallets[0] as TrackedWallet | undefined;
    if (!probeWallet) {
      pollInFlight = false;
      return;
    }
    try {
      const probeCount = await pollSingleWallet(probeWallet);
      consecutiveFailures = 0;
      circuitProbeMode = false;
      console.log('[WALLET-TRACKER] Circuit breaker CLOSED. Resuming.');
      totalNewTrades += probeCount;
    } catch {
      consecutiveFailures += 1;
      circuitOpenUntil = Date.now() + 60000;
      console.error('[WALLET-TRACKER] Circuit breaker OPEN. Pausing 60s.');
      pollInFlight = false;
      return;
    }
  }

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(w => pollSingleWallet(w as TrackedWallet))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        totalNewTrades += result.value;
      } else {
        consecutiveFailures += 1;
      }
    }

    if (consecutiveFailures >= 5) {
      circuitOpenUntil = Date.now() + 60000;
      circuitProbeMode = true;
      console.error('[WALLET-TRACKER] Circuit breaker OPEN. Pausing 60s.');
      pollInFlight = false;
      return;
    }
  }

  if (consecutiveFailures > 0 && totalNewTrades >= 0) {
    consecutiveFailures = 0;
  }

  lastPollTime = new Date().toISOString();
  const elapsed = Date.now() - cycleStart;
  if (totalNewTrades > 0) {
    console.log(`[WALLET-TRACKER] Cycle complete: ${totalNewTrades} new trades (${elapsed}ms)`);
  }
  pollInFlight = false;
}

// ============================================================
// Poll a single wallet for new trades
// ============================================================
async function pollSingleWallet(wallet: TrackedWallet): Promise<number> {
  const lastCheck = lastCheckTimestamps.get(wallet.address);

  // --- Fetch trades from Polymarket Data API ---
  const trades = await getWalletTrades({
    walletAddress: wallet.address,
    limit: 20,
    after: lastCheck,
  });

  if (!trades.length) return 0;

  // --- Deduplicate against existing trades in DB ---
  const tradeIds = trades
    .map(t => t.id)
    .filter(Boolean);

  const { data: existing } = await supabase
    .from('wallet_trades')
    .select('polymarket_trade_id')
    .in('polymarket_trade_id', tradeIds);

  const existingIds = new Set((existing || []).map(e => e.polymarket_trade_id));
  const newTrades = trades.filter(t => t.id && !existingIds.has(t.id));

  if (newTrades.length === 0) return 0;

  // --- Enrich with market metadata and insert ---
  const records: NewTradeRecord[] = [];
  for (const trade of newTrades) {
    // Determine outcome from token_id (fetch market if needed)
    let marketQuestion = '';
    let marketSlug = '';
    let outcome = trade.outcome || 'Unknown';

    if (trade.market) {
      const market = await getMarketByCondition(trade.market);
      if (market) {
        marketQuestion = market.question;
        marketSlug = market.slug;
        const matchingToken = market.tokens.find(t => t.token_id === trade.asset_id);
        if (matchingToken) outcome = matchingToken.outcome;
      }
    }

    records.push({
      wallet_id: wallet.id,
      wallet_address: wallet.address,
      market_slug: marketSlug,
      condition_id: trade.market || '',
      token_id: trade.asset_id || '',
      outcome,
      side: trade.side,
      price: parseFloat(trade.price) || 0,
      size: parseFloat(trade.size) || 0,
      total_cost: (parseFloat(trade.price) || 0) * (parseFloat(trade.size) || 0),
      polymarket_trade_id: trade.id,
      transaction_hash: trade.transaction_hash || '',
      market_question: marketQuestion,
      traded_at: normalizeTradeTimestamp(trade.timestamp),
    });
  }

  // --- Insert into Supabase ---
  const { error: insertErr } = await supabase
    .from('wallet_trades')
    .insert(records);

  if (insertErr) {
    console.error(`[WALLET-TRACKER] Insert error for ${wallet.label}:`, insertErr.message);
    throw new Error(`Insert error for ${wallet.label}: ${insertErr.message}`);
  }

  // --- Update last check timestamp ---
  const latestTimestamp = newTrades
    .map(t => t.timestamp)
    .filter(Boolean)
    .sort()
    .pop();
  if (latestTimestamp) {
    lastCheckTimestamps.set(wallet.address, latestTimestamp);
  }

  // --- Emit event for convergence detector ---
  console.log(`[WALLET-TRACKER] ${wallet.label}: ${newTrades.length} new trades`);
  walletEvents.emit('new_trades', {
    wallet,
    trades: records,
    count: records.length,
  });

  return records.length;
}

// ============================================================
// Manual wallet management
// ============================================================
export async function addWallet(address: string, label: string, tier = 'B'): Promise<void> {
  const { error } = await supabase
    .from('tracked_wallets')
    .upsert({ address: address.toLowerCase(), label, tier, is_active: true }, { onConflict: 'address' });

  if (error) {
    console.error('[WALLET-TRACKER] Add wallet error:', error.message);
    throw new Error(error.message);
  }

  console.log(`[WALLET-TRACKER] Added wallet: ${label} (${address.slice(0, 8)}...)`);
}

export async function getActiveWallets(): Promise<TrackedWallet[]> {
  const { data } = await supabase
    .from('tracked_wallets')
    .select('*')
    .eq('is_active', true)
    .order('tier', { ascending: true });
  return (data || []) as TrackedWallet[];
}
