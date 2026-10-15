import { initMenu } from './menu.js';

const STORES = {
  silpo: { name: 'Сільпо', cls: 'c-silpo' },
  atb: { name: 'АТБ', cls: 'c-atb' },
  varus: { name: 'VARUS', cls: 'c-varus' },
};
const ORDER = Object.keys(STORES);

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n ?? 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eff = (o) => o.cardPrice ?? o.price; // для АТБ — ціна з карткою

function store(k, fallback) {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
}
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватний режим — працюємо без збереження */ }
}

const state = {
  data: null,
  sort: store('sort-v2', 'price'),
  cart: store('cart-v1', {}),
  plan: 'best',
};

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ===================== Результати ===================== */

// Ціна за кг/л для пропозиції (з карткою АТБ, якщо є); для вагових — ціна за кг
function unitOf(g, o) {
  if (g.perKg) return eff(o);
  return o.unitPrice == null ? null : o.unitPrice * eff(o) / o.price;
}
const unitLabel = (g) => (/мл|л/.test(g.pack || '') ? 'л' : 'кг');

// Рядок «магазин — смужка — ціна»: довжина смужки пропорційна ціні, найдешевша — лаймова
function priceRow(g, s, maxPrice) {
  const o = g.offers.find((x) => x.store === s);
  const m = STORES[s];
  if (!o) {
    return `<div class="pr-row none ${m.cls}"><span class="pr-st">${m.name}</span><span class="pr-bar"></span><span class="pr-val"><span class="pr-no">немає</span></span></div>`;
  }
  const best = s === g.best;
  const byName = o.match === 'name';
  const u = unitOf(g, o);
  const sub = o.cardPrice ? 'з карткою' : o.oldPrice ? `<s>${money(o.oldPrice)}</s>` : u != null && !g.perKg ? `${money(u)}/${unitLabel(g)}` : '';
  const width = Math.max(12, Math.round(eff(o) / maxPrice * 100));
  return `<a class="pr-row ${m.cls}${best ? ' best' : ''}" href="${esc(o.url)}" target="_blank" rel="noopener nofollow"
      title="${esc(o.title)}${byName ? ' — збіг за назвою, брендом і фасуванням' : ' — збіг за штрихкодом'}">
    <span class="pr-st">${m.name}${byName ? '<i class="pr-why" aria-label="збіг за назвою">≈</i>' : ''}</span>
    <span class="pr-bar"><span style="width:${width}%"></span></span>
    <span class="pr-val"><b>${money(eff(o))}${g.perKg ? '<small>/кг</small>' : ''}</b>${sub ? `<small>${sub}</small>` : ''}</span>
  </a>`;
}

const addBtn = (g) => {
  const inCart = !!state.cart[g.key];
  return `<button class="add${inCart ? ' in' : ''}" data-add="${esc(g.key)}" type="button">${inCart ? '✓ У кошику' : '+ У кошик'}</button>`;
};

