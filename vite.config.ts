import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readFileSync } from 'node:fs';

const tls = existsSync('certs/lan.crt') && existsSync('certs/lan.key')
  ? { cert: readFileSync('certs/lan.crt'), key: readFileSync('certs/lan.key') }
  : undefined;

export default defineConfig({
  server: { host: '0.0.0.0', https: tls },
  preview: { host: '0.0.0.0', https: tls },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg'],
      manifest: {
        id: '/',
        name: '오늘의 영어 단어',
        short_name: '영어 단어장',
        description: '내가 쓴 뜻에서 시작하는 영어 단어장',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#f7f2e7',
        background_color: '#f7f2e7',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: []
      }
    })
  ],
  test: { environment: 'node' }
});
