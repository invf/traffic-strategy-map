const API_URL = import.meta.env.VITE_API_URL;

const LANG_NAMES = { en: 'English', uk: 'Ukrainian', ru: 'Russian' };

// Node type → hex color
const NODE_COLORS = {
  idea:      '#8b5cf6',
  channel:   '#3b82f6',
  hypothesis:'#f59e0b',
  action:    '#22c55e',
  test:      '#f97316',
  result:    '#06b6d4',
  nextStep:  '#ec4899',
};

function buildSystemPrompt(language) {
  const langName = LANG_NAMES[language] || 'English';
  const year = new Date().getFullYear();
  return `You are a senior growth marketing strategist. The current year is ${year}.
All advice, channel recommendations, platform trends, algorithm insights, and statistics must reflect ${year} reality. Never reference ${year - 1} or earlier as "current trends".

🌐 LANGUAGE REQUIREMENT (highest priority rule):
Every single string value in your JSON response MUST be written in ${langName}.
This applies without exception to: node labels, descriptions, context fields, actionPlan fields, channel names, rationales, timelines, weaknesses, hypotheses, ad messages, post ideas — everything.
Do NOT mix languages. Do NOT use English if the required language is not English.

Generate a complete, personalized traffic strategy map as a JSON object.
Return ONLY a JSON object (no markdown, no explanation) with exactly these keys: "nodes", "edges", "aiSuggestions".

━━ NODES ━━
Array of 10–13 nodes. Each node:
{
  "id": "n1",
  "type": "custom",
  "position": { "x": <number>, "y": <number> },
  "data": {
    "label": "<max 35 chars, in ${langName}>",
    "nodeType": "idea"|"channel"|"hypothesis"|"action"|"test"|"result"|"nextStep",
    "status": "todo",
    "priority": "low"|"medium"|"high",
    "color": "<hex from nodeType>",
    "description": "<1–2 specific sentences in ${langName}>",
    "context": {
      "why": "<in ${langName}>",
      "product": "<in ${langName}>",
      "audience": "<in ${langName}>",
      "expectedResult": "<in ${langName}>"
    },
    "actionPlan": {
      "todo": "<in ${langName}>",
      "tools": "<tool names only, commas>",
      "kpi": "<in ${langName}>",
      "deadline": "",
      "executionStatus": "pending"
    },
    "comments": []
  }
}

Node type colors (use exactly):
idea=#8b5cf6  channel=#3b82f6  hypothesis=#f59e0b  action=#22c55e
test=#f97316  result=#06b6d4   nextStep=#ec4899

Position grid — use ONLY these coordinates:
Row 1 (y=40):   1 central node → x=440
Row 2 (y=280):  2–3 nodes → x=80, 440, 800
Row 3 (y=520):  3–4 nodes → x=80, 440, 800, 1160
Row 4 (y=760):  3–4 nodes → x=80, 440, 800, 1160
Row 5 (y=1000): 2 nodes → x=260, 620

Structure flow: Row1=strategy goal → Row2=research/analysis → Row3=main channels → Row4=execution actions → Row5=results+next steps

━━ EDGES ━━
Array of directed edges connecting nodes logically:
{
  "id": "e_n1_n2",
  "source": "n1",
  "target": "n2",
  "type": "custom",
  "animated": false,
  "data": {
    "edgeStyle": "sequence"|"flow"|"dependency"|"triggers"|"weak",
    "pathType": "smoothstep"
  }
}
Use "animated": true for the main strategic flow (2–3 key edges).
edgeStyle: "flow"=main path, "sequence"=step-by-step, "dependency"=requires, "triggers"=causes, "weak"=optional

━━ AI SUGGESTIONS ━━
All text in ${langName}.
{
  "channels": [
    { "channel": string, "priority": "High"|"Medium"|"Low", "rationale": string, "timeline": string, "budget": string, "actions": [string, string, string] }
  ],
  "contentIdeas": [
    { "type": string, "title": string, "platform": string, "format": string }
  ],
  "weaknesses": [string × 5],
  "hypotheses": [
    { "hypothesis": string, "experiment": string, "metric": string }
  ],
  "adMessages": [
    { "type": string, "headline": string, "body": string, "cta": string }
  ],
  "postIdeas": {
    "twitter": [string, string, string],
    "reddit": [string, string, string],
    "youtubeShorts": [string, string, string]
  }
}
Include 4 channels, 5 content ideas, 5 weaknesses, 3 hypotheses, 4 ad messages.
ALL content must be specifically tailored to the product — no generic placeholders.`;
}

function buildUserPrompt(p) {
  return `Generate a traffic strategy map for this product:

Product name: ${p.name}
Description: ${p.description}
Target audience: ${p.audience}
Primary goal: ${p.goal} (${goalLabel(p.goal)})
Target markets: ${(p.countries || []).join(', ') || 'Global'}
Monthly budget: ${p.budget || 'Not specified'}

Make every node, action, KPI, and suggestion SPECIFIC to this product and audience.
Every label, description, and recommendation must reference "${p.name}" or the product's actual use case — no generic marketing templates.`;
}

function goalLabel(g) {
  const map = {
    traffic:     'grow website/app traffic',
    sales:       'drive revenue and sales',
    signups:     'increase user registrations',
    installs:    'boost app installs',
    subscribers: 'grow subscriber base',
  };
  return map[g] || g;
}

function validateResponse(data) {
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('Invalid response structure from AI');
  }
  // Ensure required fields on each node
  data.nodes = data.nodes.map((n, i) => ({
    id: n.id || `n${i + 1}`,
    type: 'custom',
    position: n.position || { x: 440, y: 40 + i * 200 },
    data: {
      label: n.data?.label || 'Node',
      nodeType: n.data?.nodeType || 'action',
      status: 'todo',
      priority: n.data?.priority || 'medium',
      color: NODE_COLORS[n.data?.nodeType] || '#6366f1',
      description: n.data?.description || '',
      context: {
        why: n.data?.context?.why || '',
        product: n.data?.context?.product || '',
        audience: n.data?.context?.audience || '',
        expectedResult: n.data?.context?.expectedResult || '',
      },
      actionPlan: {
        todo: n.data?.actionPlan?.todo || '',
        tools: n.data?.actionPlan?.tools || '',
        kpi: n.data?.actionPlan?.kpi || '',
        deadline: '',
        executionStatus: 'pending',
      },
      comments: [],
    },
  }));

  data.edges = data.edges.map((e, i) => ({
    id: e.id || `e_${i}`,
    source: e.source,
    target: e.target,
    type: 'custom',
    animated: e.animated || false,
    data: {
      edgeStyle: e.data?.edgeStyle || 'sequence',
      pathType: 'smoothstep',
    },
  }));

  return data;
}

export async function generateStrategyWithAI(productInfo, language = 'en') {
  if (!API_URL) throw new Error('VITE_API_URL не вказано у .env');

  const res = await fetch(`${API_URL}/api/openai`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.75,
      response_format: { type: 'json_object' },
      max_tokens: 6000,
      messages: [
        { role: 'system', content: buildSystemPrompt(language) },
        { role: 'user',   content: buildUserPrompt(productInfo) },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI помилка ${res.status}`);
  }

  const json = await res.json();
  const raw = JSON.parse(json.choices[0].message.content);
  return validateResponse(raw);
}
