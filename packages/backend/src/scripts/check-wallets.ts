import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DATA_API = process.env.DATA_API_URL || 'https://data-api.polymarket.com';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[CHECK] FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[CHECK] HTTP ${res.status} ${url}`);
      console.error('[CHECK] Body:', body.slice(0, 250));
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('[CHECK] Fetch error:', url, (err as Error).message);
    return null;
  }
}

function toIsoOrNull(x: unknown): string | null {
  if (typeof x === 'number' && Number.isFinite(x)) {
    const ms = x < 10_000_000_000 ? x * 1000 : x;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof x === 'string' && x) {
    const asNum = Number(x);
    if (!Number.isNaN(asNum) && Number.isFinite(asNum)) {
      const ms = asNum < 10_000_000_000 ? asNum * 1000 : asNum;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function staleFlag(lastIso: string | null): boolean {
  if (!lastIso) return true;
  const then = new Date(lastIso).getTime();
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return now - then > sevenDaysMs;
}

async function main() {
  console.log('[CHECK] Loading tracked wallets...');

  const { data: wallets, error } = await supabase
    .from('tracked_wallets')
    .select('label,address,tier,is_active')
    .order('label', { ascending: true });

  if (error) {
    console.error('[CHECK] Supabase error:', error.message);
    process.exit(1);
  }

  if (!wallets || wallets.length === 0) {
    console.log('[CHECK] No tracked wallets found.');
    return;
  }

  for (const w of wallets) {
    await sleep(1000);

    const data = await fetchJson(`${DATA_API}/trades?user=${w.address}&limit=3`);
    const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

    const lastTradeRaw = rows[0]?.timestamp ?? rows[0]?.createdAt ?? rows[0]?.time;
    const lastTradeIso = toIsoOrNull(lastTradeRaw);
    const isStale = staleFlag(lastTradeIso);

    const flag = isStale ? 'STALE' : 'OK';
    console.log(
      `[CHECK] ${w.label || 'unlabeled'} | ${w.address} | last_trade_time=${lastTradeIso || 'none'} | trade_count=${rows.length} | ${flag}`
    );
  }

  console.log('[CHECK] Done.');
}

main().catch((err) => {
  console.error('[CHECK] Fatal:', err);
  process.exitCode = 1;
});
