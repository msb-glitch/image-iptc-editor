require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // For large image data

app.post('/api/generate-caption', async (req, res) => {
  console.log('Received request with body length:', req.body?.messages?.length);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': req.headers.referer || 'http://localhost:8080'
      },
      body: JSON.stringify(req.body),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const responseText = await response.text();

    if (!response.ok) {
      console.error('API Error:', response.status, responseText);
      return res.status(502).json({ error: `Upstream error: ${response.status}` });
    }

    res.json(JSON.parse(responseText));
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: error.name === 'AbortError' ? 'Request timeout' : error.message 
    });
  }
});

app.listen(3000, () => console.log('Server ready'));