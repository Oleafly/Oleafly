#!/usr/bin/env node
// Render a page-1 PNG thumbnail for every bundled template.
//
// For each folder under src-tauri/resources/templates/<id>/, this compiles the
// template's main doc with the bundled Tectonic sidecar and rasterizes page 1 to
// `preview.png` (committed alongside the template). It doubles as a per-template
// compile smoke test. Run it from the repo root:
//
//     node scripts/render-template-previews.mjs [templateId ...]
//
// Requires `pdftoppm` (poppler-utils) on PATH. Tectonic and Typst templates render
// from their bundled sidecars; Markdown templates render via Pandoc (managed
// download, PATH, or a common install location) with Tectonic as the PDF engine.
// A template whose engine tool is unavailable is skipped, not failed.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, cpSync, rmSync, copyFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const templatesDir = join(repoRoot, "src-tauri", "resources", "templates");
const fontCatalogPath = join(repoRoot, "src-tauri", "resources", "font-packs.json");
// Shared with the app: fonts are cached under ~/.oleafly/assets/fonts/<id>/ so a
// preview run and the running app reuse the same downloads.
const fontCacheRoot = join(homedir(), ".oleafly", "assets", "fonts");

let fontCatalog = null;
function loadFontCatalog() {
  if (fontCatalog) return fontCatalog;
  fontCatalog = existsSync(fontCatalogPath)
    ? JSON.parse(readFileSync(fontCatalogPath, "utf8"))
    : [];
  return fontCatalog;
}

// Ensure a font pack is cached (downloading if needed), then copy its files into
// the build dir's fonts/ folder so a font-dependent template compiles.
async function stageFonts(fontIds, workDir) {
  if (!fontIds?.length) return;
  const catalog = loadFontCatalog();
  const fontsDir = join(workDir, "fonts");
  mkdirSync(fontsDir, { recursive: true });
  for (const id of fontIds) {
    const pack = catalog.find((p) => p.id === id);
    if (!pack) throw new Error(`unknown font pack: ${id}`);
    const cacheDir = join(fontCacheRoot, id);
    mkdirSync(cacheDir, { recursive: true });
    for (const f of pack.files) {
      const cached = join(cacheDir, f.name);
      if (!existsSync(cached)) {
        const res = await fetch(f.url);
        if (!res.ok) throw new Error(`download ${f.name} failed: ${res.status}`);
        writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
      }
      copyFileSync(cached, join(fontsDir, f.name));
    }
  }
}

// Resolve a bundled sidecar (tectonic/typst) for the host triple, or null if it
// has not been fetched yet.
function sidecarBinary(name) {
  const arch = { arm64: "aarch64", x64: "x86_64" }[process.arch] ?? process.arch;
  const platform = {
    darwin: "apple-darwin",
    linux: "unknown-linux-gnu",
    win32: "pc-windows-msvc",
  }[process.platform];
  const ext = process.platform === "win32" ? ".exe" : "";
  const bin = join(repoRoot, "src-tauri", "binaries", `${name}-${arch}-${platform}${ext}`);
  return existsSync(bin) ? bin : null;
}

function tectonicBinary() {
  const bin = sidecarBinary("tectonic");
  if (!bin) {
    throw new Error("Tectonic sidecar not found. Run scripts/fetch-tectonic.sh first.");
  }
  return bin;
}

// Mirror the app's find_pandoc: prefer our managed download, then PATH, then
// common install locations. Returns a runnable path/command or null.
function pandocBinary() {
  const managed = join(
    homedir(),
    ".oleafly",
    "bin",
    process.platform === "win32" ? "pandoc.exe" : "pandoc",
  );
  const candidates = [
    managed,
    "pandoc",
    "/opt/homebrew/bin/pandoc",
    "/usr/local/bin/pandoc",
    "/usr/bin/pandoc",
  ];
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ["--version"], { stdio: "ignore" });
      return cmd;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// Rasterize page 1 of a PDF to <dir>/preview.png (width 600px, white background).
