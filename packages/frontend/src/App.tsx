// ============================================================
// CORTEX-PM: Main Dashboard Application
// Three-column terminal-style dashboard.
//
// LEFT PANEL:   Balance, metrics, strategy config, neural topology
// CENTER PANEL: Equity curve, convergence signals, trade activity
// RIGHT PANEL:  Positions, live events, global scanner
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { api, type DashboardData, type ConvergenceEvent, type WalletTrade, type PaperTrade, type TrackedWallet } from './lib/api';
import { fmtUsd, fmtPct, fmtPrice, fmtNum, fmtTime, timeAgo, truncate, pnlClass } from './lib/format';
import { useWebSocket, type WSMessage } from './hooks/useWebSocket';
import { EquityCurve } from './components/EquityCurve';
import { NeuralTopology } from './components/NeuralTopology';

type Tab = 'dashboard' | 'strategies' | 'prediction' | 'plasticity';

export default function App() {
  // --- State ---
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [trades, setTrades] = useState<WalletTrade[]>([]);
  const [convergence, setConvergence] = useState<ConvergenceEvent[]>([]);
  const [now, setNow] = useState(new Date());
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [walletAddress, setWalletAddress] = useState('');
  const [walletLabel, setWalletLabel] = useState('');
  const [walletTier, setWalletTier] = useState('B');
  const [savingWallet, setSavingWallet] = useState(false);
  const [cfg, setCfg] = useState({
    window_minutes: 10,
    min_wallets: 3,
    min_score: 60,
    default_size_usd: 100,
    stop_loss_pct: 15,
    take_profit_pct: 30,
  });
  const [savingCfg, setSavingCfg] = useState(false);

  // --- WebSocket for real-time updates ---
  const handleWS = useCallback((msg: WSMessage) => {
    console.log(`[WS] Event: ${msg.type}`, msg.data);
    if (msg.type === 'new_trades') {
      // Prepend new trades to scanner feed
      setTrades(prev => [...(msg.data.trades || []), ...prev].slice(0, 100));
    }
    if (msg.type === 'convergence') {
      // Refresh dashboard on new convergence signal
      loadDashboard();
    }
  }, []);
  const { connected } = useWebSocket(handleWS);

  // --- Data loading ---
  async function loadDashboard() {
    const data = await api.dashboard();
    if (data) {
      console.log('[APP] Dashboard loaded:', data);
      setDashboard(data);
    }
  }

  async function loadTrades() {
    const data = await api.trades(50);
    if (data) setTrades(data);
  }

  async function loadConvergence() {
    const data = await api.convergence(20);
    if (data) setConvergence(data);
  }

  async function loadWallets() {
    const data = await api.wallets();
    if (data) setWallets(data);
  }

  async function loadConfig() {
    const data = await api.config();
    if (!data) return;
    setCfg(prev => ({
      ...prev,
      window_minutes: data.convergence?.window_minutes ?? prev.window_minutes,
      min_wallets: data.convergence?.min_wallets ?? prev.min_wallets,
      min_score: data.convergence?.min_score ?? prev.min_score,
      default_size_usd: data.paper_trading?.default_size_usd ?? prev.default_size_usd,
      stop_loss_pct: data.paper_trading?.stop_loss_pct ?? prev.stop_loss_pct,
      take_profit_pct: data.paper_trading?.take_profit_pct ?? prev.take_profit_pct,
    }));
  }

  async function handleAddWallet(e: any) {
    e.preventDefault();
    if (!walletAddress.trim()) return;
    setSavingWallet(true);
    const res = await api.addWallet(walletAddress.trim(), walletLabel.trim() || 'unnamed', walletTier);
    setSavingWallet(false);
    if (!res?.success) return;
    setWalletAddress('');
    setWalletLabel('');
    setWalletTier('B');
    await Promise.all([loadWallets(), loadDashboard()]);
  }

  async function handleSaveConfig() {
    setSavingCfg(true);
    await Promise.all([
      api.updateConfig('convergence', {
        window_minutes: cfg.window_minutes,
        min_wallets: cfg.min_wallets,
        min_score: cfg.min_score,
      }),
      api.updateConfig('paper_trading', {
        enabled: true,
        default_size_usd: cfg.default_size_usd,
        stop_loss_pct: cfg.stop_loss_pct,
        take_profit_pct: cfg.take_profit_pct,
      }),
    ]);
    setSavingCfg(false);
    await loadDashboard();
  }

  // --- Initial load + periodic refresh ---
  useEffect(() => {
    loadDashboard();
    loadTrades();
    loadConvergence();
    loadWallets();
    loadConfig();

    const refresh = setInterval(() => {
      loadDashboard();
      loadTrades();
    }, 30000); // 30s refresh

    const clock = setInterval(() => setNow(new Date()), 1000);

    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, []);

  // --- Derived values ---
  const conv = dashboard?.convergence;
  const paper = dashboard?.paperTrading;
  const positions = dashboard?.openPositions || [];
  const equity = dashboard?.equityCurve || [];
  const totalPnl = (paper?.total_realized_pnl || 0) + (paper?.total_unrealized_pnl || 0);

  const tabMeta: Record<Tab, { title: string; desc: string }> = {
    dashboard: { title: 'Dashboard', desc: 'Live telemetry and portfolio state.' },
    strategies: { title: 'Strategies', desc: 'Tune convergence thresholds and risk controls.' },
    prediction: { title: 'Prediction', desc: 'Monitor signal quality and directional bias.' },
    plasticity: { title: 'Plasticity', desc: 'Adaptive response mode and learning loops.' },
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <>
      {/* --- HEADER --- */}
      <header className="header">
        <div className="header__brand">
          <span className="header__diamond">◆</span>
          <span className="header__title">CORTEX-PM</span>
          <span className="header__version">v1.0</span>
        </div>

        <nav className="header__nav">
          {(['dashboard', 'strategies', 'prediction', 'plasticity'] as Tab[]).map(t => (
            <button
              key={t}
              className={`header__nav-item ${tab === t ? 'header__nav-item--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>

        <div className="header__status">
          <div className={`header__status-dot`} style={{ background: connected ? '#7aa2ff' : '#8a93a6' }} />
          <span>ACTIVE</span>
          <span>{now.toLocaleTimeString('en-US', { hour12: false })}</span>
        </div>
      </header>

      {/* --- PARAMS BAR --- */}
      <div className="params-bar">
        <ParamItem label="Wallets" value={String(dashboard?.activeWallets || 0)} />
        <ParamItem label="Window" value="10min" />
        <ParamItem label="Min.Wallets" value="3" />
        <ParamItem label="Score.Thr" value="60" />
        <ParamItem label="Paper" value="ON" highlight />
        <ParamItem label="SL" value="15%" />
        <ParamItem label="TP" value="30%" />
        <ParamItem label="Size" value="$100" />
        <ParamItem label="Signals" value={String(conv?.total_events || 0)} />
        <ParamItem label="WinRate" value={`${conv?.win_rate || 0}%`} highlight />
      </div>

      {/* --- MAIN GRID --- */}
      {tab === 'dashboard' && <div className="main-grid">
        {/* ======== LEFT PANEL ======== */}
        <div className="panel">
          {/* Balance */}
          <div className="section">
            <div className="metric">
              <div className={`metric__value ${totalPnl >= 0 ? 'metric__value--green' : 'metric__value--red'}`}>
                {fmtUsd(totalPnl)}
              </div>
              <div className="metric__label">Net Realized P&L</div>
              <div className="metric__sublabel">
                Recent {fmtUsd(paper?.total_realized_pnl)} &nbsp; Unrl {fmtUsd(paper?.total_unrealized_pnl)}
              </div>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="section" style={{ padding: 0 }}>
            <div className="metric-grid">
              <div className="metric-grid__cell">
                <div className="metric-grid__label">Win Rate</div>
                <div className="metric-grid__value">{conv?.win_rate || 0}%</div>
              </div>
              <div className="metric-grid__cell">
                <div className="metric-grid__label">Score</div>
                <div className="metric-grid__value">{(conv?.avg_score || 0).toFixed(1)}</div>
              </div>
              <div className="metric-grid__cell">
                <div className="metric-grid__label">Signals</div>
                <div className="metric-grid__value">{fmtNum(conv?.total_events)}</div>
              </div>
              <div className="metric-grid__cell">
                <div className="metric-grid__label">Open</div>
                <div className="metric-grid__value">{paper?.open_trades || 0}</div>
              </div>
              <div className="metric-grid__cell">
                <div className="metric-grid__label">Wins</div>
                <div className="metric-grid__value" style={{ color: '#7aa2ff' }}>{conv?.wins || 0}</div>
              </div>
              <div className="metric-grid__cell">
                <div className="metric-grid__label">Losses</div>
                <div className="metric-grid__value" style={{ color: '#ff3344' }}>{conv?.losses || 0}</div>
              </div>
            </div>
          </div>

          {/* Strategy Config */}
          <div className="section">
            <div className="kv-row">
              <span className="kv-row__key">Strategy</span>
              <span className="kv-row__value">Convergence</span>
            </div>
            <div className="kv-row">
              <span className="kv-row__key">Mode</span>
              <span className="kv-row__value">Paper</span>
            </div>
            <div className="kv-row">
              <span className="kv-row__key">Position Size</span>
              <span className="kv-row__value">$100.00</span>
            </div>
            <div className="kv-row">
              <span className="kv-row__key">Net Position</span>
              <span className="kv-row__value">{fmtUsd(positions.reduce((s, p) => s + p.cost_basis, 0))}</span>
            </div>
            <div className="kv-row">
              <span className="kv-row__key">Avg Score</span>
              <span className="kv-row__value">{(conv?.avg_score || 0).toFixed(1)}</span>
            </div>
          </div>

          {/* Neural Topology */}
          <div className="section">
            <div className="section__header">
              <span className="section__title">Neural Topology</span>
            </div>
            <NeuralTopology walletCount={dashboard?.activeWallets || 20} />
          </div>
        </div>

        {/* ======== CENTER PANEL ======== */}
        <div className="panel">
          {/* Equity Curve */}
          <div className="section">
            <div className="section__header">
              <span className="section__title">Equity Curve</span>
              <span className="section__badge">
                {equity.length > 0 ? `${equity.length} trades` : 'AWAITING DATA'}
              </span>
            </div>
            <EquityCurve data={equity} height={220} />

            {/* Current equity annotation */}
            {equity.length > 0 && (
              <div style={{ textAlign: 'right', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: '#555', border: '1px solid #1a1a1a', padding: '2px 6px' }}>
                  {fmtUsd(equity[equity.length - 1]?.equity)}
                </span>
              </div>
            )}
          </div>

          {/* Trade Activity Log */}
          <div className="section">
            <div className="section__header">
              <span className="section__title">Trade Activity</span>
            </div>
            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
              {trades.slice(0, 12).map((trade, i) => (
                <div className="scanner-entry" key={trade.id || i}>
                  <span className="scanner-entry__time">{fmtTime(trade.traded_at)}</span>
                  <span className={`scanner-entry__action scanner-entry__action--${trade.side === 'BUY' ? 'buy' : 'sell'}`}>
                    {trade.side}
                  </span>
                  {' '}
                  <span className="scanner-entry__market">
                    {truncate(trade.market_question || trade.market_slug || '???', 35)}
                  </span>
                  {' '}
                  <span className="scanner-entry__amount">
                    {fmtPrice(trade.price)} x{Math.round(trade.size)}
                  </span>
                  {trade.tracked_wallets && (
                    <span style={{ color: '#333', marginLeft: 8 }}>
                      [{trade.tracked_wallets.label}]
                    </span>
                  )}
                </div>
              ))}
              {trades.length === 0 && (
                <div style={{ color: '#333', fontSize: 11, padding: '12px 0' }}>
                  Waiting for wallet trades...
                </div>
              )}
            </div>
          </div>

          {/* Convergence Signals */}
          <div className="section">
            <div className="section__header">
              <span className="section__title">Convergence Signals</span>
              <span className="section__badge">{convergence.length} events</span>
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {convergence.map(event => (
                <SignalCard key={event.id} event={event} />
              ))}
              {convergence.length === 0 && (
                <div style={{ color: '#333', fontSize: 11, padding: '12px 0' }}>
                  No convergence events yet. Monitoring wallets...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ======== RIGHT PANEL ======== */}
        <div className="panel">
          {/* Open Positions */}
          <div className="section">
            <div className="section__header">
              <span className="section__title">Positions</span>
            </div>
            {positions.map(pos => (
              <div className="position-row" key={pos.id}>
                <span className="position-row__name">
                  {truncate(pos.market_question || pos.market_slug, 25)}
                </span>
                <span className="position-row__ticker">{pos.outcome}</span>
                <span className={`position-row__pnl ${pos.unrealized_pnl >= 0 ? 'position-row__pnl--positive' : 'position-row__pnl--negative'}`}>
                  {fmtPct(pos.pnl_percentage)}
                </span>
              </div>
            ))}
            {positions.length === 0 && (
              <div style={{ color: '#333', fontSize: 11, padding: '8px 0' }}>
                No open positions
              </div>
            )}
          </div>

          {/* Live Events */}
          <div className="section">
            <div className="section__header">
              <span className="section__title">Live Events</span>
            </div>
            {convergence.filter(e => e.outcome_result === 'PENDING').slice(0, 8).map(event => (
              <div className="live-event" key={event.id}>
                <div className="live-event__title">
                  {truncate(event.market_question, 30)}
                </div>
                <div className="live-event__meta">
                  {fmtPrice(event.price_at_detection)} {event.outcome}
                  &nbsp;&middot;&nbsp;
                  {timeAgo(event.detected_at)} ago
                </div>
              </div>
            ))}
          </div>

          {/* Global Scanner */}
          <div className="section">
            <div className="section__header">
              <span className="section__title">Global Scanner</span>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {trades.slice(0, 20).map((trade, i) => {
                const action = trade.side === 'BUY' ? 'CONFIRMED BUY' : 'SETTLED SELL';
                const walletLabel = trade.tracked_wallets?.label || trade.wallet_address?.slice(0, 8);
                return (
                  <div className="scanner-entry" key={`scan-${trade.id || i}`}>
                    <span className="scanner-entry__time">{fmtTime(trade.traded_at)}</span>
                    <span className={`scanner-entry__action scanner-entry__action--${trade.side === 'BUY' ? 'buy' : 'sell'}`}>
                      {action}
                    </span>
                    {' '}
                    <span className="scanner-entry__market">
                      {truncate(trade.market_question || trade.market_slug || '', 22)}
                    </span>
                    <br />
                    <span className="scanner-entry__amount">
                      {fmtUsd(trade.total_cost)}
                    </span>
                    <span style={{ color: '#333', marginLeft: 4 }}>
                      {walletLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>}

      {tab !== 'dashboard' && (
        <div className="main-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="panel">
            <div className="section">
              <div className="section__header">
                <span className="section__title">{tabMeta[tab].title} Control Center</span>
              </div>
              <div style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>{tabMeta[tab].desc}</div>

              {tab === 'strategies' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 16 }}>
                    <label className="kv-row">Window (min)
                      <input inputMode="numeric" value={cfg.window_minutes} onChange={(e) => setCfg({ ...cfg, window_minutes: Number(e.target.value) || 0 })} />
                    </label>
                    <label className="kv-row">Min wallets
                      <input inputMode="numeric" value={cfg.min_wallets} onChange={(e) => setCfg({ ...cfg, min_wallets: Number(e.target.value) || 0 })} />
                    </label>
                    <label className="kv-row">Min score
                      <input inputMode="numeric" value={cfg.min_score} onChange={(e) => setCfg({ ...cfg, min_score: Number(e.target.value) || 0 })} />
                    </label>
                    <label className="kv-row">Size USD
                      <input inputMode="numeric" value={cfg.default_size_usd} onChange={(e) => setCfg({ ...cfg, default_size_usd: Number(e.target.value) || 0 })} />
                    </label>
                    <label className="kv-row">SL %
                      <input inputMode="numeric" value={cfg.stop_loss_pct} onChange={(e) => setCfg({ ...cfg, stop_loss_pct: Number(e.target.value) || 0 })} />
                    </label>
                    <label className="kv-row">TP %
                      <input inputMode="numeric" value={cfg.take_profit_pct} onChange={(e) => setCfg({ ...cfg, take_profit_pct: Number(e.target.value) || 0 })} />
                    </label>
                  </div>

                  <button className="header__nav-item header__nav-item--active" onClick={handleSaveConfig} disabled={savingCfg}>
                    {savingCfg ? 'Saving...' : 'Save Strategy Settings'}
                  </button>
                </>
              )}

              {tab === 'prediction' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
                  <div className="section" style={{ margin: 0 }}>
                    <div className="kv-row"><span className="kv-row__key">Signal Quality</span><span className="kv-row__value">{(conv?.avg_score || 0).toFixed(1)}</span></div>
                    <div className="kv-row"><span className="kv-row__key">Win Rate</span><span className="kv-row__value">{conv?.win_rate || 0}%</span></div>
                    <div className="kv-row"><span className="kv-row__key">Pending</span><span className="kv-row__value">{conv?.pending || 0}</span></div>
                  </div>
                  <div className="section" style={{ margin: 0 }}>
                    <div className="kv-row"><span className="kv-row__key">Recent Signals</span><span className="kv-row__value">{convergence.length}</span></div>
                    <div className="kv-row"><span className="kv-row__key">Open Positions</span><span className="kv-row__value">{paper?.open_trades || 0}</span></div>
                    <div className="kv-row"><span className="kv-row__key">Net P&L</span><span className="kv-row__value">{fmtUsd(totalPnl)}</span></div>
                  </div>
                </div>
              )}

              {tab === 'plasticity' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
                  <div className="section" style={{ margin: 0 }}>
                    <div className="kv-row"><span className="kv-row__key">Adaptation Mode</span><span className="kv-row__value">Conservative</span></div>
                    <div className="kv-row"><span className="kv-row__key">Drift Detection</span><span className="kv-row__value">Active</span></div>
                    <div className="kv-row"><span className="kv-row__key">Volatility Gate</span><span className="kv-row__value">On</span></div>
                  </div>
                  <div className="section" style={{ margin: 0 }}>
                    <div className="kv-row"><span className="kv-row__key">Wallet Cohesion</span><span className="kv-row__value">{dashboard?.activeWallets || 0} tracked</span></div>
                    <div className="kv-row"><span className="kv-row__key">Learning Queue</span><span className="kv-row__value">{trades.length}</span></div>
                    <div className="kv-row"><span className="kv-row__key">Last Sync</span><span className="kv-row__value">{now.toLocaleTimeString()}</span></div>
                  </div>
                </div>
              )}
            </div>

            {tab === 'strategies' && <div className="section">
              <div className="section__header">
                <span className="section__title">Wallet Manager</span>
                <span className="section__badge">{wallets.length} tracked</span>
              </div>

              <form onSubmit={handleAddWallet} style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
                <input placeholder="Proxy wallet address (0x...)" value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} />
                <input placeholder="Label (optional)" value={walletLabel} onChange={(e) => setWalletLabel(e.target.value)} />
                <select value={walletTier} onChange={(e) => setWalletTier(e.target.value)}>
                  <option value="A">Tier A</option>
                  <option value="B">Tier B</option>
                  <option value="C">Tier C</option>
                </select>
                <button className="header__nav-item header__nav-item--active" type="submit" disabled={savingWallet}>
                  {savingWallet ? 'Adding...' : 'Add Wallet'}
                </button>
              </form>

              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {wallets.map(w => (
                  <div className="position-row" key={w.id}>
                    <span className="position-row__name">{w.label || w.address.slice(0, 12)}</span>
                    <span className="position-row__ticker">{w.tier}</span>
                    <span className="position-row__pnl">{w.address.slice(0, 10)}...</span>
                  </div>
                ))}
              </div>
            </div>}
          </div>
        </div>
      )}

      {/* --- STATUS BAR --- */}
      <div className="status-bar">
        <StatusItem label="SIGNALS" value={String(conv?.total_events || 0)} />
        <StatusItem label="WIN%" value={`${conv?.win_rate || 0}%`} green={Number(conv?.win_rate) > 60} />
        <StatusItem label="P&L" value={fmtUsd(totalPnl)} green={totalPnl > 0} red={totalPnl < 0} />
        <StatusItem label="WALLETS" value={String(dashboard?.activeWallets || 0)} />
        <StatusItem label="OPEN" value={String(paper?.open_trades || 0)} />
        <StatusItem label="PENDING" value={String(conv?.pending || 0)} />
        <StatusItem label="WS" value={connected ? 'CONNECTED' : 'DISCONNECTED'} green={connected} red={!connected} />
      </div>
    </>
  );
}

// ============================================================
// Sub-components
// ============================================================

function ParamItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="params-bar__item">
      <span className="params-bar__label">{label}:</span>
      <span className={`params-bar__value ${highlight ? 'params-bar__value--highlight' : ''}`}>{value}</span>
    </div>
  );
}

function StatusItem({ label, value, green, red }: { label: string; value: string; green?: boolean; red?: boolean }) {
  const cls = green ? 'status-bar__value--green' : red ? 'status-bar__value--red' : '';
  return (
    <div className="status-bar__item">
      <span className="status-bar__label">{label}:</span>
      <span className={`status-bar__value ${cls}`}>{value}</span>
    </div>
  );
}

function SignalCard({ event }: { event: ConvergenceEvent }) {
  const tier = event.signal_score >= 80 ? 'high' : event.signal_score >= 60 ? 'medium' : 'low';
  const resultColor = event.outcome_result === 'WIN' ? '#7aa2ff'
    : event.outcome_result === 'LOSS' ? '#9aa4bf'
    : '#555';

  return (
    <div className={`signal-card signal-card--${tier}`}>
      <div className="signal-card__header">
        <span className="signal-card__score" style={{ color: tier === 'high' ? '#7aa2ff' : tier === 'medium' ? '#9fb3e8' : '#555' }}>
          {event.signal_score}
        </span>
        <span className="signal-card__outcome" style={{ borderColor: resultColor, color: resultColor }}>
          {event.outcome_result}
        </span>
      </div>
      <div className="signal-card__question">
        {truncate(event.market_question || event.market_slug, 60)}
      </div>
      <div className="signal-card__meta">
        <span>{event.wallet_count} wallets</span>
        <span>{event.outcome}</span>
        <span>{fmtPrice(event.price_at_detection)}</span>
        <span>{fmtUsd(event.total_buy_usd)}</span>
        <span>{timeAgo(event.detected_at)}</span>
      </div>
    </div>
  );
}
