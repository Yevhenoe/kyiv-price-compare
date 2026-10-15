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

  function render() {
    const out = root.querySelector('#menuOut');
    if (st.error) {
      out.innerHTML = `<div class="empty"><b>Щось пішло не так</b>${esc(st.error)}<br><br><button class="btn" type="button" data-menu-retry>Спробувати ще раз</button></div>`;
      return;
    }
    if (!st.data) {
      out.innerHTML = `<div class="menu-loading"><span class="refining">Збираємо ціни на продукти в Сільпо, АТБ і VARUS…</span>
        <p class="hint">Уперше після запуску сервера це займає до хвилини, далі — миттєво.</p>
        ${'<div class="day sk"><div class="line" style="width:30%"></div><div class="line"></div><div class="line" style="width:80%"></div></div>'.repeat(2)}</div>`;
      return;
    }

    const { people, kcal, days, mode } = st.opts;
    const budget = mode === 'range' || mode === 'custom' ? st.opts.budget : null;
    const cands = candidates();
    const { lambda, min, max, mid } = chooseLambda(cands);
    const { plan, need } = buildMenu(cands, lambda);
    const plans = [{ id: 'best', ...shopping(need, 'best') }, ...ORDER.map((s) => ({ id: s, ...shopping(need, s) }))];
    const chosen = plans.find((p) => p.id === st.plan) || plans[0];
    const minTotal = Math.min(...plans.map((p) => p.total));
    const personDays = people * days;

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

    const planRow = (p) => {
      const isBest = p.id === 'best';
      const name = isBest ? 'Оптимально' : STORES[p.id].name;
      const storesUsed = new Set(p.lines.map((l) => l.o.store)).size;
      const ds = isBest
        ? `кожен продукт там, де дешевше · ${storesUsed} ${plural(storesUsed, 'магазин', 'магазини', 'магазинів')}`
        : p.moved ? `${p.moved} з ${p.lines.length} продуктів немає — візьмемо деінде` : 'усі продукти є';
      const diff = p.total - minTotal;
      const over = budget && p.total > budget + 0.005;
      return `<label class="plan ${isBest ? '' : STORES[p.id].cls}${p.id === chosen.id ? ' on' : ''}${Math.abs(diff) < 0.005 ? ' best-plan' : ''}">
        <input type="radio" name="menuPlan" value="${p.id}" ${p.id === chosen.id ? 'checked' : ''}>
        <span><span class="nm">${name}</span><span class="ds">${ds}${over ? ' · <span class="over">понад бюджет</span>' : ''}</span></span>
        <span class="tt">${money(p.total)} ₴${diff > 0.005 ? `<small>+${money(diff)}</small>` : ''}</span>
      </label>`;
    };

    const today = new Date();
    const dayCard = (meals, d) => {
      const date = new Date(today.getTime() + (d + 1) * 864e5);
      const dayCost = meals.reduce((s, m) => s + (m.cost || 0), 0) * people;
      return `<article class="day">
        <div class="day-head"><b>${days === 1 ? 'Меню на день' : WEEKDAYS[date.getDay()]}<small>${date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</small></b><span>${money(dayCost)} ₴${people > 1 ? ` на ${people}` : ''}</span></div>
        ${meals.map((m) => m.empty
          ? `<div class="meal empty-meal"><div class="meal-slot">${m.slot.name}</div><div class="meal-main"><div class="meal-ings">Немає страв, що відповідають фільтрам</div></div></div>`
          : `<div class="meal">
          <button class="meal-photo" type="button" data-recipe="${m.key}" aria-label="Рецепт: ${esc(m.dish.name)}"><img src="${esc(imgUrl(m.dish.img, 160))}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>
          <div class="meal-main">
            <div class="meal-slot">${m.slot.name} · ${Math.round(m.dish.kcal * m.scale)} ккал · ${m.dish.time} хв</div>
            <button class="meal-name" type="button" data-recipe="${m.key}">${esc(m.dish.name)}</button>
            ${m.dish.notes.length ? `<div class="meal-notes">${esc(m.dish.notes.join(', '))}</div>` : ''}
          </div>
          <div class="meal-side">
            <span class="meal-cost">${money(m.cost)} ₴</span>
            ${m.alternatives > 1 ? `<button class="swap" type="button" data-swap="${m.key}" title="Інша страва" aria-label="Інша страва">↻</button>` : ''}
          </div>
        </div>`).join('')}
      </article>`;
    };

    root.querySelector('#menuOut').innerHTML = `
      ${pending.length ? `<p class="hint"><span class="refining">Ціни ${pending.join(', ')} ще збираються — меню оновиться само</span></p>` : ''}
      ${down.length ? `<p class="warn">${down.join(', ')} зараз не відповідає — рахуємо без ${down.length > 1 ? 'них' : 'нього'}.</p>` : ''}
      ${emptySlots.length ? `<p class="warn">Для прийому «${emptySlots.join('», «')}» немає страв під вибрані фільтри — спробуйте зняти частину обмежень.</p>` : ''}
      <div class="kpis">
        <div class="kpi hl"><span>До сплати</span><b>${money(chosen.total)} ₴</b><small>${people} ${plural(people, 'людина', 'людини', 'людей')} · ${days} ${plural(days, 'день', 'дні', 'днів')}</small></div>
        <div class="kpi"><span>На людину в день</span><b>${money(chosen.eaten / personDays)} ₴</b><small>вартість з’їденого</small></div>
        <div class="kpi"><span>Калорії</span><b>${kcal.toLocaleString('uk-UA')}</b><small>ккал на людину в день</small></div>
        <div class="kpi"><span>Б · Ж · В</span><b>${Math.round(macro.p)} · ${Math.round(macro.f)} · ${Math.round(macro.c)}</b><small>г на людину в день</small></div>
      </div>
      ${budgetNote}
      ${chosen.total - chosen.eaten > 1 ? `<p class="hint">Продукти продаються пачками, тож ${money(chosen.total - chosen.eaten)} ₴ — це залишки (олія, борошно, крупи, спеції), які лишаться на потім.</p>` : ''}

      <div class="menu-grid">
        <section>
          <h3 class="sec">Меню · натисніть на страву, щоб побачити рецепт</h3>
          <div class="days">${plan.map(dayCard).join('')}</div>
        </section>
        <aside>
          <h3 class="sec">Де купити дешевше</h3>
          <div class="plans">${plans.map(planRow).join('')}</div>

          <h3 class="sec">Список покупок · ${chosen.lines.length}</h3>
          <div class="shop">${chosen.lines.map((l) => `<div class="shop-row ${STORES[l.o.store].cls}">
            <div class="shop-main">
              <div class="shop-name"><b>${esc(l.i.name)}</b> <span>${l.need}</span></div>
              <a href="${esc(l.o.url)}" target="_blank" rel="noopener nofollow">${esc(l.o.title)}</a>
            </div>
            <div class="shop-side"><b>${money(l.cost)} ₴</b><span class="st">${STORES[l.o.store].name} · ${l.label}</span></div>
          </div>`).join('')}</div>
          <div class="row-btns">
            <button class="btn" type="button" data-menu-cart>Додати все в кошик</button>
            <button class="btn ghost" type="button" data-menu-copy>Скопіювати список</button>
          </div>
          <p class="hint">Ціни з онлайн-магазинів, оновлено ${new Date(st.data.updatedAt).toLocaleString('uk-UA', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}. Для АТБ — ціна з карткою, якщо є. Калорійність довідкова. Фото страв — Wikimedia Commons.</p>
        </aside>
      </div>`;

    st.last = { chosen, plan };
  }

  function openRecipe(key) {
    const m = st.last.plan.flat().find((x) => x.key === key);
    if (!m) return;
    const { people } = st.opts;
    const d = m.dish;
    const dlg = root.querySelector('#recipe');
    dlg.querySelector('.recipe-body').innerHTML = `
      <figure class="recipe-photo"><img src="${esc(imgUrl(d.img, 800))}" alt="${esc(d.name)}" referrerpolicy="no-referrer">
        <figcaption><a href="${esc(imgPage(d.img))}" target="_blank" rel="noopener">Фото: Wikimedia Commons</a></figcaption></figure>
      <div class="recipe-text">
        <p class="eyebrow-sm">${m.slot.name}</p>
        <h2>${esc(d.name)}</h2>
        <div class="meta">
          <span class="tag">${d.time} хв</span>
          <span class="tag">${Math.round(d.kcal * m.scale)} ккал / порція</span>
          <span class="tag">Б ${Math.round(d.p * m.scale)} · Ж ${Math.round(d.f * m.scale)} · В ${Math.round(d.c * m.scale)} г</span>
          <span class="tag save">${money(m.cost * people)} ₴ на ${people}</span>
        </div>
        ${d.notes.length ? `<p class="meal-notes">Під ваші фільтри: ${esc(d.notes.join(', '))}.</p>` : ''}
        <h3>Продукти на ${people} ${plural(people, 'порцію', 'порції', 'порцій')}</h3>
        <ul class="recipe-ings">${Object.entries(d.items).map(([id, g]) => {
          const i = ing(id);
          return `<li><span>${esc(i.name)}</span><b>${amount(i, g * m.scale * people)}</b></li>`;
        }).join('')}</ul>
        <h3>Як готувати</h3>
        <ol class="recipe-steps">${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <p class="hint">Сіль, перець і спеції — за смаком.</p>
      </div>`;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
  }

  function renderBudget({ min, max, mid }) {
    const { mode, budget, people, days } = st.opts;
    const price = { cheap: min, normal: mid, rich: max };
    root.querySelector('#mBudgetFor').textContent = `· ${people} ${plural(people, 'людина', 'людини', 'людей')}, ${days} ${plural(days, 'день', 'дні', 'днів')}`;
    root.querySelectorAll('[data-tier]').forEach((b) => {
      b.classList.toggle('on', b.dataset.tier === mode);
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
    const b = root.querySelector('#mBudget');
    if (document.activeElement !== b) b.value = o.mode === 'custom' ? o.budget || '' : '';
    b.parentElement.classList.toggle('on', o.mode === 'custom');
    root.querySelectorAll('[data-kcal]').forEach((x) => x.classList.toggle('on', Number(x.dataset.kcal) === o.kcal));
    root.querySelectorAll('[data-days]').forEach((x) => x.classList.toggle('on', Number(x.dataset.days) === o.days));
    root.querySelectorAll('[data-diet]').forEach((x) => x.classList.toggle('on', x.dataset.diet === o.diet));
    root.querySelectorAll('[data-restrict]').forEach((x) => x.classList.toggle('on', o.restrict.includes(x.dataset.restrict)));
    root.querySelectorAll('[data-goal]').forEach((x) => x.classList.toggle('on', o.goals.includes(x.dataset.goal)));
    root.querySelectorAll('[data-dislike]').forEach((x) => x.classList.toggle('on', o.dislikes.includes(x.dataset.dislike)));
    const n = o.restrict.length + o.goals.length + o.dislikes.length + (o.diet !== 'all' ? 1 : 0);
    root.querySelector('#mFilterCount').textContent = n ? `· ${n}` : '';
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

  root.innerHTML = `
    <section class="hero menu-hero">
      <p class="eyebrow"><span class="pulse"></span>Меню під ваш бюджет</p>
      <h1>Смачно.<br><span>І в бюджет.</span></h1>
      <p class="lead">Вкажіть, скільки вас, скільки калорій і грошей, — ми складемо різноманітне меню з рецептами і порахуємо, де продукти обійдуться найдешевше.</p>
    </section>

    <div class="menu-form">
      <div class="form-row">
        <div class="field">
          <label>Скільки людей</label>
          <div class="stepper"><button type="button" data-people="-1" aria-label="Менше">−</button><b id="mPeople"></b><button type="button" data-people="1" aria-label="Більше">+</button></div>
        </div>
        <div class="field">
          <label>На скільки днів</label>
          <div class="seg">${DAYS.map((d) => `<button type="button" data-days="${d}">${d === 7 ? 'тиждень' : `${d} ${plural(d, 'день', 'дні', 'днів')}`}</button>`).join('')}</div>
        </div>
      </div>
      <div class="field">
        <label>Бюджет на весь термін <span class="label-sub" id="mBudgetFor"></span></label>
        <div class="tiers" id="mTiers">${TIERS.map((t) => `<button type="button" class="tier" data-tier="${t.id}"><b>${t.name}</b><span class="tier-price">…</span><small>${t.desc}</small></button>`).join('')}</div>
        <div class="budget-more">
          <span class="field-hint">або сума:</span>
          <div class="chips" id="mRanges"></div>
          <div class="budget-input"><input id="mBudget" type="number" min="0" step="50" inputmode="numeric" placeholder="своя сума"><span>₴</span></div>
        </div>
      </div>
      <div class="field">
        <label for="mKcal">Ккал на людину в день</label>
        <div class="kcal-row">
          <input id="mKcal" type="number" min="1200" max="4500" step="100" inputmode="numeric">
          <div class="chips">${KCAL_PRESETS.map((p) => `<button type="button" data-kcal="${p.kcal}">${p.kcal} · ${p.label}</button>`).join('')}</div>
        </div>
      </div>
      <details class="filters">
        <summary>Харчування та обмеження <span id="mFilterCount"></span></summary>
        <div class="filter-grid">
          <div class="field">
            <label>Тип харчування</label>
            <div class="seg wrap-seg">${DIETS.map((d) => `<button type="button" data-diet="${d.id}">${d.name}</button>`).join('')}</div>
          </div>
          <div class="field">
            <label>Без</label>
            <div class="chips">${RESTRICT.map((r) => `<button type="button" data-restrict="${r.id}" ${r.hint ? `title="${esc(r.hint)}"` : ''}>${r.name}</button>`).join('')}</div>
          </div>
          <div class="field">
            <label>Мета</label>
            <div class="chips">${GOALS.map((g) => `<button type="button" data-goal="${g.id}">${g.name}</button>`).join('')}</div>
          </div>
          <details class="dislikes">
            <summary>Не їм окремі продукти <span id="mDislikeCount"></span></summary>
            <div class="chips" id="mDislikes"></div>
          </details>
        </div>
      </details>
    </div>

    <div id="menuOut"></div>

    <dialog class="recipe" id="recipe" aria-label="Рецепт">
      <button class="icon-btn recipe-close" type="button" data-close aria-label="Закрити">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
      <div class="recipe-body"></div>
    </dialog>`;

  const dlg = root.querySelector('#recipe');
  const closeRecipe = () => { dlg.close?.(); dlg.removeAttribute('open'); document.body.style.overflow = ''; };
  dlg.addEventListener('close', () => { document.body.style.overflow = ''; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) closeRecipe(); });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || t.closest('dialog')) return;
    const o = st.opts;
    if (t.dataset.people) return setOpts({ people: Math.min(12, Math.max(1, o.people + Number(t.dataset.people))) });
    if (t.dataset.kcal) return setOpts({ kcal: Number(t.dataset.kcal) });
    if (t.dataset.days) return setOpts({ days: Number(t.dataset.days) });
    if (t.dataset.tier) return setOpts({ mode: t.dataset.tier });
    if (t.dataset.range) return setOpts({ mode: 'range', budget: Number(t.dataset.range) });
    if (t.dataset.diet) return setOpts({ diet: t.dataset.diet });
    if (t.dataset.restrict) return setOpts({ restrict: toggle(o.restrict, t.dataset.restrict) });
    if (t.dataset.goal) return setOpts({ goals: toggle(o.goals, t.dataset.goal) });
    if (t.dataset.dislike) return setOpts({ dislikes: toggle(o.dislikes, t.dataset.dislike) });
    if (t.dataset.recipe) return openRecipe(t.dataset.recipe);
    if (t.dataset.swap) {
      st.swaps[t.dataset.swap] = (st.swaps[t.dataset.swap] || 0) + 1;
      return render();
    }
    if (t.hasAttribute('data-menu-retry')) return fetchPrices();
    if (t.hasAttribute('data-menu-cart')) {
      addItemsToCart(st.last.chosen.lines.map((l) => ({
        key: `menu:${l.i.id}`,
        title: `${l.i.name} — ${l.need}`,
        image: l.o.image,
        pack: l.label,
        // Ціна в кошику — за всю потрібну кількість (кілька пачок / кілограмів) у кожному магазині
        offers: l.byStore.map((b) => ({
          store: b.o.store, title: `${b.o.title} (${b.label})`,
          price: Math.round(b.packs * b.o.price * 100) / 100,
          cardPrice: b.o.cardPrice ? Math.round(b.packs * b.o.cardPrice * 100) / 100 : null,
          url: b.o.url,
        })),
      })));
      return;
    }
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
