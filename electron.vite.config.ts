import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';

const releaseRepository = (process.env.MALACHI_OVERDRIVE_RELEASE_REPOSITORY ?? '').trim();
if (releaseRepository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(releaseRepository)) {
  throw new Error(`Invalid MALACHI_OVERDRIVE_RELEASE_REPOSITORY: ${releaseRepository}`);
}

export default defineConfig({
  main: {
    // Keep node_modules external so the MCP SDK ships as real files in the asar
    // rather than being inlined by the bundler.
    plugins: [externalizeDepsPlugin()],
    define: {
      __MALACHI_OVERDRIVE_RELEASE_REPOSITORY__: JSON.stringify(releaseRepository)
    },
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
});
