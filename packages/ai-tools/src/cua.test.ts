// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  cuaActionRisk,
  observe,
  runCuaAction,
  type CuaSurface,
} from "./cua";

function surface(html: string): CuaSurface & { navigated: string[] } {
  document.body.innerHTML = html;
  document.title = "Sandbox";
  const navigated: string[] = [];
  return {
    document,
    url: () => "https://sandbox.local/",
    navigate(url: string) {
      navigated.push(url);
    },
    navigated,
  };
}

describe("cuaActionRisk", () => {
  it("auto-approves read-only actions and confirms mutations", () => {
    expect(cuaActionRisk("read")).toBe("auto");
    expect(cuaActionRisk("screenshot")).toBe("auto");
    expect(cuaActionRisk("scroll")).toBe("auto");
    expect(cuaActionRisk("wait")).toBe("auto");
    expect(cuaActionRisk("navigate")).toBe("confirm");
    expect(cuaActionRisk("click")).toBe("confirm");
    expect(cuaActionRisk("type")).toBe("confirm");
    expect(cuaActionRisk("submit")).toBe("confirm");
  });
});

describe("observe", () => {
  it("lists interactive elements with accessible names", () => {
    const obs = observe(
      surface(
        `<p>hello</p><button aria-label="Search">Go</button><a href="#">Docs</a>`,
      ),
    );
    expect(obs.title).toBe("Sandbox");
    expect(obs.text).toContain("hello");
    expect(obs.elements.map((e) => e.name)).toEqual(["Search", "Docs"]);
  });
});

describe("runCuaAction", () => {
  it("navigates only to valid http(s) urls", async () => {
    const s = surface("<p>x</p>");
    await expect(runCuaAction(s, { type: "navigate", text: "not a url" })).resolves.toMatchObject({
      ok: false,
    });
    const ok = await runCuaAction(s, {
      type: "navigate",
      text: "https://arxiv.org/abs/1234",
    });
    expect(ok.ok).toBe(true);
    expect(s.navigated).toEqual(["https://arxiv.org/abs/1234"]);
  });

  it("clicks a matched element and reports missing ones", async () => {
    const clicked = vi.fn();
    const s = surface(`<button id="go">Go</button>`);
    s.document.getElementById("go")?.addEventListener("click", clicked);

    expect((await runCuaAction(s, { type: "click", selector: "#go" })).ok).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
    expect((await runCuaAction(s, { type: "click", selector: "#nope" })).ok).toBe(false);
  });

  it("types into a field and fires input", async () => {
    const s = surface(`<input id="q" />`);
    const input = s.document.getElementById("q") as HTMLInputElement;
    const onInput = vi.fn();
    input.addEventListener("input", onInput);

    const result = await runCuaAction(s, {
      type: "type",
      selector: "#q",
      text: "diffusion models",
    });
    expect(result.ok).toBe(true);
    expect(input.value).toBe("diffusion models");
    expect(onInput).toHaveBeenCalledOnce();
  });

  it("reads the page without mutating it", async () => {
    const s = surface(`<p>abstract text</p>`);
    const result = await runCuaAction(s, { type: "read" });
    expect(result.ok).toBe(true);
    expect(result.observation?.text).toContain("abstract text");
  });
});
