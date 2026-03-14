// ============================================================
// CORTEX-PM: Frontend API Client + Types
// Single module for all backend communication.
// ============================================================

const API = import.meta.env.VITE_API_URL || '';

// --- Generic fetch wrapper with error logging ---
async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) {
      console.error(`[API] GET ${path} failed: ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[API] GET ${path} error:`, (err as Error).message);
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[API] POST ${path} failed: ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[API] POST ${path} error:`, (err as Error).message);
    return null;
  }
}

async function put<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[API] PUT ${path} failed: ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[API] PUT ${path} error:`, (err as Error).message);
    return null;
  }
}

// --- Types ---

export interface DashboardData {
  convergence: {
    total_events: number;
    wins: number;
    losses: number;
    pending: number;
    win_rate: number;
    avg_pnl: number;
    avg_score: number;
  };
  paperTrading: {
    total_trades: number;
    open_trades: number;
    winning_trades: number;
    losing_trades: number;
    total_realized_pnl: number;
    total_unrealized_pnl: number;
    win_rate: number;
  };
  recentConvergence: ConvergenceEvent[];
  openPositions: PaperTrade[];
  activeWallets: number;
  equityCurve: Array<{ time: string; equity: number }>;
}

export interface ConvergenceEvent {
  id: string;
  market_slug: string;
  market_question: string;
  outcome: string;
  wallet_count: number;
  wallet_labels: string[];
  total_buy_usd: number;
  avg_entry_price: number;
  signal_score: number;
  score_breakdown: {
    wallet_quality: number;
    size_signal: number;
    speed_signal: number;
    consensus: number;
  };
  price_at_detection: number;
  price_15m: number | null;
  price_1h: number | null;
  price_4h: number | null;
  price_24h: number | null;
  outcome_result: 'WIN' | 'LOSS' | 'PENDING' | 'EXPIRED';
  detected_at: string;
}

export interface PaperTrade {
  id: string;
  market_slug: string;
  market_question: string;
  outcome: string;
  entry_price: number;
  exit_price: number | null;
  current_price: number;
  shares: number;
  cost_basis: number;
  unrealized_pnl: number;
  realized_pnl: number | null;
  pnl_percentage: number;
  stop_loss: number;
  take_profit: number;
  status: 'OPEN' | 'CLOSED' | 'STOPPED' | 'EXPIRED';
  close_reason: string | null;
  signal_score: number;
  wallet_count: number;
  opened_at: string;
  closed_at: string | null;
}

export interface WalletTrade {
  id: string;
  wallet_address: string;
  market_slug: string;
  market_question: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  total_cost: number;
  traded_at: string;
  tracked_wallets?: { label: string; tier: string };

  // API-SHAPE-REPORT alignment: backend now normalizes Data API camelCase fields.
  // These are optional aliases to keep frontend types resilient during migration.
  conditionId?: string;
  assetId?: string;
  transactionHash?: string;
}

export interface TrackedWallet {
  id: string;
  address: string;
  label: string;
  tier: string;
  win_rate: number;
  total_trades: number;
  total_pnl: number;
  category: string;
  is_active: boolean;
}

// --- API methods ---

export const api = {
  dashboard: () => get<DashboardData>('/api/dashboard'),
  convergence: (limit = 50) => get<ConvergenceEvent[]>(`/api/convergence?limit=${limit}`),
  convergenceStats: () => get<DashboardData['convergence']>('/api/convergence/stats'),
  positions: () => get<{ stats: any; openPositions: PaperTrade[]; recentClosed: PaperTrade[] }>('/api/positions'),
  trades: (limit = 50) => get<WalletTrade[]>(`/api/trades?limit=${limit}`),
  wallets: () => get<TrackedWallet[]>('/api/wallets'),
  config: () => get<Record<string, any>>('/api/config'),
  addWallet: (address: string, label: string, tier: string) => post<{ success: boolean }>('/api/wallets', { address, label, tier }),
  updateConfig: (key: string, value: any) => put<{ success: boolean }>(`/api/config/${key}`, { value }),
};
