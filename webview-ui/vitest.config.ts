import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/*.test.ts'],
    testTimeout: 30_000,
    // Tests bind fixed ports (Vite dev server, vite preview) and share the
    // global `window.postMessage` listener in browser-transport. Serial run
    // avoids port collisions and listener crosstalk.
    fileParallelism: false,
  },
});
