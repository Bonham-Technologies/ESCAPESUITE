/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { visualizer } from 'rollup-plugin-visualizer'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'

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

/**
 * Headless-build Vite plugin: inline worker .js files into the HTML as blob URLs.
 *
 * Chrome blocks file:// pages from loading file:// workers (null origin). The only
 * way to create workers from a file:// page is via URL.createObjectURL(blob). This
 * plugin post-processes the built headless.html to replace each
 *   new Worker(``+new URL(`workerName.js`,import.meta.url).href,...)
 * with a blob-URL worker created from the inlined worker script text.
 *
 * The worker .js files are read, base64-encoded, and embedded as a <script> block
 * that defines window.__workerBlobs. The Worker call sites then use that map.
 */
function headlessInlineWorkersPlugin() {
  return {
    name: 'headless-inline-workers',
    apply: 'build' as const,
    closeBundle() {
      const outDir = 'dist-headless'
      const htmlPath = join(outDir, 'headless.html')
      if (!existsSync(htmlPath)) return

      let html = readFileSync(htmlPath, 'utf8')

      // Find all worker files referenced in the HTML
      const workerFiles: string[] = []
      const workerFileRegex = /new URL\(`([^`]+Worker[^`]*\.js)`,import\.meta\.url\)/g
      let m: RegExpExecArray | null
      while ((m = workerFileRegex.exec(html)) !== null) {
        if (!workerFiles.includes(m[1])) workerFiles.push(m[1])
      }

      if (workerFiles.length === 0) return

      // Build the inline blob map
      const blobEntries: string[] = []
      for (const wf of workerFiles) {
        const wfPath = join(outDir, wf)
        if (!existsSync(wfPath)) continue
        const content = readFileSync(wfPath, 'utf8')
        // Escape backticks and template literal delimiters for embedding
        const escaped = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
        blobEntries.push(`${JSON.stringify(wf)}:URL.createObjectURL(new Blob([\`${escaped}\`],{type:'application/javascript'}))`)
        // Remove the standalone worker file (it's now inlined)
        unlinkSync(wfPath)
      }

      if (blobEntries.length === 0) return

      const blobScript = `<script>(function(){window.__wb={${blobEntries.join(',')}};})();</script>`

      // Replace each worker instantiation to use the blob URL map
      // Pattern: new URL(`workerName.js`,import.meta.url).href  →  window.__wb['workerName.js']
      html = html.replace(
        /``\+new URL\(`([^`]+\.js)`,import\.meta\.url\)\.href/g,
        (_match, wf) => `window.__wb[${JSON.stringify(wf)}]`
      )
      // Also handle the decode worker's double-URL pattern:
      // new URL(``+new URL(`decodeWorker.js`,import.meta.url).href,``+import.meta.url)
      // → just the blob URL string
      html = html.replace(
        /new URL\(window\.__wb\[([^\]]+)\],``\+import\.meta\.url\)/g,
        (_match, key) => `window.__wb[${key}]`
      )

      // Inject blob script right before the first <script> tag
      html = html.replace('<script', blobScript + '\n  <script')

      writeFileSync(htmlPath, html, 'utf8')
      console.log(`[headless-inline-workers] Inlined ${workerFiles.length} worker(s) as blob URLs.`)
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    // Headless build: strip { type: 'module' } from Worker constructors and inline
    // all worker .js files as blob URLs so the bundle works from file:// (null origin).
    process.env.VITE_HEADLESS === 'true' && headlessClassicWorkersPlugin(),
    process.env.VITE_HEADLESS === 'true' && headlessInlineWorkersPlugin(),
    // Run with ANALYZE=true to generate bundle-stats.html
    process.env.ANALYZE === 'true' && visualizer({
      filename: 'bundle-stats.html',
      open: true,
      gzipSize: true,
    }),
  ].filter(Boolean),
  // Headless build: emit workers as IIFE (classic scripts) not ES modules.
  // Module workers are blocked from file:// (null origin) in Chromium.
  ...(process.env.VITE_HEADLESS === 'true' ? {
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
    outDir: process.env.VITE_HEADLESS === 'true' ? 'dist-headless' : 'dist',
    rollupOptions: {
      input: process.env.VITE_HEADLESS === 'true' ? 'headless.html' : 'index.html',
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
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types.ts',
      ],
    },
  },
})
