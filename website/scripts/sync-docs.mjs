// Sync the repo's authored docs (../docs/*.md) into Starlight's content
// collection. The docs stay the single source of truth in the main tree; this
// derives site pages from them by adding frontmatter (title + description) and
// rewriting cross-doc links to site routes. Run automatically before dev/build.
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(here, "..", "..", "docs");
const OUT_DIR = join(here, "..", "src", "content", "docs");
const BASE = "/OpenLeaf";
const REPO = "https://github.com/prajwal-svm/OpenLeaf";

// Product-facing docs only. Contributor/maintainer docs (development, releasing,
// auto-update internals) live in the repo but are intentionally kept off the
// user-facing site. Order here has no effect; the sidebar (astro.config) does.
const USER_DOCS = new Set([
  "getting-started",
  "install",
  "features",
  "ai-assistant",
  "github-sync",
  "keyboard-shortcuts",
  "faq",
]);

/** Turn a doc link into a site route (if it's a published page) or a GitHub link (if not). */
function rewriteLink(url) {
  // Leave external links, images, mail, absolute paths, and in-page anchors alone.
  if (/^(https?:|mailto:|#|\/)/.test(url)) return url;
  // Links to the repo README map to the README on GitHub.
  const readme = url.match(/^\.\.\/README\.md(#.*)?$/);
  if (readme) return `${REPO}/blob/main/README.md${readme[1] ?? ""}`;
  // Sibling doc: `name.md` (optionally `./`), optionally with an #anchor.
  const doc = url.match(/^\.?\/?([\w-]+)\.md(#.*)?$/);
  if (doc) {
    const [, name, hash = ""] = doc;
    // Published page -> clean site route; contributor doc -> its GitHub source.
    return USER_DOCS.has(name) ? `${BASE}/${name}/${hash}` : `${REPO}/blob/main/docs/${name}.md${hash}`;
  }
  return url;
}

function transform(src) {
  const lines = src.split("\n");
  // First `# Heading` becomes the frontmatter title and is dropped from the body.
  let title = "OpenLeaf";
  const h1 = lines.findIndex((l) => /^#\s+/.test(l));
  if (h1 !== -1) {
    title = lines[h1].replace(/^#\s+/, "").trim();
    lines.splice(h1, 1);
  }
  let body = lines.join("\n");

  // First real paragraph becomes the meta description (plain text, capped).
  const para = body
    .split("\n\n")
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith("```"));
  const description = (para ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links -> text
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  // Rewrite markdown links [text](url).
  body = body.replace(/\]\(([^)]+)\)/g, (_m, url) => `](${rewriteLink(url)})`);

  const fm = `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n`;
  return fm + body.replace(/^\n+/, "");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  // Clear previously generated pages (all .md; the hand-authored index.mdx is
  // kept) so dropped docs don't linger as stale routes.
  for (const f of await readdir(OUT_DIR)) {
    if (f.endsWith(".md")) await rm(join(OUT_DIR, f));
  }
  const entries = (await readdir(DOCS_DIR)).filter(
    (f) => f.endsWith(".md") && USER_DOCS.has(basename(f, ".md")),
  );
  for (const file of entries) {
    const src = await readFile(join(DOCS_DIR, file), "utf8");
    await writeFile(join(OUT_DIR, basename(file)), transform(src), "utf8");
  }
  console.log(`sync-docs: wrote ${entries.length} product pages to src/content/docs/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
