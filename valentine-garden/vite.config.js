// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({

  base: '/valentine-garden/',

  
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
});
