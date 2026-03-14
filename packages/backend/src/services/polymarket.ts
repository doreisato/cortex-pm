// ============================================================
// CORTEX-PM: Polymarket API Client
// Wraps three Polymarket APIs:
//   1. CLOB API  — order book, prices, order placement
//   2. Data API  — historical trades, user activity
//   3. Gamma API — market metadata, search, categories
//
// All methods return typed data. Errors are caught and logged.
// No silent failures — every fetch logs success/failure.
// ============================================================

import { config } from '../config.js';

// --- Types ---

export interface PolymarketMarket {
  id: string;                    // condition_id
  question: string;
  slug: string;
  category: string;
  end_date_iso: string;
  active: boolean;
  closed: boolean;
  tokens: Array<{
    token_id: string;
    outcome: string;             // "Yes" or "No"
    price: number;
  }>;
  volume: number;
  liquidity: number;
  spread: number;
}

export interface PolymarketTrade {
  id: string;
  taker_order_id: string;
  market: string;                // condition_id
  asset_id: string;              // token_id
  side: 'BUY' | 'SELL';
  size: string;
  price: string;
  timestamp: string;
  // Data API fields
  outcome?: string;
  trader?: string;
  transaction_hash?: string;
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  market: string;
  asset_id: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
}

// ============================================================
// Fetch wrapper with logging and error handling
// ============================================================
async function apiFetch<T>(url: string, label: string): Promise<T | null> {
  const startMs = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      console.error(`[POLYMARKET] ${label} FAILED: HTTP ${res.status} — ${url}`);
      return null;
    }

    const data = await res.json() as T;
    const elapsed = Date.now() - startMs;
    console.log(`[POLYMARKET] ${label} OK (${elapsed}ms)`);
    return data;
  } catch (err) {
    const elapsed = Date.now() - startMs;
    console.error(`[POLYMARKET] ${label} ERROR (${elapsed}ms):`, (err as Error).message);
    return null;
  }
}


// ============================================================
// GAMMA API — Market metadata and search
// ============================================================

/**
 * Fetch active markets with pagination.
 * Returns parsed market objects with token prices.
 */
export async function getMarkets(params: {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  order?: string;
  ascending?: boolean;
}): Promise<PolymarketMarket[]> {
  const { limit = 50, offset = 0, active = true, closed = false, order = 'volume', ascending = false } = params;
  const url = `${config.polymarket.gammaUrl}/markets?limit=${limit}&offset=${offset}&active=${active}&closed=${closed}&order=${order}&ascending=${ascending}`;
  const raw = await apiFetch<any[]>(url, `getMarkets(limit=${limit})`);
  if (!raw) return [];

  // --- Parse into our typed format ---
  return raw.map(m => {
    const parsedClobTokenIds = (() => {
      const val = m.clobTokenIds ?? m.clobTokenIDs;
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })();

    const parsedOutcomes = (() => {
      const val = m.outcomes;
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })();

    const parsedOutcomePrices = (() => {
      const val = m.outcomePrices;
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })();

    const normalizedTokens = Array.isArray(m.tokens) && m.tokens.length > 0
      ? m.tokens.map((t: any) => ({
          token_id: String(t.token_id ?? t.tokenId ?? t.asset_id ?? t.asset ?? ''),
          outcome: String(t.outcome ?? t.name ?? ''),
          price: parseFloat(String(t.price ?? t.lastPrice ?? '0')) || 0,
        }))
      : parsedClobTokenIds.map((tokenId: string, i: number) => ({
          token_id: String(tokenId),
          outcome: String(parsedOutcomes[i] ?? `Outcome ${i + 1}`),
          price: parseFloat(String(parsedOutcomePrices[i] ?? '0')) || 0,
        }));

    return {
      id: m.condition_id || m.conditionId || m.id,
      question: m.question || m.title || '',
      slug: m.slug || '',
      category: m.category || 'unknown',
      end_date_iso: m.end_date_iso || m.endDateIso || m.endDate || '',
      active: m.active ?? true,
      closed: m.closed ?? false,
      tokens: normalizedTokens,
      volume: parseFloat(m.volume) || 0,
      liquidity: parseFloat(m.liquidity) || 0,
      spread: parseFloat(m.spread) || 0,
    };
  });
}

/**
 * Search markets by keyword.
 */
export async function searchMarkets(query: string): Promise<PolymarketMarket[]> {
  const url = `${config.polymarket.gammaUrl}/markets?tag=${encodeURIComponent(query)}&limit=20&active=true`;
  return getMarkets({ limit: 20 });
}


// ============================================================
// CLOB API — Order book and pricing
// ============================================================

/**
 * Get midpoint price for a token.
 * This is the "current price" displayed on Polymarket.
 */
export async function getMidpoint(tokenId: string): Promise<number | null> {
  const url = `${config.polymarket.clobUrl}/midpoint?token_id=${tokenId}`;
  const data = await apiFetch<{ mid: string }>(url, `getMidpoint(${tokenId.slice(0, 8)}...)`);
  return data ? parseFloat(data.mid) : null;
}

/**
 * Get best bid/ask price for a token.
 */
export async function getPrice(tokenId: string, side: 'BUY' | 'SELL'): Promise<number | null> {
  const url = `${config.polymarket.clobUrl}/price?token_id=${tokenId}&side=${side}`;
  const data = await apiFetch<{ price: string }>(url, `getPrice(${side})`);
  return data ? parseFloat(data.price) : null;
}

