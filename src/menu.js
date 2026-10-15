// Ціни для підбору меню: для кожного базового продукту шукаємо в кожному магазині
// найдешевший за кг (або за штуку) товар, що справді є цим продуктом.
import { INGREDIENTS, DISHES } from './menu-data.js';
import { pool } from './cache.js';

// Що точно не є базовим продуктом, хоч би як називалось
const NEVER = /корм|для кот|для собак|дитяч|снек|чипс|батончик|набір|подарунк/;

const eff = (it) => it.cardPrice ?? it.price;

function pieces(it) {
  return it.pieces || parseInt(/(\d+)\s*шт/i.exec(it.title)?.[1], 10) || null;
}

// Перетворює товар магазину на пропозицію для продукту або повертає null
function toOffer(ing, it) {
  const t = it.title.toLowerCase();
  if (NEVER.test(t) || !ing.must.every((re) => re.test(t)) || ing.not?.test(t)) return null;
  const base = {
    store: it.store, title: it.title, price: it.price, cardPrice: it.cardPrice ?? null, url: it.url, image: it.image,
  };
  if (ing.unit === 'pcs') {
    const n = pieces(it);
    if (!n || n > 30) return null;
    return { ...base, pieces: n, unitPrice: eff(it) / n }; // ціна за штуку
  }
  if (it.perKg) return { ...base, perKg: true, unitPrice: eff(it) };
  if (!it.pack) return null;
  const kg = it.pack.amount; // 1 л ≈ 1 кг — для молока, кефіру й олії похибка невелика
  if (kg < (ing.minPack ?? 0.15) || kg > (ing.maxPack || 2.5)) return null; // пробники і мішки по 25 кг не беремо
  return { ...base, packKg: Math.round(kg * 1000) / 1000, unitPrice: eff(it) / kg };
}

export function createMenuPrices({ stores, timeout, ttlSec = 3 * 3600 }) {
  let cached = null; // { data, at }
  let inflight = null;

  async function priceStore(store) {
    const out = {};
    let failed = 0;
    // Сільпо і VARUS — звичайні API. АТБ — headless-браузер за Cloudflare: паралельні вкладки
    // швидко впираються в захист, тому туди по одному запиту, а невдалий повторюємо один раз
    const isAtb = store.id === 'atb';
    const search = async (q) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await store.search(q, { limit: 30, timeout, barcodes: false, signal: AbortSignal.timeout(timeout) });
        } catch (e) {
          if (!isAtb || attempt) throw e;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    };
    await pool(INGREDIENTS, isAtb ? 1 : 4, async (ing) => {
      try {
        // Для деяких продуктів кілька запитів (яловичина в Сільпо — «телятина»); результати зливаємо
        const items = [];
        for (const q of [].concat(ing.query)) {
          for (const it of await search(q)) if (!items.some((x) => x.url === it.url)) items.push(it);
        }
        const offers = items.map((it) => toOffer(ing, it)).filter(Boolean).sort((a, b) => a.unitPrice - b.unitPrice);
        // Кілька найдешевших різного фасування: для меню на 1 день вигідніша мала пачка, на тиждень — велика
        const picked = [];
        for (const o of offers) {
          const size = o.perKg ? 'kg' : o.packKg ?? `${o.pieces}pcs`;
          if (!picked.some((p) => (p.perKg ? 'kg' : p.packKg ?? `${p.pieces}pcs`) === size)) picked.push(o);
          if (picked.length === 4) break;
        }
        if (picked.length) out[ing.id] = picked;
      } catch (e) {
        failed++;
        console.error(`[menu:${store.id}] "${ing.query}":`, e.message);
      }
    });
    return { id: store.id, ok: failed < INGREDIENTS.length / 2, offers: out };
  }

  async function build() {
    const t0 = Date.now();
    const results = await Promise.all(stores.map(priceStore));
    const ingredients = INGREDIENTS.map(({ must, not, query, maxPack, minPack, ...ing }) => ({
      ...ing,
      unit: ing.unit || 'kg',
      tags: ing.tags || [],
      offers: Object.fromEntries(results.filter((r) => r.offers[ing.id]).map((r) => [r.id, r.offers[ing.id]])),
    }));
    console.log(`[menu] ціни зібрано за ${Math.round((Date.now() - t0) / 1000)} с`);
    return {
      ingredients,
      dishes: DISHES,
      stores: results.map((r) => ({ id: r.id, ok: r.ok, count: Object.keys(r.offers).length })),
      updatedAt: new Date().toISOString(),
    };
  }

  function refresh() {
    inflight ||= build()
      .then((data) => {
        // Якщо магазин тимчасово не відповів, не затираємо його старі ціни
        if (cached && data.stores.some((s) => !s.ok)) {
          for (const ing of data.ingredients) {
            const old = cached.data.ingredients.find((x) => x.id === ing.id);
            for (const s of data.stores.filter((x) => !x.ok)) if (old?.offers[s.id]) ing.offers[s.id] = old.offers[s.id];
          }
        }
        cached = { data, at: Date.now() };
        return data;
      })
      .finally(() => { inflight = null; });
    return inflight;
  }

  return {
    async get() {
      if (cached && Date.now() - cached.at < ttlSec * 1000) return cached.data;
      if (cached) { refresh().catch(() => {}); return cached.data; } // віддаємо старе, оновлюємо у фоні
      return refresh();
    },
    warm() {
      refresh().catch((e) => console.error('[menu]', e.message));
      setInterval(() => refresh().catch(() => {}), ttlSec * 1000).unref();
    },
  };
}
