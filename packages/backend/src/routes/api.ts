// ============================================================
// CORTEX-PM: API Routes
// REST endpoints for the dashboard frontend.
// All routes are prefixed with /api.
// ============================================================

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { getMarkets, getMidpoint, getOrderBook } from '../services/polymarket.js';
import { addWallet, getActiveWallets } from '../services/wallet-tracker.js';
import { getPortfolioSummary } from '../services/paper-trader.js';

const router = Router();
const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

// ============================================================
// DASHBOARD — Aggregate stats for main view
// ============================================================
router.get('/dashboard', async (_req, res) => {
  try {
    const [
      { data: convergenceStats },
      { data: paperStats },
      { data: recentConvergence },
      { data: openPositions },
      { data: walletCount },
    ] = await Promise.all([
      supabase.from('convergence_stats').select('*').single(),
      supabase.from('paper_trade_stats').select('*').single(),
      supabase.from('convergence_events').select('*').order('detected_at', { ascending: false }).limit(10),
      supabase.from('paper_trades').select('*').eq('status', 'OPEN').order('opened_at', { ascending: false }),
      supabase.from('tracked_wallets').select('id', { count: 'exact' }).eq('is_active', true),
    ]);

    // --- Build equity curve from closed paper trades ---
    const { data: closedTrades } = await supabase
      .from('paper_trades')
      .select('realized_pnl, closed_at')
      .eq('status', 'CLOSED')
      .order('closed_at', { ascending: true });

    let cumulative = 0;
    const equityCurve = (closedTrades || []).map(t => {
      cumulative += t.realized_pnl || 0;
      return { time: t.closed_at, equity: cumulative };
    });

    res.json({
      convergence: convergenceStats || {},
      paperTrading: paperStats || {},
      recentConvergence: recentConvergence || [],
      openPositions: openPositions || [],
      activeWallets: walletCount?.length || 0,
      equityCurve,
    });
  } catch (err) {
    console.error('[API] /dashboard error:', (err as Error).message);
    res.status(500).json({ error: 'Dashboard query failed' });
  }
});


// ============================================================
// CONVERGENCE EVENTS
// ============================================================
router.get('/convergence', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const minScore = parseInt(req.query.min_score as string) || 0;
  const outcome = req.query.outcome as string; // WIN, LOSS, PENDING

  let query = supabase
    .from('convergence_events')
    .select('*')
    .gte('signal_score', minScore)
    .order('detected_at', { ascending: false })
    .limit(limit);

  if (outcome) query = query.eq('outcome_result', outcome);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.get('/convergence/stats', async (_req, res) => {
  const { data, error } = await supabase.from('convergence_stats').select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || {});
});


// ============================================================
// PAPER TRADES
// ============================================================
router.get('/positions', async (_req, res) => {
  try {
    const portfolio = await getPortfolioSummary();
    res.json(portfolio);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/paper-trades', async (req, res) => {
  const status = req.query.status as string || 'OPEN';
  const limit = parseInt(req.query.limit as string) || 50;

  const { data, error } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('status', status)
    .order(status === 'OPEN' ? 'opened_at' : 'closed_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});


// ============================================================
// WALLETS
// ============================================================
router.get('/wallets', async (_req, res) => {
  const wallets = await getActiveWallets();
  res.json(wallets);
});

router.post('/wallets', async (req, res) => {
  const { address, label, tier } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });
  await addWallet(address, label || 'unnamed', tier || 'B');
  res.json({ success: true });
});


// ============================================================
// WALLET TRADES (scanner feed)
// ============================================================
router.get('/trades', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;

  const { data, error } = await supabase
    .from('wallet_trades')
    .select('*, tracked_wallets(label, tier)')
    .order('traded_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});


// ============================================================
// MARKETS — Polymarket live data
// ============================================================
router.get('/markets', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const markets = await getMarkets({ limit, active: true });
  res.json(markets);
});

router.get('/markets/:tokenId/price', async (req, res) => {
  const price = await getMidpoint(req.params.tokenId);
  if (price === null) return res.status(404).json({ error: 'Price not found' });
  res.json({ tokenId: req.params.tokenId, price });
});

router.get('/markets/:tokenId/book', async (req, res) => {
  const book = await getOrderBook(req.params.tokenId);
  if (!book) return res.status(404).json({ error: 'Order book not found' });
  res.json(book);
});


// ============================================================
// SYSTEM CONFIG
// ============================================================
router.get('/config', async (_req, res) => {
  const { data } = await supabase.from('system_config').select('*');
  const configMap: Record<string, any> = {};
  (data || []).forEach(row => { configMap[row.key] = row.value; });
  res.json(configMap);
});

router.put('/config/:key', async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  const { error } = await supabase
    .from('system_config')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;