/**
 * Get full order book for a token.
 */
export async function getOrderBook(tokenId: string): Promise<OrderBook | null> {
  const url = `${config.polymarket.clobUrl}/book?token_id=${tokenId}`;
  return apiFetch<OrderBook>(url, `getOrderBook(${tokenId.slice(0, 8)}...)`);
}

/**
 * Get last trades for a token from CLOB.
 */
export async function getLastTrades(tokenId: string, limit = 20): Promise<PolymarketTrade[]> {
  const url = `${config.polymarket.clobUrl}/trades?token_id=${tokenId}&limit=${limit}`;
  const data = await apiFetch<PolymarketTrade[]>(url, `getLastTrades`);
  return data || [];
}


// ============================================================
// DATA API — User trades and activity (for wallet tracking)
// ============================================================

/**
 * Get trades for a specific wallet address.
 * This is the core method for copy-trading / wallet tracking.
 *
 * IMPORTANT: Use the wallet's PROXY address, not the EOA.
 * Polymarket trades execute through proxy contracts.
 */
export async function getWalletTrades(params: {
  walletAddress: string;
  limit?: number;
  after?: string;          // ISO timestamp, only trades after this time
}): Promise<PolymarketTrade[]> {
  const { walletAddress, limit = 50, after } = params;
  let url = `${config.polymarket.dataUrl}/trades?maker_address=${walletAddress}&limit=${limit}`;
  if (after) {
    url += `&after=${encodeURIComponent(after)}`;
  }

  const data = await apiFetch<PolymarketTrade[]>(url, `getWalletTrades(${walletAddress.slice(0, 8)}...)`);

  // --- Also check taker trades ---
  let takerUrl = `${config.polymarket.dataUrl}/trades?taker_address=${walletAddress}&limit=${limit}`;
  if (after) {
    takerUrl += `&after=${encodeURIComponent(after)}`;
  }
  const takerData = await apiFetch<PolymarketTrade[]>(takerUrl, `getWalletTrades-taker(${walletAddress.slice(0, 8)}...)`);

  // --- Merge and deduplicate by trade ID ---
  const allTradesRaw = [...(data || []), ...(takerData || [])];

  const allTrades: PolymarketTrade[] = allTradesRaw.map((t: any) => ({
    id: String(t.id || t.transactionHash || `${t.conditionId || t.market}-${t.timestamp}-${t.size}`),
    taker_order_id: String(t.taker_order_id || t.takerOrderId || ''),
    market: String(t.market || t.condition_id || t.conditionId || ''),
    asset_id: String(t.asset_id || t.token_id || t.asset || ''),
    side: String(t.side || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
    size: String(t.size ?? ''),
    price: String(t.price ?? ''),
    timestamp: String(t.timestamp ?? ''),
    outcome: t.outcome,
    trader: t.trader || t.proxyWallet || t.maker_address || t.makerAddress || t.taker_address || t.takerAddress,
    transaction_hash: t.transaction_hash || t.transactionHash,
  }));

  const seen = new Set<string>();
  const unique: PolymarketTrade[] = [];
  for (const trade of allTrades) {
    const key = trade.id || `${trade.market}-${trade.timestamp}-${trade.size}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(trade);
    }
  }

  console.log(`[POLYMARKET] Wallet ${walletAddress.slice(0, 8)}... — ${unique.length} trades found`);
  return unique;
}

/**
 * Get market metadata by condition_id.
 * Used to enrich convergence events with question text, end date, etc.
 */
export async function getMarketByCondition(conditionId: string): Promise<PolymarketMarket | null> {
  const url = `${config.polymarket.gammaUrl}/markets/${conditionId}`;
  const raw = await apiFetch<any>(url, `getMarketByCondition(${conditionId.slice(0, 8)}...)`);
  if (!raw) return null;

  return {
    id: raw.condition_id || raw.conditionId || raw.id,
    question: raw.question || raw.title || '',
    slug: raw.slug || '',
    category: raw.category || 'unknown',
    end_date_iso: raw.end_date_iso || raw.endDateIso || raw.endDate || '',
    active: raw.active ?? true,
    closed: raw.closed ?? false,
    tokens: (raw.tokens || []).map((t: any) => ({
      token_id: String(t.token_id ?? t.tokenId ?? t.asset_id ?? t.asset ?? ''),
      outcome: String(t.outcome ?? t.name ?? ''),
      price: parseFloat(String(t.price ?? t.lastPrice ?? '0')) || 0,
    })),
    volume: parseFloat(raw.volume) || 0,
    liquidity: parseFloat(raw.liquidity) || 0,
    spread: parseFloat(raw.spread) || 0,
  };
}


// ============================================================
// BATCH OPERATIONS — For efficiency during polling cycles
// ============================================================

/**
 * Get prices for multiple tokens at once.
 * Returns a Map of tokenId -> midpoint price.
 */
export async function batchGetPrices(tokenIds: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  // --- Polymarket doesn't have a batch endpoint, so we parallelize ---
  const results = await Promise.allSettled(
    tokenIds.map(async (id) => {
      const mid = await getMidpoint(id);
      if (mid !== null) prices.set(id, mid);
    })
  );

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    console.warn(`[POLYMARKET] batchGetPrices: ${failed}/${tokenIds.length} failed`);
  }

  return prices;
}
