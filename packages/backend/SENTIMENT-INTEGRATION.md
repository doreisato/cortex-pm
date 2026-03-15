# SENTIMENT-INTEGRATION.md

## Overview
Layer 2 sentiment enrichment runs **after** a convergence event is inserted.
It is optional and non-blocking.

## Service
- File: `src/services/sentiment.ts`
- Function: `analyzeSentiment({ marketQuestion, outcome, currentPrice })`
- Timeout: <10 seconds (9.5s abort)
- Never throws; always returns a `SentimentResult`

## Env
- `ANTHROPIC_API_KEY` (optional)
- If missing, returns neutral result:
  - `score: 0`
  - `confidence: 0`
  - narrative: `Sentiment analysis not configured`

## Data flow
1. Convergence detector inserts event.
2. Sentiment service runs asynchronously.
3. Event row is updated with:
   - `sentiment_score`
   - `sentiment_narrative`
4. Telegram alert includes sentiment section if present.
5. Frontend SignalCard displays sentiment score + narrative.

## Safety
- Sentiment failures do not block event creation.
- All sentiment outcomes are logged with `[SENTIMENT]` breadcrumbs.
