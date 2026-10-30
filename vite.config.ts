import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = '/lumen-cards/'
const packageInfo = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const buildConfigFiles = ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']

export default defineConfig(({ mode }) => ({
  base,
  define: { __APP_VERSION__: JSON.stringify(packageInfo.version) },
  plugins: [
    {
      name: 'build-provenance',
      apply: 'build',
      generateBundle() {
        const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
        const configuration = Object.fromEntries(buildConfigFiles.map((file) => [
          file, readFileSync(new URL(file, import.meta.url), 'utf8')
        ]))
        this.emitFile({
          type: 'asset',
          fileName: 'build-provenance.json',
          source: JSON.stringify({
            version: packageInfo.version,
            source: { revision: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain', '--untracked-files=normal'])) },
            runtime: { node: process.version },
            build: { mode, base },
            configuration
          }, null, 2) + '\n'
        })
      }
    },
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
        start_url: base,
        scope: base,
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
        // Build records must not trigger an app update when only the source revision changes.
        globIgnores: ['**/build-provenance.json'],
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
}))
