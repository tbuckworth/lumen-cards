// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { expect, it } from 'vitest'

it('records effective build overrides and keeps the installed app identity', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'lumen-build-test-'))
  try {
    await build({
      configFile: 'vite.config.ts',
      base: '/build-check/',
      mode: 'production',
      logLevel: 'silent',
      build: { outDir, minify: false, target: 'es2020' }
    })
    const record = JSON.parse(await readFile(join(outDir, 'build-provenance.json'), 'utf8'))
    expect(record.build.base).toBe('/build-check/')
    expect(record.build.mode).toBe('production')
    expect(record.build.options).toMatchObject({ minify: false, target: 'es2020' })
    const manifest = JSON.parse(await readFile(join(outDir, 'manifest.webmanifest'), 'utf8'))
    expect(manifest).toMatchObject({ id: '/lumen-cards/', start_url: '/build-check/', scope: '/build-check/' })
    const index = await readFile(join(outDir, 'index.html'), 'utf8')
    expect(index).toContain('href="/build-check/favicon.svg"')
    expect(index).toContain('href="/build-check/apple-touch-icon.png"')
    expect(await readFile(join(outDir, 'sw.js'), 'utf8')).not.toContain('build-provenance.json')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}, 120_000)
