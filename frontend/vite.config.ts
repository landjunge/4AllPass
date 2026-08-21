import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: false,
    reportCompressedSize: false,
    cssMinify: true,
  },
  // The client calls the API same-origin (`/api/v1`), so the service worker
  // scope and the API share one origin in production too.
  server: {
    // Pinned: the Playwright baseURL points here, and silently moving to the
    // next free port would run the suite against nothing.
    port: 5173,
    strictPort: true,
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
          'Self-hosted zero-knowledge password manager with local agent credential access. Your agents need access. They don\'t need your secrets.',
        // Matches the app shell in src/styles.css, so the splash and the
        // browser chrome do not flash a different colour on launch.
        theme_color: '#121316',
        background_color: '#121316',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
