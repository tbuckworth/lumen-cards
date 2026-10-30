import { test as base } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, resolve, sep } from 'node:path'
import { build } from 'vite'

export const test = base.extend<{
  buildDirectory: string
  offlineServer: { url: string; failWorker: boolean; failPrecache: boolean; revision: number }
}, { lifetimeBuild: string }>({
  buildDirectory: ['dist', { option: true }],
  lifetimeBuild: [async ({}, use) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'lumen-offline-'))
    try {
      // Only this lifetime fixture changes the mounting entry. App, virtual:pwa-register,
      // Workbox and the generated worker remain real; development React exercises StrictMode.
      await build({
        logLevel: 'silent',
        define: { 'process.env.NODE_ENV': JSON.stringify('development') },
        plugins: [{ name: 'lifetime-test-entry', transformIndexHtml: {
          order: 'pre', handler: (html) => html.replace('/src/main.tsx', '/tests/e2e/fixtures/offline-mount.tsx')
        } }],
        build: { outDir: directory, emptyOutDir: true }
      })
      await use(directory)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }, { scope: 'worker' }],
  offlineServer: async ({ buildDirectory }, use) => {
    const root = resolve(buildDirectory)
    const provenance = JSON.parse(await readFile(resolve(root, 'build-provenance.json'), 'utf8'))
    const basePath: string = provenance.build.base
    const worker = await readFile(resolve(root, 'sw.js'), 'utf8')
    const icon = worker.match(/(url:"pwa-512-maskable\.png",revision:")([^"]+)"/)
    if (!icon) throw new Error('Cannot locate the real worker maskable-icon precache revision')
    const faults = { url: '', failWorker: false, failPrecache: false, revision: 0 }
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' }
    // HTTP faults reach the browser's real SW fetch/install paths. Playwright routing
    // does not reliably intercept SW script requests, and OS/network faults are nondeterministic.
    const server = createServer(async (request, response) => {
      const url = new URL(request.url!, 'http://localhost')
      const relative = decodeURIComponent(url.pathname.slice(basePath.length)) || 'index.html'
      const file = resolve(root, relative)
      response.setHeader('Cache-Control', 'no-store')
      if (!url.pathname.startsWith(basePath) || !file.startsWith(root + sep)) { response.writeHead(404).end(); return }
      if ((faults.failWorker && relative === 'sw.js') || (faults.failPrecache && relative === 'pwa-512-maskable.png')) {
        response.writeHead(503).end('Deterministic offline fixture failure'); return
      }
      try {
        let bytes = await readFile(file)
        if (relative === 'sw.js') {
          // Change a real precache revision so updates fetch a real resource even
          // when the previous worker already cached the original interface.
          const revised = faults.revision ? worker.replaceAll(icon[0], `${icon[1]}${icon[2]}-fixture-${faults.revision}"`) : worker
          bytes = Buffer.from(revised + `\n// fixture revision ${faults.revision}\n`)
        }
        response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream')
        response.end(bytes)
      } catch { response.writeHead(404).end() }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    faults.url = `http://127.0.0.1:${address.port}${basePath}`
    try { await use(faults) }
    finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
  }
})

export const lifetimeTest = test.extend({
  buildDirectory: async ({ lifetimeBuild }, use) => { await use(lifetimeBuild) }
})
