import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const sourceVsDir = path.join(projectRoot, "node_modules", "monaco-editor", "min", "vs");
const targetVsDir = path.join(projectRoot, "inject", "vendor", "monaco", "vs");

function ensureSourceExists() {
  if (!fs.existsSync(sourceVsDir)) {
    throw new Error(
      "Monaco source assets not found at " +
        sourceVsDir +
        ". Run `npm install` in the extension directory first."
    );
  }
}

function recreateTargetDir() {
  fs.rmSync(targetVsDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetVsDir), { recursive: true });
}

function copyAssets() {
  fs.cpSync(sourceVsDir, targetVsDir, { recursive: true });
}

function countFiles(dir) {
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        count += 1;
      }
    }
  }
  return count;
}

function run() {
  ensureSourceExists();
  recreateTargetDir();
  copyAssets();
  const fileCount = countFiles(targetVsDir);
  console.log("[copy-monaco-assets] copied", fileCount, "files to", path.relative(projectRoot, targetVsDir));
}

run();
