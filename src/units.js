// Розбір фасування з назви/полів товару і розрахунок ціни за кг або л.

const UNIT_RE = /(\d+(?:[.,]\d+)?)\s*(кг|kg|г|гр|g|л|l|мл|ml)(?![a-zа-яіїє])/i;
const MULTI_RE = /(\d+)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*(кг|kg|г|гр|g|л|l|мл|ml)(?![a-zа-яіїє])/i;

const FACTORS = { кг: ['kg', 1], kg: ['kg', 1], г: ['kg', 0.001], гр: ['kg', 0.001], g: ['kg', 0.001],
  л: ['l', 1], l: ['l', 1], мл: ['l', 0.001], ml: ['l', 0.001] };

// Повертає { amount, base: 'kg'|'l' } або null
export function parsePack(text) {
  if (!text) return null;
  const multi = text.match(MULTI_RE);
  if (multi) {
    const [base, f] = FACTORS[multi[3].toLowerCase()];
    return { amount: Number(multi[1]) * parseFloat(multi[2].replace(',', '.')) * f, base };
  }
  const m = text.match(UNIT_RE);
  if (!m) return null;
  const [base, f] = FACTORS[m[2].toLowerCase()];
  const amount = parseFloat(m[1].replace(',', '.')) * f;
  return amount > 0 ? { amount, base } : null;
}

export function packLabel(pack, perKg) {
  if (perKg) return 'ваговий, за кг';
  if (!pack) return '';
  const big = pack.amount >= 1;
  const n = big ? pack.amount : Math.round(pack.amount * 1000);
  const unit = pack.base === 'kg' ? (big ? 'кг' : 'г') : (big ? 'л' : 'мл');
  return `${String(Math.round(n * 1000) / 1000).replace('.', ',')} ${unit}`;
}

// Додає до товару pack, packLabel і unitPrice (грн за 1 кг / 1 л)
export function withUnitPrice(product, pack) {
  product.pack = pack && pack.amount > 0 ? pack : null;
  product.packLabel = packLabel(product.pack, product.perKg);
  product.unitPrice = product.pack ? Math.round((product.price / product.pack.amount) * 100) / 100 : null;
  return product;
}
