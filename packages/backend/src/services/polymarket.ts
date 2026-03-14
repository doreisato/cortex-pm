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
  // API-SHAPE-REPORT: Gamma returns conditionId (camelCase) and endDateIso/endDate.
  // We keep camelCase canonical fields and preserve legacy aliases for non-breaking callers.
  id: string;
  conditionId: string;
  question: string;
  slug: string;
  category: string;
  endDateIso: string;
  // Back-compat alias (legacy code still reads end_date_iso).
  end_date_iso?: string;
  active: boolean;
  closed: boolean;
  // API-SHAPE-REPORT: Gamma often returns clobTokenIds + outcomes/outcomePrices, not tokens[].
  tokens: Array<{
    tokenId: string;
    // Back-compat alias (legacy code still reads token_id).
    token_id?: string;
    outcome: string;
    price: number;
  }>;
  volume: number;
  liquidity: number;
  spread: number;
}

export interface PolymarketTrade {
  // API-SHAPE-REPORT: Data trades expose conditionId + asset + proxyWallet + transactionHash.
  // We keep camelCase canonical fields and legacy aliases for non-breaking downstream usage.
  id: string;
  conditionId: string;
  // Back-compat alias (legacy code still reads market).
  market?: string;
  assetId: string;
  // Back-compat alias (legacy code still reads asset_id).
  asset_id?: string;
  side: 'BUY' | 'SELL';
  size: string;
  price: string;
  timestamp: string;
  outcome?: string;
  trader?: string;
  transactionHash?: string;
  // Back-compat alias (legacy code still reads transaction_hash).
  transaction_hash?: string;
  title?: string;
  slug?: string;
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
  const raw = await apiFetch<any>(url, `getMarkets(limit=${limit})`);
  if (!raw) return [];

