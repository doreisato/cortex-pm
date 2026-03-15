// ============================================================
// CORTEX-PM: Lightweight Sentiment Service (Layer 2)
// Optional sentiment enrichment for convergence events.
// Never throws; always returns SentimentResult.
// ============================================================

export interface SentimentResult {
  score: number; // -1 bearish .. +1 bullish
  confidence: number; // 0..1
  narrative: string; // 2 sentence summary
  sources_checked: number;
  positive_signals: string[];
  negative_signals: string[];
  searched_at: string;
}

const STOP = new Set(['will', 'the', 'in', 'on', 'at', 'of', 'for', 'to', 'a', 'an', 'and', 'or', 'is', 'are', 'be', 'with', 'by', 'from', 'this', 'that', 'it']);

function fallback(narrative = 'Sentiment analysis not configured'): SentimentResult {
  return {
    score: 0,
    confidence: 0,
    narrative,
    sources_checked: 0,
    positive_signals: [],
    negative_signals: [],
    searched_at: new Date().toISOString(),
  };
}

function extractKeywords(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 8);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export async function analyzeSentiment(params: {
  marketQuestion: string;
  outcome: string;
  currentPrice: number;
}): Promise<SentimentResult> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const out = fallback('Sentiment analysis not configured');
      console.log(`[SENTIMENT] Analyzing: ${params.marketQuestion} → score: ${out.score}`);
      return out;
    }

    const keywords = extractKeywords(params.marketQuestion);
    const prompt = `Analyze market sentiment for this prediction market.
Question: ${params.marketQuestion}
Outcome focus: ${params.outcome}
Current price: ${params.currentPrice}
Keywords: ${keywords.join(', ')}

Return STRICT JSON with keys:
score (number -1 to 1), confidence (0 to 1), narrative (2 short sentences),
sources_checked (integer), positive_signals (string[]), negative_signals (string[]).`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9500);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 300,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const out = fallback(`Sentiment API unavailable (HTTP ${res.status})`);
      console.log(`[SENTIMENT] Analyzing: ${params.marketQuestion} → score: ${out.score}`);
      return out;
    }

    const body: any = await res.json();
    const txt = body?.content?.[0]?.text || '';

    let parsed: any = null;
    try {
      parsed = JSON.parse(txt);
    } catch {
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      const out = fallback('Sentiment parse fallback');
      console.log(`[SENTIMENT] Analyzing: ${params.marketQuestion} → score: ${out.score}`);
      return out;
    }

    const out: SentimentResult = {
      score: clamp(Number(parsed.score ?? 0), -1, 1),
      confidence: clamp(Number(parsed.confidence ?? 0), 0, 1),
      narrative: String(parsed.narrative ?? 'Sentiment unavailable'),
      sources_checked: Number(parsed.sources_checked ?? 0) || 0,
      positive_signals: Array.isArray(parsed.positive_signals) ? parsed.positive_signals.map(String).slice(0, 6) : [],
      negative_signals: Array.isArray(parsed.negative_signals) ? parsed.negative_signals.map(String).slice(0, 6) : [],
      searched_at: new Date().toISOString(),
    };

    console.log(`[SENTIMENT] Analyzing: ${params.marketQuestion} → score: ${out.score}`);
    return out;
  } catch (err) {
    const out = fallback((err as Error).name === 'AbortError' ? 'Sentiment analysis timeout' : 'Sentiment analysis failed');
    console.log(`[SENTIMENT] Analyzing: ${params.marketQuestion} → score: ${out.score}`);
    return out;
  }
}
