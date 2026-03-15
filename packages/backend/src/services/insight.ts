// ============================================================
// CORTEX-PM: Historical Insight Service (Layer 2.5)
// Pattern matching over resolved convergence history.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

export interface InsightResult {
  historical_matches: number;
  historical_win_rate: number;
  avg_pnl: number;
  pattern_description: string;
  confidence: number;
}

const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

function keywords(q: string): string[] {
  const k = ['fed', 'btc', 'bitcoin', 'ethereum', 'eth', 'election', 'trump', 'rates', 'inflation'];
  const s = (q || '').toLowerCase();
  return k.filter((x) => s.includes(x));
}

function fallback(desc = 'No historical matches yet'): InsightResult {
  return {
    historical_matches: 0,
    historical_win_rate: 0,
    avg_pnl: 0,
    pattern_description: desc,
    confidence: 0,
  };
}

export async function getHistoricalInsight(params: {
  marketQuestion: string;
  outcome: string;
  walletCount: number;
  signalScore: number;
}): Promise<InsightResult> {
  try {
    const minWallets = Math.max(0, params.walletCount - 2);
    const maxWallets = params.walletCount + 2;
    const minScore = Math.max(0, params.signalScore - 15);
    const maxScore = Math.min(100, params.signalScore + 15);

    const { data, error } = await supabase
      .from('convergence_events')
      .select('id,market_question,outcome,wallet_count,signal_score,outcome_result,pnl_if_held')
      .in('outcome_result', ['WIN', 'LOSS'])
      .eq('outcome', params.outcome)
      .gte('wallet_count', minWallets)
      .lte('wallet_count', maxWallets)
      .gte('signal_score', minScore)
      .lte('signal_score', maxScore)
      .order('detected_at', { ascending: false })
      .limit(200);

    if (error || !data) return fallback('Historical insight unavailable');

    const qk = keywords(params.marketQuestion);
    let filtered = qk.length
      ? data.filter((e: any) => {
          const txt = String(e.market_question || '').toLowerCase();
          return qk.some((k) => txt.includes(k));
        })
      : data;

    // If keyword filter is too strict, fall back to the base similarity set.
    if (filtered.length === 0) filtered = data;
    if (filtered.length === 0) return fallback();

    const wins = filtered.filter((e: any) => e.outcome_result === 'WIN').length;
    const winRate = (wins / filtered.length) * 100;
    const avgPnl = filtered.reduce((s: number, e: any) => s + Number(e.pnl_if_held || 0), 0) / filtered.length;
    const confidence = filtered.length < 5 ? 0.3 : Math.min(1, 0.5 + filtered.length / 50);

    return {
      historical_matches: filtered.length,
      historical_win_rate: Number(winRate.toFixed(1)),
      avg_pnl: Number(avgPnl.toFixed(4)),
      pattern_description: `${wins} of ${filtered.length} similar events were wins`,
      confidence: Number(confidence.toFixed(2)),
    };
  } catch {
    return fallback('Historical insight failed');
  }
}