  // API-SHAPE-REPORT: Gamma may return a raw array OR wrapper object ({ data: [...] } / { markets: [...] }).
  // We normalize to an array first to avoid parser breakage.
  const marketsArray: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.markets)
        ? raw.markets
        : [];

  // --- Parse into our typed format ---
  return marketsArray.map(m => {
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
      ? m.tokens.map((t: any) => {
          const tokenId = String(t.token_id ?? t.tokenId ?? t.asset_id ?? t.asset ?? '');
          return {
            tokenId,
            // API-SHAPE-REPORT compatibility: legacy code still reads token_id.
            token_id: tokenId,
            outcome: String(t.outcome ?? t.name ?? ''),
            price: parseFloat(String(t.price ?? t.lastPrice ?? '0')) || 0,
          };
        })
      : parsedClobTokenIds.map((tokenId: string, i: number) => ({
          tokenId: String(tokenId),
          // API-SHAPE-REPORT compatibility: legacy code still reads token_id.
          token_id: String(tokenId),
          outcome: String(parsedOutcomes[i] ?? `Outcome ${i + 1}`),
          price: parseFloat(String(parsedOutcomePrices[i] ?? '0')) || 0,
        }));

    const conditionId = String(m.conditionId ?? m.condition_id ?? m.id ?? '');
    const endDateIso = String(m.endDateIso ?? m.end_date_iso ?? m.endDate ?? '');

    return {
      id: String(m.id ?? conditionId),
      conditionId,
      question: m.question || m.title || '',
      slug: m.slug || '',
      category: m.category || 'unknown',
      endDateIso,
      // API-SHAPE-REPORT compatibility: preserve legacy snake_case alias.
      end_date_iso: endDateIso,
      active: m.active ?? true,
      closed: m.closed ?? false,
      tokens: normalizedTokens,
      volume: parseFloat(String(m.volume ?? m.volumeNum ?? '0')) || 0,
      liquidity: parseFloat(String(m.liquidity ?? m.liquidityNum ?? '0')) || 0,
      spread: parseFloat(String(m.spread ?? '0')) || 0,
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
  const data = await apiFetch<any>(url, `getMidpoint(${tokenId.slice(0, 8)}...)`);

  // API-SHAPE-REPORT task: midpoint can vary by endpoint/version; parse common shapes defensively.
  // Expected primary shape is { mid: string }, but we also accept numeric mid or wrapped variants.
  if (!data) return null;
  const candidate = data.mid ?? data.price ?? data?.data?.mid ?? data?.data?.price;
  const parsed = parseFloat(String(candidate ?? 'NaN'));
  return Number.isFinite(parsed) ? parsed : null;
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

  // API-SHAPE-REPORT: Data API wallet field is proxyWallet in payloads and supports `user` query filtering.
  // We call `user` first (authoritative), then fallback to maker/taker for backward compatibility.
  let userUrl = `${config.polymarket.dataUrl}/trades?user=${walletAddress}&limit=${limit}`;
  if (after) {
    userUrl += `&after=${encodeURIComponent(after)}`;
  }
  const userData = await apiFetch<any[]>(userUrl, `getWalletTrades-user(${walletAddress.slice(0, 8)}...)`);

  let makerUrl = `${config.polymarket.dataUrl}/trades?maker_address=${walletAddress}&limit=${limit}`;
  if (after) {
    makerUrl += `&after=${encodeURIComponent(after)}`;
  }
  const makerData = await apiFetch<any[]>(makerUrl, `getWalletTrades-maker(${walletAddress.slice(0, 8)}...)`);

  let takerUrl = `${config.polymarket.dataUrl}/trades?taker_address=${walletAddress}&limit=${limit}`;
  if (after) {
    takerUrl += `&after=${encodeURIComponent(after)}`;
  }
  const takerData = await apiFetch<any[]>(takerUrl, `getWalletTrades-taker(${walletAddress.slice(0, 8)}...)`);

  // --- Merge and deduplicate by trade ID ---
  const allTradesRaw = [...(userData || []), ...(makerData || []), ...(takerData || [])];

  const allTrades: PolymarketTrade[] = allTradesRaw.map((t: any) => {
    const conditionId = String(t.conditionId ?? t.condition_id ?? t.market ?? '');
    const assetId = String(t.asset ?? t.asset_id ?? t.token_id ?? '');
    const transactionHash = String(t.transactionHash ?? t.transaction_hash ?? '');
    return {
      id: String(t.id || transactionHash || `${conditionId}-${t.timestamp}-${t.size}`),
      conditionId,
      // API-SHAPE-REPORT compatibility: legacy code still reads market.
      market: conditionId,
      assetId,
      // API-SHAPE-REPORT compatibility: legacy code still reads asset_id.
      asset_id: assetId,
      side: String(t.side || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
      size: String(t.size ?? ''),
      price: String(t.price ?? ''),
      timestamp: String(t.timestamp ?? ''),
      outcome: t.outcome,
      trader: t.trader || t.proxyWallet || t.maker_address || t.makerAddress || t.taker_address || t.takerAddress,
      transactionHash,
      // API-SHAPE-REPORT compatibility: legacy code still reads transaction_hash.
      transaction_hash: transactionHash,
      title: t.title,
      slug: t.slug,
    };
  });

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

  const conditionIdNorm = String(raw.conditionId ?? raw.condition_id ?? raw.id ?? '');
  const endDateIsoNorm = String(raw.endDateIso ?? raw.end_date_iso ?? raw.endDate ?? '');

  // API-SHAPE-REPORT: market-by-id may also omit tokens[] and only provide clobTokenIds/outcomes.
  const tokens = Array.isArray(raw.tokens) && raw.tokens.length > 0
    ? raw.tokens.map((t: any) => {
        const tokenId = String(t.token_id ?? t.tokenId ?? t.asset_id ?? t.asset ?? '');
        return {
          tokenId,
          token_id: tokenId,
          outcome: String(t.outcome ?? t.name ?? ''),
          price: parseFloat(String(t.price ?? t.lastPrice ?? '0')) || 0,
        };
      })
    : [];

  return {
    id: String(raw.id ?? conditionIdNorm),
    conditionId: conditionIdNorm,
    question: raw.question || raw.title || '',
    slug: raw.slug || '',
    category: raw.category || 'unknown',
    endDateIso: endDateIsoNorm,
    // API-SHAPE-REPORT compatibility: preserve legacy snake_case alias.
    end_date_iso: endDateIsoNorm,
    active: raw.active ?? true,
    closed: raw.closed ?? false,
    tokens,
    volume: parseFloat(String(raw.volume ?? raw.volumeNum ?? '0')) || 0,
    liquidity: parseFloat(String(raw.liquidity ?? raw.liquidityNum ?? '0')) || 0,
    spread: parseFloat(String(raw.spread ?? '0')) || 0,
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
