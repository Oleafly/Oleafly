import { describe, expect, it } from "vitest";
import type { ZoteroLibraryStatus } from "@oleafly/backend-port";
import { zoteroHint, zoteroHintText, zoteroSearchable } from "./hint";

function status(overrides: Partial<ZoteroLibraryStatus> = {}): ZoteroLibraryStatus {
  return {
    local: { state: "ready", bbtVersion: "6.7" },
    web: "notConnected",
    libraries: [],
    itemCount: 10,
    syncing: false,
    generation: 1,
    bbtSeen: true,
    loaded: true,
    ...overrides,
  };
}

describe("Zotero hints", () => {
  it("names the fix for each problem and stays quiet otherwise", () => {
    expect(zoteroHint(null)).toBeNull();
    expect(zoteroHint(status())).toBeNull();
    expect(zoteroHint(status({ local: { state: "apiDisabled" } }))).toBe("apiDisabled");
    expect(zoteroHint(status({ local: { state: "unsupported" } }))).toBe("unsupported");
    expect(zoteroHint(status({ web: "keyRejected" }))).toBe("keyRejected");
    expect(zoteroHint(status({ local: { state: "notRunning" } }))).toBe("closedCached");
    expect(zoteroHint(status({ local: { state: "notRunning" }, source: "web" }))).toBeNull();
    expect(zoteroHint(status({ local: { state: "notRunning" }, web: "ready", source: undefined }))).toBe("closedCached");
    expect(zoteroHint(status({ local: { state: "notRunning", installed: true }, itemCount: 0 }))).toBe("closed");
    expect(zoteroHint(status({ local: { state: "notRunning" }, itemCount: 0 }))).toBeNull();
    expect(zoteroHint(status({ local: { state: "ready" } }))).toBe("bbtMissing");
    expect(zoteroHint(status({ local: { state: "ready" }, bbtSeen: false }))).toBeNull();
  });

  it("words the closed hint with the time of the last sync", () => {
    const text = zoteroHintText(status({ local: { state: "notRunning" }, lastSync: Date.now() - 3 * 60_000 }));
    expect(text).toContain("Zotero is closed");
    expect(text).toContain("3 minutes ago");
    expect(zoteroHintText(status({ local: { state: "apiDisabled" } }))).toContain("Allow other applications on this computer to communicate with Zotero");
  });

  it("only searches a library that has items", () => {
    expect(zoteroSearchable(status())).toBe(true);
    expect(zoteroSearchable(status({ itemCount: 0 }))).toBe(false);
    expect(zoteroSearchable(null)).toBe(false);
  });
});
