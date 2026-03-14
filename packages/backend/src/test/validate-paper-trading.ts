import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { getMidpoint } from '../services/polymarket.js';
import { initPaperTrader, openPaperTrade, updateOpenPositions, getPortfolioSummary } from '../services/paper-trader.js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DATA_API = process.env.DATA_API_URL || 'https://data-api.polymarket.com';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[TEST-PAPER] FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function log(...args: any[]) {
  console.log('[TEST-PAPER]', ...args);
}

async function findLiveSeed() {
  const res = await fetch(`${DATA_API}/trades?limit=25`);
  if (!res.ok) throw new Error(`Data API failed: ${res.status}`);
  const data = await res.json();
  const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  for (const t of rows) {
    const tokenId = t?.asset;
    const marketSlug = t?.slug;
    const question = t?.title;
    if (!tokenId || !marketSlug || !question) continue;
    const mid = await getMidpoint(String(tokenId));
    if (mid !== null && Number.isFinite(mid) && mid > 0 && mid < 1) {
      return {
        tokenId: String(tokenId),
        marketSlug: String(marketSlug),
        question: String(question),
        outcome: String(t?.outcome || 'Yes'),
        midpoint: mid,
        conditionId: String(t?.conditionId || ''),
      };
    }
  }
  return null;
}

async function main() {
  log('Starting validate-paper-trading...');

  const seed = await findLiveSeed();
  if (!seed) {
    log('No live token with midpoint found. Aborting.');
    process.exit(1);
  }

  log('Live seed selected:', JSON.stringify(seed));

  // Create test convergence event (real token + real market)
  const manualEvent = {
    market_slug: seed.marketSlug,
    condition_id: seed.conditionId,
    token_id: seed.tokenId,
    market_question: seed.question,
    outcome: seed.outcome,
    wallet_count: 3,
    wallet_addresses: ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333'],
    wallet_labels: ['test_whale_01', 'test_whale_02', 'test_whale_03'],
    total_buy_usd: 300,
    avg_entry_price: seed.midpoint,
    signal_score: 75,
    score_breakdown: { wallet_quality: 20, size_signal: 20, speed_signal: 15, consensus: 20 },
    price_at_detection: seed.midpoint,
    outcome_result: 'PENDING',
    first_trade_at: new Date().toISOString(),
    last_trade_at: new Date().toISOString(),
    detected_at: new Date().toISOString(),
  };

  const { data: insertedEvent, error: eventErr } = await supabase
    .from('convergence_events')
    .insert(manualEvent)
    .select('*')
    .single();

  if (eventErr || !insertedEvent) {
    throw new Error(`Failed to insert test convergence event: ${eventErr?.message}`);
  }

  initPaperTrader();

  // 2) call openPaperTrade
  await openPaperTrade(insertedEvent, seed.midpoint);

  // 3) verify row inserted
  const { data: openRows, error: openErr } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('convergence_event_id', insertedEvent.id)
    .order('opened_at', { ascending: false })
    .limit(1);

  if (openErr || !openRows || openRows.length === 0) {
    throw new Error(`Paper trade row missing after openPaperTrade: ${openErr?.message}`);
  }

  const trade = openRows[0]!;
  log('Opened trade details:', JSON.stringify({
    id: trade.id,
    entry_price: trade.entry_price,
    shares: trade.shares,
    cost_basis: trade.cost_basis,
    stop_loss: trade.stop_loss,
    take_profit: trade.take_profit,
    status: trade.status,
  }));

  // 5) verify math
  const defaultSizeUsd = 100;
  const expectedShares = defaultSizeUsd / seed.midpoint;
  const expectedCostBasis = defaultSizeUsd;
  const expectedSL = seed.midpoint * 0.85;
  const expectedTP = seed.midpoint + (1 - seed.midpoint) * 0.30;

  const closeEnough = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

  log('Math check shares', trade.shares, 'expected', expectedShares);
  log('Math check cost_basis', trade.cost_basis, 'expected', expectedCostBasis);
  log('Math check stop_loss', trade.stop_loss, 'expected', expectedSL);
  log('Math check take_profit', trade.take_profit, 'expected', expectedTP);

  if (!closeEnough(Number(trade.shares), expectedShares, 1e-3)) throw new Error('shares math mismatch');
  if (!closeEnough(Number(trade.cost_basis), expectedCostBasis, 1e-3)) throw new Error('cost_basis math mismatch');
  if (!closeEnough(Number(trade.stop_loss), expectedSL, 1e-3)) throw new Error('stop_loss math mismatch');
  if (!closeEnough(Number(trade.take_profit), expectedTP, 1e-3)) throw new Error('take_profit math mismatch');

  // 6) simulate live update using real midpoint + updateOpenPositions()
  const livePrice = await getMidpoint(seed.tokenId);
  if (livePrice === null) throw new Error('live midpoint unavailable for update test');

  const expectedUnrealized = (livePrice - trade.entry_price) * trade.shares;
  log('Live midpoint for update:', livePrice, 'expected unrealized:', expectedUnrealized);

  await updateOpenPositions();

  const { data: updatedRows, error: updErr } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('id', trade.id)
    .single();

  if (updErr || !updatedRows) throw new Error(`Failed to read updated trade: ${updErr?.message}`);

  log('Updated trade snapshot:', JSON.stringify({
    current_price: updatedRows.current_price,
    unrealized_pnl: updatedRows.unrealized_pnl,
    status: updatedRows.status,
  }));

  // verify (status may auto-close if sl/tp hit; still should have updated price/pnl fields)
  if (updatedRows.current_price === null || updatedRows.current_price === undefined) {
    throw new Error('current_price not updated');
  }

  // 7) verify paper_trade_stats view
  const { data: stats, error: statsErr } = await supabase
    .from('paper_trade_stats')
    .select('*')
    .single();

  if (statsErr) throw new Error(`paper_trade_stats query failed: ${statsErr.message}`);
  log('paper_trade_stats:', JSON.stringify(stats));

  // 8) cleanup: mark test trade closed
  const { error: closeErr } = await supabase
    .from('paper_trades')
    .update({ status: 'CLOSED', close_reason: 'test', closed_at: new Date().toISOString() })
    .eq('id', trade.id);

  if (closeErr) throw new Error(`Failed to close test trade: ${closeErr.message}`);
  log('Test trade closed with close_reason=test:', trade.id);

  // 9) verify portfolio summary includes recentClosed
  const portfolio = await getPortfolioSummary();
  const foundClosed = (portfolio?.recentClosed || []).some((t: any) => t.id === trade.id);
  log('Portfolio summary recentClosed contains test trade:', foundClosed);
  if (!foundClosed) throw new Error('Portfolio summary does not include closed test trade');

  // full cleanup: delete paper trade row, then convergence event row (FK-safe)
  const { error: delTradeErr } = await supabase
    .from('paper_trades')
    .delete()
    .eq('id', trade.id);
  if (delTradeErr) {
    log('Warning: failed to delete test paper_trade:', delTradeErr.message);
  } else {
    log('Deleted test paper_trade:', trade.id);
  }

  const { error: delEventErr } = await supabase
    .from('convergence_events')
    .delete()
    .eq('id', insertedEvent.id);
  if (delEventErr) {
    log('Warning: failed to delete test convergence_event:', delEventErr.message);
  } else {
    log('Deleted test convergence_event:', insertedEvent.id);
  }

  log('validate-paper-trading complete');
}

main().catch((err) => {
  console.error('[TEST-PAPER] Fatal:', err);
  process.exitCode = 1;
});
