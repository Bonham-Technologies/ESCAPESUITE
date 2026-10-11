import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
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
