import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PolymarketMarket, PolymarketTrade } from '../services/polymarket.js';

type CompareResult = {
  expected: string[];
  actual: string[];
  matching: string[];
  missingFromActual: string[];
  unexpectedInActual: string[];
  notes: string[];
};

type FetchOk = { ok: true; status: number; data: any };
type FetchFail = { ok: false; status: number; body: string };
type FetchResult = FetchOk | FetchFail;

function log(...args: any[]) {
  console.log('[TEST]', ...args);
}

function getKeys(obj: any): string[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.keys(obj).sort();
}

function compareFields(expected: string[], actual: string[]): CompareResult {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const matching = expected.filter((k) => actualSet.has(k)).sort();
  const missingFromActual = expected.filter((k) => !actualSet.has(k)).sort();
  const unexpectedInActual = actual.filter((k) => !expectedSet.has(k)).sort();

  return {
    expected: [...expected].sort(),
    actual: [...actual].sort(),
    matching,
    missingFromActual,
    unexpectedInActual,
    notes: [],
  };
}

async function safeFetchJson(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.text();
      log(`Request failed: ${url} -> ${res.status}`);
      log('Failure body:', body);
      return { ok: false, status: res.status, body };
    }
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (err) {
    const msg = (err as Error).message;
    log(`Fetch error: ${url} -> ${msg}`);
    return { ok: false, status: 0, body: msg };
  }
}

function isArray(data: any): data is any[] {
  return Array.isArray(data);
}

