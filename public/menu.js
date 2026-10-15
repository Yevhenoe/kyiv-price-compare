// Вкладка «Меню»: підбір меню під кількість людей, калорії, бюджет і обмеження в харчуванні.
// Сервер віддає ціни продуктів у трьох мережах і страви з рецептами, а меню й список покупок рахуємо тут.

const SLOTS = [
  { id: 'breakfast', name: 'Сніданок', share: 0.25 },
  { id: 'lunch', name: 'Обід', share: 0.35 },
  { id: 'dinner', name: 'Вечеря', share: 0.3 },
  { id: 'snack', name: 'Перекус', share: 0.1 },
];
const KCAL_PRESETS = [
  { kcal: 1600, label: 'схуднення' },
  { kcal: 2000, label: 'норма' },
  { kcal: 2500, label: 'активні' },
  { kcal: 3000, label: 'спорт' },
];
const DAYS = [1, 3, 7];
const DIETS = [
  { id: 'all', name: 'Усе' },
  { id: 'pesc', name: 'Без м’яса, з рибою' },
  { id: 'veg', name: 'Вегетаріанське' },
];
const RESTRICT = [
  { id: 'lactose', name: 'лактози', hint: 'молоко замінимо на безлактозне; твердий сир і масло лишаємо — у них лише сліди лактози' },
  { id: 'gluten', name: 'глютену', hint: 'без борошна, макаронів, хліба, вівсянки, булгуру й соєвого соусу' },
  { id: 'egg', name: 'яєць' },
  { id: 'nuts', name: 'горіхів' },
  { id: 'pork', name: 'свинини' },
];
const GOALS = [
  { id: 'protein', name: 'Більше білка' },
  { id: 'lowcarb', name: 'Менше вуглеводів' },
  { id: 'quick', name: 'Швидко, до 30 хв' },
];
const WEEKDAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П’ятниця', 'Субота'];

// Скільки гривень порції «коштує» один бал смаку: без бюджету — розумний баланс ціни і різноманіття
const LAMBDA_BALANCED = 0.06;
const LAMBDA_CHEAPEST = 3;

// Три готові рівні бюджету; «range» і «custom» — конкретна сума, у яку треба вкластися
const TIERS = [
  { id: 'cheap', name: 'Дешево', desc: 'прості ситні страви', lambda: LAMBDA_CHEAPEST },
  { id: 'normal', name: 'Нормально', desc: 'баланс ціни і смаку', lambda: LAMBDA_BALANCED },
  { id: 'rich', name: 'Розкішно', desc: 'м’ясо, риба, найсмачніше', lambda: 0 },
];

// Діапазони сум з «круглими» межами між найдешевшим і найдорожчим меню
function budgetRanges(min, max) {
  const span = Math.max(max - min, 1);
  const step = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find((x) => span / x <= 4) || 20000;
  const out = [];
  for (let lo = Math.floor(min / step) * step; lo < max; lo += step) out.push([lo, lo + step]);
  return out;
}

const imgUrl = (file, w = 320) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${w}`;
const imgPage = (file) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`;

