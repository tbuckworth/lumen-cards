import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/lumen-cards/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/lumen-cards/',
        name: 'Lumen — Remember beautifully',
        short_name: 'Lumen',
        description: 'A private, offline-first flashcard app using the FSRS learning scheduler.',
        theme_color: '#f4efe5',
        background_color: '#f4efe5',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/lumen-cards/',
        scope: '/lumen-cards/',
        categories: ['education', 'productivity'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
        navigateFallback: 'index.html'
      }
    })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    clearMocks: true,
    include: ['tests/*.test.ts']
  }
})
