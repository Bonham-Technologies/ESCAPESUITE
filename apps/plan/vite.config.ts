import { execFileSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import {
  NOT_FOUND_HTML_FILE,
  ROUTE_PATHS,
  applyNotFoundHead,
  applyRouteHead,
  hubPathFor,
  routeHtmlFile,
} from './src/lib/routeMeta.ts'
import { buildSitemapXml, sitemapEntries, type Git } from './src/lib/sitemap.ts'

/**
 * Serves each hub route its own head before any JavaScript runs (ESCSUITE-458).
 * The dev server gets the requested route's head in the `index.html` it serves;
 * the build sets `/`'s head in `index.html` and writes one more copy per route
 * (`privacy/index.html`, ...) with that route's title, description, canonical
 * and social tags. `vercel.json` rewrites each route to its file. It also writes
 * `404.html`, the page the hosting serves with status 404, with the not-found
 * head: noindex and no canonical or og:url (ESCSUITE-489). The heads come from
 * `src/lib/routeMeta.ts`, which `seo.ts` reads too.
 */
function routeHeads(): Plugin {
  return {
    name: 'escapeplan-route-heads',
    transformIndexHtml(html, ctx) {
      return applyRouteHead(html, hubPathFor(ctx.originalUrl))
    },
    generateBundle: {
      // After Vite's own HTML plugin has emitted the finished index.html.
      order: 'post',
      handler(_options, bundle) {
        const index = bundle['index.html']
        if (index?.type !== 'asset') {
          this.error('escapeplan-route-heads: the build emitted no index.html')
        }
        const html = String(index.source)
        for (const path of ROUTE_PATHS) {
          if (path === '/') continue
          this.emitFile({ type: 'asset', fileName: routeHtmlFile(path), source: applyRouteHead(html, path) })
        }
        this.emitFile({ type: 'asset', fileName: NOT_FOUND_HTML_FILE, source: applyNotFoundHead(html) })
      },
    },
  }
}

/**
 * Writes `sitemap.xml` into the build (ESCSUITE-457) from `src/lib/sitemap.ts`,
 * so every page the router serves is listed. A page's `lastmod` is the date of
 * the last commit to its source; without git, or where a shallow clone can't
 * tell, the entry has no `lastmod` rather than a made-up one.
 */
function sitemap(): Plugin {
  let root = process.cwd()
  const git: Git = (args) => {
    try {
      return execFileSync('git', [...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return null
    }
  }
  return {
    name: 'escapeplan-sitemap',
    apply: 'build',
    configResolved(config) {
      root = config.root
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: buildSitemapXml(sitemapEntries(git)) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    routeHeads(),
    sitemap(),
    // Run with ANALYZE=true to generate bundle-stats.html
    process.env.ANALYZE === 'true' && visualizer({
      filename: 'bundle-stats.html',
      open: true,
      gzipSize: true,
    }),
  ].filter(Boolean),
  // Pinned so the port never depends on start order (ESCSUITE-252): a taken port
  // fails loudly instead of sliding to the next one.
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
})