function compareCard(g, i) {
  const maxPrice = Math.max(...g.offers.map(eff));
  const byName = g.offers.some((o) => o.match === 'name');
  return `
  <article class="cmp" style="animation-delay:${Math.min(i, 12) * 25}ms">
    <div class="prod-img">${g.image ? `<img src="${esc(g.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span>${esc(g.pack || '')}</span>`}</div>
    <div class="cmp-info">
      <h3 class="prod-title">${esc(g.title)}</h3>
      <div class="meta">
        ${g.savingPct >= 1 ? `<span class="tag save">−${money(g.saving)} ₴ · ${g.savingPct}%</span>` : ''}
        <span class="tag">${byName ? '≈ збіг за назвою' : 'EAN — той самий товар'}</span>
        ${g.pack ? `<span class="tag">${esc(g.pack)}</span>` : ''}
      </div>
    </div>
    <div class="pr-rows">${ORDER.map((s) => priceRow(g, s, maxPrice)).join('')}</div>
    ${addBtn(g)}
  </article>`;
}

function singleCard(g, i) {
  const o = g.offers[0];
  const m = STORES[o.store];
  const u = unitOf(g, o);
  return `
  <article class="one ${m.cls}" style="animation-delay:${Math.min(i, 12) * 20}ms">
    <div class="one-head">
      <span class="one-st">${m.name}</span>
      ${g.image ? `<img src="${esc(g.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
    </div>
    <a class="one-title" href="${esc(o.url)}" target="_blank" rel="noopener nofollow">${esc(g.title)}</a>
    <div class="one-foot">
      <span class="one-price"><b>${money(eff(o))}${g.perKg ? '<small>/кг</small>' : ''}</b>
        <small>${o.cardPrice ? 'з карткою АТБ' : u != null && !g.perKg ? `${money(u)} ₴/${unitLabel(g)}` : o.oldPrice ? `<s>${money(o.oldPrice)}</s>` : ''}</small></span>
      <button class="plus${state.cart[g.key] ? ' in' : ''}" data-add="${esc(g.key)}" type="button" aria-label="${state.cart[g.key] ? 'Прибрати з кошика' : 'Додати в кошик'}">${state.cart[g.key] ? '✓' : '+'}</button>
    </div>
  </article>`;
}

// Найнижча ціна за кг/л серед магазинів; без фасування — в кінець
function minUnit(g) {
  const units = g.offers.map((o) => unitOf(g, o)).filter((u) => u != null);
  return units.length ? Math.min(...units) : Infinity;
}

function sorted(list) {
  const arr = [...list];
  // Товари, що повністю відповідають запиту, — завжди вище
  const rel = (a, b) => (b.relevance === 1) - (a.relevance === 1);
  if (state.sort === 'saving') arr.sort((a, b) => rel(a, b) || b.savingPct - a.savingPct || a.min - b.min);
  else if (state.sort === 'price') arr.sort((a, b) => rel(a, b) || minUnit(a) - minUnit(b) || a.min - b.min);
  else arr.sort((a, b) => b.relevance - a.relevance || b.offers.length - a.offers.length || a.min - b.min);
  return arr;
}

function render() {
  const d = state.data;
  if (!d) return;
  const compared = sorted(d.compared);
  const single = sorted(d.single);

  // Магазини з кількістю знайденого + підсумок
  const maxSave = Math.max(0, ...d.compared.map((g) => g.savingPct));
  const storeChips = ORDER.map((id) => {
    const st = d.stores.find((s) => s.id === id);
    if (!st) return '';
    const val = st.pending ? '<span class="refining">шукаємо</span>' : st.ok ? st.count : 'не відповідає';
    return `<span class="st-chip ${STORES[id].cls}${!st.ok && !st.pending ? ' off' : ''}">${STORES[id].name} · ${val}</span>`;
  }).join('');
  $('#stat').innerHTML = storeChips
    + `<span class="st-sum"><b>${d.compared.length}</b> ${d.compared.length === 1 ? 'товар є' : 'товарів є'} у кількох мережах`
    + (maxSave ? ` · економія до <span class="hl">${maxSave}%</span>` : '')
    + (d.partial && !d.stores.some((s) => s.pending) ? ' · <span class="refining">шукаємо ще пари</span>' : '') + '</span>';

  const down = d.stores.filter((s) => !s.ok && !s.pending).map((s) => STORES[s.id].name);
  const warn = down.length ? `<p class="warn">${down.join(', ')} зараз не відповідає — порівнюємо без ${down.length > 1 ? 'них' : 'нього'}. Спробуйте за хвилину.</p>` : '';

  if (!compared.length && !single.length) {
    $('#results').innerHTML = warn + '<div class="empty"><b>Нічого не знайдено</b>Уточніть запит — наприклад, додайте бренд або фасування.</div>';
    return;
  }
  $('#results').innerHTML = warn
    + (compared.length ? `<h2 class="sec">Є в кількох мережах</h2><div class="cmp-list">${compared.map(compareCard).join('')}</div>` : '')
    + (single.length ? `<h2 class="sec">Лише в одній мережі${state.sort === 'price' ? ' · найдешевші за кг' : ''}</h2><div class="one-grid">${single.map(singleCard).join('')}</div>` : '');
}

function renderLoading() {
  $('#toolbar').hidden = false;
  $('#stat').innerHTML = '<span class="refining">Шукаємо в Сільпо, АТБ і VARUS і зіставляємо штрихкоди…</span>';
  $('#results').innerHTML = '<h2 class="sec">&nbsp;</h2>' + Array.from({ length: 3 }, () => `
    <div class="cmp sk"><div class="prod-img"></div>
      <div><div class="line" style="width:70%"></div><div class="line" style="width:40%"></div></div>
      <div class="pr-rows">${'<div class="line"></div>'.repeat(3)}</div></div>`).join('');
}

let controller;
async function search(q, push = true) {
  q = q.trim();
  if (q.length < 2) return;
  $('#q').value = q;
  document.body.classList.add('has-results');
  document.title = `${q} — Дешевше`;
  if (push) history.pushState({ q }, '', `?q=${encodeURIComponent(q)}`);
  renderLoading();
  controller?.abort();
  controller = new AbortController();
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Помилка сервера');
    // Відповідь — NDJSON: спершу швидкий результат, потім повний (з кешу приходить одразу повний)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      buf += decoder.decode(value || new Uint8Array(), { stream: !done });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0 || (done && buf.trim())) {
        const line = nl >= 0 ? buf.slice(0, nl) : buf;
        buf = nl >= 0 ? buf.slice(nl + 1) : '';
        if (!line.trim()) continue;
        const json = JSON.parse(line);
        if (json.error) throw new Error(json.error);
        state.data = json;
        render();
      }
      if (done) break;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    $('#stat').textContent = '';
    $('#results').innerHTML = `<div class="empty"><b>Щось пішло не так</b>${esc(e.message)}</div>`;
  }
}

