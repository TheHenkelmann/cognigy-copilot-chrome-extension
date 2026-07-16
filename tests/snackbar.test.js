import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(root, "..");

function loadModule(relativePath) {
  const code = fs.readFileSync(path.join(extensionRoot, relativePath), "utf8");
  new Function(code)();
}

function setupCcp() {
  window.__CCP__ = {};
}

describe("snackbar", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    setupCcp();
    loadModule("inject/core/snackbar.js");
  });

  afterEach(() => {
    if (window.__CCP__ && window.__CCP__.snackbar) {
      window.__CCP__.snackbar._reset();
    }
    document.documentElement.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("adds snackbar items via push helpers", () => {
    const snackbar = window.__CCP__.snackbar;
    snackbar.error("Load failed", "details");

    const items = snackbar._getItems();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Load failed");
    expect(items[0].body).toBe("details");
    expect(items[0].type).toBe("error");

    const container = document.querySelector(".ccp-snackbar-container");
    expect(container).not.toBeNull();
    expect(container.textContent).toContain("Load failed");
  });

  it("merges duplicate title and body", () => {
    const snackbar = window.__CCP__.snackbar;
    snackbar.error("Load failed", "details");
    snackbar.error("Load failed", "details");

    const items = snackbar._getItems();
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(2);

    const container = document.querySelector(".ccp-snackbar-container");
    expect(container.textContent).toContain("×2");
  });

  it("dismisses items", () => {
    const snackbar = window.__CCP__.snackbar;
    snackbar.success("Saved");
    const id = snackbar._getItems()[0].id;

    snackbar.dismiss(id);
    expect(snackbar._getItems()).toHaveLength(0);
    expect(document.querySelector(".ccp-snackbar-container")).toBeNull();
  });

  it("removes expired items over time", () => {
    setupCcp();
    loadModule("inject/core/snackbar.js");
    const snackbar = window.__CCP__.snackbar;
    snackbar._stopTickLoop();

    snackbar.push({ title: "Saved", type: "success", ttl: 100 });
    const t0 = performance.now();
    snackbar._runTickAt(t0);
    expect(snackbar._getItems()).toHaveLength(1);

    snackbar._runTickAt(t0 + 150);
    expect(snackbar._getItems()).toHaveLength(0);
  });

  it("toggles expanded state for items with body", () => {
    const snackbar = window.__CCP__.snackbar;
    snackbar.error("Load failed", "details");
    const id = snackbar._getItems()[0].id;

    snackbar._toggleExpanded(id);
    expect(snackbar._getItems()[0].expanded).toBe(true);
    expect(document.querySelector(".ccp-snackbar-body")).not.toBeNull();

    snackbar._toggleExpanded(id);
    expect(snackbar._getItems()[0].expanded).toBe(false);
    expect(document.querySelector(".ccp-snackbar-body")).toBeNull();
  });

  it("pauses countdown on hover", () => {
    setupCcp();
    loadModule("inject/core/snackbar.js");
    const snackbar = window.__CCP__.snackbar;
    snackbar._stopTickLoop();

    snackbar.push({ title: "Saved", type: "success", ttl: 1000 });
    const t0 = performance.now();
    snackbar._runTickAt(t0);
    snackbar._setPaused(true);
    const remainingWhilePaused = snackbar._getItems()[0].remaining;

    snackbar._runTickAt(t0 + 500);
    expect(snackbar._getItems()[0].remaining).toBe(remainingWhilePaused);

    snackbar._setPaused(false);
    snackbar._runTickAt(t0 + 1100);
    expect(snackbar._getItems()[0].remaining).toBeLessThan(remainingWhilePaused);
  });
  it("mounts inside an open CCP overlay when present", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-ccp-release-manage", "1");
    document.body.appendChild(overlay);

    const snackbar = window.__CCP__.snackbar;
    snackbar.error("Delete failed", "Snapshot is attached to an endpoint");

    const portal = overlay.querySelector("[data-ccp-snackbar-portal]");
    expect(portal).not.toBeNull();
    expect(overlay.contains(portal)).toBe(true);
    expect(portal.querySelector("[data-ccp-snackbar-container]").textContent).toContain("Delete failed");
  });
});

describe("snackbar-format", () => {
  beforeEach(() => {
    setupCcp();
    loadModule("inject/core/snackbar-format.js");
  });

  it("formats status-prefixed API errors", () => {
    const result = window.__CCP__.formatApiError(new Error("422 validation failed"));
    expect(result).toEqual({ title: "Request failed (422)", body: "validation failed" });
  });

  it("formats generic errors", () => {
    const result = window.__CCP__.formatApiError(new Error("Network down"));
    expect(result).toEqual({ title: "Network down", body: "" });
  });

  it("formats release-api style errors", () => {
    const result = window.__CCP__.formatApiError(new Error("API 400: Snapshot is attached to an endpoint"));
    expect(result).toEqual({
      title: "Request failed (400)",
      body: "Snapshot is attached to an endpoint",
    });
  });

  it("formats failed task errors", () => {
    const result = window.__CCP__.formatApiError(new Error("Task error: snapshot in use"));
    expect(result).toEqual({ title: "Task error", body: "snapshot in use" });
  });

  it("pushApiError delegates to showError", () => {
    const showError = vi.fn();
    window.__CCP__.pushApiError(showError, new Error("500 server error"));
    expect(showError).toHaveBeenCalledWith("Request failed (500)", "server error");
  });
});
