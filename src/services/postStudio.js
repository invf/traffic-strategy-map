const API_URL = import.meta.env.VITE_API_URL;

function buildSystemPrompt(productInfo, language) {
  const langInstruction = language === 'en'
    ? 'English only'
    : language === 'uk'
      ? 'Ukrainian only — native social media style'
      : 'Russian only — native social media style';

  return `You are a senior growth marketer for ${productInfo.name || 'this product'}.

Product:
${productInfo.description || '—'}
Target audience: ${productInfo.audience || '—'}
Primary goal: ${productInfo.goal || '—'}

Your job:
Generate viral X (Twitter) posts that create curiosity, urgency, and demand for this product.

Rules:
- ${langInstruction}
- Short, sharp, native X style (max 280 chars per post)
- No fake claims or fabricated statistics
- No guaranteed profit or result claims
- No hashtags unless completely natural
- Avoid sounding like an ad
- Mention ${productInfo.name || 'the product'} only when it feels natural and earned
- Current year is ${new Date().getFullYear()} — reference current trends, not outdated ones`;
}

function buildGenerationPrompt(topic, productInfo) {
  return `Topic: ${topic}

Generate 10 X posts for ${productInfo.name || 'this product'}.

Each post must follow one of these angles:
1. Loss shock — trigger fear of a costly mistake
2. Market psychology — expose irrational human behavior
3. Anti-hype — contrarian take that stops the scroll
4. Common mistake — "most people do this wrong"
5. Sentiment warning — "something is off in the market/space"
6. Insider insight — feels like exclusive knowledge

Return JSON only (array of 10 objects):
[
  {
    "post": "full post text, ready to publish",
    "angle": "angle name from the list above",
    "cta": "what action you want the reader to take",
    "why_it_might_work": "1 sentence explanation of the psychological hook"
  }
]`;
}

function buildScoringPrompt(posts, productName) {
  return `Score these X posts for ${productName || 'this product'} marketing.

Scoring criteria (0–100 each):
- virality_score: likelihood of shares, replies, bookmarks
- ctr_score: likelihood reader clicks profile or link
- controversy_score: will it spark debate (higher = more debate)
- product_fit_score: how naturally it promotes ${productName}
- risk_score: 0 = safe, 100 = sounds like financial advice / fake claim / misleading

final_score formula: (virality×0.30 + ctr×0.25 + product_fit×0.25 + controversy×0.10) − (risk×0.25)
Clamp final_score to 0–100.

verdict rules:
- "use" if final_score ≥ 65 and risk_score ≤ 30
- "edit" if final_score 40–64 OR risk_score 31–55
- "reject" if final_score < 40 OR risk_score > 55

Posts to score:
${JSON.stringify(posts, null, 2)}

Return JSON only (same order as input, array of objects):
[
  {
    "post": "exact post text",
    "virality_score": 0,
    "ctr_score": 0,
    "controversy_score": 0,
    "product_fit_score": 0,
    "risk_score": 0,
    "final_score": 0,
    "verdict": "use | edit | reject",
    "reason": "1 sentence on why this score"
  }
]`;
}

async function callOpenAI(systemPrompt, userPrompt) {
  if (!API_URL) throw new Error('VITE_API_URL not set in .env');

  const res = await fetch(`${API_URL}/api/openai`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.9,
      response_format: { type: 'json_object' },
      max_tokens: 3000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI error ${res.status}`);
  }

  const json = await res.json();
  const raw = json.choices[0].message.content;

  // Handle both array and {posts:[]} wrapper responses
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  const firstArray = Object.values(parsed).find(Array.isArray);
  if (firstArray) return firstArray;
  throw new Error('Unexpected response format');
}

export async function runPostStudio(topic, productInfo, language = 'en', onStep) {
  const sysPrompt = buildSystemPrompt(productInfo, language);

  onStep?.('generating');
  const posts = await callOpenAI(sysPrompt, buildGenerationPrompt(topic, productInfo));

  onStep?.('scoring');
  const scored = await callOpenAI(
    'You are a marketing analyst. Return only valid JSON array. Be strict about risk_score for any financial/misleading content.',
    buildScoringPrompt(posts, productInfo.name)
  );

  // Merge generation data with scores, sort best first
  const merged = scored
    .map((s, i) => ({
      ...s,
      angle: posts[i]?.angle || '',
      cta: posts[i]?.cta || '',
      why_it_might_work: posts[i]?.why_it_might_work || '',
      final_score: Math.max(0, Math.min(100, Number(s.final_score) || 0)),
    }))
    .sort((a, b) => b.final_score - a.final_score);

  return merged;
}
