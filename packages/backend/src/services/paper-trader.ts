// ============================================================
// CORTEX-PM: Paper Trading Engine
// Opens simulated positions on convergence signals.
// Tracks P&L, stop-loss, take-profit.
//
// Paper trades DO NOT submit orders to Polymarket.
// They simulate entry at detection price and track outcomes.
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { getMidpoint } from './polymarket.js';

let supabase: SupabaseClient;
let updateInterval: ReturnType<typeof setInterval> | null = null;

export function initPaperTrader(): void {
  supabase = createClient(config.supabase.url, config.supabase.serviceKey);
  console.log('[PAPER-TRADER] Initialized');
}

export function startPaperTrader(): void {
  if (!config.paperTrading.enabled) {
    console.log('[PAPER-TRADER] Disabled in config');
    return;
  }
  console.log('[PAPER-TRADER] Starting position monitor (60s interval)');
  updateInterval = setInterval(updateOpenPositions, 60000);
}

export function stopPaperTrader(): void {
  if (updateInterval) clearInterval(updateInterval);
  console.log('[PAPER-TRADER] Stopped');
}

// ============================================================
// Open a paper trade from a convergence event
// ============================================================
export async function openPaperTrade(event: any, currentPrice: number): Promise<void> {
  const sizeUsd = config.paperTrading.defaultSizeUsd;
  const shares = sizeUsd / currentPrice;
  const stopLoss = currentPrice * (1 - config.paperTrading.stopLossPct / 100);
  const takeProfit = currentPrice + (1 - currentPrice) * (config.paperTrading.takeProfitPct / 100);

  const trade = {
    convergence_event_id: event.id,
    market_slug: event.market_slug,
    market_question: event.market_question,
    outcome: event.outcome,
    side: 'BUY',
    entry_price: currentPrice,
    shares,
    cost_basis: sizeUsd,
    current_price: currentPrice,
    unrealized_pnl: 0,
    stop_loss: Math.max(0, stopLoss),
    take_profit: Math.min(1, takeProfit),
    status: 'OPEN',
    signal_score: event.signal_score,
    wallet_count: event.wallet_count,
  };

  const { error } = await supabase.from('paper_trades').insert(trade);

  if (error) {
    console.error('[PAPER-TRADER] Open trade error:', error.message);
    return;
  }

  console.log(`[PAPER-TRADER] ◆ OPENED: ${event.outcome} on "${event.market_question}"`);
  console.log(`  Entry: $${currentPrice.toFixed(3)} | Size: ${shares.toFixed(1)} shares ($${sizeUsd})`);
  console.log(`  SL: $${stopLoss.toFixed(3)} | TP: $${takeProfit.toFixed(3)}`);
}

// ============================================================
// Update all open positions with current prices
// ============================================================
export async function updateOpenPositions(): Promise<void> {
  const { data: positions, error } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('status', 'OPEN');

  if (error || !positions || positions.length === 0) return;

  console.log(`[PAPER-TRADER] Updating ${positions.length} open positions`);

  for (const pos of positions) {
    // --- Get current price from Polymarket ---
    // Need to look up the token_id from the convergence event
    const { data: event } = await supabase
      .from('convergence_events')
      .select('token_id')
      .eq('id', pos.convergence_event_id)
      .single();

    if (!event?.token_id) continue;

    const currentPrice = await getMidpoint(event.token_id);
    if (currentPrice === null) continue;

    const unrealizedPnl = (currentPrice - pos.entry_price) * pos.shares;
    const pnlPct = ((currentPrice - pos.entry_price) / pos.entry_price) * 100;
    const updates: Record<string, any> = {
      current_price: currentPrice,
      unrealized_pnl: unrealizedPnl,
      pnl_percentage: pnlPct,
      updated_at: new Date().toISOString(),
    };

    // --- Check stop-loss ---
    if (currentPrice <= pos.stop_loss) {
      updates.status = 'CLOSED';
      updates.exit_price = currentPrice;
      updates.realized_pnl = unrealizedPnl;
      updates.close_reason = 'stop_loss';
      updates.closed_at = new Date().toISOString();
      console.log(`[PAPER-TRADER] STOPPED OUT: "${pos.market_question}" PnL: $${unrealizedPnl.toFixed(2)}`);
    }

    // --- Check take-profit ---
    if (currentPrice >= pos.take_profit) {
      updates.status = 'CLOSED';
      updates.exit_price = currentPrice;
      updates.realized_pnl = unrealizedPnl;
      updates.close_reason = 'take_profit';
      updates.closed_at = new Date().toISOString();
      console.log(`[PAPER-TRADER] TAKE PROFIT: "${pos.market_question}" PnL: $${unrealizedPnl.toFixed(2)}`);
    }

    // --- Check market resolution (price at 0 or 1) ---
    if (currentPrice >= 0.98 || currentPrice <= 0.02) {
      const resolution = currentPrice >= 0.98 ? 1 : 0;
      const realizedPnl = (resolution - pos.entry_price) * pos.shares;
      updates.status = 'CLOSED';
      updates.exit_price = resolution;
      updates.realized_pnl = realizedPnl;
      updates.close_reason = 'resolution';
      updates.closed_at = new Date().toISOString();
      console.log(`[PAPER-TRADER] RESOLVED: "${pos.market_question}" PnL: $${realizedPnl.toFixed(2)}`);
    }

    await supabase.from('paper_trades').update(updates).eq('id', pos.id);
  }
}

// ============================================================
// Get portfolio summary
// ============================================================
export async function getPortfolioSummary(): Promise<any> {
  const { data: stats } = await supabase
    .from('paper_trade_stats')
    .select('*')
    .single();

  const { data: openPositions } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('status', 'OPEN')
    .order('opened_at', { ascending: false });

  const { data: recentClosed } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('status', 'CLOSED')
    .order('closed_at', { ascending: false })
    .limit(20);

  return {
    stats: stats || {},
    openPositions: openPositions || [],
    recentClosed: recentClosed || [],
  };
}
