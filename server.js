import express from 'express';
import { fileURLToPath } from 'node:url';
import { config } from './src/config.js';
import { Cache } from './src/cache.js';
import { groupByEan, attachAtb, addOffer, describe } from './src/match.js';
import { relevance, brandQuery } from './src/text.js';
import { silpo } from './src/stores/silpo.js';
import { varus } from './src/stores/varus.js';
import { atb } from './src/stores/atb.js';
import { createMenuPrices } from './src/menu.js';

const STORES = [silpo, atb, varus].filter((s) => s.id !== 'atb' || config.atb.enabled);
const EAN_STORES = [varus]; // магазини, де можна шукати за штрихкодом

const menuPrices = createMenuPrices({ stores: STORES, timeout: config.timeout });
const storeCache = new Cache(config.cacheTtl);
const responseCache = new Cache(config.cacheTtl);

// ---------- обмеження частоти запитів з однієї IP ----------
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const list = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
  if (list.length >= 30) return res.status(429).json({ error: 'Забагато запитів, спробуйте за хвилину' });
  list.push(now);
  hits.set(req.ip, list);
  next();
}
setInterval(() => { const now = Date.now(); for (const [ip, l] of hits) if (l.every((t) => now - t > 60_000)) hits.delete(ip); }, 60_000).unref();

async function searchStore(store, query, signal, limit = config.perStore) {
  const key = `${store.id}:${limit}:${query}`;
  const cached = storeCache.get(key);
  if (cached) return cached;
  try {
    const items = await store.search(query, { limit, signal, timeout: config.timeout });
    return storeCache.set(key, { store: store.id, ok: true, items });
  } catch (e) {
    console.error(`[${store.id}] "${query}":`, e.message);
    return { store: store.id, ok: false, items: [] };
  }
}

// Групує товари в однакові позиції і готує відповідь API
async function assemble(query, results, extraItems, signal, { lookups = true } = {}) {
  const items = (id) => results.find((r) => r.store === id)?.items || [];
  const seen = new Set();
  const base = ['silpo', 'varus'].flatMap(items).map((it) => (seen.add(it.url), it));
  const extra = extraItems
    .filter((it) => !seen.has(it.url) && seen.add(it.url))
    .map((it) => ({ ...it, extra: true }));

  // 1. Групуємо за штрихкодом
  const groups = groupByEan([...base, ...extra]);

  // 2. Дошукуємо пари у VARUS за штрихкодом
  if (lookups) await lookupMissing(groups, signal);

  // 3. Прив'язуємо товари АТБ за назвою
  const atbSingles = attachAtb(groups, items('atb'));

  // Товари з додаткових запитів показуємо, лише якщо вони стали парою до товару АТБ
  const useful = groups.filter((g) => g.offers.atb || Object.values(g.offers).some((o) => !o.extra));
  const all = [...useful, ...atbSingles].map((g) => describe(g, query));
  return {
    query,
    stores: results.map((r) => ({ id: r.store, ok: r.ok, count: r.items.length })),
    compared: all.filter((g) => g.offers.length > 1)
      .sort((a, b) => b.relevance - a.relevance || b.offers.length - a.offers.length || a.min - b.min),
    single: all.filter((g) => g.offers.length === 1)
      .sort((a, b) => b.relevance - a.relevance || a.min - b.min),
    updatedAt: new Date().toISOString(),
  };
}

// Внутрішні коди магазинів (починаються з 2) пропускаємо — шукаємо лише справжні EAN-13
const isRealEan = (e) => e.length === 13 && !e.startsWith('2');

// Дошукує пари за штрихкодом: VARUS дозволяє запитати всі штрихкоди одним запитом
async function lookupMissing(groups, signal) {
  for (const s of EAN_STORES) {
    const need = groups.filter((g) => !g.offers[s.id]);
    const eans = need.flatMap((g) => [...g.eans].filter(isRealEan)).slice(0, 300);
    if (!eans.length) continue;
    for (const it of await s.findByEans(eans, signal)) {
      const g = need.find((x) => !x.offers[s.id] && it.eans.some((e) => x.eans.has(e)));
      if (g) addOffer(g, it, 'ean');
    }
  }
}

// Пошук у два етапи: onPartial отримує швидкий результат (лише основний пошук),
// а функція повертає повний — з дошуком пар за штрихкодом і товарів АТБ в інших мережах
async function compare(query, onPartial) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.timeout);
  try {
    const results = await Promise.all(STORES.map((s) => searchStore(s, query, ac.signal)));
    onPartial?.(await assemble(query, results, [], ac.signal, { lookups: false }));

    const atbItems = results.find((r) => r.store === 'atb')?.items || [];
    const atbQueries = [...new Set(atbItems
      .filter((it) => relevance(it.title, query) === 1)
      .map((it) => brandQuery(it.title)).filter(Boolean))].slice(0, 6);

    // Дошук за штрихкодом для основних груп (прогріває кеш) паралельно з пошуком пар для АТБ
    const [extraResults] = await Promise.all([
      Promise.all(atbQueries.flatMap((q2) => [silpo, varus].map((s) => searchStore(s, q2.toLowerCase(), ac.signal, 8)))),
      lookupMissing(groupByEan(['silpo', 'varus'].flatMap((id) => results.find((r) => r.store === id)?.items || [])), ac.signal),
    ]);

    return await assemble(query, results, extraResults.flatMap((r) => r.items), ac.signal);
  } finally {
    clearTimeout(timer);
  }
}

const app = express();
// За nginx на тому ж сервері — 'loopback'; на хостингу з власним проксі (Render) — TRUST_PROXY=1
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : 'loopback');
app.disable('x-powered-by');

app.get('/api/search', rateLimit, async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 80);
  if (q.length < 2) return res.status(400).json({ error: 'Введіть щонайменше 2 символи' });
  const cached = responseCache.get(q);
  if (cached) {
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(cached);
  }
  // Без кешу відповідаємо потоком NDJSON: спершу швидкий результат, потім повний
  res.set('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.set('X-Accel-Buffering', 'no'); // щоб nginx не буферизував потік
  try {
    const data = await compare(q, (partial) => res.write(JSON.stringify({ ...partial, partial: true }) + '\n'));
    if (data.stores.every((s) => s.ok)) responseCache.set(q, data); // неповні результати не кешуємо
    res.end(JSON.stringify(data) + '\n');
  } catch (e) {
    console.error(e);
    res.end(JSON.stringify({ error: 'Помилка пошуку, спробуйте ще раз' }) + '\n');
  }
});

// Ціни базових продуктів для підбору меню (самі страви й порції рахує браузер)
app.get('/api/menu', rateLimit, async (req, res) => {
  try {
    const data = await menuPrices.get();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(data);
  } catch (e) {
    console.error('[menu]', e);
    res.status(500).json({ error: 'Не вдалося зібрати ціни, спробуйте ще раз' });
  }
});

// maxAge 0: браузер щоразу перевіряє файл (ETag → 304), тож після оновлення сайту одразу бере нову версію
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url)), { maxAge: 0 }));

const server = app.listen(config.port, () => {
  console.log(`Сайт працює: http://localhost:${config.port}`);
  menuPrices.warm(); // збираємо ціни для меню одразу, щоб перший відвідувач не чекав
});

async function shutdown() {
  server.close();
  await atb.close?.();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