/* ===================== Кошик ===================== */

function findGroup(key) {
  const d = state.data;
  return d && [...d.compared, ...d.single].find((g) => g.key === key);
}

function toggleCart(key) {
  if (state.cart[key]) {
    delete state.cart[key];
    toast('Прибрано з кошика');
  } else {
    const g = findGroup(key);
    if (!g) return;
    state.cart[key] = {
      key, title: g.title, image: g.image, pack: g.pack, perKg: g.perKg, qty: 1, addedAt: Date.now(),
      offers: g.offers.map(({ store: s, title, price, cardPrice, url }) => ({ store: s, title, price, cardPrice: cardPrice ?? null, url })),
    };
    toast('Додано в кошик');
    $('#cartOpen').classList.remove('bump'); void $('#cartOpen').offsetWidth; $('#cartOpen').classList.add('bump');
  }
  save('cart-v1', state.cart);
  render();
  renderCart();
}

// Розподіл кошика: для кожного товару — магазин, де його купувати
function buildPlan(items, plan) {
  const assign = items.map((it) => {
    const cheapest = it.offers.reduce((a, b) => (eff(b) < eff(a) ? b : a));
    const preferred = plan !== 'best' && it.offers.find((o) => o.store === plan);
    return { it, offer: preferred || cheapest, moved: plan !== 'best' && !preferred };
  });
  const total = assign.reduce((s, a) => s + eff(a.offer) * a.it.qty, 0);
  const moved = assign.filter((a) => a.moved).length;
  const used = new Set(assign.map((a) => a.offer.store));
  return { assign, total, moved, used };
}

