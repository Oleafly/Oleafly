// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FRAME_POLICY,
  frameChannel,
  framePolicy,
  framePrelude,
  cssUrlTargets,
  globalsFor,
  htmlFrameDocument,
  inlineJson,
  isPortOffer,
  libraryFor,
  prepareHtml,
  reactFrameDocument,
  readFrameMessage,
  runsScripts,
  runtimeScript,
  STATIC_POLICY,
  staticFrameDocument,
} from "./frame-document";

const MESSAGES = {
  unknownImport: "Imports {{name}}",
  compileError: "Syntax",
  runtimeError: "Runtime",
  noComponent: "None",
  loadFailed: "Couldn't load",
};
const PARENT_ORIGIN = "tauri://localhost";
const OPTIONS = { theme: "light" as const, channel: "abc", parentOrigin: PARENT_ORIGIN, messages: MESSAGES };
const HASH = "0123456789abcdef".repeat(4);
const RUNTIME = `oleafly-artifact://localhost/runtime/${HASH}.js`;
const WINDOWS_RUNTIME = `http://oleafly-artifact.localhost/runtime/${HASH}.js`;
const RUNTIME_TAG = `<script src="${RUNTIME}"></script>`;

function metaPolicy(html: string): string {
  const meta = new DOMParser().parseFromString(html, "text/html").querySelector('meta[http-equiv="Content-Security-Policy"]');
  return meta?.getAttribute("content") ?? "";
}
const SCRIPTED_DOM = { runScripts: "outside-only", pretendToBeVisual: true } as unknown as ConstructorParameters<typeof JSDOM>[1];
type DomOptions = ConstructorParameters<typeof JSDOM>[1];

function runningDom(html: string, runtime?: object): JSDOM {
  const options = {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse: (window: Window) => {
      if (runtime) Object.assign(window, { __oleaflyArtifact: runtime });
    },
  };
  return new JSDOM(html, options as unknown as DomOptions);
}

function frameWindow() {
  const dom = new JSDOM("<!doctype html><html><head></head><body><p>x</p></body></html>", SCRIPTED_DOM);
  return dom.window;
}

interface FakePort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown) => void;
}

