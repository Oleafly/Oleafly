import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("warmChoiceArt", () => {
  it("reads every illustration once, when the app is idle", async () => {
    const idle: IdleRequestCallback[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      idle.push(callback);
      return idle.length;
    });
    const sources: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        decoding = "";
        set src(value: string) {
          sources.push(value);
        }
        decode() {
          return Promise.reject(new Error("not in jsdom"));
        }
      },
    );
    const { CHOICE_ART, warmChoiceArt } = await import("@/components/library/choice-art");

    warmChoiceArt();
    warmChoiceArt();
    expect(sources).toEqual([]);
    expect(idle).toHaveLength(1);

    idle[0]({ didTimeout: false, timeRemaining: () => 50 });
    expect(sources).toEqual(Object.values(CHOICE_ART));
  });
});
