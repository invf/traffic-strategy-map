import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

const app = express();

const allowedOrigin = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: allowedOrigin, methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '2mb' }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/openai', async (req, res) => {
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