export function initMenu({ STORES, ORDER, $, esc, money, eff, toast, load, save, addItemsToCart }) {
  const root = $('#menuView');
  const saved = load('menu-v2', {});
  const st = {
    data: null,
    loading: false,
    error: null,
    opts: {
      people: 2, kcal: 2000, days: 3, mode: 'normal', budget: null, diet: 'all', restrict: [], goals: [], dislikes: [],
      ...saved,
    },
    plan: 'best',
    swaps: {}, // «день:прийом» → зсув у рейтингу страв
    last: null,
  };

  const byId = () => (st.byId ||= Object.fromEntries(st.data.ingredients.map((i) => [i.id, i])));
  const ing = (id) => byId()[id];
  const fmtKg = (g) => (g >= 1000 ? `${String(Math.round(g / 10) / 100).replace('.', ',')} кг` : `${Math.round(g)} г`);
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };
  const amount = (i, grams) => (i.unit === 'pcs' ? `${String(Math.max(0.5, Math.round(grams / i.piece * 2) / 2)).replace('.', ',')} шт` : fmtKg(grams));

  /* ---------- ціни ---------- */

  // Ціна за 1 г (для яєць — виходячи з ваги однієї штуки)
  function perGram(i, o) {
    return i.unit === 'pcs' ? eff(o) / o.pieces / i.piece : o.perKg ? eff(o) / 1000 : eff(o) / o.packKg / 1000;
  }
  const allOffers = (i) => Object.values(i.offers).flat();
  function cheapestPerGram(i) {
    const list = allOffers(i);
    return list.length ? Math.min(...list.map((o) => perGram(i, o))) : null;
  }

  // Скільки реально заплатити за потрібну кількість грамів у конкретній пропозиції
  function buy(i, o, grams) {
    if (i.unit === 'pcs') {
      const pcs = Math.ceil(grams / i.piece - 0.05);
      const packs = Math.max(1, Math.ceil(pcs / o.pieces));
      return { o, packs, cost: packs * eff(o), label: `${packs} × ${o.pieces} шт`, need: `${pcs} шт` };
    }
    if (o.perKg) {
      const kg = Math.max(0.1, Math.ceil(grams / 50) * 0.05); // зважують з кроком ~50 г
      return { o, packs: kg, cost: kg * eff(o), label: `${String(Math.round(kg * 100) / 100).replace('.', ',')} кг`, need: fmtKg(grams) };
    }
    const packs = Math.max(1, Math.ceil(grams / 1000 / o.packKg - 0.02));
    return { o, packs, cost: packs * eff(o), label: `${packs} × ${fmtKg(o.packKg * 1000)}`, need: fmtKg(grams) };
  }

  /* ---------- страви з урахуванням фільтрів ---------- */

  // Повертає страву з поправками під обмеження (заміни, прибрані добавки) або null, якщо вона не підходить
  function adapt(d) {
    const { diet, restrict, goals, dislikes } = st.opts;
    if (goals.includes('quick') && d.time > 30) return null;
    const items = {};
    const notes = [];
    for (const [id, g] of Object.entries(d.items)) {
      const i = ing(id);
      if (!i) return null;
      const t = i.tags;
      let bad = dislikes.includes(id)
        || (diet === 'veg' && (t.includes('meat') || t.includes('fish')))
        || (diet === 'pesc' && t.includes('meat'));
      for (const r of restrict) if (t.includes(r === 'nuts' ? 'nuts' : r)) bad = true;
      if (!bad) { items[id] = (items[id] || 0) + g; continue; }
      // Молоко без лактози — замінюємо, якщо безлактозне є в продажу
      if (id === 'milk' && restrict.includes('lactose') && !dislikes.includes('milk') && cheapestPerGram(ing('milkLf')) != null) {
        items.milkLf = (items.milkLf || 0) + g;
        notes.push('безлактозне молоко');
        continue;
      }
      if (d.opt?.includes(id)) { notes.push(`без «${i.name.toLowerCase()}»`); continue; }
      return null;
    }
    return stats({ ...d, items, notes });
  }

  function stats(d) {
    let kcal = 0, p = 0, f = 0, c = 0, cost = 0;
    for (const [id, g] of Object.entries(d.items)) {
      const i = ing(id);
      const pg = cheapestPerGram(i);
      if (pg == null) return null; // продукту немає в жодному магазині — страву пропускаємо
      kcal += (i.kcal * g) / 100; p += (i.p * g) / 100; f += (i.f * g) / 100; c += (i.c * g) / 100;
      cost += pg * g;
    }
    if (kcal < 50) return null;
    return { ...d, kcal, p, f, c, cost, cpk: cost / kcal, carbShare: (c * 4) / kcal, protShare: (p * 4) / kcal };
  }

  // Кандидати для кожного прийому їжі
  function candidates() {
    const { goals } = st.opts;
    const dishes = st.data.dishes.map(adapt).filter(Boolean);
    const out = {};
    for (const slot of SLOTS) {
      let list = dishes.filter((d) => [].concat(d.slot).includes(slot.id));
      if (goals.includes('lowcarb')) {
        const low = list.filter((d) => d.carbShare <= 0.35);
        if (low.length) list = low; // якщо низьковуглеводних немає — не лишаємо прийом порожнім
      }
      out[slot.id] = list;
    }
    return out;
  }

  /* ---------- підбір меню ---------- */

  function buildMenu(cands, lambda) {
    const { people, kcal, days, goals } = st.opts;
    const used = {};
    const prev = {};
    const plan = [];
    for (let d = 0; d < days; d++) {
      const meals = [];
      for (const slot of SLOTS) {
        const slotKcal = kcal * slot.share;
        const ranked = cands[slot.id]
          .map((x) => {
            const cost = x.cpk * slotKcal;
            const score = x.rating
              + (goals.includes('protein') ? 6 * x.protShare : 0)
              + (goals.includes('lowcarb') ? 3 * (0.5 - x.carbShare) : 0)
              - lambda * cost
              - 1.3 * (used[x.id] || 0) // повтори знижують привабливість
              - (prev[slot.id] === x.id ? 2 : 0); // і точно не те саме, що вчора
            return { x, score };
          })
          .sort((a, b) => b.score - a.score).map((r) => r.x);
        if (!ranked.length) { meals.push({ slot, empty: true }); continue; }
        const key = `${d}:${slot.id}`;
        const dish = ranked[(st.swaps[key] || 0) % ranked.length];
        used[dish.id] = (used[dish.id] || 0) + 1;
        prev[slot.id] = dish.id;
        const scale = slotKcal / dish.kcal;
        meals.push({ key, slot, dish, scale, alternatives: ranked.length, cost: dish.cost * scale });
      }
      plan.push(meals);
    }
    const need = {};
    for (const meals of plan) for (const m of meals) {
      if (m.empty) continue;
      for (const [id, g] of Object.entries(m.dish.items)) need[id] = (need[id] || 0) + g * m.scale * people;
    }
    return { plan, need };
  }

  // Список покупок: «best» — кожен продукт там, де дешевше; або все в одному магазині
  function shopping(need, planId) {
    let total = 0, eaten = 0, moved = 0;
    const lines = Object.entries(need).map(([id, grams]) => {
      const i = ing(id);
      const own = planId === 'best' ? allOffers(i) : i.offers[planId] || [];
      const pool = own.length ? own : allOffers(i);
      if (!own.length) moved++;
      const best = pool.map((o) => buy(i, o, grams)).sort((a, b) => a.cost - b.cost)[0];
      const byStore = ORDER.filter((s) => i.offers[s]?.length)
        .map((s) => i.offers[s].map((o) => buy(i, o, grams)).sort((a, b) => a.cost - b.cost)[0]);
      total += best.cost;
      eaten += perGram(i, best.o) * grams;
      return { i, grams, ...best, byStore };
    }).sort((a, b) => b.cost - a.cost);
    return { lines, total, eaten, moved };
  }

  const payAt = (cands, lambda) => shopping(buildMenu(cands, lambda).need, 'best').total;

  // Під бюджет шукаємо найменш «економне» λ, за якого меню ще вкладається в суму
  function chooseLambda(cands) {
    const swaps = st.swaps;
    st.swaps = {}; // діапазон рахуємо без ручних замін
    const min = payAt(cands, LAMBDA_CHEAPEST);
    const max = payAt(cands, 0);
    const { mode } = st.opts;
    let lambda = TIERS.find((t) => t.id === mode)?.lambda ?? LAMBDA_BALANCED;
    const B = mode === 'range' || mode === 'custom' ? st.opts.budget : null;
    if (B) {
      if (B >= max) lambda = 0;
      else if (B < min) lambda = LAMBDA_CHEAPEST;
      else {
        let lo = 0, hi = LAMBDA_CHEAPEST;
        for (let k = 0; k < 22; k++) {
          const mid = (lo + hi) / 2;
          if (payAt(cands, mid) <= B) hi = mid; else lo = mid;
        }
        lambda = hi;
      }
    }
    const mid = payAt(cands, LAMBDA_BALANCED);
    st.swaps = swaps;
    return { lambda, min, max, mid };
  }

  /* ---------- відмальовка ---------- */

  const fmtTime = (t) => (t < 60 ? `${t} хв` : `${String(Math.round(t / 30) / 2).replace('.', ',')} год`);
  const people = (n) => `${n} ${plural(n, 'людина', 'людини', 'людей')}`;
  const daysTxt = (n) => `${n} ${plural(n, 'день', 'дні', 'днів')}`;

  // Рядки списку покупок → позиції кошика: ціна — за всю потрібну кількість у кожному магазині
  const toCartItems = (lines) => lines.map((l) => ({
    key: `menu:${l.i.id}`,
    title: `${l.i.name} — ${l.need}`,
    image: l.o.image,
    pack: l.label,
    offers: l.byStore.map((b) => ({
      store: b.o.store, title: `${b.o.title} (${b.label})`,
      price: Math.round(b.packs * b.o.price * 100) / 100,
      cardPrice: b.o.cardPrice ? Math.round(b.packs * b.o.cardPrice * 100) / 100 : null,
      url: b.o.url,
    })),
  }));

  function render() {
    const out = root.querySelector('#menuOut');
    const bar = root.querySelector('#mBar');
    if (st.error) {
      bar.hidden = true;
      out.innerHTML = `<div class="empty"><b>Щось пішло не так</b>${esc(st.error)}<br><br><button class="btn" type="button" data-menu-retry>Спробувати ще раз</button></div>`;
      return;
    }
    if (!st.data) {
      bar.hidden = true;
      out.innerHTML = `<div class="menu-loading"><span class="refining">Збираємо ціни на продукти в Сільпо, АТБ і VARUS…</span>
        <p class="hint">Уперше після запуску сервера це може зайняти хвилину, далі — миттєво.</p>
        ${'<div class="day sk"><div class="line" style="width:30%"></div><div class="line"></div><div class="line" style="width:80%"></div></div>'.repeat(2)}</div>`;
      return;
    }

    const { kcal, days, mode } = st.opts;
    const budget = mode === 'range' || mode === 'custom' ? st.opts.budget : null;
    const cands = candidates();
    const { lambda, min, max, mid } = chooseLambda(cands);
    const { plan, need } = buildMenu(cands, lambda);
    const best = { id: 'best', ...shopping(need, 'best') };
    const storePlans = ORDER.map((s) => ({ id: s, ...shopping(need, s) })).sort((a, b) => a.total - b.total);
    const plans = [best, ...storePlans];
    const chosen = plans.find((p) => p.id === st.plan) || best;
    const personDays = st.opts.people * days;
    const storesUsed = new Set(chosen.lines.map((l) => l.o.store)).size;

    renderBudget({ min, max, mid });

    const macro = { p: 0, f: 0, c: 0 };
    for (const meals of plan) for (const m of meals) if (!m.empty) for (const k of ['p', 'f', 'c']) macro[k] += m.dish[k] * m.scale / days;

    const down = st.data.stores.filter((s) => !s.ok && !s.pending).map((s) => STORES[s.id].name);
    const pending = st.data.stores.filter((s) => s.pending).map((s) => STORES[s.id].name);
    const emptySlots = [...new Set(plan.flat().filter((m) => m.empty).map((m) => m.slot.name.toLowerCase()))];

    let budgetNote = '';
    if (budget) {
      const left = budget - chosen.total;
      budgetNote = left >= 0
        ? `<p class="budget-ok">Укладаємось у бюджет ${money(budget)} ₴ — ${left > 1 ? `лишається ${money(left)} ₴` : 'впритул'}.</p>`
        : budget < min
          ? `<p class="budget-bad">З такими обмеженнями найдешевше меню коштує ${money(chosen.total)} ₴ — це на ${money(-left)} ₴ більше за бюджет. Спробуйте менше днів або зніміть частину фільтрів.</p>`
          : `<p class="budget-bad">Після ручних замін меню вийшло на ${money(-left)} ₴ дорожче за бюджет.</p>`;
    }

    const planCard = (p) => {
      const isBest = p.id === 'best';
      const on = p.id === chosen.id;
      const diff = p.total - best.total;
      const ds = isBest ? 'кожен продукт там, де дешевше'
        : `${diff > 0.005 ? `+${money(diff)}` : 'так само'} · ${p.moved ? `${p.moved} ${plural(p.moved, 'продукт', 'продукти', 'продуктів')} деінде` : 'усе є'}`;
      const over = budget && p.total > budget + 0.005;
      return `<label class="plan-card${on ? ' on' : ''}${isBest ? '' : ` ${STORES[p.id].cls}`}">
        <span class="pc-name"><input type="radio" name="menuPlan" value="${p.id}" ${on ? 'checked' : ''}>${isBest ? '' : '<i></i>'}${isBest ? 'Оптимально' : STORES[p.id].name}</span>
        <b>${money(p.total)} ₴</b>
        <small>${ds}${over ? ' · <span class="over">понад бюджет</span>' : ''}</small>
      </label>`;
    };

    const today = new Date();
    const mealTile = (m) => m.empty
      ? `<div class="meal-tile empty-meal"><div class="mt-photo"></div><div class="mt-text"><span class="mt-meta">${m.slot.name}</span><span class="mt-name">Немає страв під вибрані фільтри</span></div></div>`
      : `<article class="meal-tile">
          <button class="mt-photo" type="button" data-recipe="${m.key}" aria-label="Рецепт: ${esc(m.dish.name)}"><img src="${esc(imgUrl(m.dish.img, 480))}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>
          <div class="mt-text">
            <span class="mt-meta">${m.slot.name} · ${Math.round(m.dish.kcal * m.scale)} ккал · ${fmtTime(m.dish.time)}</span>
            <button class="mt-name" type="button" data-recipe="${m.key}">${esc(m.dish.name)}</button>
            ${m.dish.notes.length ? `<span class="meal-notes">${esc(m.dish.notes.join(', '))}</span>` : ''}
          </div>
          <span class="mt-cost">${money(m.cost)} ₴</span>
          ${m.alternatives > 1 ? `<button class="swap" type="button" data-swap="${m.key}" aria-label="Інша страва" title="Інша страва">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></button>` : ''}
        </article>`;
    const dayCard = (meals, d) => {
      const date = new Date(today.getTime() + (d + 1) * 864e5);
      const dayCost = meals.reduce((s, m) => s + (m.cost || 0), 0) * st.opts.people;
      return `<article class="day">
        <div class="day-head"><b>${days === 1 ? 'Меню на день' : WEEKDAYS[date.getDay()]}<small>${date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</small></b><span>${money(dayCost)} ₴${st.opts.people > 1 ? ` на ${st.opts.people}` : ''}</span></div>
        <div class="meal-grid">${meals.map(mealTile).join('')}</div>
      </article>`;
    };

    const SHOW = 6;
    const lines = st.showAll ? chosen.lines : chosen.lines.slice(0, SHOW);

    out.innerHTML = `
      ${pending.length ? `<p class="hint"><span class="refining">Ціни ${pending.join(', ')} ще збираються — меню оновиться само</span></p>` : ''}
      ${down.length ? `<p class="warn">${down.join(', ')} зараз не відповідає — рахуємо без ${down.length > 1 ? 'них' : 'нього'}.</p>` : ''}
      ${emptySlots.length ? `<p class="warn">Для прийому «${emptySlots.join('», «')}» немає страв під вибрані фільтри — спробуйте зняти частину обмежень.</p>` : ''}
      <div class="kpis">
        <div class="kpi hl"><span>До сплати</span><b>${money(chosen.total)} ₴</b><small>${people(st.opts.people)} · ${daysTxt(days)} · ${chosen.lines.length} ${plural(chosen.lines.length, 'продукт', 'продукти', 'продуктів')}</small></div>
        <div class="kpi"><span>На людину в день</span><b>${money(chosen.eaten / personDays)} ₴</b><small>вартість з’їденого</small></div>
        <div class="kpi"><span>${kcal.toLocaleString('uk-UA')} ккал · Б Ж В</span><b>${Math.round(macro.p)} · ${Math.round(macro.f)} · ${Math.round(macro.c)}</b><small>г на людину в день</small></div>
      </div>
      ${budgetNote}
      <div class="plan-cards" role="radiogroup" aria-label="Де купувати">${plans.map(planCard).join('')}</div>
      ${chosen.total - chosen.eaten > 1 ? `<p class="hint">Продукти продаються пачками, тож ${money(chosen.total - chosen.eaten)} ₴ — це залишки (олія, борошно, крупи, спеції), які лишаться на потім.</p>` : ''}

      <div class="days">${plan.map(dayCard).join('')}</div>

      <article class="shop-card" id="mShop">
        <div class="shop-head"><b>Список покупок</b><span>${chosen.lines.length} ${plural(chosen.lines.length, 'продукт', 'продукти', 'продуктів')} · ${storesUsed} ${plural(storesUsed, 'магазин', 'магазини', 'магазинів')}</span></div>
        <div class="shop">${lines.map((l) => `<div class="shop-row ${STORES[l.o.store].cls}">
          <div class="shop-main">
            <div class="shop-name"><b>${esc(l.i.name)}</b> <span>${l.need}</span></div>
            <a href="${esc(l.o.url)}" target="_blank" rel="noopener nofollow">${esc(l.o.title)}</a>
          </div>
          <div class="shop-side"><b>${money(l.cost)} ₴</b><span class="st">${STORES[l.o.store].name} · ${l.label}</span></div>
        </div>`).join('')}</div>
        <div class="row-btns">
          <button class="btn" type="button" data-menu-cart>Додати все в кошик</button>
          ${chosen.lines.length > SHOW ? `<button class="btn ghost" type="button" data-show-all>${st.showAll ? 'Згорнути' : `Показати всі ${chosen.lines.length}`}</button>` : ''}
          <button class="btn ghost" type="button" data-menu-copy>Скопіювати список</button>
        </div>
        <p class="hint">Ціни з онлайн-магазинів, оновлено ${new Date(st.data.updatedAt).toLocaleString('uk-UA', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}. Для АТБ — ціна з карткою, якщо є. Калорійність довідкова. Фото страв — Wikimedia Commons.</p>
      </article>`;

    // Нижня панель на телефоні: сума і швидкий перехід до списку покупок
    bar.hidden = false;
    bar.querySelector('.mbar-sum').textContent = `${money(chosen.total)} ₴`;
    bar.querySelector('.mbar-sub').textContent = `До сплати · ${storesUsed} ${plural(storesUsed, 'магазин', 'магазини', 'магазинів')}`;

    st.last = { chosen, plan };
  }

  function openRecipe(key) {
    const m = st.last.plan.flat().find((x) => x.key === key);
    if (!m || m.empty) return;
    const n = st.opts.people;
    const d = m.dish;
    const dlg = root.querySelector('#recipe');
    dlg.dataset.key = key;
    dlg.querySelector('.recipe-body').innerHTML = `
      <figure class="recipe-photo"><img src="${esc(imgUrl(d.img, 900))}" alt="${esc(d.name)}" referrerpolicy="no-referrer">
        <figcaption><a href="${esc(imgPage(d.img))}" target="_blank" rel="noopener">Фото: Wikimedia Commons</a></figcaption></figure>
      <div class="recipe-text">
        <p class="eyebrow-sm">${m.slot.name}</p>
        <h2>${esc(d.name)}</h2>
        <div class="rstats">
          <div><span>Час</span><b>${fmtTime(d.time)}</b></div>
          <div><span>Порція</span><b>${Math.round(d.kcal * m.scale)} ккал</b></div>
          <div><span>Б · Ж · В</span><b>${Math.round(d.p * m.scale)}·${Math.round(d.f * m.scale)}·${Math.round(d.c * m.scale)}</b></div>
          <div class="hl"><span>На ${n}</span><b>${money(m.cost * n)} ₴</b></div>
        </div>
        ${d.notes.length ? `<p class="meal-notes">Під ваші фільтри: ${esc(d.notes.join(', '))}.</p>` : ''}
        <div class="rcols">
          <section>
            <h3>Продукти на ${n} ${plural(n, 'порцію', 'порції', 'порцій')}</h3>
            <ul class="recipe-ings">${Object.entries(d.items).map(([id, g]) => {
              const i = ing(id);
              return `<li><span>${esc(i.name)}</span><b>${amount(i, g * m.scale * n)}</b></li>`;
            }).join('')}</ul>
          </section>
          <section>
            <h3>Як готувати</h3>
            <ol class="recipe-steps">${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
            <p class="hint">Сіль, перець і спеції — за смаком.</p>
          </section>
        </div>
        <div class="row-btns">
          ${m.alternatives > 1 ? '<button class="btn" type="button" data-dialog-swap>Інша страва</button>' : ''}
          <button class="btn ghost" type="button" data-dialog-cart>Продукти в кошик</button>
        </div>
      </div>`;
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    dlg.scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }

  function renderBudget({ min, max, mid }) {
    const { mode, budget, days } = st.opts;
    const price = { cheap: min, normal: mid, rich: max };
    root.querySelector('#mBudgetFor').textContent = days === 1 ? 'на 1 день' : `на ${daysTxt(days)}`;
    root.querySelectorAll('[data-tier]').forEach((b) => {
      b.classList.toggle('on', b.dataset.tier === mode);
      b.setAttribute('aria-pressed', String(b.dataset.tier === mode));
      b.querySelector('.tier-price').textContent = `≈ ${Math.ceil(price[b.dataset.tier]).toLocaleString('uk-UA')} ₴`;
    });
    const fmt = (n) => n.toLocaleString('uk-UA');
    root.querySelector('#mRanges').innerHTML = budgetRanges(min, max).map(([lo, hi]) =>
      `<button type="button" data-range="${hi}" class="${mode === 'range' && budget === hi ? 'on' : ''}">${lo ? `${fmt(lo)}–${fmt(hi)}` : `до ${fmt(hi)}`} ₴</button>`).join('');
  }

  function renderControls() {
    const o = st.opts;
    root.querySelector('#mPeople').textContent = o.people;
    root.querySelector('#mKcal').value = o.kcal;
    root.querySelector('#mSummaryText').textContent = `${people(o.people)} · ${daysTxt(o.days)} · ${o.kcal.toLocaleString('uk-UA')} ккал`;
    const b = root.querySelector('#mBudget');
    if (document.activeElement !== b) b.value = o.mode === 'custom' ? o.budget || '' : '';
    b.parentElement.classList.toggle('on', o.mode === 'custom');
    root.querySelectorAll('[data-kcal]').forEach((x) => x.classList.toggle('on', Number(x.dataset.kcal) === o.kcal));
    root.querySelectorAll('[data-days]').forEach((x) => x.classList.toggle('on', Number(x.dataset.days) === o.days));
    root.querySelectorAll('[data-diet]').forEach((x) => x.classList.toggle('on', x.dataset.diet === o.diet));
    root.querySelectorAll('[data-restrict]').forEach((x) => x.classList.toggle('on', o.restrict.includes(x.dataset.restrict)));
    root.querySelectorAll('[data-goal]').forEach((x) => x.classList.toggle('on', o.goals.includes(x.dataset.goal)));
    root.querySelectorAll('[data-dislike]').forEach((x) => x.classList.toggle('on', o.dislikes.includes(x.dataset.dislike)));
    root.querySelector('#mDislikeCount').textContent = o.dislikes.length ? `(${o.dislikes.length})` : '';
  }

  function renderDislikes() {
    if (!st.data) return;
    // Лише продукти, які справді є в стравах; базові (олія, сіль) не пропонуємо
    const usedIds = new Set(st.data.dishes.flatMap((d) => Object.keys(d.items)));
    const skip = new Set(['oil', 'milkLf', 'sugar', 'flour']);
    const list = st.data.ingredients.filter((i) => usedIds.has(i.id) && !skip.has(i.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    root.querySelector('#mDislikes').innerHTML = list.map((i) => `<button type="button" data-dislike="${i.id}">${esc(i.name)}</button>`).join('');
    renderControls();
  }

  function setOpts(patch) {
    Object.assign(st.opts, patch);
    st.swaps = {};
    save('menu-v2', st.opts);
    renderControls();
    render();
  }
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // silent — тихе оновлення, коли сервер дозібрав ціни АТБ (без екрана завантаження)
  let polls = 0;
  async function fetchPrices({ silent = false } = {}) {
    if (st.loading) return;
    st.loading = true;
    if (!silent) { st.error = null; render(); }
    try {
      const res = await fetch('/api/menu', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error || 'Помилка сервера');
      st.data = json;
      st.byId = null;
      renderDislikes();
      if (json.stores.some((s) => s.pending) && polls++ < 30) setTimeout(() => fetchPrices({ silent: true }), 20000);
    } catch (e) {
      if (!silent) st.error = e.message;
    } finally {
      st.loading = false;
      render();
    }
  }

  /* ---------- розмітка й події ---------- */

  const chip = (attr, id, name, hint) => `<button type="button" ${attr}="${id}"${hint ? ` title="${esc(hint)}"` : ''}>${name}</button>`;
  root.innerHTML = `
    <h1 class="page-title">Смачно. <span>І в бюджет.</span></h1>
    <div class="menu-layout">
      <aside class="menu-panel" id="mPanel" aria-label="Налаштування меню">
        <button class="panel-summary" type="button" data-panel-toggle aria-expanded="false" aria-controls="mBasics">
          <span id="mSummaryText"></span><b>Змінити</b>
        </button>
        <div class="p-basics" id="mBasics">
          <div class="p-row">
            <div class="field">
              <span class="p-label">Людей</span>
              <div class="stepper"><button type="button" data-people="-1" aria-label="Менше людей">−</button><b id="mPeople"></b><button type="button" data-people="1" aria-label="Більше людей">+</button></div>
            </div>
            <div class="field">
              <span class="p-label">Днів</span>
              <div class="seg">${DAYS.map((d) => `<button type="button" data-days="${d}" aria-label="${daysTxt(d)}">${d}</button>`).join('')}</div>
            </div>
          </div>
          <div class="field">
            <label class="p-label" for="mKcal">Ккал на людину в день</label>
            <div class="chips">
              <input id="mKcal" class="kcal-input" type="number" min="1200" max="4500" step="100" inputmode="numeric">
              ${KCAL_PRESETS.map((p) => `<button type="button" data-kcal="${p.kcal}" title="${p.label}">${p.kcal}</button>`).join('')}
            </div>
          </div>
        </div>

        <div class="field p-budget">
          <span class="p-label">Бюджет <span id="mBudgetFor"></span></span>
          <div class="tiers" id="mTiers">${TIERS.map((t) => `<button type="button" class="tier" data-tier="${t.id}" aria-pressed="false"><b>${t.name}</b><span class="tier-price">…</span><small>${t.desc}</small></button>`).join('')}</div>
          <div class="budget-more">
            <span class="field-hint">або сума:</span>
            <div class="chips" id="mRanges"></div>
            <div class="budget-input"><input id="mBudget" type="number" min="0" step="50" inputmode="numeric" placeholder="своя сума" aria-label="Своя сума бюджету"><span>₴</span></div>
          </div>
        </div>

        <div class="field p-filters">
          <span class="p-label">Харчування</span>
          <div class="chips scroll-chips">
            ${DIETS.filter((d) => d.id !== 'all').map((d) => chip('data-diet', d.id, d.name)).join('')}
            ${RESTRICT.map((r) => chip('data-restrict', r.id, `Без ${r.name}`, r.hint)).join('')}
            ${GOALS.map((g) => chip('data-goal', g.id, g.name)).join('')}
          </div>
          <details class="dislikes">
            <summary>Не їм окремі продукти <span id="mDislikeCount"></span></summary>
            <div class="chips" id="mDislikes"></div>
          </details>
        </div>
      </aside>

      <section class="menu-main" id="menuOut" aria-live="polite"></section>
    </div>

    <div class="mbar" id="mBar" hidden>
      <div><span class="mbar-sub"></span><b class="mbar-sum"></b></div>
      <button type="button" data-goto-shop>Список покупок</button>
    </div>

    <dialog class="recipe" id="recipe" aria-label="Рецепт">
      <button class="icon-btn recipe-close" type="button" data-close aria-label="Закрити">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
      <div class="recipe-body"></div>
    </dialog>`;

  const dlg = root.querySelector('#recipe');
  const closeRecipe = () => { dlg.close?.(); dlg.removeAttribute('open'); document.body.style.overflow = ''; };
  dlg.addEventListener('close', () => { document.body.style.overflow = ''; });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) return closeRecipe();
    const key = dlg.dataset.key;
    if (e.target.closest('[data-dialog-swap]')) {
      st.swaps[key] = (st.swaps[key] || 0) + 1;
      render();
      return openRecipe(key);
    }
    if (e.target.closest('[data-dialog-cart]')) {
      const m = st.last.plan.flat().find((x) => x.key === key);
      const need = Object.fromEntries(Object.entries(m.dish.items).map(([id, g]) => [id, g * m.scale * st.opts.people]));
      closeRecipe();
      addItemsToCart(toCartItems(shopping(need, 'best').lines));
    }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || t.closest('dialog')) return;
    const o = st.opts;
    if (t.hasAttribute('data-panel-toggle')) {
      const open = root.querySelector('#mPanel').classList.toggle('open');
      t.setAttribute('aria-expanded', String(open));
      return;
    }
    if (t.dataset.people) return setOpts({ people: Math.min(12, Math.max(1, o.people + Number(t.dataset.people))) });
    if (t.dataset.kcal) return setOpts({ kcal: Number(t.dataset.kcal) });
    if (t.dataset.days) return setOpts({ days: Number(t.dataset.days) });
    if (t.dataset.tier) return setOpts({ mode: t.dataset.tier });
    if (t.dataset.range) return setOpts({ mode: 'range', budget: Number(t.dataset.range) });
    if (t.dataset.diet) return setOpts({ diet: o.diet === t.dataset.diet ? 'all' : t.dataset.diet });
    if (t.dataset.restrict) return setOpts({ restrict: toggle(o.restrict, t.dataset.restrict) });
    if (t.dataset.goal) return setOpts({ goals: toggle(o.goals, t.dataset.goal) });
    if (t.dataset.dislike) return setOpts({ dislikes: toggle(o.dislikes, t.dataset.dislike) });
    if (t.dataset.recipe) return openRecipe(t.dataset.recipe);
    if (t.dataset.swap) {
      st.swaps[t.dataset.swap] = (st.swaps[t.dataset.swap] || 0) + 1;
      return render();
    }
    if (t.hasAttribute('data-show-all')) { st.showAll = !st.showAll; return render(); }
    if (t.hasAttribute('data-goto-shop')) return root.querySelector('#mShop')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (t.hasAttribute('data-menu-retry')) return fetchPrices();
    if (t.hasAttribute('data-menu-cart')) return addItemsToCart(toCartItems(st.last.chosen.lines));
    if (t.hasAttribute('data-menu-copy')) {
      const { chosen } = st.last;
      const text = ORDER.map((s) => {
        const list = chosen.lines.filter((l) => l.o.store === s);
        if (!list.length) return '';
        return `${STORES[s].name}:\n` + list.map((l) => `• ${l.i.name} (${l.need}) — ${l.o.title}, ${l.label} — ${money(l.cost)} грн\n  ${l.o.url}`).join('\n');
      }).filter(Boolean).join('\n\n') + `\n\nРазом: ${money(chosen.total)} грн`;
      try { await navigator.clipboard.writeText(text); toast('Список скопійовано'); } catch { toast('Не вдалося скопіювати'); }
    }
  });

  root.addEventListener('change', (e) => {
    if (e.target.name === 'menuPlan') { st.plan = e.target.value; render(); }
    if (e.target.id === 'mKcal') {
      const v = Math.round(Number(e.target.value) / 50) * 50;
      setOpts({ kcal: Math.min(4500, Math.max(1200, v || 2000)) });
    }
    if (e.target.id === 'mBudget') {
      const v = Math.round(Number(e.target.value));
      setOpts(v > 0 ? { mode: 'custom', budget: v } : { mode: 'normal', budget: null });
    }
  });
  root.querySelector('#mBudget').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

  renderControls();
  return {
    show() { if (!st.data && !st.loading) fetchPrices(); else render(); },
  };
}
