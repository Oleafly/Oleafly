// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { remoteImageHost } from "./remote-image";

const MAC = "tauri://localhost/index.html";
const WINDOWS = "http://tauri.localhost/index.html";
const DEV = "http://localhost:1420/";

describe("remote image hosts", () => {
  it("names the host of an image on another site", () => {
    expect(remoteImageHost("https://tracker.example.com/p.gif?n=1", MAC)).toBe("tracker.example.com");
    expect(remoteImageHost("http://cdn.example.org:8080/a.png", WINDOWS)).toBe("cdn.example.org:8080");
    expect(remoteImageHost(" //cdn.example.org/a.png ", WINDOWS)).toBe("cdn.example.org");
    expect(remoteImageHost("HTTPS://Example.COM/a.png", DEV)).toBe("example.com");
  });

  it("treats inline, local and the app's own images as safe to show", () => {
    for (const src of ["data:image/png;base64,AAAA", "blob:tauri://localhost/1", "", "  ", "assets/plot.png", "/plot.png"]) {
      expect(remoteImageHost(src, MAC)).toBeNull();
    }
    expect(remoteImageHost("asset://localhost/Users/me/plot.png", MAC)).toBeNull();
    expect(remoteImageHost("http://asset.localhost/C:/plot.png", WINDOWS)).toBeNull();
    expect(remoteImageHost("http://tauri.localhost/icon.png", WINDOWS)).toBeNull();
    expect(remoteImageHost("http://localhost:1420/icon.png", DEV)).toBeNull();
    expect(remoteImageHost("assets/plot.png", WINDOWS)).toBeNull();
  });

  it("ignores addresses it can't read", () => {
    expect(remoteImageHost("https://", MAC)).toBeNull();
    expect(remoteImageHost("https://example.com/a.png", "not a url")).toBeNull();
  });

  it("reads against the page address by default", () => {
    expect(remoteImageHost(`${window.location.origin}/a.png`)).toBeNull();
    expect(remoteImageHost("https://elsewhere.example/a.png")).toBe("elsewhere.example");
  });
});
