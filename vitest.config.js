import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/** IIFE inject modules loaded in tests — must pass through Vite transform for v8 coverage. */
const COVERED_IIFE_MODULES = ["inject/naming/naming-engine.js", "inject/project-map/structured-json.js"];

function iifeCoveragePlugin() {
  return {
    name: "iife-coverage",
    transform(code, id) {
      const filePath = id.split("?")[0];
      const rel = path.relative(root, filePath);
      if (!COVERED_IIFE_MODULES.includes(rel)) {
        return null;
      }
      return {
        code: `${code}\nexport {};\n`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [iifeCoveragePlugin()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["lib/**/*.js", ...COVERED_IIFE_MODULES],
      thresholds: {
        lines: 35,
        functions: 35,
        branches: 25,
        statements: 35,
        "lib/**": {
          lines: 90,
          functions: 90,
          branches: 75,
          statements: 90,
        },
      },
    },
  },
});
