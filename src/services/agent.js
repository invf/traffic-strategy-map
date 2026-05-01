const API_URL = import.meta.env.VITE_API_URL;
const LANG_NAMES = { en: 'English', uk: 'Ukrainian', ru: 'Russian' };

function taskPrompt(nodeType, node, productInfo, langName, year = new Date().getFullYear()) {
  const ctx = `
Product: ${productInfo.name || '—'}
Description: ${productInfo.description || '—'}
Audience: ${productInfo.audience || '—'}
Goal: ${productInfo.goal || '—'}

Block label: "${node.data.label}"
Block description: ${node.data.description || '—'}
Why it matters: ${node.data.context?.why || '—'}
Expected result: ${node.data.context?.expectedResult || '—'}
Action plan: ${node.data.actionPlan?.todo || '—'}
KPI: ${node.data.actionPlan?.kpi || '—'}
`.trim();

  const tasks = {
    idea: `
Analyze this idea for "${productInfo.name}" and deliver:
1. Market signals (3 reasons this idea is worth pursuing right now)
2. Top 3 competitors doing something similar — name them, describe the gap
3. Unique angle: how to differentiate this idea from competitors
4. 5 viral discussion hooks (for Twitter/Reddit threads) about this idea space
5. 8 search queries the user should run (Google, Reddit, Twitter) to validate demand
6. 2-week quick-win validation plan (what to do, what to measure)
`,
    channel: `
Build a viral content execution plan for this channel. Deliver:
1. What content formats go viral on this platform in ${year} (3-4 formats with examples based on current algorithm trends)
2. 5 ready-to-publish viral post templates (full text, not stubs)
3. 7 search queries to find trending conversations to join on this platform right now
4. 10 hashtags / subreddits / communities that are active in ${year}
5. 7-day posting schedule (day, format, topic, best time)
6. Engagement tactics: how to start conversations, get shares, build following in ${year}
7. Exact KPIs to track and targets for week 1
`,
    action: `
Break this action into an executable micro-plan for "${productInfo.name}":
1. Prerequisites (what must be true/ready before starting)
2. Step-by-step execution: 12-15 specific steps with ownership and time estimate
3. Write 3 ready-to-use templates/scripts needed for this action
4. Tools with exact setup notes (not just tool names)
5. How to know it worked in 48 hours (leading indicators)
6. Top 3 blockers and how to prevent them
`,
    hypothesis: `
Design a rigorous growth experiment for this hypothesis about "${productInfo.name}":
1. Precise null hypothesis (H0) and alternative hypothesis (H1)
2. Experiment design: control vs treatment (what exactly changes)
3. Target sample size and how to reach it
4. Exact tracking setup: events, tools, UTM parameters
5. Timeline: when to start reading results
6. Decision matrix: if result = X → do Y (3 scenarios)
7. What to do if hypothesis is confirmed vs rejected
`,
    test: `
Create a complete A/B test plan for "${productInfo.name}":
1. Write out Variant A and Variant B in full (exact copy, design notes)
2. Traffic split: what % to each variant and why
3. Step-by-step tool setup (Google Optimize / VWO / custom)
4. Minimum detectable effect and required sample size
5. Events to track with exact implementation code snippets
6. Duration: how many days and why
7. Decision rules: when to stop early, when to declare winner
`,
    result: `
Interpret this result for "${productInfo.name}" and generate insights:
1. What the data is telling us — 3 interpretations (optimistic / neutral / pessimistic)
2. Root cause analysis: why this result happened
3. What to do next based on this result (3 concrete actions)
4. Hypothesis for the next experiment
5. How to present this to stakeholders (3 key talking points + 1 chart recommendation)
6. What to watch for in the next 30 days
`,
    nextStep: `
Build a prioritized roadmap for "${productInfo.name}" next steps:
1. Top 3 highest-impact actions ranked by effort vs impact (include ICE score)
2. Execution sequence: what blocks what
3. Resource needs: people, tools, budget estimates
4. 30 / 60 / 90 day milestones with success criteria
5. Top 3 risks and mitigation strategies
6. 3 quick wins to do this week to maintain momentum
7. North Star metric and how this roadmap moves it
`,
  };

  const task = tasks[nodeType] || tasks.action;

  return `You are an expert growth marketer and execution specialist for "${productInfo.name}".

CONTEXT:
${ctx}

TASK:
${task}

RULES:
- Write ALL output in ${langName}
- Be SPECIFIC to "${productInfo.name}" — no generic advice, reference the actual product
- Include real examples, write full templates (not "[insert text here]" stubs)
- Every item must be immediately actionable

Return ONLY valid JSON:
{
  "summary": "2-3 sentence executive summary of the key insight and top action",
  "sections": [
    {
      "title": "Section title in ${langName}",
      "type": "list" | "templates" | "schedule" | "queries" | "steps",
      "items": ["item 1", "item 2"]
    }
  ],
  "quickWins": ["action 1", "action 2", "action 3"],
  "copyables": [
    { "label": "Name of this template/query", "content": "full ready-to-use text" }
  ]
}`;
}

export async function runNodeAgent(node, productInfo, language = 'en') {
  if (!API_URL) throw new Error('VITE_API_URL not set in .env');

  const langName = LANG_NAMES[language] || 'English';
  const nodeType = node.data?.nodeType || 'action';
  const currentYear = new Date().getFullYear();

  const res = await fetch(`${API_URL}/api/openai`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.8,
      response_format: { type: 'json_object' },
      max_tokens: 4000,
      messages: [
        {
          role: 'system',
          content: `You are an expert growth marketer. The current year is ${currentYear}. All advice, trends, platform features, algorithms, and statistics must reflect ${currentYear} reality — never reference ${currentYear - 1} or earlier years as "current". Return ONLY valid JSON. Write all text content in ${langName}.`,
        },
        {
          role: 'user',
          content: taskPrompt(nodeType, node, productInfo, langName, currentYear),
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI error ${res.status}`);
  }

  const json = await res.json();
  const raw = JSON.parse(json.choices[0].message.content);

  return {
    summary: raw.summary || '',
    sections: Array.isArray(raw.sections) ? raw.sections : [],
    quickWins: Array.isArray(raw.quickWins) ? raw.quickWins : [],
    copyables: Array.isArray(raw.copyables) ? raw.copyables : [],
    nodeId: node.id,
    nodeType,
    timestamp: new Date().toISOString(),
  };
}
