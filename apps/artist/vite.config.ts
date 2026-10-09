/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { visualizer } from 'rollup-plugin-visualizer'
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isSingleFileBuild } from './singleFileBuild.js'

/**
 * Headless-build Vite plugin: rewrite module-worker instantiation to classic workers.
 *
 * Chrome blocks module workers from file:// (null origin). The decodeWorker is
 * instantiated with `new Worker(url, { type: 'module' })`. For the headless
 * build we emit the worker as IIFE (classic) and strip `{ type: 'module' }` from
 * the call-site at transform time so the built bundle loads cleanly from file://.
 */
function headlessClassicWorkersPlugin() {
  return {
    name: 'headless-classic-workers',
    transform(code: string, id: string) {
      // Only touch the videoDecodeManager source file
      if (!id.includes('videoDecodeManager')) return null
      // Replace `{ type: 'module' }` in the Worker constructor call
      const patched = code.replace(
        /new Worker\(\s*new URL\([^)]+\)\s*,\s*\{\s*type\s*:\s*['"]module['"]\s*\}\s*\)/g,
        (match) => match.replace(/,\s*\{\s*type\s*:\s*['"]module['"]\s*\}/, '')
      )
      if (patched !== code) return { code: patched, map: null }
      return null
    },
  }
}

/** Escape a literal string for embedding in a RegExp. */
function escapeRegExp(literal: string) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Single-file-build Vite plugin: inline worker .js files into the HTML as blob URLs.
 *
 * Chrome blocks file:// pages from loading file:// workers (null origin). The only
 * way to create workers from a file:// page is via URL.createObjectURL(blob). This
 * plugin post-processes the built HTML to replace each worker URL
 * expression with a blob URL created from the inlined worker script text.
 *
 * Used by both builds that must run from file:// — the headless render bundle
 * (dist-headless/headless.html) and the standalone offline download
 * (dist/index.html, ESCSUITE-153) — so it takes the output directory and entry
 * HTML filename rather than assuming the headless build's own.
 *
 * Two call-site shapes are handled, because Vite has emitted both:
 *   - vite <= 8.2:  new Worker(``+new URL(`w.js`,import.meta.url).href, ...)
 *   - vite >= 8.3:  new Worker(new URL(`w.js`,import.meta.url).href, ...)
 * and, for the decode worker, the doubled form
 *   new Worker(new URL(<either of the above>,``+import.meta.url))
 * So the rewrite treats the leading ``+ and the trailing .href as optional, and
 * then collapses the outer `new URL(window.__wb[K], [``+]import.meta.url)` wrapper.
 *
 * The worker .js files are read, embedded as a <script> block that defines
 * window.__wb, and deleted from the output directory. The Worker call sites then
 * use that map.
 *
 * Fail-loud contract: this plugin must never leave a call site pointing at a file
 * it has deleted. If a discovered worker file is missing on disk, if any inlined
 * worker's filename survives inside a `new URL(...)`/`new Worker(...)` expression
 * after the rewrite, or if any .js file is left behind in the output directory,
 * it throws and fails the build — so a future change to Vite's emitted shape turns
 * the `build` job red instead of only the e2e/kit-docker jobs (which Dependabot skips).
 */
function headlessInlineWorkersPlugin(outDir: string, htmlFile: string) {
  return {
    name: 'headless-inline-workers',
    apply: 'build' as const,
    closeBundle() {
      const htmlPath = join(outDir, htmlFile)
      if (!existsSync(htmlPath)) return

      let html = readFileSync(htmlPath, 'utf8')

      // Find all worker files referenced in the HTML
      const workerFiles: string[] = []
      const workerFileRegex = /new URL\(`([^`]+Worker[^`]*\.js)`,\s*import\.meta\.url\)/g
      let m: RegExpExecArray | null
      while ((m = workerFileRegex.exec(html)) !== null) {
        if (!workerFiles.includes(m[1])) workerFiles.push(m[1])
      }

      // Build the inline blob map
      const blobEntries: string[] = []
      for (const wf of workerFiles) {
        const wfPath = join(outDir, wf)
        if (!existsSync(wfPath)) {
          throw new Error(
            `[headless-inline-workers] ${htmlPath} references worker "${wf}", but ` +
            `${wfPath} does not exist — it cannot be inlined, and the headless bundle ` +
            `would fail to construct that worker from file://.`
          )
        }
        const content = readFileSync(wfPath, 'utf8')
        // Escape backticks and template literal delimiters for embedding
        const escaped = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
        blobEntries.push(`${JSON.stringify(wf)}:URL.createObjectURL(new Blob([\`${escaped}\`],{type:'application/javascript'}))`)
        // Remove the standalone worker file (it's now inlined)
        unlinkSync(wfPath)
      }

      // Anything still emitted as a separate .js chunk would be loaded over file://
      // and blocked. If discovery above missed a worker (e.g. Vite changed the URL
      // expression again), this is where we find out.
      // recursive: true — a top-level-only scan would miss a stray .js vite
      // emits into a subdirectory (e.g. dist/assets/), which is exactly the
      // kind of future emission-shape change this guard exists to catch
      // (ESCSUITE-153 review round 1, NIT).
      const leftovers = (readdirSync(outDir, { recursive: true }) as string[]).filter((f) => f.endsWith('.js'))
      if (leftovers.length > 0) {
        throw new Error(
          `[headless-inline-workers] ${outDir} still contains separate script file(s) ` +
          `after inlining: ${leftovers.join(', ')}. This bundle must be a single ` +
          `HTML file; these would be blocked when loaded from file:// (null origin).`
        )
      }

      if (workerFiles.length === 0) return

      // Replace each worker instantiation to use the blob URL map. Scoped to the
      // files actually inlined — never a blanket rewrite of other new URL(...) uses.
      // [``+]new URL(`workerName.js`,import.meta.url)[.href] → window.__wb['workerName.js']
      for (const wf of workerFiles) {
        const inner = new RegExp(
          '(?:``\\+)?new URL\\(`' + escapeRegExp(wf) + '`,\\s*import\\.meta\\.url\\)(?:\\.href)?',
          'g'
        )
        html = html.replace(inner, `window.__wb[${JSON.stringify(wf)}]`)
      }
      // Also handle the decode worker's double-URL pattern, now that the inner URL
      // is a blob-URL string:
      //   new URL(window.__wb['decodeWorker.js'],[``+]import.meta.url) → window.__wb[...]
      html = html.replace(
        /new URL\(window\.__wb\[([^\]]+)\],\s*(?:``\+)?import\.meta\.url\)/g,
        (_match, key) => `window.__wb[${key}]`
      )

      // Fail loudly if any call site survived the rewrite. Legitimate references are
      // now `window.__wb["<file>"]`, so blank those out before looking; [^()] keeps the
      // search inside a single (innermost) call expression.
      const scrubbed = html.replace(/window\.__wb\[[^\]]*\]/g, 'window.__wb[0]')
      for (const wf of workerFiles) {
        const survivor = new RegExp(
          'new (?:URL|Worker)\\([^()]{0,200}' + escapeRegExp(wf)
        ).exec(scrubbed)
        if (survivor) {
          throw new Error(
            `[headless-inline-workers] worker "${wf}" was inlined and its file deleted, but a ` +
            `call site still loads it from a separate file — Vite's emitted URL expression ` +
            `changed and the rewrite no longer matches it. Offending snippet:\n` +
            `  ${scrubbed.slice(survivor.index, survivor.index + 200)}`
          )
        }
      }

      const blobScript = `<script>(function(){window.__wb={${blobEntries.join(',')}};})();</script>`

      // Inject blob script right before the first <script> tag
      html = html.replace('<script', blobScript + '\n  <script')

      writeFileSync(htmlPath, html, 'utf8')
      console.log(`[headless-inline-workers] Inlined ${workerFiles.length} worker(s) as blob URLs.`)
    },
  }
}

// True for the two builds that must run from file:// — headless (Playwright,
// the headless-artist CLI) and standalone (a downloaded GitHub Release asset)
// — which both need every worker inlined; false for the hosted (saas) build,
// served over http(s), which keeps its worker as a separate, fetchable chunk.
// See singleFileBuild.js, beside this file. ESCSUITE-153: the standalone build used to
// read only VITE_HEADLESS here, so it shipped index.html plus a second,
// never-attached decodeWorker-*.js — a downloaded build's MP4 export hung
// forever trying to start a worker that was never there.
const SINGLE_FILE_BUILD = isSingleFileBuild(process.env)
// A separate question from SINGLE_FILE_BUILD above: standalone and saas both
// build dist/index.html and differ only in whether the worker gets inlined;
// only the headless build's output location and entry file are different.
const OUT_DIR = process.env.VITE_HEADLESS === 'true' ? 'dist-headless' : 'dist'
const ENTRY_HTML = process.env.VITE_HEADLESS === 'true' ? 'headless.html' : 'index.html'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    // Single-file builds (headless and standalone): strip { type: 'module' }
    // from Worker constructors and inline all worker .js files as blob URLs
    // so the bundle works from file:// (null origin).
    SINGLE_FILE_BUILD && headlessClassicWorkersPlugin(),
    SINGLE_FILE_BUILD && headlessInlineWorkersPlugin(OUT_DIR, ENTRY_HTML),
    // Run with ANALYZE=true to generate bundle-stats.html
    process.env.ANALYZE === 'true' && visualizer({
      filename: 'bundle-stats.html',
      open: true,
      gzipSize: true,
    }),
  ].filter(Boolean),
  // Single-file builds: emit workers as IIFE (classic scripts) not ES modules.
  // Module workers are blocked from file:// (null origin) in Chromium.
  ...(SINGLE_FILE_BUILD ? {
    worker: {
      format: 'iife' as const,
    },
  } : {}),
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000, // Required for vite-plugin-singlefile
    chunkSizeWarningLimit: 5000,
    cssCodeSplit: false,
    // Headless render bundle: single-file headless.html in dist-headless/.
    // The hosted and standalone builds both emit dist/index.html; only the
    // worker-inlining above (gated on SINGLE_FILE_BUILD) differs between them.
    outDir: OUT_DIR,
    rollupOptions: {
      input: ENTRY_HTML,
      output: { inlineDynamicImports: true },
    },
  },
  define: {
    // Build mode: 'saas' (default) or 'standalone'
    'import.meta.env.VITE_BUILD_MODE': JSON.stringify(process.env.VITE_BUILD_MODE || 'saas'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'src/test/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types.ts',
        'src/main.tsx', // React bootstrap only; exercised by every Playwright suite
        'src/headless/main.ts', // headless-bundle bootstrap; covered by services/headless-artist Chromium tests
        'src/workers/decodeWorker.ts', // runs only inside a Web Worker; covered by apps/e2e/tests/export/decode-worker.spec.ts (its logic lives in mp4Demux.ts, decoderConfig.ts and frameDecoder.ts, which are measured)
      ],
      // Coverage floors — these only go up. See CLAUDE.md's Testing section.
      thresholds: {
        lines: 99,
        statements: 99,
        branches: 95,
        functions: 99,
      },
    },
  },
})
