import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "scripts/m2/**/*.test.ts",
      // M2.7 helper uses node:test, not vitest — keep it out of the vitest run.
      "src/sources/graph/deployment-assertion.test.ts",
    ],
  },
});