function connectFrame(window: Window) {
  const sent: unknown[] = [];
  const offers: { message: unknown; origin: string; transfer: unknown[] }[] = [];
  const port1: FakePort = { onmessage: null, postMessage: (message) => sent.push(message) };
  const port2 = { end: "parent" };
  Object.assign(window, {
    MessageChannel: class {
      readonly port1 = port1;
      readonly port2 = port2;
    },
  });
  window.postMessage = ((message: unknown, origin: string, transfer: unknown[]) =>
    offers.push({ message, origin, transfer })) as unknown as typeof window.postMessage;
  return { sent, offers, port1, port2 };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("framePrelude", () => {
  it("cuts the Tauri bridge it cannot delete and removes network globals before user code runs", () => {
    const window = frameWindow() as ReturnType<typeof frameWindow> & { hostCalls: string[] };
    window.hostCalls = [];
    window.eval(`
      Object.defineProperty(window, "chrome", { value: { webview: { postMessage: (s) => hostCalls.push(s) } }, writable: true, configurable: false });
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: { plugins: {} } });
      Object.defineProperty(window.__TAURI_INTERNALS__, "invoke", { value: (cmd) => window.ipc.postMessage(cmd) });
      Object.defineProperty(window, "ipc", { value: Object.freeze({ postMessage: (s) => window.chrome.webview.postMessage(s) }) });
      window.RTCPeerConnection = class {};
    `);
    window.eval(framePrelude("abc", PARENT_ORIGIN));
    expect(window.eval("typeof __TAURI_INTERNALS__")).toBe("object");
    expect(() => window.eval("__TAURI_INTERNALS__.invoke('read_file')")).toThrow();
    expect(() => window.eval("ipc.postMessage('x')")).toThrow();
    expect(window.hostCalls).toEqual([]);
    expect(window.eval("typeof chrome")).toBe("undefined");
    expect(window.eval("typeof RTCPeerConnection")).toBe("undefined");
    expect(window.eval("typeof WebSocket")).toBe("undefined");
    expect(window.eval("navigator.sendBeacon('x')")).toBe(false);
    window.eval("window.RTCPeerConnection = function () {}");
    expect(window.eval("typeof RTCPeerConnection")).toBe("undefined");
  });

  it("hands the parent a message port, addressed to the parent's origin only", () => {
    const window = frameWindow();
    const { offers, port2 } = connectFrame(window as unknown as Window);
    window.eval(framePrelude("chan", PARENT_ORIGIN));
    expect(offers).toEqual([{ message: { channel: "chan", type: "port" }, origin: PARENT_ORIGIN, transfer: [port2] }]);
  });

  it("reports heartbeats and size over its port with its channel", async () => {
    const window = frameWindow();
    const { sent, offers } = connectFrame(window as unknown as Window);
    window.eval(framePrelude("chan", PARENT_ORIGIN));
    expect(sent).toContainEqual({ channel: "chan", type: "beat" });
    await vi.waitFor(() => expect(sent.some((post) => (post as { type: string }).type === "size")).toBe(true));
    const size = sent.find((post) => (post as { type: string }).type === "size") as { height: number };
    expect(typeof size.height).toBe("number");
    expect(offers).toHaveLength(1);
  });

  it("measures after the document finishes loading when it starts early", async () => {
    const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", SCRIPTED_DOM);
    const { sent } = connectFrame(dom.window as unknown as Window);
    Object.defineProperty(dom.window.document, "readyState", { value: "loading", configurable: true });
    dom.window.eval(framePrelude("late", PARENT_ORIGIN));
    expect(sent.some((post) => (post as { type: string }).type === "size")).toBe(false);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    await vi.waitFor(() => expect(sent.some((post) => (post as { type: string }).type === "size")).toBe(true));
  });

  it("follows theme messages that arrive on its port only", () => {
    const window = frameWindow();
    const { port1 } = connectFrame(window as unknown as Window);
    window.eval(framePrelude("chan", PARENT_ORIGIN));
    const send = (data: unknown) => port1.onmessage?.({ data });
    send({ channel: "chan", type: "theme", theme: "dark" });
    expect(window.document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.document.documentElement.dataset.theme).toBe("dark");
    send({ channel: "other", type: "theme", theme: "light" });
    send({ channel: "chan", type: "size", theme: "light" });
    send(null);
    window.dispatchEvent(new window.MessageEvent("message", { data: { channel: "chan", type: "theme", theme: "light" }, source: window }));
    expect(window.document.documentElement.classList.contains("dark")).toBe(true);
    send({ channel: "chan", type: "theme", theme: "light" });
    expect(window.document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.document.documentElement.style.colorScheme).toBe("light");
  });

  it("still seals the frame when it cannot open a port", () => {
    const window = frameWindow();
    const offers: unknown[] = [];
    window.postMessage = ((message: unknown) => offers.push(message)) as typeof window.postMessage;
    window.eval(framePrelude("chan", PARENT_ORIGIN));
    expect(offers).toEqual([]);
    expect(window.eval("typeof WebSocket")).toBe("undefined");
  });
});

describe("libraryFor", () => {
  it.each([
    ["https://cdn.tailwindcss.com", "tailwind"],
    ["https://cdn.tailwindcss.com/3.4.1", "tailwind"],
    ["https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4", "tailwind"],
    ["https://d3js.org/d3.v7.min.js", "d3"],
    ["https://cdn.jsdelivr.net/npm/d3@7", "d3"],
    ["https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js", "d3"],
    ["https://cdn.jsdelivr.net/npm/chart.js", "chart"],
    ["https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js", "chart"],
    ["https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js", "papaparse"],
    ["https://cdn.jsdelivr.net/npm/papaparse@5.4.1", "papaparse"],
    ["https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js", "lodash"],
    ["https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js", "lodash"],
    ["https://unpkg.com/react@18/umd/react.production.min.js", "react"],
    ["https://unpkg.com/react-dom@18/umd/react-dom.production.min.js", "react-dom"],
    ["https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.development.js", "react-dom"],
    ["//unpkg.com/@babel/standalone/babel.min.js", "babel"],
    ["https://unpkg.com/babel-standalone@6/babel.min.js", "babel"],
    ["https://unpkg.com/recharts/umd/Recharts.js", "recharts"],
  ])("recognises %s", (url, library) => {
    expect(libraryFor(url)).toBe(library);
  });

  it.each(["https://example.com/app.js", "http://[", "app.js", "data:text/javascript,1", "ftp://x/d3.js", "https://unpkg.com/three@0.150/build/three.min.js"])(
    "does not swap %s",
    (url) => {
      expect(libraryFor(url)).toBeUndefined();
    },
  );

  it("collects the globals of the swapped libraries once", () => {
    expect(globalsFor(["react-dom", "babel", "d3"])).toEqual(["React", "ReactDOM", "Babel", "d3"]);
  });
});

describe("prepareHtml", () => {
  it("swaps known CDN scripts, drops other remote files and lists them", () => {
    const prepared = prepareHtml(`<!doctype html><html><head>
      <base href="https://evil.example/">
      <meta http-equiv="refresh" content="0; url=https://evil.example">
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://evil.example/track.js"></script>
      <script src="data:text/javascript,1"></script>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      <link rel="preload" href="https://cdn.jsdelivr.net/npm/d3@7">
      <link rel="icon" href="data:image/png;base64,AA==">
      <style>@import url("https://evil.example/a.css"); body { background: url(//evil.example/b.png) } .x { background: url(#local) }</style>
    </head><body>
      <img src="https://evil.example/x.png" srcset="https://evil.example/2x.png 2x, data:image/png;base64,AA== 1x">
      <img src="data:image/png;base64,AA==">
      <video poster="https://evil.example/p.jpg"></video>
      <div style="background-image: url('https://evil.example/c.png')"></div>
      <iframe src="https://evil.example/frame"></iframe>
      <object data="https://evil.example/o.swf"></object>
      <embed src="https://evil.example/e.swf">
      <div data="kept">kept</div>
    </body></html>`);
    expect(prepared.libraries).toEqual(["tailwind"]);
    expect(prepared.removed).toEqual(
      expect.arrayContaining([
        "https://evil.example/track.js",
        "https://fonts.googleapis.com/css2?family=Inter",
        "https://evil.example/a.css",
        "//evil.example/b.png",
        "https://evil.example/x.png",
        "https://evil.example/2x.png",
        "https://evil.example/p.jpg",
        "https://evil.example/c.png",
        "https://evil.example/frame",
        "https://evil.example/o.swf",
        "https://evil.example/e.swf",
        "https://evil.example/",
      ]),
    );
    expect(prepared.removed).not.toContain("https://cdn.jsdelivr.net/npm/d3@7");
    const { document } = prepared;
    expect(document.querySelectorAll("script, base, meta[http-equiv], iframe, object, embed")).toHaveLength(0);
    expect(document.querySelectorAll("link")).toHaveLength(1);
    expect(document.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(document.querySelector("img")?.hasAttribute("srcset")).toBe(false);
    expect(document.querySelectorAll("img")[1].getAttribute("src")).toBe("data:image/png;base64,AA==");
    expect(document.querySelector("div[data]")?.getAttribute("data")).toBe("kept");
    expect(prepared.scripts).toBe(true);
  });

  it("marks Babel scripts and inline scripts as needing to run", () => {
    const babel = prepareHtml('<div id="root"></div><script type="text/babel">ReactDOM.render(<p/>, root)</script>');
    expect(babel.libraries).toEqual(["babel"]);
    expect(babel.scripts).toBe(true);
    expect(prepareHtml("<script>1</script>").scripts).toBe(true);
    expect(prepareHtml("<p>static</p><style>p{color:red}</style>").scripts).toBe(false);
  });

  it("detects handlers, javascript links and script types", () => {
    const check = (html: string) => runsScripts(new DOMParser().parseFromString(html, "text/html"));
    expect(check('<button onclick="go()">Go</button>')).toBe(true);
    expect(check('<a href=" javascript:go()">Go</a>')).toBe(true);
    expect(check('<script type="module">1</script>')).toBe(true);
    expect(check('<script type="application/json">{}</script>')).toBe(false);
    expect(check("<p>Nothing</p>")).toBe(false);
  });

  it.each([
    "application/x-javascript",
    "text/x-javascript",
    "text/jscript",
    "text/livescript",
    "text/javascript1.0",
    "text/javascript1.1",
    "text/javascript1.2",
    "text/javascript1.3",
    "text/javascript1.4",
    "text/javascript1.5",
    "application/x-ecmascript",
    "text/x-ecmascript",
    "text/javascript; charset=utf-8",
    " TEXT/JAVASCRIPT ",
    "text/x-unknown-runner",
  ])("counts a script of type %j as scripted, in HTML and in SVG", (type) => {
    const html = `<script type="${type}">go()</script>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script type="${type}">go()</script></svg>`;
    expect(prepareHtml(html).scripts).toBe(true);
    expect(prepareHtml(svg).scripts).toBe(true);
  });

  it("counts a script with only a language attribute as scripted", () => {
    expect(prepareHtml('<script language="javascript">go()</script>').scripts).toBe(true);
  });

  it.each(["application/json", "application/ld+json", "importmap", "text/plain", "text/template", "text/x-template", "APPLICATION/JSON; charset=utf-8"])(
    "leaves a data script of type %j alone",
    (type) => {
      expect(prepareHtml(`<script type="${type}">{}</script><p>x</p>`).scripts).toBe(false);
    },
  );

  it.each([
    ['<a href="\u0001 javascript:go()">Go</a>'],
    ['<a href="java\tscript:go()">Go</a>'],
    ['<a href="java\nscr\ripT:go()">Go</a>'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="#x;javascript:go()"/></a></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="href" to="JavaScript:go()"/></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg" onload="go()"></svg>'],
  ])("counts %j as scripted", (html) => {
    expect(prepareHtml(html).scripts).toBe(true);
  });

  it.each([
    ["<math><mtext><table><mglyph><style><img src=x onerror=go()>"],
    ["<form><math><mtext></form><form><mglyph><style></math><img src onerror=go()>"],
  ])("counts markup that only runs once the frame parses it again: %j", (html) => {
    expect(prepareHtml(html).scripts).toBe(true);
  });

  it("drops noscript, which a frame with scripts parses differently", () => {
    const prepared = prepareHtml('<p>x</p><noscript><p title="</noscript><script>go()</script>"></p></noscript>');
    expect(prepared.document.querySelector("noscript")).toBeNull();
    expect(htmlFrameDocument(prepared, OPTIONS, null)).not.toMatch(/<noscript/iu);
  });

  it("keeps templates inert so they cannot attach shadow roots", () => {
    const prepared = prepareHtml(
      '<div><template shadowrootmode="open" shadowrootclonable><iframe srcdoc="x"></iframe></template><template shadowroot="closed"><p>x</p></template></div>',
    );
    for (const template of prepared.document.querySelectorAll("template")) {
      expect(template.getAttributeNames().filter((name) => name.startsWith("shadowroot"))).toEqual([]);
    }
  });

  it("leaves text that only mentions javascript alone", () => {
    expect(prepareHtml('<p title="a javascript-free page">javascript: is plain text here</p>').scripts).toBe(false);
  });
});

describe("cssUrlTargets", () => {
  it.each([
    ['@import url("https://a.example/x.css");', ["https://a.example/x.css"]],
    ["@import 'b.css' screen;", ["b.css"]],
    ["@IMPORT URL( //c.example/y.css )", ["//c.example/y.css"]],
    ['@import url("")', ["url("]],
    ["@importurl(//d.example/z.png)", ["//d.example/z.png"]],
    ["a { background: url( 'https://e.example/p.png' ) } b { background: url(local.png) }", ["https://e.example/p.png"]],
    ["c { background: url(HTTP://f.example/a;b.png) }", ["HTTP://f.example/a;b.png"]],
    ["@import\t\n  ;", []],
    ["", []],
  ])("reads %j", (text, urls) => {
    expect(cssUrlTargets(text)).toEqual(urls);
  });

  it("stays fast on long runs of spaces", () => {
    const started = performance.now();
    expect(cssUrlTargets(`@import${" ".repeat(100_000)}"`)).toEqual([]);
    expect(cssUrlTargets(`url(${" ".repeat(100_000)}'`)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("frame documents", () => {
  it("escapes JSON so it cannot close the script element", () => {
    const text = inlineJson("</script><script>alert(1)</script>\u2028\u2029");
    expect(text).not.toContain("<");
    expect(text).toContain(String.raw`\u2028`);
    expect(JSON.parse(text)).toBe("</script><script>alert(1)</script>\u2028\u2029");
  });

  it("loads the runtime only from the app's runtime address", () => {
    expect(runtimeScript(RUNTIME)).toBe(RUNTIME_TAG);
    expect(runtimeScript(WINDOWS_RUNTIME)).toBe(`<script src="${WINDOWS_RUNTIME}"></script>`);
    for (const url of [
      `${RUNTIME}"></script><script>alert(1)`,
      `oleafly-artifact://localhost/runtime/${HASH.toUpperCase()}.js`,
      `oleafly-artifact://localhost/runtime/${HASH.slice(1)}.js`,
      `oleafly-artifact://localhost/${HASH}.js`,
      `https://oleafly-artifact.localhost/runtime/${HASH}.js`,
      `oleafly-artifact://evil/runtime/${HASH}.js`,
      `${RUNTIME}; script-src *`,
      `${RUNTIME}?x`,
      "/artifact-runtime/react-runtime.js",
      "",
    ]) {
      expect(() => runtimeScript(url)).toThrow(TypeError);
      expect(() => framePolicy(url)).toThrow(TypeError);
    }
  });

  it("puts the policy, prelude and runtime before the page's own head", () => {
    const prepared = prepareHtml(
      '<html lang="fr" data-x="1"><head><title>Doc</title><script src="https://d3js.org/d3.v7.min.js"></script></head><body class="b"><p>Hi</p></body></html>',
    );
    const html = htmlFrameDocument(prepared, { ...OPTIONS, theme: "dark" }, RUNTIME);
    expect(html.startsWith("<!doctype html><html")).toBe(true);
    expect(html).toContain('lang="fr"');
    expect(html).toContain('class="dark"');
    expect(metaPolicy(html)).toBe(framePolicy(RUNTIME));
    const policy = html.indexOf("Content-Security-Policy");
    const prelude = html.indexOf('"use strict"');
    const runtime = html.indexOf(RUNTIME_TAG);
    const expose = html.indexOf('__oleaflyArtifact.expose(["d3"])');
    const title = html.indexOf("<title>Doc</title>");
    expect(policy).toBeGreaterThan(0);
    expect(policy).toBeLessThan(prelude);
    expect(prelude).toBeLessThan(runtime);
    expect(runtime).toBeLessThan(expose);
    expect(expose).toBeLessThan(title);
    expect(html).toContain('<body class="b"><p>Hi</p></body></html>');
    expect(html).toContain("connect-src &#39;none&#39;".replaceAll("&#39;", "'"));
    expect(html).not.toContain("runScripts");
  });

  it("runs Babel scripts after the page loads and skips the runtime when no library is used", () => {
    const babel = htmlFrameDocument(prepareHtml('<script type="text/babel">x</script>'), OPTIONS, RUNTIME);
    expect(babel).toContain("__oleaflyArtifact.runScripts(");
    expect(babel).toContain('lang="en"');
    expect(babel).toContain(RUNTIME_TAG);
    const plain = htmlFrameDocument(prepareHtml("<p>plain</p>"), OPTIONS, null);
    expect(plain).not.toContain("__oleaflyArtifact");
    expect(plain).not.toContain("/runtime/");
    expect(metaPolicy(plain)).toBe(FRAME_POLICY);
    const unused = htmlFrameDocument(prepareHtml("<p>no library</p>"), OPTIONS, RUNTIME);
    expect(unused).not.toContain("/runtime/");
    expect(metaPolicy(unused)).toBe(FRAME_POLICY);
    const noRuntime = htmlFrameDocument(prepareHtml('<script src="https://d3js.org/d3.v7.min.js"></script>'), OPTIONS, null);
    expect(noRuntime).not.toContain("__oleaflyArtifact");
  });

  it("says the block couldn't load when the runtime script never ran, and runs it when it did", async () => {
    const documents = [
      reactFrameDocument("export default () => null", OPTIONS, RUNTIME),
      htmlFrameDocument(prepareHtml('<script src="https://d3js.org/d3.v7.min.js"></script><p>x</p>'), OPTIONS, RUNTIME),
    ];
    const settle = (dom: JSDOM) =>
      new Promise<void>((done) => {
        if (dom.window.document.readyState === "complete") done();
        else dom.window.addEventListener("load", () => done());
      });
    for (const html of documents) {
      const missing = runningDom(html);
      await settle(missing);
      const alerts = missing.window.document.querySelectorAll('[role="alert"]');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].textContent).toBe(MESSAGES.loadFailed);
      missing.window.close();
      const runtime = { expose: vi.fn(), runReact: vi.fn(), runScripts: vi.fn() };
      const loaded = runningDom(html, runtime);
      await settle(loaded);
      expect(loaded.window.document.querySelector('[role="alert"]')).toBeNull();
      expect(runtime.expose.mock.calls.length + runtime.runReact.mock.calls.length).toBe(1);
      loaded.window.close();
    }
  });

  it("drops a page's own copy of the runtime address so only the app adds it", () => {
    const prepared = prepareHtml(`<script src="${RUNTIME}"></script><p>x</p>`);
    expect(prepared.libraries).toEqual([]);
    expect(prepared.removed).toEqual([RUNTIME]);
    expect(htmlFrameDocument(prepared, OPTIONS, null)).not.toContain("/runtime/");
  });

  it("builds a React document that passes the code and messages as data", () => {
    const html = reactFrameDocument('export default () => "</script>"', { ...OPTIONS, theme: "dark" }, RUNTIME);
    expect(html).toContain('class="dark"');
    expect(html).toContain(RUNTIME_TAG);
    expect(metaPolicy(html)).toBe(framePolicy(RUNTIME));
    expect(html.indexOf(RUNTIME_TAG)).toBeLessThan(html.indexOf("__oleaflyArtifact.runReact"));
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain(`__oleaflyArtifact.runReact(${inlineJson('export default () => "</script>"')}, ${inlineJson(MESSAGES)});`);
    expect(html.match(/<\/script>/gu)).toHaveLength(3);
    expect(reactFrameDocument("x", OPTIONS, RUNTIME)).not.toContain('class="dark"');
    expect(() => reactFrameDocument("x", OPTIONS, "RT")).toThrow(TypeError);
  });

  it("wraps static previews in a script-free policy", () => {
    const html = staticFrameDocument("<p>Hi</p>", "dark");
    expect(html).toContain(STATIC_POLICY);
    expect(STATIC_POLICY).not.toContain("script-src");
    expect(STATIC_POLICY).toContain("default-src 'none'");
    expect(html).toContain("color-scheme:dark");
    expect(html).toContain("<body><p>Hi</p></body>");
  });

  it("keeps the frame policy locked down", () => {
    for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-src 'none'"]) {
      expect(FRAME_POLICY).toContain(directive);
    }
    expect(FRAME_POLICY).not.toMatch(/https?:|\*/u);
    expect(FRAME_POLICY).toContain("script-src 'unsafe-inline' 'unsafe-eval';");
    for (const url of [RUNTIME, WINDOWS_RUNTIME]) {
      expect(framePolicy(url)).toBe(FRAME_POLICY.replace("'unsafe-eval';", `'unsafe-eval' ${url};`));
    }
  });
});

describe("frame messages", () => {
  it("recognises a port offer on the channel only", () => {
    expect(isPortOffer({ channel: "a", type: "port" }, "a")).toBe(true);
    for (const data of [null, "port", { channel: "b", type: "port" }, { channel: "a", type: "beat" }]) {
      expect(isPortOffer(data, "a")).toBe(false);
    }
  });

  it("accepts only well-formed heartbeat and size messages on the channel", () => {
    expect(readFrameMessage({ channel: "a", type: "beat" }, "a")).toEqual({ type: "beat" });
    expect(readFrameMessage({ channel: "a", type: "size", height: 120 }, "a")).toEqual({ type: "size", height: 120 });
    for (const data of [
      null,
      "beat",
      { channel: "b", type: "beat" },
      { channel: "a", type: "size", height: Number.NaN },
      { channel: "a", type: "size", height: -1 },
      { channel: "a", type: "size", height: "10" },
      { channel: "a", type: "theme" },
    ]) {
      expect(readFrameMessage(data, "a")).toBeNull();
    }
  });

  it("makes a fresh random channel each time", () => {
    const first = frameChannel();
    expect(first).toMatch(/^[0-9a-f]{24}$/u);
    expect(frameChannel()).not.toBe(first);
  });
});
