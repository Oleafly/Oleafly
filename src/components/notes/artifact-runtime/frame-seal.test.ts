// @vitest-environment node
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { FRAME_TAGS, frameSealScript, NETWORK_GLOBALS, TAURI_GLOBALS } from "./frame-seal";

type FrameWindow = JSDOM["window"] & Record<string, unknown>;

const SCRIPTED = { runScripts: "outside-only" } as unknown as ConstructorParameters<typeof JSDOM>[1];

function frame(body = "<p>x</p>"): FrameWindow {
  return new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, SCRIPTED).window as FrameWindow;
}

const TAURI = `
Object.defineProperty(window, "isTauri", { value: true });
Object.defineProperty(window, "__TAURI_INTERNALS__", { value: { plugins: {} } });
Object.defineProperty(window.__TAURI_INTERNALS__, "postMessage", { value: (message) => window.ipc.postMessage(JSON.stringify(message)) });
Object.defineProperty(window.__TAURI_INTERNALS__, "ipc", { value: (message) => window.__TAURI_INTERNALS__.postMessage(message) });
Object.defineProperty(window.__TAURI_INTERNALS__, "invoke", { value: (cmd) => window.__TAURI_INTERNALS__.ipc({ cmd }) });
Object.defineProperty(window, "ipc", { value: Object.freeze({ postMessage: (s) => window.chrome.webview.postMessage(s) }) });
`;

function reached(window: FrameWindow, call: string): boolean {
  const before = (window.hostCalls as string[]).length;
  try {
    window.eval(call);
  } catch {
    return (window.hostCalls as string[]).length > before;
  }
  return (window.hostCalls as string[]).length > before;
}

function tauriFrame(chrome: string): FrameWindow {
  const window = frame();
  window.hostCalls = [];
  window.eval(`const record = (s) => { hostCalls.push(String(s)); return "sent"; };\n${chrome}\n${TAURI}`);
  return window;
}

describe("the Tauri bridge in a frame", () => {
  it.each([
    ["a plain chrome object", "window.chrome = { webview: { postMessage: record } };"],
    [
      "a non-configurable but writable chrome",
      'Object.defineProperty(window, "chrome", { value: { webview: { postMessage: record } }, writable: true, enumerable: true, configurable: false });',
    ],
    [
      "a fixed chrome with a removable webview",
      'Object.defineProperty(window, "chrome", { value: { webview: { postMessage: record } }, writable: false, configurable: false });',
    ],
    [
      "a fixed chrome and webview whose postMessage is inherited",
      'const webview = Object.create({ postMessage: record }); Object.defineProperty(window, "chrome", { value: Object.freeze({ webview }), writable: false, configurable: false });',
    ],
  ])("can't reach the host through %s", (_label, chrome) => {
    const window = tauriFrame(chrome);
    expect(reached(window, "window.ipc.postMessage('x')")).toBe(true);
    const sealed = tauriFrame(chrome);
    sealed.eval(frameSealScript());
    expect(sealed.eval("typeof window.__TAURI_INTERNALS__")).toBe("object");
    expect(sealed.eval("typeof window.ipc")).toBe("object");
    expect(reached(sealed, "window.__TAURI_INTERNALS__.invoke('read_file')")).toBe(false);
    expect(reached(sealed, "window.__TAURI_INTERNALS__.postMessage({ cmd: 'read_file' })")).toBe(false);
    expect(reached(sealed, "window.ipc.postMessage('x')")).toBe(false);
    expect(sealed.hostCalls).toEqual([]);
  });

  it("still reaches a bridge that is frozen all the way down", () => {
    const window = tauriFrame(
      'Object.defineProperty(window, "chrome", { value: Object.freeze({ webview: Object.freeze({ postMessage: record }) }), writable: false, configurable: false });',
    );
    window.eval(frameSealScript());
    expect(reached(window, "window.ipc.postMessage('x')")).toBe(true);
  });

  it("removes globals it can redefine and the WebKit message handlers", () => {
    const window = frame();
    window.hostCalls = [];
    window.eval(
      'const record = (s) => hostCalls.push(s); window.__TAURI__ = { core: {} }; window.webkit = { messageHandlers: { ipc: { postMessage: record } } }; window.RTCPeerConnection = class {};',
    );
    window.eval(frameSealScript());
    expect(window.eval("typeof __TAURI__")).toBe("undefined");
    expect(window.eval("typeof webkit")).toBe("undefined");
    expect(window.eval("typeof RTCPeerConnection")).toBe("undefined");
    expect(window.eval("typeof WebSocket")).toBe("undefined");
    window.eval("window.RTCPeerConnection = function () {}");
    expect(window.eval("typeof RTCPeerConnection")).toBe("undefined");
    expect(window.eval("navigator.sendBeacon('x')")).toBe(false);
  });

  it("shadows the bridge methods of a webkit object it cannot remove", () => {
    const window = frame();
    window.hostCalls = [];
    window.eval(
      'const handlers = { ipc: { postMessage: (s) => hostCalls.push(s) } }; Object.defineProperty(window, "webkit", { value: { messageHandlers: handlers }, writable: false, configurable: false }); Object.defineProperty(window.webkit, "messageHandlers", { value: handlers, writable: false, configurable: false });',
    );
    window.eval(frameSealScript());
    expect(reached(window, "window.webkit.messageHandlers.ipc.postMessage('x')")).toBe(false);
    expect(() => window.eval("window.webkit.messageHandlers.ipc('x')")).toThrow(/not available/u);
    expect(window.hostCalls).toEqual([]);
  });

  it("lists every global it seals", () => {
    expect(TAURI_GLOBALS).toContain("__TAURI_INTERNALS__");
    expect(TAURI_GLOBALS).toContain("ipc");
    expect(NETWORK_GLOBALS).toContain("RTCPeerConnection");
  });
});

