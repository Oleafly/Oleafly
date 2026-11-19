(() => {
  const X_ORIGIN = "https://platform.twitter.com";
  const youtubeSource = (id, start) => {
    if (!/^[A-Za-z0-9_-]{11}$/u.test(id)) return null;
    const startParam = start === null ? "" : `&start=${start}`;
    return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1${startParam}`;
  };
  const vimeoSource = (id, hash) => {
    if (!/^\d{1,20}$/u.test(id)) return null;
    const hashParam = hash === null ? "" : `&h=${hash}`;
    return `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1${hashParam}`;
  };
  const xSource = (id, theme) => {
    if (!/^\d{1,20}$/u.test(id)) return null;
    const themeParam = theme === null ? "" : `&theme=${theme}`;
    return `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true${themeParam}`;
  };
  const xEmbedCall = (data) => {
    let message = data;
    if (typeof message === "string") {
      try {
        message = JSON.parse(message);
      } catch {
        return null;
      }
    }
    const call = message !== null && typeof message === "object" ? message["twttr.embed"] : null;
    return call !== null && typeof call === "object" && typeof call.method === "string" ? call : null;
  };
  const xReport = (call) => {
    if (call.method === "twttr.private.no_results") return { source: "oleafly-x-post", missing: true };
    if (call.method !== "twttr.private.resize" || !Array.isArray(call.params)) return null;
    const height = call.params[0]?.height;
    if (typeof height !== "number" || !Number.isFinite(height) || height <= 0 || height > 20000) return null;
    return { source: "oleafly-x-post", height: Math.ceil(height) };
  };
  const match = /^#(youtube|vimeo|x)\/([^?&]*)(?:[?&](.*))?$/u.exec(location.hash);
  if (!match) return;
  const [, provider, id, query = ""] = match;
  const params = new URLSearchParams(query);
  const start = params.get("start");
  const hash = params.get("h");
  const theme = params.get("theme");
  if (start !== null && !/^\d{1,9}$/u.test(start)) return;
  if (hash !== null && !/^[0-9a-f]{1,64}$/u.test(hash)) return;
  if (theme !== null && theme !== "light" && theme !== "dark") return;
  let src = null;
  let title = "X";
  if (provider === "youtube") {
    src = youtubeSource(id, start);
    title = "YouTube";
  } else if (provider === "vimeo") {
    src = vimeoSource(id, hash);
    title = "Vimeo";
  } else if (provider === "x") {
    src = xSource(id, theme);
  }
  if (src === null) return;
  const background = provider === "x" ? "transparent" : "#000";
  Object.assign(document.documentElement.style, { height: "100%", background, colorScheme: theme ?? "normal" });
  Object.assign(document.body.style, { margin: "0", height: "100%", overflow: "hidden" });
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("scrolling", "no");
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  Object.assign(frame.style, { display: "block", width: "100%", height: "100%", border: "0" });
  if (provider === "x") {
    frame.style.colorScheme = "normal";
    window.addEventListener("message", (event) => {
      if (event.origin !== X_ORIGIN || event.source !== frame.contentWindow) return;
      const call = xEmbedCall(event.data);
      const report = call === null ? null : xReport(call);
      if (report !== null) window.parent.postMessage(report, "*");
    });
  }
  frame.src = src;
  document.body.append(frame);
})();
