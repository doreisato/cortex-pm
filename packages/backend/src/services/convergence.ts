// ============================================================
// CORTEX-PM: Convergence Detector
// Core signal engine. Detects when 3+ tracked wallets buy the
// same outcome on the same market within a configurable time window.
//
// Signal scoring (0-100):
//   wallet_quality (0-30): avg tier of participating wallets
//   size_signal   (0-25): total USD committed
//   speed_signal  (0-20): how fast wallets converged
//   consensus     (0-25): wallet count above minimum
//
// Runs on a loop. Also triggered by wallet-tracker events.
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { getMidpoint } from './polymarket.js';
import { walletEvents } from './wallet-tracker.js';
import { openPaperTrade } from './paper-trader.js';
import { sendConvergenceAlert } from './telegram.js';
import { analyzeSentiment } from './sentiment.js';
import { getHistoricalInsight } from './insight.js';
import { EventEmitter } from 'events';

export const convergenceEvents = new EventEmitter();

let supabase: SupabaseClient;
let detectInterval: ReturnType<typeof setInterval> | null = null;
let priceTrackInterval: ReturnType<typeof setInterval> | null = null;

// ============================================================
// Initialize
// ============================================================
export function initConvergenceDetector(): void {
  supabase = createClient(config.supabase.url, config.supabase.serviceKey);

  // --- Listen for new trades from wallet tracker ---
  walletEvents.on('new_trades', () => {
    // Run detection immediately when new trades arrive
    detectConvergence();
  });

  console.log('[CONVERGENCE] Initialized');
}

// ============================================================
// Start detection + price tracking loops
// ============================================================
export function startDetection(): void {
  console.log('[CONVERGENCE] Starting detection loop (30s interval)');
  detectConvergence(); // run immediately
  detectInterval = setInterval(detectConvergence, 30000);

  console.log(`[CONVERGENCE] Starting price tracker (${config.polling.priceTrackIntervalMs}ms interval)`);
  priceTrackInterval = setInterval(trackPrices, config.polling.priceTrackIntervalMs);
}

export function stopDetection(): void {
  if (detectInterval) clearInterval(detectInterval);
  if (priceTrackInterval) clearInterval(priceTrackInterval);
  console.log('[CONVERGENCE] Stopped');
}

