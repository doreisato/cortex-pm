-- ============================================================
-- CORTEX-PM: Supabase Schema
-- Convergence Oracle for Real-Time Edge Extraction
-- Prediction Markets Edition
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- TRACKED WALLETS
-- Whale/smart money wallets we monitor on Polymarket
-- ============================================================
CREATE TABLE tracked_wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- NOTE: Use the PROXY address from Polymarket, not the EOA
  address TEXT NOT NULL UNIQUE,
  label TEXT,                          -- human-readable name: "whale_1", "insider_fed"
  tier TEXT DEFAULT 'B',               -- A/B/C ranking by win rate
  win_rate NUMERIC DEFAULT 0,          -- rolling win rate percentage
  total_trades INTEGER DEFAULT 0,
  total_pnl NUMERIC DEFAULT 0,
  category TEXT,                       -- "politics", "crypto", "sports", "macro"
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups during polling
CREATE INDEX idx_wallets_active ON tracked_wallets(is_active) WHERE is_active = true;
CREATE INDEX idx_wallets_address ON tracked_wallets(address);


-- ============================================================
-- WALLET TRADES
-- Raw trade data from tracked wallets via Polymarket Data API
-- ============================================================
CREATE TABLE wallet_trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id UUID REFERENCES tracked_wallets(id),
  wallet_address TEXT NOT NULL,
  -- Polymarket-specific fields
  market_slug TEXT,                    -- e.g. "will-fed-cut-rates-march"
  condition_id TEXT,                   -- Polymarket condition ID
  token_id TEXT,                       -- outcome token ID
  outcome TEXT,                        -- "Yes" or "No"
  side TEXT NOT NULL,                  -- "BUY" or "SELL"
  price NUMERIC NOT NULL,             -- price paid per share (0.00-1.00)
  size NUMERIC NOT NULL,              -- number of shares
  total_cost NUMERIC,                 -- price * size in USDC
  -- Metadata
  polymarket_trade_id TEXT UNIQUE,    -- dedup key from Data API
  transaction_hash TEXT,
  market_question TEXT,               -- "Will the Fed cut rates in March?"
  market_end_date TIMESTAMPTZ,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  traded_at TIMESTAMPTZ NOT NULL
);

-- Index for convergence detection: find recent buys by token
CREATE INDEX idx_trades_token_time ON wallet_trades(token_id, traded_at DESC);
CREATE INDEX idx_trades_market_time ON wallet_trades(market_slug, traded_at DESC);
CREATE INDEX idx_trades_wallet ON wallet_trades(wallet_id, traded_at DESC);
CREATE INDEX idx_trades_dedup ON wallet_trades(polymarket_trade_id);


-- ============================================================
-- CONVERGENCE EVENTS
-- Core signal: 3+ wallets buying same outcome within time window
-- ============================================================
CREATE TABLE convergence_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Market identification
  market_slug TEXT NOT NULL,
  condition_id TEXT,
  token_id TEXT,
  market_question TEXT,
  outcome TEXT,                        -- "Yes" or "No"
  -- Convergence metrics
  wallet_count INTEGER NOT NULL,       -- how many wallets converged
  wallet_addresses TEXT[] NOT NULL,    -- array of participating wallets
  wallet_labels TEXT[],               -- human-readable labels
  total_buy_usd NUMERIC,             -- total USDC committed
  avg_entry_price NUMERIC,           -- weighted average entry
  -- Signal scoring (0-100)
  signal_score INTEGER DEFAULT 0,
  score_breakdown JSONB,              -- { wallet_quality, size, speed, consensus }
  -- Price tracking
  price_at_detection NUMERIC,         -- market price when convergence detected
  price_15m NUMERIC,                  -- price 15 min later
  price_1h NUMERIC,                   -- price 1 hour later
  price_4h NUMERIC,                   -- price 4 hours later
  price_24h NUMERIC,                  -- price 24 hours later
  price_at_resolution NUMERIC,        -- final settlement price (0 or 1)
  -- Outcome tracking
  outcome_result TEXT,                -- "WIN", "LOSS", "PENDING", "EXPIRED"
  max_price_after NUMERIC,           -- highest price reached after detection
  min_price_after NUMERIC,           -- lowest price reached after detection
  pnl_if_held NUMERIC,              -- P&L if held to resolution
  pnl_at_peak NUMERIC,              -- P&L at peak price
  -- Sentiment layer (BettaFish integration, future)
  sentiment_score NUMERIC,           -- -1 to 1
  sentiment_narrative TEXT,
  -- Timestamps
  first_trade_at TIMESTAMPTZ,        -- earliest trade in the convergence window
  last_trade_at TIMESTAMPTZ,         -- latest trade in the convergence window
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_convergence_time ON convergence_events(detected_at DESC);
CREATE INDEX idx_convergence_market ON convergence_events(market_slug, detected_at DESC);
CREATE INDEX idx_convergence_outcome ON convergence_events(outcome_result);
CREATE INDEX idx_convergence_score ON convergence_events(signal_score DESC);


