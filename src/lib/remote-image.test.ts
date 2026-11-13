// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  heldRemoteImage,
  REMOTE_IMAGE_HOSTS_KEY,
  remoteImageAllowed,
  remoteImageHost,
  resetRemoteImagesForTest,
  subscribeRemoteImages,
  trustedRemoteImageHosts,
  trustRemoteImageHost,
  untrustRemoteImageHost,
} from "./remote-image";

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

describe("trusted remote image hosts", () => {
  beforeEach(() => {
    localStorage.clear();
    resetRemoteImagesForTest();
  });

  it("lists trusted hosts and holds a host's images again once it is removed", () => {
    const seen = vi.fn();
    const stop = subscribeRemoteImages(seen);
    trustRemoteImageHost("x.org");
    trustRemoteImageHost("y.org");
    const listed = trustedRemoteImageHosts();
    expect(listed).toEqual(["x.org", "y.org"]);
    expect(trustedRemoteImageHosts()).toBe(listed);

    untrustRemoteImageHost("x.org");
    untrustRemoteImageHost("x.org");
    stop();
    expect(trustedRemoteImageHosts()).toEqual(["y.org"]);
    expect(seen).toHaveBeenCalledTimes(3);
    expect(heldRemoteImage("https://x.org/a.png")).toEqual({ url: "https://x.org/a.png", host: "x.org" });
    expect(JSON.parse(localStorage.getItem(REMOTE_IMAGE_HOSTS_KEY) ?? "null")).toEqual(["y.org"]);
    resetRemoteImagesForTest();
    expect(trustedRemoteImageHosts()).toEqual(["y.org"]);
  });

  it("ignores a broken saved host list", () => {
    localStorage.setItem(REMOTE_IMAGE_HOSTS_KEY, '{"x.org": true}');
    resetRemoteImagesForTest();
    expect(remoteImageAllowed("https://x.org/a.png")).toBe(false);
    trustRemoteImageHost("x.org");
    trustRemoteImageHost("x.org");
    expect(JSON.parse(localStorage.getItem(REMOTE_IMAGE_HOSTS_KEY) ?? "[]")).toEqual(["x.org"]);
  });
});
