(() => {
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
  const sources = { youtube: () => youtubeSource(id, start), vimeo: () => vimeoSource(id, hash), x: () => xSource(id, theme) };
  const src = sources[provider]();
  if (src === null) return;
  const titles = { youtube: "YouTube", vimeo: "Vimeo", x: "X" };
  const background = provider === "x" ? "transparent" : "#000";
  Object.assign(document.documentElement.style, { height: "100%", background });
  Object.assign(document.body.style, { margin: "0", height: "100%", overflow: "hidden" });
  const frame = document.createElement("iframe");
  frame.title = titles[provider];
  frame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  Object.assign(frame.style, { display: "block", width: "100%", height: "100%", border: "0" });
  frame.src = src;
  document.body.append(frame);
})();
