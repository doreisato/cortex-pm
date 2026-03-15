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
import { FreshnessBadge } from './components/FreshnessBadge';
import { ConfidenceBar } from './components/ConfidenceBar';
import { EmptyState } from './components/EmptyState';

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
  const [expandedSignals, setExpandedSignals] = useState<Record<string, boolean>>({});
  const [lastTradeUpdate, setLastTradeUpdate] = useState<string | null>(null);
  const [lastDashboardUpdate, setLastDashboardUpdate] = useState<string | null>(null);
  const [preset, setPreset] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [maxConcurrentPositions, setMaxConcurrentPositions] = useState(5);

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
    console.log('[APP] Fetch dashboard');
    const data = await api.dashboard();
    if (data) {
      console.log('[APP] Dashboard loaded:', data);
      setDashboard(data);
      setLastDashboardUpdate(new Date().toISOString());
    }
  }

  async function loadTrades() {
    console.log('[APP] Fetch trades');
    const data = await api.trades(50);
    if (data) {
      setTrades(data);
      setLastTradeUpdate(new Date().toISOString());
    }
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

  function applyPreset(next: 'conservative' | 'balanced' | 'aggressive') {
    setPreset(next);
    if (next === 'conservative') {
      setCfg((c) => ({ ...c, min_wallets: 4, min_score: 70, stop_loss_pct: 10, take_profit_pct: 20 }));
    } else if (next === 'balanced') {
      setCfg((c) => ({ ...c, min_wallets: 3, min_score: 60, stop_loss_pct: 15, take_profit_pct: 30 }));
    } else {
      setCfg((c) => ({ ...c, min_wallets: 2, min_score: 50, stop_loss_pct: 20, take_profit_pct: 40 }));
    }
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

  const avgBreakdown = convergence.reduce((acc, e) => {
    acc.wallet_quality += e.score_breakdown?.wallet_quality || 0;
    acc.size_signal += e.score_breakdown?.size_signal || 0;
    acc.speed_signal += e.score_breakdown?.speed_signal || 0;
    acc.consensus += e.score_breakdown?.consensus || 0;
    return acc;
  }, { wallet_quality: 0, size_signal: 0, speed_signal: 0, consensus: 0 });
  const den = Math.max(convergence.length, 1);
  const quality = {
    wallet_quality: avgBreakdown.wallet_quality / den,
    size_signal: avgBreakdown.size_signal / den,
    speed_signal: avgBreakdown.speed_signal / den,
    consensus: avgBreakdown.consensus / den,
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
              <div className={`metric__value animated-value ${totalPnl >= 0 ? 'metric__value--green' : 'metric__value--red'}`}>
                {fmtUsd(totalPnl)}
              </div>
              <div className="metric__label">Net Realized P&L</div>
              <div className="metric__sublabel">
                Recent {fmtUsd(paper?.total_realized_pnl)} &nbsp; Unrl {fmtUsd(paper?.total_unrealized_pnl)}
              </div>
              <div style={{ marginTop: 6 }}>
                <FreshnessBadge
                  lastUpdate={connected ? new Date().toISOString() : lastDashboardUpdate}
                  label={connected ? 'LIVE' : (lastDashboardUpdate ? `${timeAgo(lastDashboardUpdate)} ago` : 'STALE')}
                />
              </div>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="section" style={{ padding: 0 }}>
            <div className="metric-grid">
              {[
                ['Win Rate', `${conv?.win_rate || 0}%`, undefined],
                ['Score', (conv?.avg_score || 0).toFixed(1), undefined],
                ['Signals', fmtNum(conv?.total_events), undefined],
                ['Open', String(paper?.open_trades || 0), undefined],
                ['Wins', String(conv?.wins || 0), '#7aa2ff'],
                ['Losses', String(conv?.losses || 0), '#9aa4bf'],
              ].map(([label, value, color], idx) => (
                <div className="metric-grid__cell" key={String(label)} style={{ animation: 'fade-in 0.3s ease forwards', animationDelay: `${idx * 0.05}s` }}>
                  <div className="metric-grid__label">{label}</div>
                  <div className="metric-grid__value" style={color ? { color: String(color) } : undefined}>{value}</div>
                </div>
              ))}
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
              <span className="kv-row__value">{fmtUsd(cfg.default_size_usd)}</span>
            </div>
            <div className="confidence-bar" style={{ marginBottom: 10 }}>
              <div className="confidence-bar__fill" data-level="mid" style={{ width: `${Math.min(100, (cfg.default_size_usd / 300) * 100)}%` }} />
            </div>
            <div className="kv-row">
              <span className="kv-row__key">Avg Score</span>
              <span className="kv-row__value">{(conv?.avg_score || 0).toFixed(1)}</span>
            </div>
            <ConfidenceBar value={conv?.avg_score || 0} max={100} />
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
              <FreshnessBadge lastUpdate={lastTradeUpdate} />
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
                <EmptyState
                  title="Waiting for wallet trades"
                  description="Scanner will stream entries once tracked wallets execute on Polymarket."
                />
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
                <SignalCard
                  key={event.id}
                  event={event}
                  expanded={!!expandedSignals[event.id]}
                  onToggle={() => setExpandedSignals((s) => ({ ...s, [event.id]: !s[event.id] }))}
                />
              ))}
              {convergence.length === 0 && (
                <EmptyState
                  title="No convergence events yet"
                  description="Signals appear when multiple tracked wallets converge on the same outcome."
                />
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
            {positions.map(pos => {
              const current = pos.current_price || pos.entry_price;
              const sl = pos.stop_loss || Math.max(0, pos.entry_price * 0.8);
              const tp = pos.take_profit || Math.min(1, pos.entry_price * 1.2);
              const pct = Math.max(0, Math.min(100, ((current - sl) / Math.max(0.0001, tp - sl)) * 100));
              return (
                <div key={pos.id} style={{ borderBottom: '1px solid #121212', padding: '8px 0' }}>
                  <div className="position-row" style={{ borderBottom: 'none', padding: 0 }}>
                    <span className="position-row__name">
                      {truncate(pos.market_question || pos.market_slug, 25)}
                    </span>
                    <span className="position-row__ticker">{pos.outcome}</span>
                    <span className={`position-row__pnl ${pos.unrealized_pnl >= 0 ? 'position-row__pnl--positive' : 'position-row__pnl--negative'}`}>
                      {fmtPct(pos.pnl_percentage)}
                    </span>
                  </div>
                  <div style={{ height: 3, position: 'relative', marginTop: 6, background: 'linear-gradient(90deg,#333 0%,#333 35%,#7aa2ff 35%,#7aa2ff 65%,#9fb3e8 65%,#9fb3e8 100%)' }}>
                    <div style={{ position: 'absolute', left: `${pct}%`, top: -1, width: 2, height: 5, background: '#fff' }} />
                  </div>
                </div>
              );
            })}
            {positions.length === 0 && (
              <EmptyState title="No open positions" description="Paper trader will open positions when valid convergence signals fire." />
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
                  {formatElapsed(event.detected_at, now)}
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
                  <div className="scanner-entry" key={`scan-${trade.id || i}`} style={{ background: i % 2 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', marginRight: 6, background: trade.tracked_wallets?.tier === 'A' ? '#7aa2ff' : trade.tracked_wallets?.tier === 'B' ? '#555' : '#333' }} />
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
            <div className="page-header">
              <div className="page-header__title">{tab === 'prediction' ? 'Prediction Engine' : tab === 'plasticity' ? 'Plasticity Engine' : tabMeta[tab].title}</div>
              <div className="page-header__desc">{tab === 'prediction' ? 'Signal quality analysis and model confidence.' : tab === 'plasticity' ? 'System adaptation, drift detection, and learning state.' : tabMeta[tab].desc}</div>
            </div>

            {tab === 'strategies' && (
              <div className="section">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 16 }}>
                  {[
                    ['conservative', 'Conservative', '4 wallets · score 70 · SL 10 · TP 20'],
                    ['balanced', 'Balanced', '3 wallets · score 60 · SL 15 · TP 30'],
                    ['aggressive', 'Aggressive', '2 wallets · score 50 · SL 20 · TP 40'],
                  ].map(([key, title, desc]) => (
                    <button key={key} className="signal-card" onClick={() => applyPreset(key as any)} style={{ borderColor: preset === key ? '#7aa2ff' : '#1a1a1a', textAlign: 'left' }}>
                      <div style={{ fontSize: 12, color: '#e0e0e0', marginBottom: 4 }}>{title}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{desc}</div>
                    </button>
                  ))}
                </div>

                <div style={{ color: '#555', fontSize: 11, marginBottom: 12 }}>
                  Expected Profile: {cfg.min_wallets >= 4 || cfg.min_score >= 70
                    ? 'Higher threshold = fewer signals, likely higher precision.'
                    : cfg.min_wallets <= 2 || cfg.min_score <= 50
                      ? 'Lower threshold = more signals, higher noise and drawdown risk.'
                      : 'Balanced throughput and signal quality for paper-mode iteration.'}
                </div>

                <div className="control-group">
                  <div className="control-group__title">Signal Detection</div>
                  <div className="control-group__row">
                    <div className="control-group__field"><label>Window (min)<input value={cfg.window_minutes} onChange={(e) => setCfg({ ...cfg, window_minutes: Number(e.target.value) || 0 })} /><small>Time window for wallet convergence</small></label></div>
                    <div className="control-group__field"><label>Min wallets<input value={cfg.min_wallets} onChange={(e) => setCfg({ ...cfg, min_wallets: Number(e.target.value) || 0 })} /><small>Minimum wallets in same direction</small></label></div>
                    <div className="control-group__field"><label>Min score<input value={cfg.min_score} onChange={(e) => setCfg({ ...cfg, min_score: Number(e.target.value) || 0 })} /><small>Signal quality threshold</small></label></div>
                  </div>
                </div>

                <div className="control-group">
                  <div className="control-group__title">Risk Management</div>
                  <div className="control-group__row">
                    <div className="control-group__field"><label>Stop loss %<input value={cfg.stop_loss_pct} onChange={(e) => setCfg({ ...cfg, stop_loss_pct: Number(e.target.value) || 0 })} /><small>Maximum tolerated downside per trade</small></label></div>
                    <div className="control-group__field"><label>Take profit %<input value={cfg.take_profit_pct} onChange={(e) => setCfg({ ...cfg, take_profit_pct: Number(e.target.value) || 0 })} /><small>Target upside capture</small></label></div>
                    <div className="control-group__field"><label>Default size USD<input value={cfg.default_size_usd} onChange={(e) => setCfg({ ...cfg, default_size_usd: Number(e.target.value) || 0 })} /><small>Paper position sizing</small></label></div>
                  </div>
                </div>

                <div className="control-group">
                  <div className="control-group__title">Execution</div>
                  <div className="control-group__row">
                    <div className="control-group__field"><label>Mode<input value="PAPER ONLY" disabled /><small>Live execution disabled</small></label></div>
                    <div className="control-group__field"><label>Max concurrent positions<input value={maxConcurrentPositions} onChange={(e) => setMaxConcurrentPositions(Number(e.target.value) || 1)} /><small>Frontend control placeholder</small></label></div>
                  </div>
                </div>

                <button className="header__nav-item header__nav-item--active" onClick={handleSaveConfig} disabled={savingCfg}>
                  {savingCfg ? 'Saving...' : 'Save Strategy Settings'}
                </button>
              </div>
            )}

            {tab === 'strategies' && <div className="section">
              <div className="section__header">
                <span className="section__title">Wallet Manager</span>
                <span className="section__badge">{wallets.length} tracked</span>
              </div>

              <form onSubmit={handleAddWallet} style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
                <input placeholder="Proxy wallet address (0x...)" value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} />
                <input placeholder="Label (optional)" value={walletLabel} onChange={(e) => setWalletLabel(e.target.value)} />
                <select value={walletTier} onChange={(e) => setWalletTier(e.target.value)}>
                  <option value="A">Tier A</option><option value="B">Tier B</option><option value="C">Tier C</option>
                </select>
                <button className="header__nav-item header__nav-item--active" type="submit" disabled={savingWallet}>{savingWallet ? 'Adding...' : 'Add Wallet'}</button>
              </form>

              <div className="position-row" style={{ fontSize: 10, color: '#555' }}><span className="position-row__name">Label</span><span className="position-row__ticker">Tier</span><span className="position-row__pnl">Address</span></div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {wallets.map(w => (
                  <div className="position-row" key={w.id} style={{ borderLeft: `2px solid ${w.tier === 'A' ? '#7aa2ff' : w.tier === 'B' ? '#555' : '#333'}`, paddingLeft: 8 }}>
                    <span className="position-row__name">{w.label || w.address.slice(0, 12)}</span>
                    <span className="position-row__ticker">{w.tier}</span>
                    <span className="position-row__pnl" style={{ width: 180, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span>{w.address.slice(0, 8)}...{w.address.slice(-4)}</span>
                      <button className="header__nav-item" style={{ padding: '2px 6px' }} onClick={() => navigator.clipboard.writeText(w.address)}>copy</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>}

            {tab === 'prediction' && (
              <div className="section" style={{ display: 'grid', gap: 14 }}>
                <div className="control-group">
                  <div className="control-group__title">Signal Quality Matrix</div>
                  <div className="control-group__row">
                    <ConfidenceBar value={quality.wallet_quality} max={30} label={`Wallet Quality ${quality.wallet_quality.toFixed(1)}/30`} />
                    <ConfidenceBar value={quality.size_signal} max={25} label={`Size Signal ${quality.size_signal.toFixed(1)}/25`} />
                    <ConfidenceBar value={quality.speed_signal} max={20} label={`Speed Signal ${quality.speed_signal.toFixed(1)}/20`} />
                    <ConfidenceBar value={quality.consensus} max={25} label={`Consensus ${quality.consensus.toFixed(1)}/25`} />
                  </div>
                </div>

                <div className="control-group">
                  <div className="control-group__title">Outcome Distribution</div>
                  <div style={{ display: 'flex', height: 16, background: '#111' }}>
                    <div style={{ width: `${((conv?.wins || 0) / Math.max(1, conv?.total_events || 1)) * 100}%`, background: '#7aa2ff' }} />
                    <div style={{ width: `${((conv?.pending || 0) / Math.max(1, conv?.total_events || 1)) * 100}%`, background: '#555' }} />
                    <div style={{ width: `${((conv?.losses || 0) / Math.max(1, conv?.total_events || 1)) * 100}%`, background: '#333' }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>W {conv?.wins || 0} · P {conv?.pending || 0} · L {conv?.losses || 0}</div>
                </div>

                <div className="control-group">
                  <div className="control-group__title">Recent Signal Timeline</div>
                  <div className="timeline-rail">
                    <div className="timeline-rail__line" />
                    {convergence.slice(0, 10).map((e) => (
                      <div className="timeline-rail__node" key={e.id}>
                        <span className={`timeline-rail__dot ${e.outcome_result === 'WIN' ? 'timeline-rail__dot--signal' : e.outcome_result === 'LOSS' ? 'timeline-rail__dot--trade' : 'timeline-rail__dot--outcome'}`} />
                        <div style={{ fontSize: 11 }}>{truncate(e.market_question, 72)}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>score {e.signal_score} · {e.outcome_result} · {timeAgo(e.detected_at)} ago</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'plasticity' && (
              <div className="section" style={{ display: 'grid', gap: 14 }}>
                <div className="metric-grid">
                  <div className="metric-grid__cell"><div className="metric-grid__label">WebSocket</div><div className="metric-grid__value"><FreshnessBadge lastUpdate={connected ? new Date().toISOString() : null} label={connected ? 'LIVE' : 'DISCONNECTED'} /></div></div>
                  <div className="metric-grid__cell"><div className="metric-grid__label">Last Poll</div><div className="metric-grid__value" style={{ fontSize: 12 }}>{lastDashboardUpdate ? `${timeAgo(lastDashboardUpdate)} ago` : 'n/a'}</div></div>
                  <div className="metric-grid__cell"><div className="metric-grid__label">Active Wallets</div><div className="metric-grid__value">{dashboard?.activeWallets || 0}</div></div>
                  <div className="metric-grid__cell"><div className="metric-grid__label">Trade Feed</div><div className="metric-grid__value">{trades.length}</div></div>
                </div>

                <div className="control-group">
                  <div className="control-group__title">Wallet Performance</div>
                  {wallets.map((w) => (
                    <div className="position-row" key={w.id}>
                      <span className="position-row__name">{w.label}</span>
                      <span className="position-row__ticker">{w.tier}</span>
                      <span className={`position-row__pnl ${Number(w.total_pnl) >= 0 ? 'position-row__pnl--positive' : 'position-row__pnl--negative'}`}>{fmtUsd(Number(w.total_pnl || 0))}</span>
                    </div>
                  ))}
                </div>

                <div className="control-group">
                  <div className="control-group__title">Configuration Drift Log</div>
                  <div className="kv-row"><span className="kv-row__key">Window</span><span className="kv-row__value">{cfg.window_minutes}m</span></div>
                  <div className="kv-row"><span className="kv-row__key">Min Wallets</span><span className="kv-row__value">{cfg.min_wallets}</span></div>
                  <div className="kv-row"><span className="kv-row__key">Min Score</span><span className="kv-row__value">{cfg.min_score}</span></div>
                  <div className="kv-row"><span className="kv-row__key">Last updated</span><span className="kv-row__value">{lastDashboardUpdate ? `${timeAgo(lastDashboardUpdate)} ago` : 'n/a'}</span></div>
                </div>

                <div className="control-group">
                  <div className="control-group__title">Adaptation Rules</div>
                  {[
                    ['PLANNED', 'Auto-demote wallets with <40% win rate after 20+ trades'],
                    ['PLANNED', 'Increase min_score by 5 if last 10 signals had <50% win rate'],
                    ['PLANNED', 'Pause paper trading if 3 consecutive losses'],
                  ].map(([s, t]) => (
                    <div key={t} className="signal-card"><div className="signal-card__header"><span className="signal-card__question">{t}</span><span className="section__badge">{s}</span></div></div>
                  ))}
                </div>
              </div>
            )}
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

function SignalCard({ event, expanded, onToggle }: { event: ConvergenceEvent; expanded?: boolean; onToggle?: () => void }) {
  const tier = event.signal_score >= 80 ? 'high' : event.signal_score >= 60 ? 'medium' : 'low';
  const resultColor = event.outcome_result === 'WIN' ? '#7aa2ff'
    : event.outcome_result === 'LOSS' ? '#9aa4bf'
    : '#555';
  const b = event.score_breakdown || { wallet_quality: 0, size_signal: 0, speed_signal: 0, consensus: 0 };
  const current = event.price_15m || event.price_1h || event.price_4h || event.price_24h || event.price_at_detection;
  const perf = event.price_at_detection ? ((current - event.price_at_detection) / event.price_at_detection) * 100 : 0;

  return (
    <div className={`signal-card signal-card--${tier}`} onClick={onToggle} style={{ cursor: 'pointer' }}>
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
      {event.sentiment_score !== undefined && event.sentiment_score !== null && (
        <div style={{ marginTop: 6, fontSize: 11, color: event.sentiment_score > 0.3 ? '#00ff41' : event.sentiment_score < -0.3 ? '#ff3344' : '#ffaa00' }} title={event.sentiment_narrative || ''}>
          Sentiment: {event.sentiment_score.toFixed(2)}
          {event.sentiment_narrative ? <span style={{ color: '#666', marginLeft: 6 }}>{truncate(event.sentiment_narrative, 80)}</span> : null}
        </div>
      )}

      <div style={{ maxHeight: expanded ? 280 : 0, overflow: 'hidden', transition: 'max-height 0.25s ease', marginTop: expanded ? 10 : 0 }}>
        <div className="signal-explain">
          <div className="signal-explain__label">Signal explainability</div>
          {[['Wallet Quality', b.wallet_quality, 30], ['Size Signal', b.size_signal, 25], ['Speed Signal', b.speed_signal, 20], ['Consensus', b.consensus, 25]].map(([label, v, max]) => (
            <div key={String(label)} style={{ marginBottom: 6 }}>
              <div className="signal-explain__factor"><span>{label}</span><span>{Number(v).toFixed(0)}/{max}</span></div>
              <div style={{ background: '#111', height: 4 }}><div className="signal-explain__bar" style={{ width: `${Math.min(100, (Number(v) / Number(max)) * 100)}%` }} /></div>
            </div>
          ))}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {(event.wallet_labels || []).slice(0, 6).map((w) => <span key={w} className="section__badge">{w}</span>)}
          </div>
          <div style={{ marginTop: 8, color: '#666' }}>Converged in 3.2 minutes</div>
          <div style={{ color: '#666' }}>Entry: {fmtPrice(event.price_at_detection)} → Current: {fmtPrice(current)} ({fmtPct(perf)})</div>
        </div>
      </div>
    </div>
  );
}

function formatElapsed(iso: string, now: Date) {
  const diff = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}m ${s}s`;
}
