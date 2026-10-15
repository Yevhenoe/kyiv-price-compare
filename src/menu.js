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

  async function priceStore(store) {
    const out = {};
    let failed = 0;
    // Сільпо і VARUS — звичайні API. АТБ — headless-браузер за Cloudflare: паралельні вкладки
    // швидко впираються в захист, тому туди по одному запиту, а невдалий повторюємо один раз
    // VARUS на пачку паралельних запитів відповідає 429 — до нього по два, а 429 повторюємо з паузою
    const isAtb = store.id === 'atb';
    const search = async (q) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await store.search(q, { limit: 30, timeout, barcodes: false, signal: AbortSignal.timeout(timeout) });
        } catch (e) {
          const retry = isAtb ? attempt < 1 : / 429/.test(e.message) && attempt < 3;
          if (!retry) throw e;
          await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        }
      }
    };
    await pool(INGREDIENTS, { atb: 1, varus: 2 }[store.id] ?? 4, async (ing) => {
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

  function publish(results) {
    const ingredients = INGREDIENTS.map(({ must, not, query, maxPack, minPack, ...ing }) => ({
      ...ing,
      unit: ing.unit || 'kg',
      tags: ing.tags || [],
      offers: Object.fromEntries(results.filter((r) => r.offers[ing.id]).map((r) => [r.id, r.offers[ing.id]])),
    }));
    const data = {
      ingredients,
      dishes: DISHES,
      stores: results.map((r) => ({ id: r.id, ok: r.ok, pending: !!r.pending, count: Object.keys(r.offers).length })),
      updatedAt: new Date().toISOString(),
    };
    // Якщо магазин тимчасово не відповів або ще збирається, лишаємо його попередні ціни
    if (cached) {
      for (const ing of data.ingredients) {
        const old = cached.data.ingredients.find((x) => x.id === ing.id);
        for (const st of data.stores.filter((x) => !x.ok || x.pending)) {
          if (old?.offers[st.id] && !ing.offers[st.id]) ing.offers[st.id] = old.offers[st.id];
        }
      }
    }
    cached = { data, at: Date.now() };
    return data;
  }

  // Сільпо і VARUS відповідають за секунди — публікуємо їхні ціни одразу.
  // АТБ (headless-браузер) на слабкому сервері може збиратися кілька хвилин — дозбираємо у фоні.
  let busy = null;
  let ready = null;
  function refresh() {
    if (busy) return ready;
    const t0 = Date.now();
    const sec = () => Math.round((Date.now() - t0) / 1000);
    const fast = stores.filter((s) => s.id !== 'atb');
    const slow = stores.filter((s) => s.id === 'atb');
    const slowDone = Promise.all(slow.map(priceStore));
    const fastDone = Promise.all(fast.map(priceStore)).then((fr) => {
      publish([...fr, ...slow.map((s) => ({ id: s.id, ok: true, pending: true, offers: {} }))]);
      console.log(`[menu] ціни ${fast.map((s) => s.name).join(', ')} зібрано за ${sec()} с`);
      return fr;
    });
    busy = Promise.all([fastDone, slowDone])
      .then(([fr, sr]) => {
        if (!sr.length) return;
        publish([...fr, ...sr]);
        console.log(`[menu] ціни АТБ зібрано за ${sec()} с`);
      })
      .catch((e) => console.error('[menu]', e.message))
      .finally(() => { busy = null; });
    ready = fastDone.then(() => cached.data);
    return ready;
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