async function main() {
  log('Starting API validation...');

  const marketExpectedFields = [
    'id',
    'question',
    'slug',
    'category',
    'end_date_iso',
    'active',
    'closed',
    'tokens',
    'volume',
    'liquidity',
    'spread',
  ] satisfies Array<keyof PolymarketMarket>;

  const tokenExpectedFields = ['token_id', 'outcome', 'price'];

  const tradeExpectedFields = [
    'id',
    'taker_order_id',
    'market',
    'asset_id',
    'side',
    'size',
    'price',
    'timestamp',
    'outcome',
    'trader',
    'transaction_hash',
  ] satisfies Array<keyof PolymarketTrade>;

  const reportLines: string[] = [];
  reportLines.push('# API SHAPE REPORT');
  reportLines.push('');
  reportLines.push(`Generated: ${new Date().toISOString()}`);
  reportLines.push('');

  // 1) Gamma
  const gammaUrl = 'https://gamma-api.polymarket.com/markets?limit=3&active=true';
  log('Gamma request:', gammaUrl);
  const gammaResult = await safeFetchJson(gammaUrl);

  let tokenIdForStep2: string | null = null;

  if (!gammaResult.ok) {
    reportLines.push('## 1) Gamma API');
    reportLines.push('');
    reportLines.push(`- ❌ Request failed: status=${gammaResult.status}`);
    reportLines.push('');
    reportLines.push('```text');
    reportLines.push(gammaResult.body);
    reportLines.push('```');
    reportLines.push('');
  } else {
    const markets = gammaResult.data;
    const firstMarket = isArray(markets) ? markets[0] : null;

    log('Gamma first market (FULL RAW):');
    console.log(JSON.stringify(firstMarket, null, 2));

    const marketActualFields = getKeys(firstMarket);
    const marketCmp = compareFields([...marketExpectedFields], marketActualFields);

    const tokenRaw = Array.isArray(firstMarket?.tokens) ? firstMarket.tokens[0] : null;
    const tokenActualFields = getKeys(tokenRaw);
    const tokenCmp = compareFields(tokenExpectedFields, tokenActualFields);

    const hasConditionId = Boolean(firstMarket && 'condition_id' in firstMarket);
    const hasId = Boolean(firstMarket && 'id' in firstMarket);
    const slugValue = firstMarket?.slug;

    const clobTokenIdsRaw = firstMarket?.clobTokenIds;
    let clobTokenIds: string[] = [];
    if (typeof clobTokenIdsRaw === 'string') {
      try {
        const parsed = JSON.parse(clobTokenIdsRaw);
        if (Array.isArray(parsed)) clobTokenIds = parsed.filter((x) => typeof x === 'string');
      } catch {
        // ignore parse issue
      }
    } else if (Array.isArray(clobTokenIdsRaw)) {
      clobTokenIds = clobTokenIdsRaw.filter((x: any) => typeof x === 'string');
    }

    tokenIdForStep2 = tokenRaw?.token_id ?? tokenRaw?.asset_id ?? clobTokenIds[0] ?? null;

    if (hasConditionId && hasId) {
      marketCmp.notes.push('Both condition_id and id exist in market payload.');
    } else if (hasConditionId) {
      marketCmp.notes.push('condition_id exists; id may need mapping from condition_id.');
    } else if (hasId) {
      marketCmp.notes.push('id exists; condition_id missing.');
    } else {
      marketCmp.notes.push('Neither id nor condition_id found.');
    }

    if (typeof slugValue !== 'string') {
      marketCmp.notes.push(`slug is not string (type=${typeof slugValue}).`);
    } else {
      marketCmp.notes.push(`slug sample: ${slugValue}`);
    }

    if ('end_date_iso' in (firstMarket || {})) {
      marketCmp.notes.push('end_date_iso present.');
    } else {
      const endDateCandidates = marketActualFields.filter((k) => k.includes('end') || k.includes('date'));
      marketCmp.notes.push(`end_date_iso missing; date-like fields: ${endDateCandidates.join(', ') || '(none)'}`);
    }

    reportLines.push('## 1) Gamma API');
    reportLines.push('');
    reportLines.push(`- URL: \`${gammaUrl}\``);
    reportLines.push(`- Status: ${gammaResult.status}`);
    reportLines.push(`- First market token picked for CLOB test: ${tokenIdForStep2 ?? '(none found)'}`);
    reportLines.push('');
    reportLines.push('### First market (raw)');
    reportLines.push('```json');
    reportLines.push(JSON.stringify(firstMarket, null, 2));
    reportLines.push('```');
    reportLines.push('');

    reportLines.push('### Market field comparison');
    reportLines.push(`- Fields that match: ${marketCmp.matching.join(', ') || '(none)'}`);
    reportLines.push(`- Fields that need renaming / are missing in real payload: ${marketCmp.missingFromActual.join(', ') || '(none)'}`);
    reportLines.push(`- Fields missing from our type (unexpected in real payload): ${marketCmp.unexpectedInActual.join(', ') || '(none)'}`);
    for (const note of marketCmp.notes) reportLines.push(`- Note: ${note}`);
    reportLines.push('');

    reportLines.push('### Tokens[0] field comparison');
    reportLines.push(`- Fields that match: ${tokenCmp.matching.join(', ') || '(none)'}`);
    reportLines.push(`- Fields that need renaming / are missing in real payload: ${tokenCmp.missingFromActual.join(', ') || '(none)'}`);
    reportLines.push(`- Fields missing from our token type: ${tokenCmp.unexpectedInActual.join(', ') || '(none)'}`);
    reportLines.push('');
  }

  // 2) CLOB midpoint
  reportLines.push('## 2) CLOB API midpoint');
  reportLines.push('');

  if (!tokenIdForStep2) {
    log('No token_id found from Gamma; skipping CLOB midpoint test.');
    reportLines.push('- ⚠️ Skipped: no token_id found from Gamma response.');
    reportLines.push('');
  } else {
    const clobUrl = `https://clob.polymarket.com/midpoint?token_id=${encodeURIComponent(tokenIdForStep2)}`;
    log('CLOB request:', clobUrl);
    const clobResult = await safeFetchJson(clobUrl);

    if (!clobResult.ok) {
      reportLines.push(`- ❌ Request failed: status=${clobResult.status}`);
      reportLines.push('```text');
      reportLines.push(clobResult.body);
      reportLines.push('```');
      reportLines.push('');
    } else {
      const clobRaw = clobResult.data;
      log('CLOB midpoint raw response:');
      console.log(JSON.stringify(clobRaw, null, 2));

      const keys = getKeys(clobRaw);
      const hasMidString = typeof clobRaw?.mid === 'string';

      reportLines.push(`- URL: \`${clobUrl}\``);
      reportLines.push(`- Status: ${clobResult.status}`);
      reportLines.push('');
      reportLines.push('### Raw response');
      reportLines.push('```json');
      reportLines.push(JSON.stringify(clobRaw, null, 2));
      reportLines.push('```');
      reportLines.push('');
      reportLines.push(`- Keys: ${keys.join(', ') || '(none)'}`);
      reportLines.push(`- Expected shape { mid: string }: ${hasMidString ? '✅ yes' : '❌ no'}`);
      reportLines.push('');
    }
  }

  // 3) Data API trades
  const dataUrl = 'https://data-api.polymarket.com/trades?limit=3';
  reportLines.push('## 3) Data API trades');
  reportLines.push('');
  log('Data API request:', dataUrl);
  const dataResult = await safeFetchJson(dataUrl);

  if (!dataResult.ok) {
    reportLines.push(`- ❌ Request failed: status=${dataResult.status}`);
    reportLines.push('```text');
    reportLines.push(dataResult.body);
    reportLines.push('```');
    reportLines.push('');
  } else {
    const trades = dataResult.data;
    const firstTrade = isArray(trades) ? trades[0] : null;
    log('Data API first trade (FULL RAW):');
    console.log(JSON.stringify(firstTrade, null, 2));

    const tradeActualFields = getKeys(firstTrade);
    const tradeCmp = compareFields([...tradeExpectedFields], tradeActualFields);

    const marketField =
      'market' in (firstTrade || {})
        ? 'market'
        : ('condition_id' in (firstTrade || {})
          ? 'condition_id'
          : ('conditionId' in (firstTrade || {}) ? 'conditionId' : '(neither)'));

    const tokenField =
      'asset_id' in (firstTrade || {})
        ? 'asset_id'
        : ('token_id' in (firstTrade || {})
          ? 'token_id'
          : ('asset' in (firstTrade || {}) ? 'asset' : '(neither)'));

    const walletCandidates = ['maker_address', 'taker_address', 'trader', 'user', 'owner', 'wallet', 'proxyWallet', 'makerAddress', 'takerAddress'];
    const walletPresent = walletCandidates.filter((k) => k in (firstTrade || {}));

    reportLines.push(`- URL: \`${dataUrl}\``);
    reportLines.push(`- Status: ${dataResult.status}`);
    reportLines.push('');
    reportLines.push('### First trade (raw)');
    reportLines.push('```json');
    reportLines.push(JSON.stringify(firstTrade, null, 2));
    reportLines.push('```');
    reportLines.push('');

    reportLines.push('### Trade field comparison');
    reportLines.push(`- Fields that match: ${tradeCmp.matching.join(', ') || '(none)'}`);
    reportLines.push(`- Fields that need renaming / are missing in real payload: ${tradeCmp.missingFromActual.join(', ') || '(none)'}`);
    reportLines.push(`- Fields missing from our type (unexpected in real payload): ${tradeCmp.unexpectedInActual.join(', ') || '(none)'}`);
    reportLines.push('');

    reportLines.push('### Required documentation checks');
    reportLines.push(`- Is field "market" or "condition_id"? **${marketField}**`);
    reportLines.push(`- Is field "asset_id" or "token_id"? **${tokenField}**`);
    reportLines.push(`- Wallet address fields seen: **${walletPresent.join(', ') || '(none obvious)'}**`);
    reportLines.push('');
  }

  const outPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'API-SHAPE-REPORT.md');
  await writeFile(outPath, reportLines.join('\n'), 'utf8');

  log('Wrote report:', outPath);
  log('Done.');
}

main().catch((err) => {
  console.error('[TEST] Fatal error:', err);
  process.exitCode = 1;
});