-- ============================================================
-- PAPER TRADES
-- Simulated trades opened on convergence signals
-- ============================================================
CREATE TABLE paper_trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  convergence_event_id UUID REFERENCES convergence_events(id),
  -- Position details
  market_slug TEXT NOT NULL,
  market_question TEXT,
  outcome TEXT NOT NULL,               -- "Yes" or "No"
  side TEXT DEFAULT 'BUY',
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC,
  shares NUMERIC NOT NULL,            -- position size in shares
  cost_basis NUMERIC NOT NULL,        -- entry_price * shares
  -- P&L
  current_price NUMERIC,
  unrealized_pnl NUMERIC DEFAULT 0,
  realized_pnl NUMERIC,
  pnl_percentage NUMERIC,
  -- Risk management
  stop_loss NUMERIC,
  take_profit NUMERIC,
  -- Status
  status TEXT DEFAULT 'OPEN',         -- OPEN, CLOSED, STOPPED, EXPIRED
  close_reason TEXT,                  -- "take_profit", "stop_loss", "manual", "resolution"
  -- Signal context
  signal_score INTEGER,
  wallet_count INTEGER,
  -- Timestamps
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_paper_status ON paper_trades(status);
CREATE INDEX idx_paper_time ON paper_trades(opened_at DESC);


-- ============================================================
-- MARKET SNAPSHOTS
-- Periodic snapshots of active markets for trend analysis
-- ============================================================
CREATE TABLE market_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_slug TEXT NOT NULL,
  condition_id TEXT,
  question TEXT,
  -- Pricing
  yes_price NUMERIC,
  no_price NUMERIC,
  spread NUMERIC,                    -- ask - bid
  volume_24h NUMERIC,
  liquidity NUMERIC,
  -- Metadata
  end_date TIMESTAMPTZ,
  category TEXT,
  active BOOLEAN DEFAULT true,
  snapshot_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_snapshots_market ON market_snapshots(market_slug, snapshot_at DESC);


-- ============================================================
-- SYSTEM CONFIG
-- Runtime configuration for the engine
-- ============================================================
CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default config
INSERT INTO system_config (key, value) VALUES
  ('convergence', '{"window_minutes": 10, "min_wallets": 3, "min_score": 60}'),
  ('paper_trading', '{"enabled": true, "default_size_usd": 100, "stop_loss_pct": 15, "take_profit_pct": 30}'),
  ('polling', '{"wallet_interval_ms": 10000, "price_interval_ms": 300000, "market_interval_ms": 600000}'),
  ('alerts', '{"telegram_enabled": true, "min_score_alert": 50}');


-- ============================================================
-- VIEWS for dashboard queries
-- ============================================================

-- Active convergence stats
CREATE OR REPLACE VIEW convergence_stats AS
SELECT
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE outcome_result = 'WIN') as wins,
  COUNT(*) FILTER (WHERE outcome_result = 'LOSS') as losses,
  COUNT(*) FILTER (WHERE outcome_result = 'PENDING') as pending,
  ROUND(
    COUNT(*) FILTER (WHERE outcome_result = 'WIN')::NUMERIC /
    NULLIF(COUNT(*) FILTER (WHERE outcome_result IN ('WIN', 'LOSS')), 0) * 100,
    1
  ) as win_rate,
  ROUND(AVG(pnl_if_held) FILTER (WHERE outcome_result IN ('WIN', 'LOSS')), 2) as avg_pnl,
  ROUND(AVG(signal_score), 1) as avg_score
FROM convergence_events;

-- Paper trading P&L summary
CREATE OR REPLACE VIEW paper_trade_stats AS
SELECT
  COUNT(*) as total_trades,
  COUNT(*) FILTER (WHERE status = 'OPEN') as open_trades,
  COUNT(*) FILTER (WHERE status = 'CLOSED' AND realized_pnl > 0) as winning_trades,
  COUNT(*) FILTER (WHERE status = 'CLOSED' AND realized_pnl <= 0) as losing_trades,
  ROUND(SUM(realized_pnl) FILTER (WHERE status = 'CLOSED'), 2) as total_realized_pnl,
  ROUND(SUM(unrealized_pnl) FILTER (WHERE status = 'OPEN'), 2) as total_unrealized_pnl,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'CLOSED' AND realized_pnl > 0)::NUMERIC /
    NULLIF(COUNT(*) FILTER (WHERE status = 'CLOSED'), 0) * 100,
    1
  ) as win_rate
FROM paper_trades;


-- ============================================================
-- ROW LEVEL SECURITY (optional, enable if public access needed)
-- ============================================================
-- ALTER TABLE tracked_wallets ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE wallet_trades ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE convergence_events ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE paper_trades ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- REALTIME (enable for live dashboard updates)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE convergence_events;
ALTER PUBLICATION supabase_realtime ADD TABLE paper_trades;
ALTER PUBLICATION supabase_realtime ADD TABLE wallet_trades;