// ============================================================
// Core detection algorithm
// ============================================================
async function detectConvergence(): Promise<void> {
  const windowMs = config.convergence.windowMinutes * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs).toISOString();

  // --- 1. Get recent BUY trades within the convergence window ---
  const { data: recentTrades, error } = await supabase
    .from('wallet_trades')
    .select('*, tracked_wallets!inner(label, tier)')
    .eq('side', 'BUY')
    .gte('traded_at', cutoff)
    .order('traded_at', { ascending: false });

  if (error || !recentTrades) {
    console.error('[CONVERGENCE] Query error:', error?.message);
    return;
  }

  if (recentTrades.length === 0) return;

  // --- 2. Group trades by token_id (same outcome on same market) ---
  const groups = new Map<string, typeof recentTrades>();

  for (const trade of recentTrades) {
    const key = trade.token_id;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(trade);
  }

  // --- 3. Find groups with enough unique wallets ---
  for (const [tokenId, trades] of groups) {
    const uniqueWallets = new Map<string, typeof trades[0]>();
    for (const trade of trades) {
      if (!uniqueWallets.has(trade.wallet_address)) {
        uniqueWallets.set(trade.wallet_address, trade);
      }
    }

    const walletCount = uniqueWallets.size;
    if (walletCount < config.convergence.minWallets) continue;

    // --- 4. Check if we already detected this convergence ---
    const walletAddresses = Array.from(uniqueWallets.keys()).sort();
    const { data: existing } = await supabase
      .from('convergence_events')
      .select('id')
      .eq('token_id', tokenId)
      .gte('detected_at', cutoff)
      .limit(1);

    if (existing && existing.length > 0) continue; // already detected

    // --- 5. Calculate signal score ---
    const walletLabels = trades.map(t => (t as any).tracked_wallets?.label || 'unknown');
    const walletTiers = trades.map(t => (t as any).tracked_wallets?.tier || 'C');
    const totalBuyUsd = trades.reduce((sum, t) => sum + (t.total_cost || 0), 0);
    const avgEntryPrice = trades.reduce((sum, t) => sum + t.price, 0) / trades.length;

    const score = calculateSignalScore({
      walletCount,
      walletTiers: Array.from(new Set(walletTiers)),
      totalBuyUsd,
      trades,
    });

    if (score < config.convergence.minScore) {
      console.log(`[CONVERGENCE] Signal below threshold: ${score} < ${config.convergence.minScore} (${tokenId.slice(0, 8)}...)`);
      continue;
    }

    // --- 6. Get current market price ---
    const currentPrice = await getMidpoint(tokenId);

    // --- 7. Get first trade's market info for context ---
    const firstTrade = trades[0];

    // --- 8. Insert convergence event ---
    const event = {
      market_slug: firstTrade.market_slug || '',
      condition_id: firstTrade.condition_id || '',
      token_id: tokenId,
      market_question: firstTrade.market_question || '',
      outcome: firstTrade.outcome || 'Unknown',
      wallet_count: walletCount,
      wallet_addresses: walletAddresses,
      wallet_labels: Array.from(new Set(walletLabels)),
      total_buy_usd: totalBuyUsd,
      avg_entry_price: avgEntryPrice,
      signal_score: score,
      score_breakdown: {
        wallet_quality: scoreWalletQuality(walletTiers),
        size_signal: scoreSizeSignal(totalBuyUsd),
        speed_signal: scoreSpeedSignal(trades),
        consensus: scoreConsensus(walletCount),
      },
      price_at_detection: currentPrice,
      outcome_result: 'PENDING',
      first_trade_at: trades[trades.length - 1]?.traded_at,
      last_trade_at: trades[0]?.traded_at,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('convergence_events')
      .insert(event)
      .select()
      .single();

    if (insertErr) {
      console.error('[CONVERGENCE] Insert error:', insertErr.message);
      continue;
    }

    console.log(`[CONVERGENCE] ◆ NEW SIGNAL: ${firstTrade.market_question}`);
    console.log(`  Wallets: ${walletCount} | Score: ${score} | Price: $${currentPrice}`);
    console.log(`  Outcome: ${firstTrade.outcome} | USD: $${totalBuyUsd.toFixed(2)}`);

    // --- 9. Emit event for downstream consumers ---
    convergenceEvents.emit('convergence', inserted);

    // --- 9.5 Layer 2 sentiment enrichment (non-blocking) ---
    // Event already exists; failures here should never block the core pipeline.
    let enrichedEvent: any = inserted;
    try {
      const sentiment = await analyzeSentiment({
        marketQuestion: inserted.market_question || firstTrade.market_question || '',
        outcome: inserted.outcome || firstTrade.outcome || 'Unknown',
        currentPrice: Number(currentPrice || inserted.price_at_detection || 0),
      });

      const { error: sErr } = await supabase
        .from('convergence_events')
        .update({
          sentiment_score: sentiment.score,
          sentiment_narrative: sentiment.narrative,
        })
        .eq('id', inserted.id);

      if (!sErr) {
        enrichedEvent = {
          ...inserted,
          sentiment_score: sentiment.score,
          sentiment_narrative: sentiment.narrative,
        };
      } else {
        console.error('[CONVERGENCE] Sentiment update error:', sErr.message);
      }
    } catch (err) {
      console.error('[CONVERGENCE] Sentiment analyze error:', (err as Error).message);
    }

    // --- 9.6 Historical insight enrichment (non-blocking) ---
    try {
      const insight = await getHistoricalInsight({
        marketQuestion: enrichedEvent.market_question || firstTrade.market_question || '',
        outcome: enrichedEvent.outcome || firstTrade.outcome || 'Unknown',
        walletCount: Number(enrichedEvent.wallet_count || walletCount || 0),
        signalScore: Number(enrichedEvent.signal_score || score || 0),
      });

      const { error: iErr } = await supabase
        .from('convergence_events')
        .update({ historical_insight: insight })
        .eq('id', inserted.id);

      if (!iErr) {
        enrichedEvent = {
          ...enrichedEvent,
          historical_insight: insight,
        };
      } else {
        console.error('[CONVERGENCE] Historical insight update error:', iErr.message);
      }
    } catch (err) {
      console.error('[CONVERGENCE] Historical insight error:', (err as Error).message);
    }

    // --- 10. Send Telegram alert ---
    await sendConvergenceAlert(enrichedEvent);

    // --- 11. Open paper trade if enabled ---
    if (config.paperTrading.enabled && currentPrice) {
      await openPaperTrade(enrichedEvent, currentPrice);
    }
  }
}


