// ============================================================
// CORTEX-PM: Telegram Alerts
// Sends convergence signals and trade updates to Telegram.
// ============================================================

import { config } from '../config.js';

const API_BASE = `https://api.telegram.org/bot${config.telegram.botToken}`;

function esc(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function send(text: string): Promise<void> {
  if (!config.telegram.enabled || !config.telegram.botToken || !config.telegram.chatId) {
    console.log('[TELEGRAM] Disabled or not configured, skipping alert');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegram.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      console.error(`[TELEGRAM] Send failed: HTTP ${res.status}`);
    } else {
      console.log('[TELEGRAM] Alert sent');
    }
  } catch (err) {
    console.error('[TELEGRAM] Error:', (err as Error).message);
  }
}

export async function sendConvergenceAlert(event: any): Promise<void> {
  const emoji = event.signal_score >= 80 ? '🔴' : event.signal_score >= 60 ? '🟡' : '⚪';
  const polymarketUrl = `https://polymarket.com/event/${encodeURIComponent(String(event.market_slug || ''))}`;

  const text = [
    `${emoji} <b>CORTEX CONVERGENCE SIGNAL</b>`,
    ``,
    `<b>Market:</b> ${esc(event.market_question)}`,
    `<b>Outcome:</b> ${esc(event.outcome)}`,
    `<b>Score:</b> ${esc(event.signal_score)}/100`,
    `<b>Wallets:</b> ${esc(event.wallet_count)} (${esc((event.wallet_labels || []).join(', '))})`,
    `<b>Total USD:</b> $${Number(event.total_buy_usd || 0).toFixed(2)}`,
    `<b>Price:</b> $${Number(event.price_at_detection || 0).toFixed(3)}`,
    ``,
    `<a href="${polymarketUrl}">View on Polymarket</a>`,
  ].join('\n');

  await send(text);
}

export async function sendTradeAlert(trade: any, action: 'OPEN' | 'CLOSE'): Promise<void> {
  const emoji = action === 'OPEN' ? '📈' : trade.realized_pnl > 0 ? '✅' : '❌';

  const text = [
    `${emoji} <b>PAPER TRADE ${action}</b>`,
    ``,
    `<b>Market:</b> ${esc(trade.market_question)}`,
    `<b>Side:</b> ${esc(trade.outcome)}`,
    action === 'OPEN'
      ? `<b>Entry:</b> $${Number(trade.entry_price || 0).toFixed(3)} | Size: $${Number(trade.cost_basis || 0).toFixed(2)}`
      : `<b>Exit:</b> $${Number(trade.exit_price || 0).toFixed(3)} | PnL: $${Number(trade.realized_pnl || 0).toFixed(2)}`,
    action === 'CLOSE' ? `<b>Reason:</b> ${esc(trade.close_reason)}` : '',
  ].filter(Boolean).join('\n');

  await send(text);
}
