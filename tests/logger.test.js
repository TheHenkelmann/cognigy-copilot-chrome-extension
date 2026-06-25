import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../lib/logger.js";

describe("createLogger", () => {
  it("logs info/warn/error unconditionally", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const log = createLogger("[Test]");
    log.info("hello");
    log.warn("careful");
    log.error("boom");

    expect(infoSpy).toHaveBeenCalledWith("[Test]", "hello");
    expect(warnSpy).toHaveBeenCalledWith("[Test]", "careful");
    expect(errorSpy).toHaveBeenCalledWith("[Test]", "boom");

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs debug only when __CCP_DEBUG__ is true", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const log = createLogger("[Test]");

    log.debug("hidden");
    expect(debugSpy).not.toHaveBeenCalled();

    globalThis.__CCP_DEBUG__ = true;
    log.debug("visible");
    expect(debugSpy).toHaveBeenCalledWith("[Test]", "visible");

    delete globalThis.__CCP_DEBUG__;
    debugSpy.mockRestore();
  });
});
