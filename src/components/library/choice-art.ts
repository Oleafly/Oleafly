/**
 * The starting-point illustrations under public/project-kind/, used by the
 * project kind chooser, the empty library's welcome cards and the import
 * dialog. Each is a 720x406 WebP of 5 to 15 KB bundled with the app.
 */
export const CHOICE_ART = {
  research: "/project-kind/research-project-light.webp",
  import: "/project-kind/import-project-light.webp",
  template: "/project-kind/use-template-light.webp",
  newProject: "/project-kind/new-project-light.webp",
  openFolder: "/project-kind/open-folder-light.webp",
  importArchive: "/project-kind/import-archive-light.webp",
  importWord: "/project-kind/import-word-light.webp",
  importMarkdown: "/project-kind/import-markdown-light.webp",
  importHtml: "/project-kind/import-html-light.webp",
  importTypst: "/project-kind/import-typst-light.webp",
  importArxiv: "/project-kind/import-arxiv-light.webp",
  importGithub: "/project-kind/import-github-light.webp",
} as const;

let warmed = false;

/**
 * Reads and decodes every illustration once, while the app is idle, so a
 * chooser opens with its pictures already drawn instead of filling them in
 * after the dialog appears. The images are not kept: the webview's cache
 * holds the files, and decoding one again takes a couple of milliseconds.
 */
export function warmChoiceArt(): void {
  if (warmed || typeof Image === "undefined") return;
  warmed = true;
  const load = () => {
    for (const src of Object.values(CHOICE_ART)) {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      image.decode?.().catch(() => {});
    }
  };
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(load, { timeout: 3000 });
  } else {
    globalThis.setTimeout(load, 1000);
  }
}
