export const TAURI_GLOBALS: readonly string[] = [
  "__TAURI_INTERNALS__",
  "__TAURI__",
  "__TAURI_IPC__",
  "__TAURI_METADATA__",
  "__TAURI_POST_MESSAGE__",
  "__TAURI_EVENT_PLUGIN_INTERNALS__",
  "__TAURI_OS_PLUGIN_INTERNALS__",
  "ipc",
];

export const NETWORK_GLOBALS: readonly string[] = [
  "RTCPeerConnection",
  "webkitRTCPeerConnection",
  "mozRTCPeerConnection",
  "RTCDataChannel",
  "RTCSessionDescription",
  "RTCIceCandidate",
  "RTCRtpSender",
  "RTCRtpReceiver",
  "RTCRtpTransceiver",
  "RTCDtlsTransport",
  "RTCIceTransport",
  "RTCSctpTransport",
  "RTCCertificate",
  "RTCDTMFSender",
  "RTCTrackEvent",
  "RTCPeerConnectionIceEvent",
  "RTCDataChannelEvent",
  "RTCRtpScriptTransform",
  "WebTransport",
  "WebSocket",
  "EventSource",
];

export const BRIDGE_METHODS: readonly string[] = ["postMessage", "invoke", "ipc"];

export const FRAME_TAGS: readonly string[] = ["iframe", "frame", "frameset", "fencedframe", "portal", "object", "embed"];

const FRAME_ELEMENTS = ["HTMLIFrameElement", "HTMLFrameElement", "HTMLObjectElement", "HTMLEmbedElement"];

