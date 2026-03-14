import dotenv from 'dotenv';

dotenv.config();

function log(...args: any[]) {
  console.log('[TEST-TELEGRAM]', ...args);
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    log('SKIP: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
    return;
  }

  // Force enable for this test run even if .env has TELEGRAM_ENABLED=false
  process.env.TELEGRAM_ENABLED = 'true';

  const API_BASE = `https://api.telegram.org/bot${token}`;

  // 1-3) direct test message + verify HTTP 200
  const pingBody = {
    chat_id: chatId,
    text: '◆ CORTEX-PM: Test alert. System online.',
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  const pingRes = await fetch(`${API_BASE}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pingBody),
  });

  if (!pingRes.ok) {
    const body = await pingRes.text();
    log('FAIL direct test message HTTP', pingRes.status, body);
    process.exit(1);
  }

  const pingJson = await pingRes.json();
  log('OK direct test message:', pingJson?.ok === true ? 'ok' : 'unknown');

  // import after env is set so config sees TELEGRAM_ENABLED=true
  const { sendConvergenceAlert, sendTradeAlert } = await import('../services/telegram.js');

  // 4) mock convergence alert
  const convergenceEvent = {
    market_slug: 'eth-updown-5m-1773499800',
    market_question: 'Ethereum <Up/Down> test & validation',
    outcome: 'Yes',
    signal_score: 75,
    wallet_count: 3,
    wallet_labels: ['whale_01', 'whale_02', 'whale_03'],
    total_buy_usd: 1234.56,
    price_at_detection: 0.55,
  };

  try {
    await sendConvergenceAlert(convergenceEvent);
    log('OK sendConvergenceAlert');
  } catch (err) {
    log('FAIL sendConvergenceAlert', (err as Error).message);
  }

  // 5) mock trade alerts open + close
  const openTrade = {
    market_question: 'Ethereum <Up/Down> test & validation',
    outcome: 'Yes',
    entry_price: 0.55,
    cost_basis: 100,
  };

  const closeTrade = {
    market_question: 'Ethereum <Up/Down> test & validation',
    outcome: 'Yes',
    exit_price: 0.62,
    realized_pnl: 12.73,
    close_reason: 'take_profit & lock-in',
  };

  try {
    await sendTradeAlert(openTrade, 'OPEN');
    log('OK sendTradeAlert OPEN');
  } catch (err) {
    log('FAIL sendTradeAlert OPEN', (err as Error).message);
  }

  try {
    await sendTradeAlert(closeTrade, 'CLOSE');
    log('OK sendTradeAlert CLOSE');
  } catch (err) {
    log('FAIL sendTradeAlert CLOSE', (err as Error).message);
  }

  log('validate-telegram complete');
}

main().catch((err) => {
  console.error('[TEST-TELEGRAM] Fatal:', err);
  process.exitCode = 1;
});
