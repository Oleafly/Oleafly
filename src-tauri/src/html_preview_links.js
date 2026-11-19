(() => {
  if (window.parent === window) return;
  const appOrigin = "__OLEAFLY_APP_ORIGIN__";
  const sameFrameTargets = new Set(["", "_self"]);
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