export function frameSealScript(): string {
  const tags = FRAME_TAGS.join("|");
  return String.raw`(() => {
"use strict";
const reach = (read) => { try { return read(); } catch (error) { return undefined; } };
const blocked = function () { throw new TypeError("This is not available in a note block."); };
const seal = (target, name) => {
  if (!target) return;
  try { delete target[name]; } catch (error) {}
  try { Object.defineProperty(target, name, { value: undefined, writable: false, configurable: false }); } catch (error) {}
};
const cut = (target, name) => {
  const value = reach(() => target[name]);
  seal(target, name);
  if (value === undefined || value === null || reach(() => target[name]) === undefined) return;
  for (const method of ${JSON.stringify(BRIDGE_METHODS)}) {
    try { Object.defineProperty(value, method, { value: blocked, writable: false, configurable: false }); } catch (error) {}
  }
};
const sealed = new WeakSet();
const sealWindow = (win) => {
  if (!win || reach(() => sealed.has(win)) !== false) return;
  sealed.add(win);
  for (const name of ${JSON.stringify([...TAURI_GLOBALS, ...NETWORK_GLOBALS, "open"])}) cut(win, name);
  for (const name of ["back", "forward", "go"]) reach(() => Object.defineProperty(win.History.prototype, name, { value: blocked, writable: false, configurable: false }));
  const chrome = reach(() => win.chrome);
  if (chrome) cut(chrome, "webview");
  seal(win, "chrome");
  const webkit = reach(() => win.webkit);
  if (webkit) cut(webkit, "messageHandlers");
  seal(win, "webkit");
  reach(() => seal(win.Navigator.prototype, "mediaDevices"));
  reach(() => seal(win.navigator, "mediaDevices"));
  reach(() => Object.defineProperty(win.navigator, "sendBeacon", { value: () => false, configurable: false }));
  for (const name of ${JSON.stringify(FRAME_ELEMENTS)}) {
    const proto = reach(() => win[name].prototype);
    if (!proto) continue;
    for (const key of ["contentWindow", "contentDocument"]) reach(() => Object.defineProperty(proto, key, { get: () => null, configurable: false }));
    reach(() => Object.defineProperty(proto, "getSVGDocument", { value: () => null, writable: false, configurable: false }));
  }
  reach(() => Object.defineProperty(win, "frames", { value: Object.freeze({ length: 0 }), writable: false, configurable: false }));
};
const FRAMES = ${JSON.stringify(FRAME_TAGS.join(", "))};
const FRAME_NAMES = ${JSON.stringify(FRAME_TAGS)};
const FRAME_TAG = /<(?=(?:${tags})(?:[\s/>]|$))/giu;
const roots = new Set();
const views = [];
for (const name of ${JSON.stringify(FRAME_ELEMENTS)}) {
  const proto = reach(() => window[name].prototype);
  const view = reach(() => Object.getOwnPropertyDescriptor(proto, "contentWindow").get);
  if (proto && typeof view === "function") views.push([proto, view]);
}
const viewOf = (element) => {
  for (const [proto, view] of views) if (reach(() => proto.isPrototypeOf(element))) return reach(() => view.call(element));
  return undefined;
};
const isFrame = (node) => reach(() => node.nodeType === 1 && node.matches(FRAMES)) === true;
const drop = (scope) => {
  for (const element of reach(() => Array.from(scope.querySelectorAll(FRAMES))) || []) {
    sealWindow(viewOf(element));
    reach(() => element.remove());
  }
};
const strip = (node) => { if (node && typeof node === "object" && typeof reach(() => node.querySelectorAll) === "function") drop(node); };
const sweep = () => {
  const count = reach(() => window.length) || 0;
  for (let index = 0; index < count; index += 1) sealWindow(reach(() => window[index]));
  if (count > 0) drop(document);
  for (const root of roots) drop(root);
};
const markup = (value) => (value === null || value === undefined ? value : String(value).replace(FRAME_TAG, "&lt;"));
const wrap = (owner, name, make) => {
  const descriptor = reach(() => Object.getOwnPropertyDescriptor(owner, name));
  if (!descriptor) return;
  const next = make(descriptor);
  if (next) reach(() => Object.defineProperty(owner, name, Object.assign({}, descriptor, next)));
};
const method = (owner, names, prepare) => {
  for (const name of names) wrap(owner, name, (descriptor) => {
    const run = descriptor.value;
    if (typeof run !== "function") return null;
    return { value: function (...args) {
      const ready = prepare(args);
      if (!ready) return null;
      try { return Reflect.apply(run, this, ready); } finally { sweep(); }
    } };
  });
};
const setter = (owner, name, prepare) => wrap(owner, name, (descriptor) => {
  const set = descriptor.set;
  if (typeof set !== "function") return null;
  return { set: function (value) {
    const ready = prepare([value]);
    if (!ready) return;
    try { Reflect.apply(set, this, ready); } finally { sweep(); }
  } };
});
const stripRoots = () => { for (const root of roots) drop(root); };
const first = (args) => { if (isFrame(args[0])) return null; strip(args[0]); stripRoots(); return args; };
const second = (args) => { if (isFrame(args[1])) return null; strip(args[1]); stripRoots(); return args; };
const each = (args) => { const kept = args.filter((arg) => !isFrame(arg)); kept.forEach(strip); stripRoots(); return kept; };
const at = (index) => (args) => { if (args.length > index) args[index] = markup(args[index]); return args; };
const insertHtml = (args) => { if (String(args[0]).toLowerCase() === "inserthtml" && args.length > 2) args[2] = markup(args[2]); return args; };
const written = (args) => {
  let text = markup(args.map(String).join(""));
  const open = /<([a-z]*)$/iu.exec(text);
  if (open && FRAME_NAMES.some((name) => name.startsWith(open[1].toLowerCase()))) text += " ";
  return [text];
};
const prototypes = (name) => reach(() => window[name].prototype);
method(prototypes("Node"), ["appendChild", "insertBefore", "replaceChild"], first);
for (const name of ["Element", "CharacterData", "DocumentType", "Document", "DocumentFragment"]) {
  method(prototypes(name), ["append", "prepend", "before", "after", "replaceWith", "replaceChildren"], each);
  method(prototypes(name), ["moveBefore"], first);
}
method(prototypes("Element"), ["insertAdjacentElement"], second);
method(prototypes("Element"), ["insertAdjacentHTML"], at(1));
method(prototypes("Element"), ["setHTMLUnsafe"], at(0));
method(prototypes("ShadowRoot"), ["setHTMLUnsafe"], at(0));
method(reach(() => window.Document), ["parseHTMLUnsafe"], at(0));
method(prototypes("Range"), ["insertNode", "surroundContents"], first);
method(prototypes("Range"), ["createContextualFragment"], at(0));
method(prototypes("Document"), ["execCommand"], insertHtml);
method(prototypes("Document"), ["write", "writeln"], written);
setter(prototypes("Element"), "innerHTML", at(0));
setter(prototypes("Element"), "outerHTML", at(0));
setter(prototypes("ShadowRoot"), "innerHTML", at(0));
setter(prototypes("Document"), "body", first);
const watch = (root) => reach(() => new MutationObserver(sweep).observe(root, { childList: true, subtree: true }));
const call = Reflect.apply;
const pathOf = reach(() => window.Event.prototype.composedPath);
const cancel = reach(() => window.Event.prototype.preventDefault);
const nameOf = reach(() => Object.getOwnPropertyDescriptor(window.Element.prototype, "localName").get);
const attribute = reach(() => window.Element.prototype.getAttribute);
const listen = reach(() => window.EventTarget.prototype.addEventListener);
const test = RegExp.prototype.test;
const text = String;
const IN_PAGE = /^\s*#/u;
const stay = (event) => {
  const path = reach(() => call(pathOf, event, [])) || [];
  for (let index = 0; index < path.length; index += 1) {
    const node = path[index];
    const name = reach(() => call(nameOf, node, []));
    if (name !== "a" && name !== "area") continue;
    const href = reach(() => call(attribute, node, ["href"]) ?? call(attribute, node, ["xlink:href"]));
    if (href === null || href === undefined) continue;
    if (!call(test, IN_PAGE, [text(href)])) reach(() => call(cancel, event, []));
    return;
  }
};
const guard = (target) => {
  for (const type of ["click", "auxclick"]) reach(() => call(listen, target, [type, stay, true]));
};
wrap(prototypes("Element"), "attachShadow", (descriptor) => {
  const attach = descriptor.value;
  if (typeof attach !== "function") return null;
  return { value: function (...args) {
    const root = Reflect.apply(attach, this, args);
    roots.add(root);
    watch(root);
    guard(root);
    return root;
  } };
});
guard(window);
sealWindow(window);
sweep();
watch(document);
})();`;
}
