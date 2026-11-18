import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createRequireAuth } from './middleware/requireAuth.js';
import { createRequireEntitlement } from './middleware/requireEntitlement.js';
import { checkEntitlement, recordUsage } from './lib/entitlements.js';
dotenv.config();

const app = express();

const allowedOrigin = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: allowedOrigin, methods: ['GET', 'POST', 'OPTIONS'] }));
// AUTH-003A: tightened from 2mb - a chat-completions request body is
// text, not media; 2mb was far more than this endpoint ever needed and
// was itself a minor abuse surface on an otherwise-unauthenticated route.
app.use(express.json({ limit: '256kb' }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// AUTH-003A: this route is gated behind requireAuth + requireEntitlement
// below - see docs/AUTH_003A_SETUP_CHECKLIST.md for what must be
// configured (TRAFFIC_STRATEGY_MAP_DB_URL, the traffic_strategy_map_app
// role) before this takes effect in Production. Until that setup is
// done, requireAuth still rejects any request with no valid token
// (fails closed), so this is safe to deploy ahead of the entitlement
// wiring being fully live - it only makes the endpoint STRICTER, never
// looser, at every step.
const requireAuth = createRequireAuth();
const requireEntitlement = createRequireEntitlement({ checkEntitlement, recordUsage });

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/openai', requireAuth, requireEntitlement, async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: { message: 'OPENAI_API_KEY not configured on server' } });
  }
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
