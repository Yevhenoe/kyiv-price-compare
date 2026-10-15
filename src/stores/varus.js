// VARUS: пошук іде через multisearch.io (повертає id товарів), а картки з цінами —
// з каталогу сайту (Vue Storefront / Elasticsearch). Ціни залежать від магазину (shop_id).
import { config } from '../config.js';
import { parsePack, withUnitPrice } from '../units.js';
import { normEan } from '../text.js';

const SEARCH = 'https://api.multisearch.io/';
const SEARCH_ID = '12138';
const SEARCH_KEY = '468671b168b5ec56b8c34d458bf03f1b'; // публічний ключ із сайту varus.ua
const CATALOG = 'https://varus.ua/api/catalog/vue_storefront_catalog_2/product_v2/_search';

const shop = () => config.varus.shopId;
const FIELDS = () => ['id', 'sku', 'name', 'barCode', 'url_key', 'weight', 'volume', 'packingtype',
  'productquantityunit', 'brand_data.name', `sqpp_data_${shop()}`].join(',');

async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json', Referer: 'https://varus.ua/' } });
  if (!res.ok) throw new Error(`VARUS відповів ${res.status}`);
  return res.json();
}

// Товари з каталогу за фільтром (за id або штрихкодами)
async function catalog(attribute, values, signal) {
  if (!values.length) return [];
  const request = { _availableFilters: [], _appliedFilters: [{ attribute, value: { in: values }, scope: 'default' }], _appliedSort: [], _searchText: '' };
  const url = new URL(CATALOG);
  url.searchParams.set('_source_include', FIELDS());
  url.searchParams.set('from', 0);
  url.searchParams.set('size', values.length);
  url.searchParams.set('request', JSON.stringify(request));
  url.searchParams.set('request_format', 'search-query');
  url.searchParams.set('response_format', 'compact');
  url.searchParams.set('shop_id', shop());
  const data = await getJson(url, signal);
  return (data.hits || []).map(toItem).filter(Boolean);
}

function toItem(it) {
  const s = it[`sqpp_data_${shop()}`];
  if (!s || !s.available || !s.in_stock || !(s.sort_price > 0)) return null; // немає в цьому магазині
  const price = s.sort_price; // актуальна ціна з урахуванням акції
  const perKg = it.packingtype === 1 || /кг/i.test(it.productquantityunit || '');
  let pack;
  if (perKg) pack = { amount: 1, base: 'kg' };
  else pack = parsePack(it.name)
    || (Number(it.volume) > 0 ? { amount: Number(it.volume) / 1000, base: 'l' } : null)
    || (Number(it.weight) > 0 ? { amount: Number(it.weight) / 1000, base: 'kg' } : null);

  return withUnitPrice({
    store: 'varus',
    vid: String(it.id),
    title: it.name,
    brand: it.brand_data?.name || null,
    eans: [normEan(it.barCode)].filter(Boolean),
    price,
    oldPrice: s.price > price ? s.price : null,
    perKg,
    image: it.sku ? `https://varus.ua/img/product/240/240/${it.sku}` : null,
    url: `https://varus.ua/${it.url_key}`,
  }, pack);
}

export const varus = {
  id: 'varus',
  name: 'VARUS',

  async search(query, { limit, signal }) {
    const url = new URL(SEARCH);
    url.searchParams.set('id', SEARCH_ID);
    url.searchParams.set('key', SEARCH_KEY);
    url.searchParams.set('query', query);
    url.searchParams.set('uid', 'guest');
    url.searchParams.set('lang', 'uk');
    url.searchParams.set('location', 'default');
    // Частини товарів немає у вибраному магазині — беремо із запасом і відкидаємо відсутні
    url.searchParams.set('limit', Math.min(60, limit * 2));
    url.searchParams.set('categories', 0);
    url.searchParams.set('fields', 'id');
    url.searchParams.set('sort', 'relevance');
    url.searchParams.set('filters', '{}');
    const found = await getJson(url, signal);
    const ids = (found.results?.items || []).map((x) => String(x.id));
    const items = await catalog('id', ids, signal);
    // зберігаємо порядок релевантності з пошуку
    const order = new Map(ids.map((id, i) => [id, i]));
    return items.sort((a, b) => (order.get(a.vid) ?? 0) - (order.get(b.vid) ?? 0)).slice(0, limit);
  },

  // Пошук пар за штрихкодами — одним запитом для всіх
  async findByEans(eans, signal) {
    try {
      // У каталозі VARUS штрихкод зберігається як EAN-13 без провідних нулів
      return await catalog('barCode', [...new Set(eans)], signal);
    } catch {
      return [];
    }
  },
};
