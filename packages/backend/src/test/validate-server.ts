import WebSocket from 'ws';

const BASE = 'http://localhost:4000';

function log(...args: any[]) {
  console.log('[TEST-SERVER]', ...args);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function hit(path: string, validate: (json: any) => string | null) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`);
    const ms = Date.now() - t0;
    const json = await res.json();
    const err = validate(json);
    if (!res.ok || err) {
      log(`FAIL ${path} status=${res.status} time=${ms}ms reason=${err || 'non-200'}`);
      return false;
    }
    log(`OK   ${path} status=${res.status} time=${ms}ms shape=${shapeSummary(json)}`);
    return true;
  } catch (e) {
    const ms = Date.now() - t0;
    log(`FAIL ${path} time=${ms}ms error=${(e as Error).message}`);
    return false;
  }
}

function shapeSummary(json: any): string {
  if (Array.isArray(json)) return `array(len=${json.length})`;
  if (json && typeof json === 'object') return `object(keys=${Object.keys(json).slice(0, 8).join(',')})`;
  return typeof json;
}

async function testWs() {
  return new Promise<boolean>((resolve) => {
    const ws = new WebSocket('ws://localhost:4000/ws');
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        log('FAIL WS timeout waiting for connected message');
        ws.close();
        resolve(false);
      }
    }, 5000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type === 'connected') {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            log('OK   WS connected message received');
            ws.close();
            resolve(true);
          }
        }
      } catch {
        // ignore
      }
    });

    ws.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        log('FAIL WS error:', (err as Error).message);
        resolve(false);
      }
    });
  });
}

async function main() {
  log('Waiting 5s for server startup...');
  await sleep(5000);

  const checks: Array<Promise<boolean>> = [
    hit('/health', (j) => (j?.status === 'ok' ? null : 'status != ok')),
    hit('/api/dashboard', (j) => (j?.convergence && j?.paperTrading && j?.equityCurve !== undefined ? null : 'missing dashboard keys')),
    hit('/api/convergence', (j) => (Array.isArray(j) ? null : 'not array')),
    hit('/api/convergence/stats', (j) => (j && 'win_rate' in j ? null : 'missing win_rate')),
    hit('/api/positions', (j) => (j?.stats !== undefined && Array.isArray(j?.openPositions) && Array.isArray(j?.recentClosed) ? null : 'missing positions shape')),
    hit('/api/trades', (j) => (Array.isArray(j) ? null : 'not array')),
    hit('/api/wallets', (j) => (Array.isArray(j) ? null : 'not array')),
    hit('/api/markets', (j) => (Array.isArray(j) ? null : 'not array')),
    hit('/api/config', (j) => (j?.convergence && j?.paper_trading ? null : 'missing config keys')),
  ];

  const results = await Promise.all(checks);
  const wsOk = await testWs();

  const failed = results.filter((x) => !x).length + (wsOk ? 0 : 1);
  if (failed > 0) {
    log(`Completed with ${failed} failures`);
    process.exitCode = 1;
  } else {
    log('All endpoint + WS checks passed');
  }
}

main().catch((e) => {
  console.error('[TEST-SERVER] Fatal:', e);
  process.exitCode = 1;
});
