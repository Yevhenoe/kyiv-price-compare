// Сайт АТБ закритий захистом Cloudflare, тому сторінку пошуку відкриваємо
// у headless-браузері (Playwright) і читаємо товари прямо з DOM.
import { chromium } from 'playwright';
import { parsePack, withUnitPrice } from '../units.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

let browserPromise = null;
let contextPromise = null;

async function newContext(browser) {
  const ctx = await browser.newContext({ locale: 'uk-UA', userAgent: UA, viewport: { width: 1280, height: 900 } });
  // Не вантажимо картинки, шрифти і стилі — швидше і менше трафіку
  await ctx.route('**/*', (route) => {
    const t = route.request().resourceType();
    return ['image', 'font', 'media', 'stylesheet'].includes(t) ? route.abort() : route.continue();
  });
  return ctx;
}

async function getContext() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      // --disable-dev-shm-usage: у Docker /dev/shm лише 64 МБ, без цього Chromium падає
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
    }).then((browser) => {
      browser.on('disconnected', () => { browserPromise = null; contextPromise = null; });
      return browser;
    }).catch((e) => { browserPromise = null; throw e; });
  }
  const browser = await browserPromise;
  contextPromise ||= newContext(browser).catch((e) => { contextPromise = null; throw e; });
  return contextPromise;
}

// Після кількох запитів поспіль Cloudflare вмикає для сесії перевірку «Трохи зачекайте…» (403).
// Нова сесія (контекст без cookies) проходить одразу — тож просто відкриваємо нову.
async function resetContext(old) {
  if (contextPromise && (await contextPromise.catch(() => null)) === old) contextPromise = null;
  old.close().catch(() => {});
}

class Challenge extends Error {}

// Обмежуємо кількість одночасних вкладок, щоб не з'їсти всю пам'ять VPS
const MAX_PAGES = 2;
let active = 0;
const waiting = [];
async function withSlot(fn) {
  if (active >= MAX_PAGES) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

export const atb = {
  id: 'atb',
  name: 'АТБ',

  async search(query, opts) {
    return withSlot(async () => {
      try {
        return await searchPage(query, opts);
      } catch (e) {
        if (!(e instanceof Challenge)) throw e;
        return await searchPage(query, opts); // уже в новій сесії
      }
    });
  },

  async close() {
    if (browserPromise) (await browserPromise).close().catch(() => {});
  },
};

async function searchPage(query, { limit, timeout }) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    const url = `https://www.atbmarket.com/sch?lang=uk&query=${encodeURIComponent(query)}`;
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    if (resp?.status() === 403 || /зачекайте|just a moment/i.test(await page.title())) {
      await resetContext(ctx);
      throw new Challenge('АТБ: перевірка Cloudflare');
    }
    // Чекаємо або товари, або порожній результат («Показано 0 з 0»)
    await page.waitForFunction(
      () => document.querySelector('article.catalog-item, .info-page__text-desc')
        || /не знайдено|показано\s*0\s*з\s*0/i.test(document.body?.textContent || ''),
      null, { timeout },
    );

    const raw = await page.$$eval('article.catalog-item', (els) => els.map((el) => {
      const a = el.querySelector('.catalog-item__title a');
      const num = (sel) => { const d = el.querySelector(sel); return d ? parseFloat(d.getAttribute('value')) : null; };
      const img = el.querySelector('.catalog-item__photo source[srcset]')?.getAttribute('srcset')
        || el.querySelector('.catalog-item__photo img')?.getAttribute('src');
      return {
        title: a?.textContent.trim(),
        href: a?.getAttribute('href'),
        price: num('data.product-price__top'),
        oldPrice: num('data.product-price__bottom'),
        cardPrice: num('data.atbcard-sale__price-top'),
        unit: el.querySelector('.product-price__unit')?.textContent.trim(),
        image: img,
      };
    }));

    return raw.filter((r) => r.title && r.price).slice(0, limit).map((r) => {
      const weighted = /кг/.test(r.unit || '');
      return withUnitPrice({
        store: 'atb',
        title: r.title,
        brand: null, // АТБ не віддає бренд і штрихкод у списку — зіставляємо за назвою
        eans: [],
        price: r.price,
        oldPrice: r.oldPrice && r.oldPrice > r.price ? r.oldPrice : null,
        cardPrice: r.cardPrice && r.cardPrice < r.price ? r.cardPrice : null,
        perKg: weighted,
        image: r.image ? new URL(r.image, 'https://www.atbmarket.com').href : null,
        url: new URL(r.href, 'https://www.atbmarket.com').href,
      }, weighted ? { amount: 1, base: 'kg' } : parsePack(r.title));
    });
  } finally {
    await page.close().catch(() => {});
  }
}
