// node repro.mjs [default|async|no-groups] [--no-lazy]
// Starts the Rsbuild dev server with HMR, opens the page in headless Chromium,
// then edits src/lazy.js (a self-accepting module loaded with import()) so that
// it imports a node_modules package for the first time. Prints the outcome,
// the page's errors, the requests the page made after the edit and the chunks
// of both compilations.
//   default   : Rsbuild's default splitChunks
//   async     : splitChunks { preset: 'none', chunks: 'async' } (Rspack's defaults on async chunks only)
//   no-groups : the same with Rspack's default cache groups off (control: no new chunk, works)
//   --no-lazy : also set dev.lazyCompilation: false
import fs from 'node:fs'
import path from 'node:path'
import { createRsbuild } from '@rsbuild/core'
import { chromium } from 'playwright'

const variant = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'default'
const noLazy = process.argv.includes('--no-lazy')
const root = path.dirname(new URL(import.meta.url).pathname)
const lazyFile = path.join(root, 'src/lazy.js')

const lazy = (version, withVendor) => `${withVendor ? "import _ from 'lodash'\n" : ''}
document.getElementById('out').textContent = 'lazy-${version} ' + ${withVendor ? 'typeof _.chunk' : "'none'"}
if (import.meta.webpackHot) {
  import.meta.webpackHot.accept()
}
`
fs.writeFileSync(lazyFile, lazy('v0', false))

const splitChunks = {
  default: undefined,
  async: { preset: 'none', chunks: 'async' },
  'no-groups': {
    preset: 'none',
    chunks: 'async',
    cacheGroups: { default: false, defaultVendors: false },
  },
}[variant]

const port = 3400 + Math.floor(Math.random() * 500)
const rsbuild = await createRsbuild({
  cwd: root,
  rsbuildConfig: {
    root,
    logLevel: 'warn',
    source: { entry: { index: './src/index.js' } },
    server: { port, host: '127.0.0.1', strictPort: true, printUrls: false },
    dev: { hmr: true, liveReload: false, client: { logLevel: 'silent' }, ...(noLazy && { lazyCompilation: false }) },
    ...(splitChunks && { splitChunks }),
  },
})
const compilations = []
rsbuild.onAfterDevCompile(({ stats }) => {
  const json = stats.toJson({ all: false, chunks: true, chunkRelations: true, ids: true, hash: true })
  compilations.push(json.chunks.map((c) => `${c.id} (${c.size} B, siblings ${JSON.stringify(c.siblings)})`))
})
const server = await rsbuild.startDevServer()

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const page = await browser.newPage()
const errors = []
const requests = []
page.on('pageerror', (e) => errors.push((e.stack ?? e.message).split('\n').slice(0, 5).join('\n')))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 300))
})
page.on('response', (r) => requests.push(new URL(r.url()).pathname))
const text = () => page.textContent('#out')
await page.goto(`http://127.0.0.1:${port}/`)
await page.waitForFunction(() => document.getElementById('out')?.textContent === 'lazy-v0 none', null, { timeout: 10_000 })
requests.length = 0
const before = compilations.length

fs.writeFileSync(lazyFile, lazy('v1', true))
let outcome = 'OK: the page shows lazy-v1 function'
try {
  await page.waitForFunction(() => document.getElementById('out')?.textContent === 'lazy-v1 function', null, { timeout: 10_000 })
} catch {
  outcome = `FAILED: the page still shows ${JSON.stringify(await text())}`
}
await new Promise((r) => setTimeout(r, 500))
const { version: rsbuildVersion } = JSON.parse(fs.readFileSync(new URL(import.meta.resolve('@rsbuild/core/package.json')), 'utf8'))
const { version: rspackVersion } = JSON.parse(fs.readFileSync(new URL(import.meta.resolve('@rspack/core/package.json')), 'utf8'))
console.log(`variant=${variant}${noLazy ? ' lazyCompilation=false' : ''} @rsbuild/core=${rsbuildVersion} @rspack/core=${rspackVersion}`)
console.log(outcome)
console.log('page errors:', errors.length ? '\n  ' + errors.join('\n  ') : 'none')
console.log('requests after the edit:', requests.filter((p) => !p.endsWith('.map')))
console.log('chunks before the edit:', compilations[before - 1])
console.log('chunks after the edit:', compilations.at(-1))
await browser.close()
await server.server.close()
fs.writeFileSync(lazyFile, lazy('v0', false))
process.exit(0)
