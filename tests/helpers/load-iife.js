import { vi } from "vitest";

const MODULE_IMPORTS = {
  "inject/naming/naming-engine.js": () => import("../../inject/naming/naming-engine.js"),
  "inject/project-map/structured-json.js": () => import("../../inject/project-map/structured-json.js"),
};

/**
 * Load an IIFE browser script through Vite so v8 coverage instruments the source file.
 * @param {string} relativePath
 */
export async function loadIifeModule(relativePath) {
  const loader = MODULE_IMPORTS[relativePath];
  if (!loader) {
    throw new Error(`Unknown IIFE module for coverage import: ${relativePath}`);
  }
  vi.resetModules();
  await loader();
  return window.__CCP__;
}
