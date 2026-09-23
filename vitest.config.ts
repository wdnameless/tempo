import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Component tests need a DOM; the service suites are environment-agnostic
    // (they install their own localStorage) and run unchanged under jsdom.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // The three suites that render the whole application shell (App, StatsView)
    // or a canvas with its animation loop (WinterCanvas) need more than the
    // default five seconds once v8 coverage instruments every module — they were
    // already brushing the limit before the ambient canvas existed, and they
    // fail only in the coverage run, never alone. This is a ceiling for those
    // heavy mounts, not a blanket excuse: a genuinely hung test still reports.
    testTimeout: 20000,
    // jsdom plus v8 instrumentation is heavy per file. Left unbounded, the suite
    // saturates the machine and the few suites that render the whole shell blow
    // past any reasonable timeout — they pass alone and in a quiet run, which is
    // exactly the shape of flake that wastes an afternoon. Capping the workers
    // costs a few seconds and makes the result the same everywhere, including
    // the slower two-core CI runner.
    maxWorkers: 4,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**', 'src/vite-env.d.ts'],
      // Floors sit just under today's numbers so the check is a ratchet against
      // regressions rather than an aspiration nobody meets. Both P0 defects this
      // project shipped lived in the untested lifecycle of a component, which is
      // the gap these thresholds exist to stop widening.
      thresholds: {
        statements: 53,
        branches: 50,
        functions: 50,
        lines: 54,
      },
    },
  },
});
