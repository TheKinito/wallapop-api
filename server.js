const express = require('express');
const { chromium } = require('playwright');
const https = require('https');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function newBrowser() {
  return await chromium.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process']
  });
}

// ── BUSCAR en Wallapop ──
app.get('/search', async (req, res) => {
  const { q = '', minPrice = '', maxPrice = '', condition = '', order = 'newest', limit = 24 } = req.query;
  if (!q.trim()) return res.status(400).json({ error: 'Parametro q requerido' });

  const cacheKey = `${q}|${minPrice}|${maxPrice}|${condition}|${order}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return res.json({ ...cached.data, fromCache: true });

  let browser = null;
  try {
    browser = await newBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      locale: 'es-ES',
      viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,otf}', r => r.abort());

    const params = new URLSearchParams({ keywords: q, order_by: order });
    if (minPrice) params.append('min_sale_price', minPrice);
    if (maxPrice) params.append('max_sale_price', maxPrice);
    if (condition) params.append('condition', condition);

    const url = `https://es.wallapop.com/app/search?${params}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    try {
      await page.click('#onetrust-accept-btn-handler', { timeout: 4000 });
      await page.waitForTimeout(1000);
    } catch (_) {}

    await page.waitForSelector('a[href*="/item/"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(500);
    }

    const items = await page.evaluate((maxItems) => {
      const results = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="/item/"]').forEach(card => {
        if (results.length >= maxItems) return;
        const href = card.href || '';
        if (!href.includes('/item/') || seen.has(href)) return;
        seen.add(href);
        const idMatch = href.match(/\/item\/([^/?#]+)/);
        const id = idMatch ? idMatch[1] : null;
        const container = card.closest('[class*="Card"],[class*="card"],li,article') || card;
        const titleEl = container.querySelector('[class*="title"],[class*="Title"],h2,h3') || card;
        const title = titleEl?.textContent?.trim() || '';
        if (!title || title.length < 3) return;
        const priceEl = container.querySelector('[class*="price"],[class*="Price"]');
        const priceText = priceEl?.textContent?.trim() || '';
        const price = parseFloat(priceText.replace(/[^0-9,.]/g, '').replace(',', '.')) || 0;
        const imgEl = container.querySelector('img');
        const imageUrl = imgEl?.src || imgEl?.getAttribute('data-src') || '';
        const locEl = container.querySelector('[class*="location"],[class*="Location"],[class*="city"]');
        const location = locEl?.textContent?.trim() || '';
        const descEl = container.querySelector('[class*="description"],[class*="Description"]');
        const description = descEl?.textContent?.trim() || '';
        results.push({ id, title, price, priceText, imageUrl, location, description, url: href });
      });
      return results;
    }, parseInt(limit));

    const result = { query: q, total: items.length, items, wallapopUrl: url, scrapedAt: new Date().toISOString() };
    cache.set(cacheKey, { data: result, ts: Date.now() });
    res.json(result);

  } catch (err) {
    console.error('Error search:', err.message);
    res.status(500).json({ error: err.message, query: q });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ── DETALLE de un item ──
app.get('/item/:id', async (req, res) => {
  const { id } = req.params;
  const cacheKey = `item_${id}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return res.json({ ...cached.data, fromCache: true });

  let browser = null;
  try {
    browser = await newBrowser();
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', locale: 'es-ES' });
    const page = await context.newPage();
    await page.goto(`https://es.wallapop.com/item/${id}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    try { await page.click('#onetrust-accept-btn-handler', { timeout: 3000 }); } catch (_) {}
    await page.waitForTimeout(2000);
    const detail = await page.evaluate(() => {
      const getText = sel => document.querySelector(sel)?.textContent?.trim() || '';
      const title = getText('h1');
      const priceText = getText('[class*="price"],[class*="Price"]');
      const price = parseFloat(priceText.replace(/[^0-9,.]/g, '').replace(',', '.')) || 0;
      const description = getText('[class*="description"],[class*="Description"]');
      const condition = getText('[class*="condition"],[class*="Condition"]');
      const location = getText('[class*="location"],[class*="Location"]');
      const images = [...document.querySelectorAll('img')].map(i => i.src).filter(s => s && s.includes('cdn') && !s.includes('avatar')).slice(0, 5);
      return { title, price, priceText, description, condition, location, images };
    });
    cache.set(cacheKey, { data: detail, ts: Date.now() });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ── IA DE REPARACIÓN usando https nativo (sin fetch) ──
app.post('/ai', async (req, res) => {
  const { messages, system } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ error: 'messages requerido' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: system || 'Eres un experto en reparación de electrónica. Responde en español.',
    messages
  });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  };

  const request = https.request(options, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) return res.status(400).json({ error: parsed.error.message || 'Error de Anthropic' });
        const reply = parsed.content?.map(b => b.text || '').join('\n') || '';
        res.json({ reply });
      } catch (e) {
        res.status(500).json({ error: 'Error parseando respuesta: ' + data.slice(0, 200) });
      }
    });
  });

  request.on('error', (err) => {
    console.error('HTTPS error:', err.message);
    res.status(500).json({ error: err.message });
  });

  request.write(body);
  request.end();
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'wallapop-scraper' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API corriendo en puerto ${PORT}`));
