// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  appendAppLog: vi.fn().mockResolvedValue(undefined),
}));

async function loadModule() {
  vi.resetModules();
  return import("./boot-telemetry");
}

describe("markBootStage", () => {
  let markSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    markSpy = vi.spyOn(performance, "mark");
    window.__oleaflySplashStage = undefined;
    window.__oleaflySplashTimer = undefined;
  });

  afterEach(() => {
    markSpy.mockRestore();
    document.getElementById("oleafly-splash")?.remove();
  });

  it("records a performance mark once per stage", async () => {
    const { markBootStage, bootStageReached } = await loadModule();
    markBootStage("entry-evaluated");
    markBootStage("entry-evaluated");
    expect(
      markSpy.mock.calls.filter(
        (call: unknown[]) => call[0] === "boot:entry-evaluated",
      ),
    ).toHaveLength(1);
    expect(bootStageReached("entry-evaluated")).toBe(true);
    expect(bootStageReached("react-mounted")).toBe(false);
  });

  it("advances the splash narration for staged milestones", async () => {
    const { markBootStage } = await loadModule();
    const advance = vi.fn();
    window.__oleaflySplashStage = advance;
    markBootStage("entry-evaluated");
    markBootStage("contributions-registered");
    markBootStage("react-mounted");
    markBootStage("stores-ready"); // not a narration stage
    expect(advance.mock.calls).toEqual([[1], [2], [3]]);
  });

  it("survives a missing splash hook", async () => {
    const { markBootStage } = await loadModule();
    expect(() => markBootStage("entry-evaluated")).not.toThrow();
  });
});

describe("dismissBootSplash", () => {
  it("removes the splash element and stops the fallback timer", async () => {
    const { dismissBootSplash } = await loadModule();
    const splash = document.createElement("div");
    splash.id = "oleafly-splash";
    document.body.append(splash);
    const timer = setInterval(() => {}, 60_000);
    window.__oleaflySplashTimer = timer;
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    dismissBootSplash();

    expect(document.getElementById("oleafly-splash")).toBeNull();
    expect(clearSpy).toHaveBeenCalledWith(timer);
    expect(window.__oleaflySplashTimer).toBeUndefined();
    clearSpy.mockRestore();
  });

  it("is idempotent when no splash exists", async () => {
    const { dismissBootSplash } = await loadModule();
    expect(() => {
      dismissBootSplash();
      dismissBootSplash();
    }).not.toThrow();
  });
});

describe("holding the splash for a folder that is opening", () => {
  function mountSplash() {
    const splash = document.createElement("div");
    splash.id = "oleafly-splash";
    const stage = document.createElement("div");
    stage.id = "oleafly-splash-stage";
    stage.textContent = "Initializing Oleafly";
    splash.append(stage);
    document.body.append(splash);
  }

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById("oleafly-splash")?.remove();
    window.__oleaflySplashStage = undefined;
  });

  it("names the folder and keeps boot progress from overwriting it", async () => {
    const { holdBootSplash, bootSplashHeld, markBootStage } = await loadModule();
    mountSplash();
    const advance = vi.fn();
    window.__oleaflySplashStage = advance;
    holdBootSplash("Opening thesis…");
    markBootStage("react-mounted");
    expect(bootSplashHeld()).toBe(true);
    expect(advance).not.toHaveBeenCalled();
    expect(document.getElementById("oleafly-splash-stage")?.textContent).toBe("Opening thesis…");
    expect(document.getElementById("oleafly-splash")?.getAttribute("aria-label")).toBe(
      "Opening thesis…",
    );
  });

  it("lets go once the folder is open, and on its own if the open never settles", async () => {
    vi.useFakeTimers();
    const { holdBootSplash, releaseBootSplash, bootSplashHeld } = await loadModule();
    mountSplash();
    holdBootSplash("Opening thesis…");
    releaseBootSplash();
    expect(bootSplashHeld()).toBe(false);
    expect(document.getElementById("oleafly-splash")).toBeNull();

    mountSplash();
    holdBootSplash("Opening notes…");
    vi.advanceTimersByTime(20_000);
    expect(bootSplashHeld()).toBe(false);
    expect(document.getElementById("oleafly-splash")).toBeNull();
  });

  it("does nothing when the splash is already gone", async () => {
    const { holdBootSplash, bootSplashHeld } = await loadModule();
    holdBootSplash("Opening thesis…");
    expect(bootSplashHeld()).toBe(false);
  });
});
