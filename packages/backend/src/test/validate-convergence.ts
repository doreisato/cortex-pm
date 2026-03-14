import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { getMidpoint } from '../services/polymarket.js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[TEST-CONVERGENCE] FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type TradeRow = {
  id: string;
  wallet_address: string;
  token_id: string;
  market_slug: string | null;
  condition_id: string | null;
  market_question: string | null;
  outcome: string | null;
  total_cost: number | null;
  price: number;
  traded_at: string;
};

function log(...args: any[]) {
  console.log('[TEST-CONVERGENCE]', ...args);
}

function scoreWalletQuality(tiers: string[]): number {
  const tierScores: Record<string, number> = { A: 30, B: 20, C: 10 };
  const avg = tiers.reduce((sum, t) => sum + (tierScores[t] || 10), 0) / Math.max(1, tiers.length);
  return Math.round(avg);
}

function scoreSizeSignal(totalUsd: number): number {
  if (totalUsd >= 10000) return 25;
  if (totalUsd >= 5000) return 20;
  if (totalUsd >= 1000) return 15;
  if (totalUsd >= 500) return 10;
  return 5;
}

function scoreSpeedSignal(trades: TradeRow[]): number {
  if (trades.length < 2) return 10;
  const times = trades.map((t) => new Date(t.traded_at).getTime()).sort((a, b) => a - b);
  const spanMinutes = (times[times.length - 1]! - times[0]!) / 60000;
  if (spanMinutes <= 2) return 20;
  if (spanMinutes <= 5) return 15;
  if (spanMinutes <= 10) return 10;
  return 5;
}

function scoreConsensus(walletCount: number): number {
  if (walletCount >= 6) return 25;
  if (walletCount >= 5) return 20;
  if (walletCount >= 4) return 15;
  if (walletCount >= 3) return 10;
  return 5;
}

function totalScore(input: { walletTiers: string[]; totalBuyUsd: number; trades: TradeRow[]; walletCount: number }) {
  const wallet_quality = scoreWalletQuality(input.walletTiers);
  const size_signal = scoreSizeSignal(input.totalBuyUsd);
  const speed_signal = scoreSpeedSignal(input.trades);
  const consensus = scoreConsensus(input.walletCount);
  return {
    total: Math.min(100, wallet_quality + size_signal + speed_signal + consensus),
    breakdown: { wallet_quality, size_signal, speed_signal, consensus },
  };
}

