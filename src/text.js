// Нормалізація тексту для порівняння назв і брендів з різних магазинів.

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ё: 'e', ъ: '',
};

// «Фонетичний ключ»: латиниця, без пробілів і розділових знаків, схожі звуки злиті.
// Завдяки цьому «Лактель» і «Lactel», «Галичина» і «Galychyna» дають однаковий ключ.
export function phonetic(s) {
  let t = String(s || '').toLowerCase().replace(/[а-яіїєґёыэъ]/g, (c) => TRANSLIT[c] ?? c);
  t = t.replace(/[^a-z0-9]/g, '')
    .replace(/kh/g, 'h').replace(/ph/g, 'f').replace(/ck|c|q/g, 'k').replace(/x/g, 'ks')
    .replace(/w/g, 'v').replace(/[yj]/g, 'i').replace(/g/g, 'h').replace(/ts/g, 'k')
    .replace(/(.)\1+/g, '$1');
  return t;
}

// Слова, які не несуть сенсу для порівняння
const STOP = new Set(['з', 'зі', 'із', 'та', 'і', 'й', 'в', 'у', 'на', 'для', 'без', 'по', 'від', 'шт', 'уп', 'пет', 'п/ет',
  'ск/б', 'ск', 'д/п', 'ж/б', 'т/п', 'пак', 'пл', 'пляш', 'tm', 'тм', 'ваг', 'вагова', 'ваговий', 'кг', 'г', 'гр', 'л', 'мл']);

// Основи значущих слів (перші 5 літер), без бренду, чисел і одиниць
export function stems(title, brand) {
  const brandKey = phonetic(brand);
  return String(title || '').toLowerCase()
    .replace(/[«»"“”'’`]/g, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(?:%|кг|г|гр|л|мл|kg|g|l|ml|шт)?/g, ' ')
    .split(/[\s,.;:()/+\-–—!?]+/)
    .filter((w) => w.length > 1 && !STOP.has(w) && /[a-zа-яіїєґ]/.test(w))
    .filter((w) => !brandKey || !brandKey.includes(phonetic(w)) || phonetic(w).length < 3)
    .map((w) => w.slice(0, 5));
}

// Короткий пошуковий запит з назви товару: тип + слова з великої літери (бренд, лінійка).
// «Кава 225г Fort Intense Taste мелена» → «Кава Fort Intense Taste»
export function brandQuery(title) {
  const words = String(title).replace(/[«»"“”()]/g, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(?:%|кг|г|гр|л|мл|шт)?(?![a-zа-яіїє])/gi, ' ')
    .split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w.toLowerCase()));
  const named = words.slice(1).filter((w) => /^[A-ZА-ЯІЇЄҐ]/.test(w)).slice(0, 3);
  return named.length ? [words[0], ...named].join(' ') : null;
}

export function percents(title) {
  return [...String(title || '').matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) => parseFloat(m[1].replace(',', '.'))).sort();
}

export function normEan(e) {
  const s = String(e || '').replace(/\D/g, '').replace(/^0+/, '');
  return s.length >= 8 ? s : null;
}

// Частка слів запиту, знайдених у назві
export function relevance(title, query) {
  const t = String(title).toLowerCase();
  const words = String(query).toLowerCase().split(/[\s,]+/).filter((w) => w.length > 1);
  if (!words.length) return 1;
  const found = words.filter((w) => t.includes(w.length > 4 ? w.slice(0, w.length - 2) : w)).length;
  return found / words.length;
}
