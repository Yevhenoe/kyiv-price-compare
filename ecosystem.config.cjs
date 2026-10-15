// Конфіг для pm2: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'prices',
    script: 'server.js',
    max_memory_restart: '600M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      // VARUS_SHOP: '67',
      // ATB_ENABLED: '0',
    },
  }],
};