// ============================================================
// Signal scoring functions
// ============================================================

interface ScoreInput {
  walletCount: number;
  walletTiers: string[];
  totalBuyUsd: number;
  trades: any[];
}

function calculateSignalScore(input: ScoreInput): number {
  const wq = scoreWalletQuality(input.walletTiers);
  const ss = scoreSizeSignal(input.totalBuyUsd);
  const sp = scoreSpeedSignal(input.trades);
  const co = scoreConsensus(input.walletCount);
  return Math.min(100, wq + ss + sp + co);
}

/** Wallet quality: A=30, B=20, C=10 — averaged */
function scoreWalletQuality(tiers: string[]): number {
  const tierScores: Record<string, number> = { A: 30, B: 20, C: 10 };
  const avg = tiers.reduce((sum, t) => sum + (tierScores[t] || 10), 0) / tiers.length;
  return Math.round(avg);
}

/** Size signal: more USD committed = stronger signal */
function scoreSizeSignal(totalUsd: number): number {
  if (totalUsd >= 10000) return 25;
  if (totalUsd >= 5000) return 20;
  if (totalUsd >= 1000) return 15;
  if (totalUsd >= 500) return 10;
  return 5;
}

/** Speed: how quickly wallets converged — faster = stronger */
function scoreSpeedSignal(trades: any[]): number {
  if (trades.length < 2) return 10;
  const times = trades.map(t => new Date(t.traded_at).getTime()).sort();
  const spanMs = times[times.length - 1] - times[0];
  const spanMinutes = spanMs / 60000;

  if (spanMinutes <= 2) return 20;
  if (spanMinutes <= 5) return 15;
  if (spanMinutes <= 10) return 10;
  return 5;
}

/** Consensus: more wallets agreeing = stronger signal */
function scoreConsensus(walletCount: number): number {
  if (walletCount >= 6) return 25;
  if (walletCount >= 5) return 20;
  if (walletCount >= 4) return 15;
  if (walletCount >= 3) return 10;
  return 5;
}


// ============================================================
// Price tracking — update convergence events with price changes
// ============================================================
async function trackPrices(): Promise<void> {
  // --- Get pending events that need price updates ---
  const { data: pending } = await supabase
    .from('convergence_events')
    .select('id, token_id, price_at_detection, detected_at, price_15m, price_1h, price_4h, price_24h')
    .eq('outcome_result', 'PENDING')
    .order('detected_at', { ascending: false })
    .limit(50);

  if (!pending || pending.length === 0) return;

  console.log(`[CONVERGENCE] Tracking prices for ${pending.length} pending events`);

  for (const event of pending) {
    const currentPrice = await getMidpoint(event.token_id);
    if (currentPrice === null) continue;

    const age = Date.now() - new Date(event.detected_at).getTime();
    const ageMinutes = age / 60000;
    const updates: Record<string, any> = {};

    // --- Update price fields based on age ---
    if (ageMinutes >= 15 && !event.price_15m) updates.price_15m = currentPrice;
    if (ageMinutes >= 60 && !event.price_1h) updates.price_1h = currentPrice;
    if (ageMinutes >= 240 && !event.price_4h) updates.price_4h = currentPrice;
    if (ageMinutes >= 1440 && !event.price_24h) updates.price_24h = currentPrice;

    // --- Track max/min prices ---
    updates.max_price_after = currentPrice; // will be max'd in trigger or next iteration
    updates.min_price_after = currentPrice;

    // --- Check if market resolved (price near 0 or 1) ---
    if (currentPrice >= 0.95 || currentPrice <= 0.05) {
      const entryPrice = event.price_at_detection || 0.5;
      const resolution = currentPrice >= 0.95 ? 1 : 0;
      const pnl = resolution - entryPrice;

      updates.price_at_resolution = resolution;
      updates.pnl_if_held = pnl;
      updates.outcome_result = pnl > 0 ? 'WIN' : 'LOSS';
      updates.resolved_at = new Date().toISOString();

      console.log(`[CONVERGENCE] Event resolved: ${event.id.slice(0, 8)}... → ${updates.outcome_result} (PnL: ${pnl.toFixed(3)})`);
    }

    if (Object.keys(updates).length > 0) {
      await supabase
        .from('convergence_events')
        .update(updates)
        .eq('id', event.id);
    }
  }
}
