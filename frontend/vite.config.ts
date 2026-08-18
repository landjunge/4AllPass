import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // The client calls the API same-origin (`/api/v1`), so the service worker
  // scope and the API share one origin in production too.
  server: {
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Vault plaintext never touches the network, but it does end up in
      // memory / IndexedDB on this origin while unlocked (crypto-protocol.md
      // §10). Keep the service worker scope limited to app-shell assets;
      // never cache API responses that could carry envelopes or entries.
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: '4AllPass',
        short_name: '4AllPass',
        description:
          'Self-hosted Zero-Knowledge password manager — for all browsers and devices.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
})
