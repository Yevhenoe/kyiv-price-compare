import { config } from '../config.js';
import { parsePack, withUnitPrice } from '../units.js';
import { Cache, pool } from '../cache.js';
import { normEan } from '../text.js';

const API = () => `https://sf-ecom-api.silpo.ua/v1/uk/branches/${config.silpo.branchId}`;
const barcodeCache = new Cache(7 * 24 * 3600, 20000); // штрихкоди не змінюються — тримаємо тиждень

async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Сільпо відповів ${res.status}`);
  return res.json();
}

// Штрихкоди є лише в картці товару, тому догружаємо їх окремо (з кешем)
async function barcodes(slug, signal) {
  return barcodeCache.wrap(slug, async () => {
    try {
      const d = await getJson(`${API()}/products/${slug}`, signal);
      return [...new Set((d.barcodes || []).map(normEan).filter(Boolean))];
    } catch {
      return [];
    }
  });
}

export const silpo = {
  id: 'silpo',
  name: 'Сільпо',

  // barcodes: false — без штрихкодів (не потрібні для підбору меню, зате без зайвих запитів)
  async search(query, { limit, signal, barcodes: withEans = true }) {
    const url = new URL(`${API()}/products`);
    url.searchParams.set('limit', limit);
    url.searchParams.set('offset', 0);
    url.searchParams.set('search', query);
    url.searchParams.set('inStock', 'true');
    const data = await getJson(url, signal);

    const items = (data.items || []).map((it) => {
      const perKg = it.ratio === 'кг';
      const pack = perKg ? { amount: 1, base: 'kg' } : parsePack(it.displayRatio) || parsePack(it.title);
      return withUnitPrice({
        store: 'silpo',
        title: it.title,
        brand: it.brandTitle || null,
        eans: [],
        slug: it.slug,
        // displayPrice у вагових товарів — за 100 г, а price — за кг (у фасованих вони однакові)
        price: it.price,
        oldPrice: it.oldPrice || null,
        perKg,
        pieces: parseInt(/(\d+)\s*шт/.exec(it.displayRatio || '')?.[1], 10) || null,
        image: it.icon ? `https://images.silpo.ua/v2/products/300x300/webp/${it.icon}` : null,
        url: `https://silpo.ua/product/${it.slug}`,
      }, pack);
    });

    if (withEans) await pool(items, 8, async (it) => { it.eans = await barcodes(it.slug, signal); });
    return items;
  },
};
