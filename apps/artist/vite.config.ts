/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    // Run with ANALYZE=true to generate bundle-stats.html
    process.env.ANALYZE === 'true' && visualizer({
      filename: 'bundle-stats.html',
      open: true,
      gzipSize: true,
    }),
  ].filter(Boolean),
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000, // Required for vite-plugin-singlefile
    chunkSizeWarningLimit: 5000,  // 5MB - flag unexpected bloat
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  define: {
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
