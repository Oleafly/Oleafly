// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
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

function nonScriptableSurface(): CuaSurface & { navigated: string[] } {
  const navigated: string[] = [];
  return {
    get document(): Document {
      throw new Error("native surface has no document");
    },
    url: () => "https://native.local/",
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

  it("returns a minimal observation for a non-scriptable surface", () => {
    expect(observe(nonScriptableSurface())).toEqual({
      url: "https://native.local/",
      title: "",
      text: "",
      elements: [],
    });
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

  it("navigates and waits without reading the document", async () => {
    const s = nonScriptableSurface();
    const navigated = await runCuaAction(s, {
      type: "navigate",
      text: "https://arxiv.org/abs/1234",
    });
    const waited = await runCuaAction(s, { type: "wait", amount: 0 });
    expect(navigated).toMatchObject({
      ok: true,
      observation: { url: "https://native.local/", title: "" },
    });
    expect(waited.ok).toBe(true);
    expect(s.navigated).toEqual(["https://arxiv.org/abs/1234"]);
  });

  it.each([
    ["read", false],
    ["screenshot", false],
    ["scroll", false],
    ["click", false],
    ["type", false],
    ["submit", false],
  ] as const)("degrades %s on a non-scriptable surface", async (type, ok) => {
    const result = await runCuaAction(nonScriptableSurface(), {
      type,
      selector: "#target",
    });
    expect(result).toMatchObject({
      ok,
      observation: {
        url: "https://native.local/",
        title: "",
        text: "",
        elements: [],
      },
    });
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

describe("observe edge cases", () => {
  it("falls back to a placeholder and then to an empty name", () => {
    const obs = observe(surface(`<input placeholder="  Search papers " /><button></button>`));
    expect(obs.elements).toEqual([
      { ref: 0, tag: "input", role: null, name: "Search papers" },
      { ref: 1, tag: "button", role: null, name: "" },
    ]);
  });

  it("keeps the page when the surface cannot report its URL", () => {
    const s = surface(`<a role="link" href="#">Docs</a>`);
    const obs = observe({ ...s, document: s.document, url: () => { throw new Error("detached"); } });
    expect(obs.url).toBe("");
    expect(obs.elements).toEqual([{ ref: 0, tag: "a", role: "link", name: "Docs" }]);
  });

  it("reads a document that has no body as empty text", () => {
    const svg = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><title>Chart</title></svg>',
      "image/svg+xml",
    );
    const obs = observe({ document: svg, url: () => "https://example.org/chart.svg", navigate() {} });
    expect(obs).toEqual({ url: "https://example.org/chart.svg", title: "Chart", text: "", elements: [] });
  });

  it("caps the page text at 4,000 characters", () => {
    const obs = observe(surface(`<p>${"word ".repeat(2000)}</p>`));
    expect(obs.text).toHaveLength(4000);
  });
});

describe("runCuaAction on a scriptable page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("refuses non-http navigation and a missing URL", async () => {
    const s = surface("<p>x</p>");
    expect(await runCuaAction(s, { type: "navigate", text: "javascript:alert(1)" })).toEqual({
      ok: false,
      message: "navigate needs a valid http(s) URL",
    });
    expect(await runCuaAction(s, { type: "navigate" })).toMatchObject({ ok: false });
    expect(s.navigated).toEqual([]);
  });

  it("scrolls by the requested amount, 400 pixels by default", async () => {
    const s = surface("<p>long page</p>");
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    expect(await runCuaAction(s, { type: "scroll" })).toMatchObject({ ok: true, message: "Scrolled" });
    await runCuaAction(s, { type: "scroll", amount: -120 });
    expect(scrollBy.mock.calls).toEqual([[0, 400], [0, -120]]);
  });

  it("reports a scroll on a document with no window without failing", async () => {
    const detached = document.implementation.createHTMLDocument("Detached");
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const result = await runCuaAction(
      { document: detached, url: () => "https://example.org/", navigate() {} },
      { type: "scroll" },
    );
    expect(result).toMatchObject({ ok: true, message: "Scrolled", observation: { title: "Detached" } });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("captures the page for a screenshot", async () => {
    const result = await runCuaAction(surface("<p>figure 1</p>"), { type: "screenshot" });
    expect(result).toMatchObject({ ok: true, message: "Captured the page" });
    expect(result.observation?.text).toBe("figure 1");
  });

  it("reports a click or type with no selector as unmatched", async () => {
    const s = surface(`<button>Go</button><input />`);
    expect(await runCuaAction(s, { type: "click" })).toMatchObject({ ok: false });
    expect(await runCuaAction(s, { type: "type", text: "x" })).toMatchObject({ ok: false });
  });

  it("reports a missing field and clears a field when typing nothing", async () => {
    const s = surface(`<textarea id="notes">old</textarea>`);
    expect(await runCuaAction(s, { type: "type", selector: "#nope", text: "x" })).toEqual({
      ok: false,
      message: "No field matches #nope",
    });
    expect(await runCuaAction(s, { type: "type", selector: "#notes" })).toEqual({
      ok: true,
      message: "Typed into #notes",
    });
    expect((s.document.getElementById("notes") as HTMLTextAreaElement).value).toBe("");
  });

  it("submits the selected form, else the first form, else reports none", async () => {
    const s = surface(`<form id="a"><input name="q" /></form><form id="b"></form>`);
    const submitted: string[] = [];
    s.document.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted.push((event.target as HTMLFormElement).id);
    });
    expect(await runCuaAction(s, { type: "submit", selector: "#b" })).toMatchObject({
      ok: true,
      message: "Submitted the form",
    });
    expect((await runCuaAction(s, { type: "submit" })).ok).toBe(true);
    expect(submitted).toEqual(["b", "a"]);
    expect(await runCuaAction(surface("<p>no form</p>"), { type: "submit" })).toEqual({
      ok: false,
      message: "No form to submit",
    });
  });

  it("waits 500 ms by default and never longer than five seconds", async () => {
    vi.useFakeTimers();
    const s = surface("<p>x</p>");
    let settled = false;
    const short = runCuaAction(s, { type: "wait" }).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await short;
    expect(settled).toBe(true);

    let longSettled = false;
    const long = runCuaAction(s, { type: "wait", amount: 60_000 }).then(() => {
      longSettled = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(longSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await long;
    expect(longSettled).toBe(true);
  });

  it("rejects an action type it does not know", async () => {
    expect(
      await runCuaAction(surface("<p>x</p>"), { type: "drag" as unknown as "click" }),
    ).toEqual({ ok: false, message: "Unknown action drag" });
  });
});
