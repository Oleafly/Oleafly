(() => {
  if (window.parent === window) return;
  const appOrigin = "__OLEAFLY_APP_ORIGIN__";
  const sameFrameTargets = new Set(["", "_self"]);
  const look = document.createElement("style");
  look.textContent = [
    ":focus, :focus-visible { outline: none !important; }",
    ".btn:focus-visible, .code-copy-button:focus, .code-copy-button:focus-visible { box-shadow: none !important; }",
    ".code-copy-button:focus-visible { background-color: rgb(127 127 127 / 0.2) !important; }",
    "html[data-oleafly-inverted] :is(img, video, canvas, iframe, object, embed, svg image) { filter: invert(1) hue-rotate(180deg); }",
  ].join("\n");
  (document.head ?? document.documentElement).append(look);
  addEventListener("message", (event) => {
    if (event.source !== parent || event.origin !== appOrigin) return;
    const message = event.data;
    if (!message || message.type !== "oleafly-preview-appearance") return;
    document.documentElement.toggleAttribute("data-oleafly-inverted", message.inverted === true);
  });
  parent.postMessage({ type: "oleafly-preview-ready" }, appOrigin);
  const reportLook = () => {
    const colour = [document.body, document.documentElement]
      .filter(Boolean)
      .map((element) => getComputedStyle(element).backgroundColor)
      .find((value) => !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(value));
    const channels = (colour?.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const dark =
      channels.length === 3 && 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] < 128;
    parent.postMessage({ type: "oleafly-preview-look", dark }, appOrigin);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", reportLook, { once: true });
  else reportLook();
  addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const link = event.target instanceof Element ? event.target.closest("a[href], area[href]") : null;
    if (!link || link.hasAttribute("download")) return;
    let url;
    try {
      url = new URL(link.getAttribute("href") ?? "", document.baseURI);
    } catch {
      return;
    }
    if (url.origin === location.origin) {
      if (sameFrameTargets.has((link.getAttribute("target") ?? "").trim().toLowerCase())) return;
      event.preventDefault();
      location.assign(url.href);
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    event.preventDefault();
    parent.postMessage({ type: "oleafly-preview-open-link", url: url.href }, appOrigin);
  });
})();
