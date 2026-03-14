// ============================================================
// CORTEX-PM: Main Entry Point
// Convergence Oracle for Real-Time Edge Extraction
// Prediction Markets Edition
//
// Boot sequence:
//   1. Load config
//   2. Start Express + WebSocket server
//   3. Initialize services (wallet tracker, convergence, paper trader)
//   4. Start polling loops
//   5. Broadcast events to connected frontends via WebSocket
// ============================================================

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import apiRoutes from './routes/api.js';
import { initWalletTracker, startPolling, stopPolling } from './services/wallet-tracker.js';
import { initConvergenceDetector, startDetection, stopDetection, convergenceEvents } from './services/convergence.js';
import { initPaperTrader, startPaperTrader, stopPaperTrader } from './services/paper-trader.js';
import { walletEvents } from './services/wallet-tracker.js';

// ============================================================
// Express app
// ============================================================
const app = express();
app.use(cors());
app.use(express.json());

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'cortex-pm',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// --- API routes ---
app.use('/api', apiRoutes);

// ============================================================
// HTTP + WebSocket server
// ============================================================
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// --- Track connected clients ---
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected (${clients.size} total)`);
  });

  // --- Send initial state ---
  ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
});

// --- Broadcast helper ---
function broadcast(type: string, data: any): void {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// ============================================================
// Initialize services
// ============================================================
console.log('');
console.log('  ◆ CORTEX-PM');
console.log('  Convergence Oracle for Real-Time Edge Extraction');
console.log('  Prediction Markets Edition');
console.log('');

initWalletTracker();
initConvergenceDetector();
initPaperTrader();

// ============================================================
// Wire up event broadcasting
// ============================================================

// --- New trades detected → broadcast to dashboard ---
walletEvents.on('new_trades', (data) => {
  broadcast('new_trades', {
    wallet: data.wallet.label,
    count: data.count,
    trades: data.trades.slice(0, 5), // send max 5 for preview
  });
});

// --- Convergence signal → broadcast to dashboard ---
convergenceEvents.on('convergence', (event) => {
  broadcast('convergence', {
    id: event.id,
    market: event.market_question,
    outcome: event.outcome,
    score: event.signal_score,
    wallets: event.wallet_count,
    price: event.price_at_detection,
  });
});

// ============================================================
// Start server + polling loops
// ============================================================
server.listen(config.port, () => {
  console.log(`[SERVER] Listening on port ${config.port}`);
  console.log(`[SERVER] API: http://localhost:${config.port}/api`);
  console.log(`[SERVER] WS:  ws://localhost:${config.port}/ws`);
  console.log('');

  // --- Start all polling loops ---
  startPolling();
  startDetection();
  startPaperTrader();

  console.log('[SERVER] All systems active ◆');
});

let shuttingDown = false;
function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SERVER] Shutting down gracefully... (${signal})`);

  stopPolling();
  stopDetection();
  stopPaperTrader();

  for (const c of clients) {
    try { c.close(); } catch {}
  }

  const hardTimeout = setTimeout(() => {
    console.error('[SERVER] Forced shutdown after timeout');
    process.exit(1);
  }, 5000);

  server.close(() => {
    clearTimeout(hardTimeout);
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