describe("leaving the frame's document", () => {
  function clicked(window: FrameWindow, selector: string, init: MouseEventInit = {}): boolean {
    const target = window.document.querySelector(selector) as Element;
    return !target.dispatchEvent(new window.MouseEvent(init.button === 1 ? "auxclick" : "click", { bubbles: true, cancelable: true, composed: true, ...init }));
  }

  const LINKS =
    '<a id="away" href="https://evil.example/c?d=1"><span id="inner">go</span></a><a id="jump" href="#part">part</a><map><area id="spot" href="http://192.168.1.1/"></map><svg><a id="vector" href="https://evil.example/"><text id="label">x</text></a></svg><div id="host"></div>';

  it.each([
    ["a link", "#away"],
    ["text inside a link", "#inner"],
    ["an image map area", "#spot"],
    ["an SVG link", "#label"],
  ])("cancels a click on %s that would load another page", (_label, selector) => {
    const window = frame(LINKS);
    window.eval(frameSealScript());
    expect(clicked(window, selector)).toBe(true);
    expect(clicked(window, selector, { button: 1 })).toBe(true);
  });

  it("keeps in-page links working", () => {
    const window = frame(LINKS);
    window.eval(frameSealScript());
    expect(clicked(window, "#jump")).toBe(false);
  });

  it("cancels a link inside a shadow root and one whose page tries to undo the guard", () => {
    const window = frame(LINKS);
    window.eval(frameSealScript());
    window.eval(`
      const root = document.getElementById("host").attachShadow({ mode: "closed" });
      root.innerHTML = '<a id="hidden" href="https://evil.example/">x</a>';
      window.shadowLink = root.getElementById("hidden");
      window.awayLink = document.getElementById("away");
      Object.setPrototypeOf(window.awayLink, HTMLElement.prototype);
      Event.prototype.composedPath = () => [];
      Event.prototype.preventDefault = () => {};
      Element.prototype.getAttribute = () => "#safe";
      RegExp.prototype.test = () => true;
      Reflect.apply = () => null;
    `);
    for (const link of [window.shadowLink, window.awayLink] as Element[]) {
      expect(link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, composed: true }))).toBe(false);
    }
  });

  it("takes away window.open and history steps", () => {
    const window = frame();
    window.eval(frameSealScript());
    expect(window.eval("typeof window.open")).toBe("undefined");
    for (const step of ["history.back()", "history.forward()", "history.go(-1)"]) {
      expect(() => window.eval(step)).toThrow(/not available/u);
    }
  });
});

