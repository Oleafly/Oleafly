// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ICONS } from "@/store/settings";

const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

function splashQuill(saved: string | null) {
  localStorage.clear();
  if (saved !== null) localStorage.setItem("oleafly.appIcon", saved);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const splash = parsed.getElementById("oleafly-splash");
  const script = [...parsed.scripts].find((element) => element.textContent?.includes("oleafly.appIcon"));
  if (!splash || !script) throw new Error("index.html has no splash quill script");
  document.body.replaceChildren(document.importNode(splash, true));
  const run = document.createElement("script");
  run.textContent = script.textContent;
  document.body.append(run);
  return {
    fill: document.querySelector(".oleafly-splash-fill path")?.getAttribute("fill"),
    stops: [...document.querySelectorAll(".oleafly-splash-fill stop")].map((stop) => [
      stop.getAttribute("offset"),
      stop.getAttribute("stop-color"),
    ]),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.replaceChildren();
});

function elementsAfterRoot(source: string): Element[] {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const root = parsed.getElementById("root");
  const after: Element[] = [];
  for (let node = root?.nextElementSibling ?? null; node; node = node.nextElementSibling) {
    after.push(node);
  }
  return after;
}

describe("index.html body", () => {
  it("keeps a non-script element after the app root, so overlays appended to body never make the root the last child", () => {
    const after = elementsAfterRoot(html).filter((element) => element.tagName !== "SCRIPT");
    expect(after.length).toBeGreaterThan(0);
    expect(after[0]?.hasAttribute("hidden")).toBe(true);
  });

  it("still has a non-script element after the root once the build moves the entry script into head", () => {
    const built = html.replace(/<script type="module"[^>]*><\/script>/, "");
    expect(elementsAfterRoot(built).some((element) => element.tagName !== "SCRIPT")).toBe(true);
  });
});

describe("index.html splash quill", () => {
  it("draws the quill in the colours of every app icon", () => {
    for (const icon of APP_ICONS) {
      const quill = splashQuill(icon.id);
      if (icon.quill.length === 1) {
        expect(quill, icon.id).toEqual({ fill: icon.quill[0], stops: [] });
      } else {
        expect(quill, icon.id).toEqual({
          fill: "url(#oleafly-splash-quill)",
          stops: icon.quill.map((colour, index) => [String(index / (icon.quill.length - 1)), colour]),
        });
      }
    }
  });

  it("keeps the classic quill when no icon is saved or the saved one is unknown", () => {
    for (const saved of [null, "Classic", "constructor", ""]) {
      expect(splashQuill(saved), String(saved)).toEqual({ fill: "#34B44A", stops: [] });
    }
  });

  it("keeps the classic quill when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(splashQuill(null)).toEqual({ fill: "#34B44A", stops: [] });
  });
});
