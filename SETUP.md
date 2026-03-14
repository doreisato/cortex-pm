# CORTEX-PM SETUP

Convergence Oracle for Real-Time Edge Extraction. Prediction Markets.


## PREREQUISITES

1. Node.js 20+
2. Supabase account (free tier works)
3. Polygon wallet with private key (for Polymarket CLOB auth)
4. Telegram bot token (for alerts)
5. Railway account (backend deploy)
6. Vercel account (frontend deploy)


## STEP 1: SUPABASE

1. Create project at supabase.com
2. Go to SQL Editor
3. Paste contents of `packages/backend/src/db/schema.sql`
4. Run it
5. Copy: Project URL, anon key, service role key

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
```


## STEP 2: POLYMARKET API ACCESS

No API key needed for read-only operations (market data, order books, trades).

For trade execution (paper trading submits real orders in future):
1. Export private key from Polymarket account settings
2. Or generate a new Polygon wallet

```
POLYGON_PRIVATE_KEY=0x...
POLYGON_ADDRESS=0x...
```

Endpoints used:
- CLOB API: https://clob.polymarket.com
- Data API: https://data-api.polymarket.com
- Gamma API: https://gamma-api.polymarket.com


## STEP 3: TELEGRAM BOT

1. Message @BotFather on Telegram
2. /newbot -> name it "CORTEX-PM"
3. Copy the token
4. Message your bot, then hit: https://api.telegram.org/bot<TOKEN>/getUpdates
5. Copy your chat_id from the response

```
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
```


## STEP 4: BACKEND ENV

Create `packages/backend/.env`:

```env
PORT=4000
NODE_ENV=development

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Polymarket
CLOB_API_URL=https://clob.polymarket.com
DATA_API_URL=https://data-api.polymarket.com
GAMMA_API_URL=https://gamma-api.polymarket.com
POLYGON_PRIVATE_KEY=0x...
POLYGON_ADDRESS=0x...

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789

# Convergence
CONVERGENCE_WINDOW_MINUTES=10
CONVERGENCE_MIN_WALLETS=3
CONVERGENCE_MIN_SCORE=60
POLL_INTERVAL_MS=10000
PRICE_TRACK_INTERVAL_MS=300000
```


## STEP 5: FRONTEND ENV

Create `packages/frontend/.env`:

```env
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000
```


## STEP 6: INSTALL AND RUN

```bash
# From project root
cd cortex-pm

# Install backend
cd packages/backend
npm install
npm run dev

# In another terminal, install frontend
cd packages/frontend
npm install
npm run dev
```

Backend: http://localhost:4000
Frontend: http://localhost:5173


## STEP 7: SEED WALLETS

Add tracked wallets via API or Supabase dashboard:

```bash
curl -X POST http://localhost:4000/api/wallets \
  -H "Content-Type: application/json" \
  -d '{"address": "0x...", "label": "whale_1", "tier": "A"}'
```

Find whale wallets:
- Polymarket leaderboard profiles
- Use PROXY address, not EOA
- Tools: predicts.guru, polywallet.xyz, predscan.com


## STEP 8: DEPLOY

Backend (Railway):
```bash
cd packages/backend
railway init
railway up
```

Frontend (Vercel):
```bash
cd packages/frontend
vercel --prod
```

Update frontend env: `VITE_API_URL` and `VITE_WS_URL` to Railway URL.


## STEP 9: VERIFY

1. Dashboard loads with live market data
2. Wallet trades appear in scanner feed
3. Convergence events trigger Telegram alerts
4. Paper trades auto-open on convergence signals
5. Equity curve updates with paper trade P&L
