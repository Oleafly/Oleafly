import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const json = (path: string) => JSON.parse(read(path));

const pkg = json("package.json");
const base = json("src-tauri/tauri.conf.json");
const linux = json("src-tauri/tauri.linux.conf.json");
const metainfoPath = "/usr/share/metainfo/com.oleafly.app.metainfo.xml";
const metainfo = read("src-tauri/linux/com.oleafly.app.metainfo.xml");

function tag(name: string): string[] {
  return [...metainfo.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`, "gu"))].map(
    (match) => match[1],
  );
}

function pngWidth(path: string): number {
  return readFileSync(new URL(`src-tauri/${path}`, root)).readUInt32BE(16);
}

describe("Linux packaging", () => {
  it("describes the same app the bundle installs", () => {
    expect(tag("id")).toEqual([base.identifier]);
    expect(tag("launchable")).toEqual([`${base.productName}.desktop`]);
    expect(tag("icon")).toEqual([linux.mainBinaryName]);
    expect(tag("project_license")).toEqual([pkg.license]);
    expect(metainfo).toContain('<release version="');
    expect(metainfo.match(/<release version="([^"]+)"/u)?.[1]).toBe(pkg.version);
  });

  it("ships the metainfo in every Linux package format", () => {
    for (const format of ["deb", "rpm", "appimage"]) {
      expect(linux.bundle.linux[format].files[metainfoPath]).toBe("linux/com.oleafly.app.metainfo.xml");
    }
  });

  it("points screenshots at the public CDN", () => {
    const screenshots = [...metainfo.matchAll(/<image[^>]*>([^<]+)<\/image>/gu)].map((match) => match[1]);
    expect(screenshots.length).toBeGreaterThan(0);
    for (const url of screenshots) {
      expect(url).toMatch(/^https:\/\/cdn\.oleafly\.com\/images\/screenshots\/desktop\/[\w-]+\.png$/u);
    }
  });

  it("uses the largest icon as the window icon and installs every size", () => {
    const icons: string[] = linux.bundle.icon;
    for (const icon of icons) expect(existsSync(new URL(`src-tauri/${icon}`, root))).toBe(true);
    const widths = icons.map(pngWidth);
    expect(widths[0]).toBe(Math.max(...widths));
    expect(widths[0]).toBeGreaterThanOrEqual(512);
  });

  it("gives both desktop entries categories and search keywords", () => {
    for (const entry of ["src-tauri/linux/main.desktop", "src-tauri/linux/appimage.desktop"]) {
      const text = read(entry);
      expect(text).toMatch(/^Categories=Office;[\w;]+$/mu);
      expect(text).toMatch(/^Keywords=LaTeX;[\w;]+$/mu);
    }
  });

  it("creates the main window without decorations instead of removing them at runtime", () => {
    expect(linux.app.windows).toHaveLength(1);
    expect(linux.app.windows[0].decorations).toBe(false);
    expect(base.app.windows[0].decorations).toBe(true);
  });

  it("keeps the main window see-through so the page can round its corners", () => {
    const main = linux.app.windows[0];
    expect(main.transparent).toBe(true);
    expect(main.backgroundColor).toBeUndefined();
    expect(read("index.html")).toContain('setAttribute("data-window-surface", "solid")');
    const css = read("src/styles/globals.css");
    expect(css).toContain('html[data-window-surface="solid"] #root');
    expect(css).toContain('html[data-window-corners="round"] body');
    expect(read("src-tauri/src/window_frame.rs")).toContain("dataset.windowCorners");
  });

  it("fills in the package description shown before installing", () => {
    expect(linux.bundle.shortDescription.length).toBeLessThanOrEqual(80);
    expect(linux.bundle.longDescription.length).toBeGreaterThan(100);
  });
});
