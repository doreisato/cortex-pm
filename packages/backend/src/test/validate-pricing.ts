import { getMarkets, getMidpoint, getPrice, getOrderBook, type PolymarketMarket } from '../services/polymarket.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(...args: any[]) {
  console.log('[TEST]', ...args);
}

function fmt(n: number | null | undefined, d = 3) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return n.toFixed(d);
}

function pickYesNoTokens(m: PolymarketMarket) {
  const yes = m.tokens.find((t) => /yes/i.test(t.outcome));
  const no = m.tokens.find((t) => /no/i.test(t.outcome));

  // Fallback: some markets use non-Yes/No labels; use first 2 tokens.
  const t0 = m.tokens[0];
  const t1 = m.tokens[1];

  return {
    yes: yes ?? t0 ?? null,
    no: no ?? (t0 === yes ? t1 : t0) ?? null,
  };
}

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const out = await fn();
    return out;
  } catch (err) {
    log(`${label} ERROR:`, (err as Error).message);
    return null;
  }
}

async function main() {
  log('Pricing validation start');

  const markets = await safe('getMarkets', () => getMarkets({ limit: 5, active: true, closed: false }));
  if (!markets || markets.length === 0) {
    log('No markets returned. Exiting.');
    return;
  }

  const top = markets.slice(0, 5);
  const rows: Array<{ question: string; yesMid: number | null; noMid: number | null; sum: number | null; spread: number | null; bids: number; asks: number; flags: string[]; }> = [];

  for (const m of top) {
    const { yes, no } = pickYesNoTokens(m);

    if (!yes || !no) {
      log(`Skipping market (missing 2 tokens): ${m.question}`);
      continue;
    }

    const flags: string[] = [];

    const yesMid = await safe(`getMidpoint yes ${yes.tokenId ?? yes.token_id}`, () => getMidpoint((yes.tokenId ?? yes.token_id)!));
    await sleep(500);
    const noMid = await safe(`getMidpoint no ${no.tokenId ?? no.token_id}`, () => getMidpoint((no.tokenId ?? no.token_id)!));
    await sleep(500);

    const yesBid = await safe(`getPrice BUY yes`, () => getPrice((yes.tokenId ?? yes.token_id)!, 'BUY'));
    await sleep(500);
    const yesAsk = await safe(`getPrice SELL yes`, () => getPrice((yes.tokenId ?? yes.token_id)!, 'SELL'));
    await sleep(500);

    const noBid = await safe(`getPrice BUY no`, () => getPrice((no.tokenId ?? no.token_id)!, 'BUY'));
    await sleep(500);
    const noAsk = await safe(`getPrice SELL no`, () => getPrice((no.tokenId ?? no.token_id)!, 'SELL'));
    await sleep(500);

    const yesBook = await safe(`getOrderBook yes`, () => getOrderBook((yes.tokenId ?? yes.token_id)!));
    await sleep(500);
    const noBook = await safe(`getOrderBook no`, () => getOrderBook((no.tokenId ?? no.token_id)!));
    await sleep(500);

    const yesSpread = yesBid !== null && yesAsk !== null ? Math.abs(yesAsk - yesBid) : null;
    const noSpread = noBid !== null && noAsk !== null ? Math.abs(noAsk - noBid) : null;

    if (yesSpread !== null && yesSpread > 0.1) flags.push('LOW_LIQUIDITY_YES');
    if (noSpread !== null && noSpread > 0.1) flags.push('LOW_LIQUIDITY_NO');

    const sum = yesMid !== null && noMid !== null ? yesMid + noMid : null;
    if (sum !== null && Math.abs(sum - 1) > 0.05) flags.push('PARITY_VIOLATION');

    const spread = yesSpread !== null && noSpread !== null ? Math.max(yesSpread, noSpread) : (yesSpread ?? noSpread ?? null);
    const bids = (yesBook?.bids?.length || 0) + (noBook?.bids?.length || 0);
    const asks = (yesBook?.asks?.length || 0) + (noBook?.asks?.length || 0);

    rows.push({
      question: m.question,
      yesMid,
      noMid,
      sum,
      spread,
      bids,
      asks,
      flags,
    });
  }

  const header = [
    'Market Question'.padEnd(44),
    'Yes Mid'.padStart(8),
    'No Mid'.padStart(8),
    'Yes+No'.padStart(8),
    'Spread'.padStart(8),
    'Depth(b)'.padStart(9),
    'Depth(a)'.padStart(9),
    'Flags',
  ].join(' | ');

  log('');
  log(header);
  log('-'.repeat(header.length));

  for (const r of rows) {
    console.log(
      [
        r.question.slice(0, 44).padEnd(44),
        fmt(r.yesMid).padStart(8),
        fmt(r.noMid).padStart(8),
        fmt(r.sum).padStart(8),
        fmt(r.spread).padStart(8),
        String(r.bids).padStart(9),
        String(r.asks).padStart(9),
        r.flags.join(',') || '-',
      ].join(' | ')
    );
  }

  const parityViolations = rows.filter((r) => r.flags.includes('PARITY_VIOLATION')).length;
  const lowLiquidity = rows.filter((r) => r.flags.some((f) => f.startsWith('LOW_LIQUIDITY'))).length;

  log('');
  log(`Markets checked: ${rows.length}`);
  log(`Parity violations (> $0.05 from $1.00): ${parityViolations}`);
  log(`Low liquidity flags (spread > $0.10): ${lowLiquidity}`);
  log('Pricing validation done');
}

main().catch((err) => {
  console.error('[TEST] Fatal:', err);
  process.exitCode = 1;
});
