import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// Три окна: основное (index.html), подсказка о клавише в углу экрана (hint.html)
// и слой закреплённых пунктов поверх игры (pins.html)
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  resolve: {
    alias: {
      // Типы базы общие с парсером — один источник правды о формате
      '@shared': fileURLToPath(new URL('../parser/src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    cssMinify: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        hint: fileURLToPath(new URL('./hint.html', import.meta.url)),
        pins: fileURLToPath(new URL('./pins.html', import.meta.url)),
      },
    },
  },
  test: { environment: 'node' },
});
