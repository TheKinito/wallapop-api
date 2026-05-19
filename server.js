const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

// CORS — permite peticiones desde tu web de Vercel
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Cache simple para no spammear Wallapop
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });
  }
  return browser;
}

// ── ENDPOINT PRINCIPAL: buscar en Wallapop ──
app.get('/search', async (req, res) => {
  const {
    q = '',
    minPrice = '',
    maxPrice = '',
    condition = '',
    order = 'newest',
    limit = 24
  } = req.query;

  if (!q.trim()) {
    return res.status(400).json({ error: 'Parámetro q requerido' });
  }

  const cacheKey = `${q}|${minPrice}|${maxPrice}|${condition}|${order}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json({ ...cached.data, fromCache: true });
  }

  let context = null;
  let page = null;

  try {
    const b = await getBrowser();
    context = await b.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      locale: 'es-ES',
      viewport: { width: 1280, height: 900 }
    });
    page = await context.newPage();

    // Bloquear imágenes y fuentes para ir más rápido
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,otf}', r => r.abort());

    // Construir URL de búsqueda
    const params = new URLSearchParams({ keywords: q, order_by: order });
    if (minPrice) params.append('min_sale_price', minPrice);
    if (maxPrice) params.append('max_sale_price', maxPrice);
    if (condition) params.append('condition', condition);

    const url = `https://es.wallapop.com/app/search?${params}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Aceptar cookies si aparece el banner
    try {
      const cookieBtn = page.locator('button[id*="accept"], button:has-text("Aceptar"), button:has-text("Accept")').first();
      await cookieBtn.click({ timeout: 3000 });
      await page.waitForTimeout(800);
    } catch (_) {}

    // Esperar a que carguen los resultados
    await page.waitForSelector('[class*="ItemCard"], [data-testid*="item"], a[href*="/item/"]', {
      timeout: 15000
    }).catch(() => {});

    // Scroll suave para cargar más resultados
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(600);
    }

    // Extraer items
    const items = await page.evaluate((maxItems) => {
      const results = [];

      // Intentar varios selectores según la versión de Wallapop
      const cards = document.querySelectorAll([
        'a[href*="/item/"]',
        '[class*="ItemCard"]',
        '[data-testid="item-card"]',
        '.ItemCardList__item',
        '[class*="item-card"]'
      ].join(', '));

      const seen = new Set();

      cards.forEach(card => {
        if (results.length >= maxItems) return;

        const anchor = card.tagName === 'A' ? card : card.querySelector('a[href*="/item/"]');
        if (!anchor) return;

        const href = anchor.href || anchor.getAttribute('href') || '';
        if (!href.includes('/item/') || seen.has(href)) return;
        seen.add(href);

        // Extraer id del item de la URL
        const idMatch = href.match(/\/item\/([^/?#]+)/);
        const id = idMatch ? idMatch[1] : null;

        // Título
        const titleEl = card.querySelector('[class*="title"], [class*="Title"], h2, h3, [class*="name"], [class*="Name"]');
        const title = titleEl?.textContent?.trim() || '';
        if (!title) return;

        // Precio
        const priceEl = card.querySelector('[class*="price"], [class*="Price"]');
        const priceText = priceEl?.textContent?.trim() || '';
        const priceNum = parseFloat(priceText.replace(/[^0-9,.]/g, '').replace(',', '.')) || 0;

        // Imagen
        const img = card.querySelector('img');
        const imageUrl = img?.src || img?.getAttribute('data-src') || '';

        // Ubicación
        const locEl = card.querySelector('[class*="location"], [class*="Location"], [class*="city"]');
        const location = locEl?.textContent?.trim() || '';

        // Descripción corta si está visible
        const descEl = card.querySelector('[class*="description"], [class*="Description"]');
        const description = descEl?.textContent?.trim() || '';

        results.push({ id, title, price: priceNum, priceText, imageUrl, location, description, url: href });
      });

      return results;
    }, parseInt(limit));

    const result = {
      query: q,
      total: items.length,
      items,
      wallapopUrl: url,
      scrapedAt: new Date().toISOString()
    };

    cache.set(cacheKey, { data: result, ts: Date.now() });
    res.json(result);

  } catch (err) {
    console.error('Error scraping:', err.message);
    res.status(500).json({ error: err.message, query: q });
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
});

// ── ENDPOINT: detalle de un item ──
app.get('/item/:id', async (req, res) => {
  const { id } = req.params;
  const cacheKey = `item_${id}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json({ ...cached.data, fromCache: true });
  }

  let context = null;
  let page = null;

  try {
    const b = await getBrowser();
    context = await b.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      locale: 'es-ES'
    });
    page = await context.newPage();
    await page.route('**/*.{woff,woff2,ttf,otf}', r => r.abort());

    await page.goto(`https://es.wallapop.com/item/${id}`, { waitUntil: 'networkidle', timeout: 25000 });

    try {
      const cookieBtn = page.locator('button:has-text("Aceptar"), button:has-text("Accept")').first();
      await cookieBtn.click({ timeout: 2000 });
    } catch (_) {}

    const detail = await page.evaluate(() => {
      const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
      const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';

      const title = getText('h1, [class*="title"], [class*="Title"]');
      const priceText = getText('[class*="price"], [class*="Price"]');
      const price = parseFloat(priceText.replace(/[^0-9,.]/g, '').replace(',', '.')) || 0;
      const description = getText('[class*="description"], [class*="Description"], [data-testid="description"]');
      const condition = getText('[class*="condition"], [class*="Condition"]');
      const location = getText('[class*="location"], [class*="Location"]');
      const seller = getText('[class*="seller"], [class*="Seller"], [class*="user"], [class*="User"]');

      const images = [...document.querySelectorAll('img[src*="cdn"], img[src*="wallapop"]')]
        .map(img => img.src)
        .filter(src => src && !src.includes('avatar') && !src.includes('icon'))
        .slice(0, 6);

      const tags = [...document.querySelectorAll('[class*="tag"], [class*="Tag"], [class*="badge"]')]
        .map(t => t.textContent.trim())
        .filter(Boolean)
        .slice(0, 8);

      return { title, price, priceText, description, condition, location, seller, images, tags };
    });

    cache.set(cacheKey, { data: detail, ts: Date.now() });
    res.json(detail);

  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'wallapop-scraper' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API corriendo en puerto ${PORT}`));
