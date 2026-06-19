import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Native addons are loaded at runtime via createRequire, never bundled.
      external: [/\.node$/],
    },
  },
});
