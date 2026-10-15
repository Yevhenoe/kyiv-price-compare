// Зіставлення однакових товарів між магазинами.
//  1) Сільпо / VARUS — за штрихкодом (EAN). Це точний збіг.
//  2) АТБ штрихкодів не віддає — прив'язуємо його товар до групи, лише якщо збігаються
//     бренд, фасування, жирність/відсотки, тип товару і всі уточнення з назви АТБ.
import { phonetic, stems, percents, relevance } from './text.js';

const STORE_ORDER = ['silpo', 'atb', 'varus'];

// Уточнення, що роблять товар іншим. Якщо є в одній назві і нема в іншій — це різні товари.
const STRONG = ['безла', 'дитяч', 'згущ', 'знежи', 'орган', 'розчи', 'мелен', 'зерно', 'зерна', 'гірки', 'топле',
  'шокол', 'ваніл', 'какао', 'кокос', 'мигда', 'вівся', 'соєв', 'без ц', 'лайт', 'light', 'zero', 'decaf'];

export function groupByEan(items) {
  const groups = [];
  const byEan = new Map();

  for (const it of items) {
    const existing = [...new Set(it.eans.map((e) => byEan.get(e)).filter(Boolean))];
    let g = existing[0];
    if (!g) {
      g = { offers: {}, eans: new Set(), match: {} };
      groups.push(g);
    }
    // Якщо товар зв'язав кілька груп — зливаємо їх
    for (const other of existing.slice(1)) {
      for (const [s, o] of Object.entries(other.offers)) if (!g.offers[s]) { g.offers[s] = o; g.match[s] = 'ean'; }
      other.eans.forEach((e) => { g.eans.add(e); byEan.set(e, g); });
      groups.splice(groups.indexOf(other), 1);
    }
    if (!g.offers[it.store] || it.price < g.offers[it.store].price) {
      g.offers[it.store] = it;
      g.match[it.store] = 'ean';
    }
    it.eans.forEach((e) => { g.eans.add(e); byEan.set(e, g); });
  }
  return groups;
}

export function addOffer(group, item, how) {
  group.offers[item.store] = item;
  group.match[item.store] = how;
  item.eans.forEach((e) => group.eans.add(e));
}

const samePack = (a, b) => {
  if (a.perKg || b.perKg) return a.perKg && b.perKg;
  if (!a.pack || !b.pack) return false;
  return Math.abs(a.pack.amount - b.pack.amount) / Math.max(a.pack.amount, b.pack.amount) < 0.02;
};

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Наскільки товар АТБ схожий на групу. null — точно не той самий товар.
function atbScore(atb, group) {
  const refs = Object.values(group.offers);
  const brands = [...new Set(refs.map((r) => r.brand).filter(Boolean))];
  if (!brands.length) return null;

  const atbKey = phonetic(atb.title);
  const brand = brands.find((b) => { const k = phonetic(b); return k.length >= 3 && atbKey.includes(k); });
  if (!brand) return null;

  if (!refs.some((r) => samePack(r, atb))) return null;

  const pa = percents(atb.title);
  if (pa.length && !refs.some((r) => { const pr = percents(r.title); return !pr.length || sameList(pr, pa); })) return null;

  const atbStems = stems(atb.title, brand);
  const refStems = new Set(refs.flatMap((r) => stems(r.title, r.brand || brand)));
  const refFirst = refs.map((r) => stems(r.title, r.brand || brand)[0]?.slice(0, 4));
  if (!atbStems.length || !refFirst.includes(atbStems[0].slice(0, 4))) return null;

  // Кожне слово з назви АТБ має бути і в назві товару-пари
  const refPrefixes = [...refStems].map((s) => s.slice(0, 4));
  for (const s of atbStems) if (!refPrefixes.includes(s.slice(0, 4))) return null;

  // Сильні уточнення пари мають бути і в АТБ (наприклад, «безлактозне»)
  const atbLower = atb.title.toLowerCase();
  const refLower = refs.map((r) => r.title.toLowerCase());
  for (const q of STRONG) {
    if (refLower.every((t) => t.includes(q)) && !atbLower.includes(q)) return null;
  }
  return atbStems.length;
}

export function attachAtb(groups, atbItems) {
  const singles = [];
  for (const atb of atbItems) {
    let best = null;
    let bestScore = -1;
    for (const g of groups) {
      if (g.offers.atb) continue;
      const s = atbScore(atb, g);
      if (s != null && s > bestScore) { best = g; bestScore = s; }
    }
    if (best) addOffer(best, atb, 'name');
    else singles.push({ offers: { atb }, eans: new Set(), match: { atb: 'name' } });
  }
  return singles;
}

const effPrice = (o) => o.cardPrice ?? o.price;

// Готує групу до відповіді API
export function describe(group, query) {
  const offers = STORE_ORDER.filter((s) => group.offers[s]).map((s) => {
    const o = group.offers[s];
    return {
      store: s, title: o.title, price: o.price, oldPrice: o.oldPrice, cardPrice: o.cardPrice ?? null,
      unitPrice: o.unitPrice, url: o.url, match: group.match[s],
    };
  });
  const main = group.offers.silpo || group.offers.varus || group.offers.atb;
  const prices = offers.map(effPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const brand = Object.values(group.offers).map((o) => o.brand).find(Boolean) || null;
  return {
    key: group.eans.size ? `ean:${[...group.eans].sort()[0]}` : `url:${main.url}`,
    title: main.title,
    brand,
    pack: main.packLabel,
    perKg: main.perKg,
    image: Object.values(group.offers).map((o) => o.image).find(Boolean) || null,
    offers,
    best: offers.find((o) => effPrice(o) === min).store,
    min,
    saving: offers.length > 1 ? Math.round((max - min) * 100) / 100 : 0,
    savingPct: offers.length > 1 ? Math.round((1 - min / max) * 100) : 0,
    relevance: Math.max(...Object.values(group.offers).map((o) => relevance(o.title, query))),
  };
}