function renderCart() {
  const items = Object.values(state.cart);
  $('#cartCount').textContent = items.reduce((s, it) => s + it.qty, 0);
  const body = $('#cartBody');

  if (!items.length) {
    body.innerHTML = '<div class="cart-empty"><b>Кошик порожній</b>Додавайте товари кнопкою «+ У кошик» — ми порахуємо, у якому магазині все разом дешевше.</div>';
    return;
  }

  const plans = [{ id: 'best', ...buildPlan(items, 'best') },
    ...ORDER.map((s) => ({ id: s, ...buildPlan(items, s) }))];
  const minTotal = Math.min(...plans.map((p) => p.total));
  if (!plans.some((p) => p.id === state.plan)) state.plan = 'best';
  const chosen = plans.find((p) => p.id === state.plan);

  const planRow = (p) => {
    const isBest = p.id === 'best';
    const name = isBest ? 'Оптимально' : STORES[p.id].name;
    const cls = isBest ? '' : STORES[p.id].cls;
    const ds = isBest
      ? `найдешевше для кожного товару · ${p.used.size} ${p.used.size === 1 ? 'магазин' : 'магазини'}`
      : p.moved ? `${p.moved} з ${items.length} товарів немає — візьмемо деінде` : 'усі товари є';
    const diff = p.total - minTotal;
    return `<label class="plan ${cls}${p.id === state.plan ? ' on' : ''}${Math.abs(diff) < 0.005 ? ' best-plan' : ''}${p.moved === items.length ? ' disabled' : ''}">
      <input type="radio" name="plan" value="${p.id}" ${p.id === state.plan ? 'checked' : ''}>
      <span><span class="nm">${name}</span><span class="ds">${ds}</span></span>
      <span class="tt">${money(p.total)} ₴${diff > 0.005 ? `<small>+${money(diff)}</small>` : ''}</span>
    </label>`;
  };

  // Замовлення по магазинах для вибраного плану
  const byStore = {};
  for (const a of chosen.assign) (byStore[a.offer.store] ||= []).push(a);
  const orders = ORDER.filter((s) => byStore[s]).map((s) => {
    const list = byStore[s];
    const sum = list.reduce((t, a) => t + eff(a.offer) * a.it.qty, 0);
    return `<div class="order ${STORES[s].cls}">
      <div class="order-head"><b>${STORES[s].name}</b><span>${money(sum)} ₴</span></div>
      <ol>${list.map((a) => `<li><a href="${esc(a.offer.url)}" target="_blank" rel="noopener nofollow">${esc(a.offer.title)}</a>
        <span class="q">× ${a.it.qty}${a.it.perKg ? ' кг' : ''} · ${money(eff(a.offer) * a.it.qty)} ₴</span></li>`).join('')}</ol>
      <div class="row-btns">
        <button class="btn" type="button" data-open="${s}">Відкрити в ${STORES[s].name} (${list.length})</button>
      </div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <h3>Товари · ${items.length}</h3>
    ${items.map((it) => {
      const best = it.offers.reduce((a, b) => (eff(b) < eff(a) ? b : a));
      return `<div class="ci">
        <div class="prod-img">${it.image ? `<img src="${esc(it.image)}" alt="" referrerpolicy="no-referrer">` : ''}</div>
        <div><div class="ci-title">${esc(it.title)}</div>
          <div class="ci-sub">${esc(it.pack || '')} · від ${money(eff(best))} ₴ · ${it.offers.length} ${it.offers.length === 1 ? 'магазин' : 'магазини'}</div></div>
        <div class="qty"><button type="button" data-qty="${esc(it.key)}" data-d="-1" aria-label="Менше">−</button><span>${it.qty}</span><button type="button" data-qty="${esc(it.key)}" data-d="1" aria-label="Більше">+</button></div>
      </div>`;
    }).join('')}

    <h3>Де купити дешевше</h3>
    <div class="plans">${plans.map(planRow).join('')}</div>

    <h3>Замовлення за посиланнями</h3>
    ${orders}
    <div class="row-btns">
      <button class="btn ghost" type="button" id="copyList">Скопіювати список</button>
      <button class="btn ghost" type="button" id="clearCart">Очистити кошик</button>
    </div>
    <p class="hint">Кнопка «Відкрити» відкриває сторінки товарів у нових вкладках — додайте їх у кошик на сайті магазину. Якщо браузер блокує вкладки, дозвольте спливаючі вікна для цього сайту. Ціни зафіксовані на момент додавання.</p>`;
}

function openCart(open) {
  $('#drawer').classList.toggle('open', open);
  $('#drawer').setAttribute('aria-hidden', String(!open));
  $('#scrim').hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) renderCart();
}

/* ===================== Події ===================== */

$('#search').addEventListener('submit', (e) => { e.preventDefault(); search($('#q').value); });
$('#examples').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') search(e.target.textContent); });

$('#sort').value = state.sort;
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; save('sort-v2', state.sort); render(); });

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) return toggleCart(add.dataset.add);
});

