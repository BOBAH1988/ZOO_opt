import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// GitHub Pages: сайт публикуется по адресу https://BOBAH1988.github.io/ZOO_opt/
// base должен совпадать с именем репозитория.
const BASE = process.env.VITE_BASE_PATH || '/ZOO_opt/';

export default defineConfig({
  plugins: [react()],
  base: BASE,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Статические ассеты с хешами для кэширования Service Worker'ом
        entryFileNames: `assets/[name].[hash].js`,
        chunkFileNames: `assets/[name].[hash].js`,
        assetFileNames: `assets/[name].[hash].[ext]`,
      },
    },
  },
  server: {
    port: 5173,
    open: false,
    origin: 'http://localhost:5173',
    hmr: {
      host: 'localhost',
      port: 5173,
      path: '/__vite_hmr',
    },
  },
});