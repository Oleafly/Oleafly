// Sync engineering docs and shared media into the site before dev/build.
//
// Product docs are authored natively in src/content/docs/ and committed.
// Engineering docs stay in the repo root (docs/*.md, CONTRIBUTING.md) as the
// single source of truth next to the code; this script derives site pages from
// them under src/content/docs/engineering/ (generated, gitignored) by adding
// frontmatter and rewriting cross-doc links. It also copies the repo's shared
// media/ folder (used by the README too) into public/media/.
import { readdir, readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
const DOCS_DIR = join(ROOT, "docs");
const OUT_DIR = join(here, "..", "src", "content", "docs", "engineering");
const MEDIA_DIR = join(ROOT, "media");
const MEDIA_OUT = join(here, "..", "public", "media");
const BASE = "/Oleafly";
const REPO = "https://github.com/Oleafly/Oleafly";

// Engineering pages, synced from root docs/. CONTRIBUTING.md is added from the
// repo root separately. Everything else in docs/ (product markdown kept for
// GitHub readers, planning/) stays off the site.
const ENGINEERING_DOCS = new Set(["architecture", "development", "releasing", "updates"]);

// Product pages authored in src/content/docs/ that engineering docs may link to.
const PRODUCT_SLUGS = new Set([
  "overview",
  "philosophy",
  "why-oleafly",
  "getting-started",
  "install",
  "library",
  "templates",
  "files",
  "where-your-data-lives",
  "editor",
  "autocomplete",
  "code-intelligence",
  "spellcheck-grammar",
  "citations",
  "figures-diagrams",
  "keyboard-shortcuts",
  "compiling",
  "pdf-preview",
  "synctex",
  "latex-engines",
  "preflight",
  "export",
  "ai-setup",
  "ai-chat",
  "ai-inline-edit",
  "ai-figures",
  "git-history",
  "github-sync",
  "settings",
  "updates",
  "faq",
]);

/** Turn a doc link into a site route (engineering or product) or a GitHub link. */
function rewriteLink(url) {
  // Leave external links, mail, absolute paths, and in-page anchors alone.
  if (/^(https?:|mailto:|#|\/)/.test(url)) return url;
  // Links to the repo README map to the README on GitHub.
  const readme = url.match(/^\.\.\/README\.md(#.*)?$/);
  if (readme) return `${REPO}/blob/main/README.md${readme[1] ?? ""}`;
  const contributing = url.match(/^\.\.\/CONTRIBUTING\.md(#.*)?$/);
  if (contributing) return `${BASE}/engineering/contributing/${contributing[1] ?? ""}`;
  // Media images referenced from docs/ resolve to the copied public folder.
  const media = url.match(/^(?:\.\.\/)?media\/(.+)$/);
  if (media) return `${BASE}/media/${media[1]}`;
  // Sibling doc: `name.md` (optionally `./`), optionally with an #anchor.
  const doc = url.match(/^\.?\/?([\w-]+)\.md(#.*)?$/);
  if (doc) {
    const [, name, hash = ""] = doc;
    if (ENGINEERING_DOCS.has(name)) return `${BASE}/engineering/${name}/${hash}`;
    if (PRODUCT_SLUGS.has(name)) return `${BASE}/${name}/${hash}`;
    return `${REPO}/blob/main/docs/${name}.md${hash}`;
  }
  return url;
}

function transform(src) {
  const lines = src.split("\n");
  // First `# Heading` becomes the frontmatter title and is dropped from the body.
  let title = "Oleafly";
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
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  let count = 0;
  for (const file of await readdir(DOCS_DIR)) {
    if (!file.endsWith(".md") || !ENGINEERING_DOCS.has(basename(file, ".md"))) continue;
    const src = await readFile(join(DOCS_DIR, file), "utf8");
    await writeFile(join(OUT_DIR, basename(file)), transform(src), "utf8");
    count++;
  }
  const contributing = join(ROOT, "CONTRIBUTING.md");
  if (existsSync(contributing)) {
    const src = await readFile(contributing, "utf8");
    await writeFile(join(OUT_DIR, "contributing.md"), transform(src), "utf8");
    count++;
  }

  if (existsSync(MEDIA_DIR)) {
    await rm(MEDIA_OUT, { recursive: true, force: true });
    await cp(MEDIA_DIR, MEDIA_OUT, { recursive: true });
    // The landing hero imports this via astro:assets for optimized variants,
    // so it must live under src/ (imports can't reach outside the site root).
    await cp(join(MEDIA_DIR, "hero-editor.png"), join(here, "..", "src", "assets", "hero-editor.png"));
  }

  console.log(`sync-docs: wrote ${count} engineering pages, copied media/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
