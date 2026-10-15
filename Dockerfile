# Образ Playwright уже містить Chromium і всі системні бібліотеки для нього.
# Версія має збігатися з playwright у package-lock.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# --ignore-scripts: postinstall вдруге качав би Chromium, а він уже є в образі
RUN npm ci --omit=dev --ignore-scripts

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