async function main() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  log('Cutoff (24h):', cutoff);

  // 1) Pull wallet trades in last 24h
  const { data: trades, error } = await supabase
    .from('wallet_trades')
    .select('id,wallet_address,token_id,market_slug,condition_id,market_question,outcome,total_cost,price,traded_at')
    .gte('traded_at', cutoff)
    .order('traded_at', { ascending: false });

  if (error) {
    log('wallet_trades query failed:', error.message);
    process.exit(1);
  }

  let rows = (trades || []) as TradeRow[];

  // If local ingestion has not yet filled wallet_trades, bootstrap analysis from live Data API
  // for tracked wallets so grouping/scoring validation can still run.
  if (rows.length === 0) {
    log('wallet_trades is empty; bootstrapping synthetic analysis set from Data API for tracked wallets');
    const { data: tracked } = await supabase
      .from('tracked_wallets')
      .select('address')
      .eq('is_active', true)
      .limit(20);

    const synthetic: TradeRow[] = [];
    for (const w of tracked || []) {
      try {
        const res = await fetch(`https://data-api.polymarket.com/trades?user=${w.address}&limit=10`);
        if (!res.ok) continue;
        const data = await res.json();
        const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
        for (const t of arr) {
          const iso = typeof t.timestamp === 'number'
            ? new Date(t.timestamp * 1000).toISOString()
            : (typeof t.timestamp === 'string' ? new Date(Number(t.timestamp) * 1000).toISOString() : new Date().toISOString());
          synthetic.push({
            id: String(t.id || t.transactionHash || `${t.conditionId}-${t.asset}-${t.timestamp}`),
            wallet_address: String(t.proxyWallet || w.address),
            token_id: String(t.asset || ''),
            market_slug: t.slug || null,
            condition_id: t.conditionId || null,
            market_question: t.title || null,
            outcome: t.outcome || null,
            total_cost: Number(t.size || 0) * Number(t.price || 0),
            price: Number(t.price || 0),
            traded_at: iso,
          });
        }
      } catch {
        // continue
      }
    }

    rows = synthetic.filter((r) => r.token_id && r.wallet_address);
    log('Synthetic trade rows loaded:', rows.length);
  }

  const uniqueTokens = new Set(rows.map((t) => t.token_id).filter(Boolean));
  const uniqueWallets = new Set(rows.map((t) => t.wallet_address).filter(Boolean));
  const uniqueMarkets = new Set(rows.map((t) => t.market_slug || t.condition_id || '').filter(Boolean));

  log('Total trades:', rows.length);
  log('Unique tokens:', uniqueTokens.size);
  log('Unique wallets:', uniqueWallets.size);
  log('Unique markets:', uniqueMarkets.size);

  // Issue check A: join with !inner
  const { data: joinProbe, error: joinErr } = await supabase
    .from('wallet_trades')
    .select('id,tracked_wallets!inner(label,tier)')
    .limit(5);

  if (joinErr) {
    log('JOIN PROBE (tracked_wallets!inner) FAILED:', joinErr.message);
  } else {
    log('JOIN PROBE (tracked_wallets!inner) OK: rows=', (joinProbe || []).length);
  }

  // 3) Group by token_id + count unique wallets
  const groups = new Map<string, TradeRow[]>();
  for (const t of rows) {
    if (!t.token_id) continue;
    if (!groups.has(t.token_id)) groups.set(t.token_id, []);
    groups.get(t.token_id)!.push(t);
  }

  const groupSummaries: Array<{
    tokenId: string;
    trades: TradeRow[];
    walletCount: number;
    wallets: string[];
  }> = [];

  for (const [tokenId, gTrades] of groups) {
    const ws = [...new Set(gTrades.map((t) => t.wallet_address).filter(Boolean))];
    if (ws.length >= 2) {
      groupSummaries.push({ tokenId, trades: gTrades, walletCount: ws.length, wallets: ws });
      log('GROUP 2+ wallets:', tokenId.slice(0, 16), 'wallets=', ws.length, 'trades=', gTrades.length);
    }
  }

  groupSummaries.sort((a, b) => b.walletCount - a.walletCount || b.trades.length - a.trades.length);

  // 4) If any 3+ wallets, run full scoring pipeline
  const strong = groupSummaries.filter((g) => g.walletCount >= 3);

  // Load wallet tiers for scoring
  const { data: trackedWallets } = await supabase
    .from('tracked_wallets')
    .select('address,tier,label')
    .in('address', [...uniqueWallets]);
  const tierMap = new Map<string, string>((trackedWallets || []).map((w: any) => [w.address, w.tier || 'C']));

  let scoredTarget: (typeof groupSummaries)[number] | null = null;

  if (strong.length > 0) {
    log('Found real convergence candidates (3+ wallets):', strong.length);
    for (const g of strong.slice(0, 5)) {
      const tiers = g.wallets.map((w) => tierMap.get(w) || 'C');
      const totalBuyUsd = g.trades.reduce((s, t) => s + (t.total_cost || 0), 0);
      const scored = totalScore({ walletTiers: tiers, totalBuyUsd, trades: g.trades, walletCount: g.walletCount });
      log('SCORE', g.tokenId.slice(0, 16), 'wallets=', g.walletCount, 'score=', scored.total, 'breakdown=', JSON.stringify(scored.breakdown));
    }
    scoredTarget = strong[0] || null;
  } else {
    // 5) fallback threshold=2 scoring
    log('No real convergence yet. Lowering threshold to 2 for scoring test.');
    const closest = groupSummaries[0];
    if (closest) {
      const tiers = closest.wallets.map((w) => tierMap.get(w) || 'C');
      const totalBuyUsd = closest.trades.reduce((s, t) => s + (t.total_cost || 0), 0);
      const scored = totalScore({ walletTiers: tiers, totalBuyUsd, trades: closest.trades, walletCount: closest.walletCount });
      log(`No real convergence yet. Closest signal: token=${closest.tokenId.slice(0, 16)} wallets=${closest.walletCount} score=${scored.total}`);
      log('Closest signal breakdown:', JSON.stringify(scored.breakdown));
      scoredTarget = closest;
    } else {
      log('No 2+ wallet groups found in last 24h.');
    }
  }

  // Issue check B: already-detected query (token_id + time)
  if (scoredTarget) {
    const { data: existing, error: existingErr } = await supabase
      .from('convergence_events')
      .select('id,detected_at')
      .eq('token_id', scoredTarget.tokenId)
      .gte('detected_at', cutoff)
      .limit(5);

    if (existingErr) {
      log('already-detected check FAILED:', existingErr.message);
    } else {
      log('already-detected check OK:', (existing || []).length, 'existing events in window for token');
    }

    // Issue check C: midpoint on tracked token
    const midpoint = await getMidpoint(scoredTarget.tokenId);
    if (midpoint === null) {
      log('getMidpoint returned null for top token:', scoredTarget.tokenId.slice(0, 20));
    } else {
      log('getMidpoint OK for top token:', scoredTarget.tokenId.slice(0, 20), 'mid=', midpoint);
    }

    // 6) Insert manual test convergence event, verify stats, cleanup
    const sampleTrade = scoredTarget.trades[0]!;
    const walletLabels = scoredTarget.wallets.map((a) => {
      const row: any = (trackedWallets || []).find((w: any) => w.address === a);
      return row?.label || a.slice(0, 8);
    });

    const manualEvent = {
      market_slug: sampleTrade.market_slug || 'test-market',
      condition_id: sampleTrade.condition_id || '',
      token_id: scoredTarget.tokenId,
      market_question: sampleTrade.market_question || 'TEST: Manual convergence validation',
      outcome: sampleTrade.outcome || 'Yes',
      wallet_count: scoredTarget.walletCount,
      wallet_addresses: scoredTarget.wallets,
      wallet_labels: walletLabels,
      total_buy_usd: scoredTarget.trades.reduce((s, t) => s + (t.total_cost || 0), 0),
      avg_entry_price: scoredTarget.trades.reduce((s, t) => s + (t.price || 0), 0) / Math.max(1, scoredTarget.trades.length),
      signal_score: 75,
      score_breakdown: {
        wallet_quality: 20,
        size_signal: 20,
        speed_signal: 15,
        consensus: 20,
      },
      price_at_detection: midpoint,
      outcome_result: 'PENDING',
      first_trade_at: scoredTarget.trades[scoredTarget.trades.length - 1]?.traded_at,
      last_trade_at: scoredTarget.trades[0]?.traded_at,
      detected_at: new Date().toISOString(),
    };

    const { data: inserted, error: insErr } = await supabase
      .from('convergence_events')
      .insert(manualEvent)
      .select('id,detected_at,signal_score')
      .single();

    if (insErr || !inserted) {
      log('Manual convergence insert FAILED:', insErr?.message);
    } else {
      log('Manual convergence insert OK:', inserted.id, 'score=', inserted.signal_score);

      const { data: stats, error: statsErr } = await supabase
        .from('convergence_stats')
        .select('*')
        .limit(1)
        .single();

      if (statsErr) {
        log('convergence_stats view query FAILED:', statsErr.message);
      } else {
        log('convergence_stats view OK:', JSON.stringify(stats));
      }

      const { error: delErr } = await supabase
        .from('convergence_events')
        .delete()
        .eq('id', inserted.id);

      if (delErr) {
        log('Cleanup delete FAILED for test event:', delErr.message);
      } else {
        log('Cleanup delete OK for test event:', inserted.id);
      }
    }
  }

  log('validate-convergence complete');
}

main().catch((err) => {
  console.error('[TEST-CONVERGENCE] Fatal:', err);
  process.exitCode = 1;
});
