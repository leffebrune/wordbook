import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
const base = '/wordbook/';

export default defineConfig({
  base,
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      scope: base,
      includeAssets: ['icon.svg'],
      manifest: {
        id: base,
        name: '오늘의 영어 단어',
        short_name: '영어 단어장',
        description: '내가 쓴 뜻에서 시작하는 영어 단어장',
        lang: 'ko',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: '#f7f2e7',
        background_color: '#f7f2e7',
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,svg,png,webmanifest}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: []
      }
    })
  ],
  test: { environment: 'node' }
});