$('#cartOpen').addEventListener('click', () => openCart(true));
$('#cartClose').addEventListener('click', () => openCart(false));
$('#scrim').addEventListener('click', () => openCart(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openCart(false); });

$('#cartBody').addEventListener('change', (e) => {
  if (e.target.name === 'plan') { state.plan = e.target.value; renderCart(); }
});
$('#cartBody').addEventListener('click', async (e) => {
  const q = e.target.closest('[data-qty]');
  if (q) {
    const it = state.cart[q.dataset.qty];
    it.qty += Number(q.dataset.d);
    if (it.qty < 1) delete state.cart[it.key];
    save('cart-v1', state.cart);
    renderCart();
    render();
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) {
    const plan = buildPlan(Object.values(state.cart), state.plan);
    const urls = plan.assign.filter((a) => a.offer.store === open.dataset.open).map((a) => a.offer.url);
    let blocked = 0;
    for (const u of urls) {
      const w = window.open(u, '_blank'); // з 'noopener' open() завжди повертає null — не відрізнимо блокування
      if (w) w.opener = null; else blocked++;
    }
    if (blocked) toast('Браузер заблокував вкладки — дозвольте спливаючі вікна');
    return;
  }
  if (e.target.id === 'copyList') {
    const plan = buildPlan(Object.values(state.cart), state.plan);
    const text = ORDER.map((s) => {
      const list = plan.assign.filter((a) => a.offer.store === s);
      if (!list.length) return '';
      return `${STORES[s].name}:\n` + list.map((a) => `• ${a.offer.title} × ${a.it.qty} — ${money(eff(a.offer) * a.it.qty)} грн\n  ${a.offer.url}`).join('\n');
    }).filter(Boolean).join('\n\n') + `\n\nРазом: ${money(plan.total)} грн`;
    try { await navigator.clipboard.writeText(text); toast('Список скопійовано'); } catch { toast('Не вдалося скопіювати'); }
    return;
  }
  if (e.target.id === 'clearCart') {
    state.cart = {};
    save('cart-v1', state.cart);
    renderCart();
    render();
  }
});

/* ===================== Вкладки ===================== */

// Товари з меню: ключ «menu:…», ціна вже за всю потрібну кількість
function addItemsToCart(items) {
  for (const it of items) state.cart[it.key] = { ...it, perKg: false, qty: 1, addedAt: Date.now() };
  save('cart-v1', state.cart);
  renderCart();
  toast(`Додано ${items.length} продуктів у кошик`);
  openCart(true);
}

const menu = initMenu({ STORES, ORDER, $, esc, money, eff, toast, load: store, save, addItemsToCart });

const TITLES = { compare: 'Дешевше — порівняння цін у Києві', menu: 'Меню на бюджет — Дешевше' };
function setTab(tab) {
  document.body.dataset.tab = tab;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  if (tab === 'menu') {
    document.title = TITLES.menu;
    menu.show();
  } else {
    const q = new URLSearchParams(location.search).get('q');
    document.title = q ? `${q} — Дешевше` : TITLES.compare;
  }
  window.scrollTo(0, 0);
}
const tabFromUrl = () => (location.hash === '#menu' ? 'menu' : 'compare');

document.querySelector('.tabs').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-tab]');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.tab === 'menu') history.pushState(null, '', '#menu');
  else history.pushState(null, '', location.pathname + location.search);
  setTab(a.dataset.tab);
});

window.addEventListener('popstate', () => {
  setTab(tabFromUrl());
  const q = new URLSearchParams(location.search).get('q');
  if (q && tabFromUrl() === 'compare' && q !== state.data?.query) search(q, false);
});

renderCart();
setTab(tabFromUrl());
const initial = new URLSearchParams(location.search).get('q');
if (initial) search(initial, false);