function rasterize(pdfPath, work, dir) {
  execFileSync(
    "pdftoppm",
    ["-png", "-f", "1", "-l", "1", "-scale-to-x", "600", "-scale-to-y", "-1", pdfPath, join(work, "preview")],
    { stdio: "pipe" },
  );
  // pdftoppm names single-page output "preview-1.png" (or "preview-01.png").
  const out = readdirSync(work).find((f) => /^preview-0*1\.png$/.test(f));
  if (!out) throw new Error("pdftoppm produced no PNG");
  const dest = join(dir, "preview.png");
  copyFileSync(join(work, out), dest);
  return Math.round(statSync(dest).size / 1024);
}

function which(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function render(id, tools) {
  const dir = join(templatesDir, id);
  const manifestPath = join(dir, "template.json");
  if (!existsSync(manifestPath)) return { id, status: "skip", reason: "no manifest" };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const engineKind = manifest.requires?.engine ?? "tectonic";
  const mainDoc = manifest.main_doc ?? "main.tex";

  const work = mkdtempSync(join(tmpdir(), `oleafly-preview-${id}-`));
  try {
    cpSync(dir, work, { recursive: true });
    rmSync(join(work, "template.json"), { force: true });
    rmSync(join(work, "preview.png"), { force: true });

    // Each engine produces a PDF in the work dir; the rasterize step is shared.
    let pdf;
    if (engineKind === "tectonic") {
      await stageFonts(manifest.requires?.fonts, work);
      execFileSync(tools.tectonic, ["-X", "compile", "--keep-logs", mainDoc], { cwd: work, stdio: "pipe" });
      pdf = join(work, mainDoc.replace(/\.tex$/, ".pdf"));
    } else if (engineKind === "typst") {
      if (!tools.typst) return { id, status: "skip", reason: "typst sidecar missing (run scripts/fetch-typst.sh)" };
      execFileSync(tools.typst, ["compile", mainDoc, "preview-out.pdf"], { cwd: work, stdio: "pipe" });
      pdf = join(work, "preview-out.pdf");
    } else if (engineKind === "pandoc" || engineKind === "markdown") {
      if (!tools.pandoc) return { id, status: "skip", reason: "pandoc not found (needed for markdown previews)" };
      // Pandoc validates the --pdf-engine BASENAME against its known engine names,
      // so the target-triple sidecar name is rejected. Expose Tectonic under the
      // exact name `tectonic` (the app does the same by shipping the sidecar
      // without its triple suffix).
      const ext = process.platform === "win32" ? ".exe" : "";
      const enginePath = join(work, `tectonic${ext}`);
      try {
        symlinkSync(tools.tectonic, enginePath);
      } catch {
        copyFileSync(tools.tectonic, enginePath);
      }
      // Mirror the app's Markdown pipeline: Pandoc with Tectonic as the PDF engine.
      execFileSync(
        tools.pandoc,
        [mainDoc, "-o", "preview-out.pdf", `--pdf-engine=${enginePath}`, "--citeproc"],
        { cwd: work, stdio: "pipe" },
      );
      pdf = join(work, "preview-out.pdf");
    } else {
      return { id, status: "skip", reason: `engine ${engineKind}` };
    }

    if (!existsSync(pdf)) throw new Error("no PDF produced");
    const kb = rasterize(pdf, work, dir);
    return { id, status: "ok", reason: `${kb} KB` };
  } catch (e) {
    return { id, status: "fail", reason: String(e.message || e).slice(0, 200) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  if (!which("pdftoppm")) {
    console.error("pdftoppm not found. Install poppler-utils (macOS: brew install poppler).");
    process.exit(1);
  }
  const tools = {
    tectonic: tectonicBinary(),
    typst: sidecarBinary("typst"),
    pandoc: pandocBinary(),
  };
  const only = process.argv.slice(2);
  const ids = readdirSync(templatesDir).filter((f) => statSync(join(templatesDir, f)).isDirectory());
  const targets = only.length ? ids.filter((id) => only.includes(id)) : ids;

  let failed = 0;
  for (const id of targets) {
    const r = await render(id, tools);
    const tag = { ok: "OK  ", skip: "SKIP", fail: "FAIL" }[r.status];
    console.log(`${tag} ${id}  ${r.reason}`);
    if (r.status === "fail") failed++;
  }
  if (failed) {
    console.error(`\n${failed} template(s) failed to render.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