describe("child frames", () => {
  it("never connects a frame and hides child windows from the element", () => {
    const window = frame();
    window.eval(frameSealScript());
    const iframe = window.document.createElement("iframe");
    expect(iframe.contentWindow).toBeNull();
    expect(iframe.contentDocument).toBeNull();
    expect(window.document.body.appendChild(iframe)).toBeNull();
    expect(window.document.body.insertBefore(window.document.createElement("frame"), null)).toBeNull();
    const fragment = window.document.createDocumentFragment();
    fragment.append(window.document.createElement("iframe"), window.document.createElement("span"));
    window.document.body.append(fragment, window.document.createElement("iframe"), "text");
    const wrapper = window.document.createElement("div");
    wrapper.innerHTML = "<p>inside</p>";
    wrapper.append(window.document.createElement("iframe"));
    window.document.body.prepend(wrapper);
    window.document.body.firstChild?.after(window.document.createElement("iframe"));
    window.document.body.insertAdjacentElement("beforeend", window.document.createElement("iframe"));
    window.document.createRange().insertNode(window.document.createElement("iframe"));
    expect(window.document.querySelector("iframe, frame")).toBeNull();
    expect(window.document.querySelector("span")).not.toBeNull();
    expect(window.document.querySelector("p")?.textContent).toBe("inside");
    expect(window).toHaveLength(0);
    expect(window.eval("frames.length")).toBe(0);
    expect(window.eval("frames[0]")).toBeUndefined();
    expect(window.eval("document.createElement('embed').getSVGDocument()")).toBeNull();
  });

  it("turns frame tags in markup into text", () => {
    const window = frame();
    window.eval(frameSealScript());
    const body = window.document.body;
    body.innerHTML = '<p>a</p><iframe onload="go()"></iframe><IFRAME/><object data="x"></object><embed><frameset><b>kept</b>';
    expect(body.querySelector("iframe, object, embed, frameset")).toBeNull();
    expect(body.querySelector("b")?.textContent).toBe("kept");
    expect(body.textContent).toContain('<iframe onload="go()">');
    body.insertAdjacentHTML("beforeend", "<iframe srcdoc='<script>go()</script>'></iframe><i>x</i>");
    expect(body.querySelector("iframe")).toBeNull();
    expect(body.querySelector("i")).not.toBeNull();
    const bold = body.querySelector("b") as HTMLElement;
    bold.outerHTML = "<iframe></iframe><u>u</u>";
    expect(body.querySelector("iframe")).toBeNull();
    expect(body.querySelector("u")).not.toBeNull();
    body.append(window.document.createRange().createContextualFragment("<iframe></iframe><s>s</s>"));
    expect(body.querySelector("iframe")).toBeNull();
    expect(body.querySelector("s")).not.toBeNull();
    body.innerHTML = '<textarea><iframe></iframe></textarea><p title="<iframe>">t</p><embed-chart></embed-chart>';
    expect(body.querySelector("textarea")?.value).toBe("<iframe></iframe>");
    expect(body.querySelector("p")?.getAttribute("title")).toBe("<iframe>");
    expect(body.querySelector("embed-chart")).not.toBeNull();
    body.innerHTML = null as unknown as string;
    expect(body.innerHTML).toBe("");
  });

  it("keeps frames out of shadow roots", () => {
    const window = frame();
    window.eval(frameSealScript());
    const host = window.document.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = "<iframe></iframe><p>shadow</p>";
    expect(root.querySelector("iframe")).toBeNull();
    root.appendChild(window.document.createElement("iframe"));
    expect(root.querySelector("iframe")).toBeNull();
    window.document.body.append(host);
    expect(root.querySelector("p")?.textContent).toBe("shadow");
  });

  it("seals a child window it finds before removing the frame", () => {
    const window = frame('<iframe id="early"></iframe>');
    const child = window[0] as unknown as Record<string, unknown>;
    Object.defineProperty(child, "RTCPeerConnection", { value: class {}, configurable: true, writable: true });
    window.eval(frameSealScript());
    expect(child.RTCPeerConnection).toBeUndefined();
    expect(window.document.getElementById("early")).toBeNull();
  });

  it("removes a frame added by a path it does not wrap once mutations are delivered", async () => {
    const window = frame();
    const append = window.Node.prototype.appendChild;
    window.eval(frameSealScript());
    const iframe = window.document.createElement("iframe");
    append.call(window.document.body, iframe);
    expect(window.document.querySelector("iframe")).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.document.querySelector("iframe")).toBeNull();
  });

  it("breaks a frame tag split across document.write calls", () => {
    const window = frame();
    const written: string[] = [];
    window.Document.prototype.write = function write(text: string) {
      written.push(text);
    };
    window.Document.prototype.writeln = function writeln(text: string) {
      written.push(`${text}\n`);
    };
    window.eval(frameSealScript());
    window.document.write("<p>a</p><ifr");
    window.document.write("ame>", "<", "iframe>");
    window.document.writeln("<div");
    window.document.write("<");
    expect(written).toEqual(["<p>a</p><ifr ", "ame>&lt;iframe>", "<div\n", "< "]);
  });

  it("covers every frame-like element", () => {
    expect([...FRAME_TAGS].sort()).toEqual(["embed", "fencedframe", "frame", "frameset", "iframe", "object", "portal"]);
  });
});
