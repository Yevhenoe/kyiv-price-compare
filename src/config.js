// Налаштування магазинів. Усі значення можна перевизначити змінними оточення (файл .env або pm2).
export const config = {
  port: Number(process.env.PORT) || 3000,
  // Скільки секунд зберігати результати пошуку в кеші
  cacheTtl: Number(process.env.CACHE_TTL) || 600,
  // Скільки товарів брати з кожного магазину
  perStore: Number(process.env.PER_STORE) || 24,
  // Таймаут запиту до одного магазину, мс
  timeout: Number(process.env.STORE_TIMEOUT) || 25000,

  silpo: {
    // 00000000-... — онлайн-магазин Сільпо (доставка по Києву)
    branchId: process.env.SILPO_BRANCH || '00000000-0000-0000-0000-000000000000',
  },
  varus: {
    // Магазин VARUS у Києві, ціни якого показуємо: 98 — Деміївська, 27 (є доставка);
    // інші: 67 — Волинська, 37; 139260 — Малишка, 3; 139261 — Вишгородська, 45А; 130700 — Героїв полку «Азов», 12
    shopId: process.env.VARUS_SHOP || '98',
  },
  atb: {
    enabled: process.env.ATB_ENABLED !== '0',
  },
};
