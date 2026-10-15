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

function cell(g, s) {
  const o = g.offers.find((x) => x.store === s);
  const m = STORES[s];
  if (!o) return `<div class="cell none ${m.cls}"><span class="st">${m.name}</span><span class="pr">—</span><span class="sub">немає</span></div>`;
  const best = g.offers.length > 1 && s === g.best;
  const unit = o.unitPrice != null && !g.perKg
    ? `${money(o.cardPrice ? o.unitPrice * o.cardPrice / o.price : o.unitPrice)}/${/мл|л/.test(g.pack) ? 'л' : 'кг'}` : '';
  const sub = o.cardPrice ? 'з карткою АТБ' : o.oldPrice ? `<s>${money(o.oldPrice)}</s>` : unit;
  const byName = g.offers.length > 1 && o.match === 'name'; // «≈» має сенс лише коли є з чим порівнювати
  return `<a class="cell ${m.cls}${best ? ' best' : ''}${byName ? ' name' : ''}" href="${esc(o.url)}" target="_blank" rel="noopener nofollow"
      title="${esc(o.title)}${byName ? ' — збіг за назвою, брендом і фасуванням' : g.offers.length > 1 ? ' — збіг за штрихкодом' : ''}">
    ${byName ? '<span class="why">≈</span>' : ''}
    <span class="st">${m.name}</span>
    <span class="pr">${money(eff(o))}${g.perKg ? '<small>/кг</small>' : ''}</span>
    <span class="sub">${sub || '&nbsp;'}</span>
  </a>`;
}

function productCard(g, i) {
  const inCart = !!state.cart[g.key];
  return `
  <article class="prod" style="animation-delay:${Math.min(i, 12) * 25}ms">
    <div class="prod-img">${g.image ? `<img src="${esc(g.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</div>
    <div class="prod-info">
      <h3 class="prod-title">${esc(g.title)}</h3>
      <div class="meta">
        ${g.brand ? `<span class="tag">${esc(g.brand)}</span>` : ''}
        ${g.pack ? `<span class="tag">${esc(g.pack)}</span>` : ''}
        ${g.savingPct >= 1 ? `<span class="tag save">−${g.savingPct}% · ${money(g.saving)} ₴</span>` : ''}
      </div>
    </div>
    <div class="prod-side">
      <div class="prices">${ORDER.map((s) => cell(g, s)).join('')}</div>
      <button class="add${inCart ? ' in' : ''}" data-add="${esc(g.key)}" type="button">${inCart ? '✓ У кошику' : '+ У кошик'}</button>
    </div>
  </article>`;
}

// Найнижча ціна за кг/л серед магазинів (для ваги — ціна за кг); без фасування — в кінець
function minUnit(g) {
  const units = g.offers.map((o) => (g.perKg ? eff(o) : o.unitPrice == null ? null : o.unitPrice * eff(o) / o.price)).filter((u) => u != null);
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
  const list = sorted([...d.compared, ...d.single]);

  const maxSave = Math.max(0, ...d.compared.map((g) => g.savingPct));
  $('#stat').innerHTML = `<b>${list.length}</b> товарів · <b>${d.compared.length}</b> є в кількох магазинах`
    + (maxSave ? ` · економія до <span class="hl">${maxSave}%</span>` : '')
    + (d.stores.some((s) => s.pending) ? ' · <span class="refining">ще шукаємо в АТБ</span>'
      : d.partial ? ' · <span class="refining">шукаємо ще пари за штрихкодом</span>' : '');

  const down = d.stores.filter((s) => !s.ok && !s.pending).map((s) => STORES[s.id].name);
  const warn = down.length ? `<p class="warn">${down.join(', ')} зараз не відповідає — порівнюємо без ${down.length > 1 ? 'них' : 'нього'}. Спробуйте за хвилину.</p>` : '';

  $('#results').innerHTML = warn + (list.length
    ? list.map(productCard).join('')
    : '<div class="empty"><b>Нічого не знайдено</b>Уточніть запит — наприклад, додайте бренд або фасування.</div>');
}

function renderLoading() {
  $('#toolbar').hidden = false;
  $('#legend').hidden = false;
  $('#stat').textContent = 'Шукаємо в 3 магазинах і зіставляємо штрихкоди…';
  $('#results').innerHTML = Array.from({ length: 4 }, () => `
    <div class="prod sk"><div class="prod-img"></div>
      <div><div class="line" style="width:70%"></div><div class="line" style="width:40%"></div></div>
      <div class="prod-side"><div class="prices">${'<div class="cell"></div>'.repeat(ORDER.length)}</div></div></div>`).join('');
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
