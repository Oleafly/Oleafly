#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, cpSync, rmSync, copyFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const templatesDir = join(repoRoot, "src-tauri", "resources", "templates");
const fontCatalogPath = join(repoRoot, "src-tauri", "resources", "font-packs.json");
const fontCacheRoot = join(homedir(), ".oleafly", "assets", "fonts");

let fontCatalog = null;
function loadFontCatalog() {
  if (fontCatalog) return fontCatalog;
  fontCatalog = existsSync(fontCatalogPath)
    ? JSON.parse(readFileSync(fontCatalogPath, "utf8"))
    : [];
  return fontCatalog;
}

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

function hostTriple() {
  const arch = { arm64: "aarch64", x64: "x86_64" }[process.arch] ?? process.arch;
  const platform = {
    darwin: "apple-darwin",
    linux: "unknown-linux-gnu",
    win32: "pc-windows-msvc",
  }[process.platform];
  return `${arch}-${platform}`;
}

const EXE = process.platform === "win32" ? ".exe" : "";

function sidecarBinary(name) {
  const bin = join(repoRoot, "src-tauri", "binaries", `${name}-${hostTriple()}${EXE}`);
  return existsSync(bin) ? bin : null;
}

function onPath(cmd) {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
    return cmd;
  } catch {
    return null;
  }
}

// A copy Oleafly downloaded into ~/.oleafly (or the dev app's ~/.oleafly-dev),
// newest version first.
function downloadedToolchain(tool, relativePaths) {
  for (const root of [".oleafly", ".oleafly-dev"]) {
    const base = join(homedir(), root, "toolchains", tool);
    if (!existsSync(base)) continue;
    for (const version of readdirSync(base).sort().reverse()) {
      for (const relative of relativePaths) {
        const bin = join(base, version, relative);
        if (existsSync(bin)) return bin;
      }
    }
  }
  return null;
}

function quartoBinary() {
  return process.env.OLEAFLY_QUARTO ?? onPath("quarto") ?? downloadedToolchain("quarto", [`bin/quarto${EXE}`]);
}

function calepinBinary() {
  return (
    process.env.OLEAFLY_CALEPIN ??
    onPath("calepin") ??
    downloadedToolchain("calepin", [`calepin-${hostTriple()}/calepin${EXE}`, `calepin${EXE}`])
  );
}

function tectonicBinary() {
  const bin = sidecarBinary("tectonic");
  if (!bin) {
    throw new Error("Tectonic sidecar not found. Run scripts/fetch-tectonic.sh first.");
  }
  return bin;
}

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

function pdftoppmBinary() {
  const candidates = [
    "/opt/homebrew/bin/pdftoppm",
    "/usr/local/bin/pdftoppm",
    "/usr/bin/pdftoppm",
  ];
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ["-v"], { stdio: "ignore" });
      return cmd;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function rasterize(pdftoppm, pdfPath, work, dir) {
  execFileSync(
    pdftoppm,
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

// Slide decks render to a web page, so their preview is the first slide at
// 1280x720, saved 600 px wide like the Beamer previews.
async function screenshotSlides(htmlPath, dir) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 600 / 1280 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.Reveal?.isReady?.() ?? true);
    const dest = join(dir, "preview.png");
    await page.screenshot({ path: dest });
    return Math.round(statSync(dest).size / 1024);
  } finally {
    await browser.close();
  }
}

const TYPST_MISSING = "typst sidecar missing (run scripts/fetch-typst.sh)";

// Each engine compiles the template copied into `work` and returns { pdf },
// { kb } when it saved the preview itself, or { skip } with the reason.
async function compileTectonic({ work, mainDoc, manifest, tools }) {
  await stageFonts(manifest.requires?.fonts, work);
  execFileSync(tools.tectonic, ["-X", "compile", "--keep-logs", mainDoc], { cwd: work, stdio: "pipe" });
  return { pdf: join(work, mainDoc.replace(/\.tex$/, ".pdf")) };
}

function compileTypst({ work, mainDoc, tools }) {
  if (!tools.typst) return { skip: TYPST_MISSING };
  execFileSync(tools.typst, ["compile", mainDoc, "preview-out.pdf"], { cwd: work, stdio: "pipe" });
  return { pdf: join(work, "preview-out.pdf") };
}

function compilePandoc({ work, mainDoc, tools }) {
  if (!tools.pandoc) return { skip: "pandoc not found (needed for markdown previews)" };
  // Pandoc validates the --pdf-engine BASENAME against its known engine names,
  // so the target-triple sidecar name is rejected. Expose Tectonic under the
  // exact name `tectonic` (the app does the same by shipping the sidecar
  // without its triple suffix).
  const enginePath = join(work, `tectonic${EXE}`);
  try {
    symlinkSync(tools.tectonic, enginePath);
  } catch {
    copyFileSync(tools.tectonic, enginePath);
  }
  execFileSync(
    tools.pandoc,
    [mainDoc, "-o", "preview-out.pdf", `--pdf-engine=${enginePath}`, "--citeproc"],
    { cwd: work, stdio: "pipe" },
  );
  return { pdf: join(work, "preview-out.pdf") };
}

async function compileQuarto({ work, dir, mainDoc, tools }) {
  if (!tools.quarto) return { skip: "quarto not found (install it, or set OLEAFLY_QUARTO)" };
  // Code off, as a new project first compiles: no R, Python or Jupyter needed.
  execFileSync(tools.quarto, ["render", mainDoc, "--no-execute"], { cwd: work, stdio: "pipe" });
  const stem = join(work, mainDoc.replace(/\.(qmd|Rmd)$/, ""));
  if (existsSync(`${stem}.html`) && !existsSync(`${stem}.pdf`)) {
    return { kb: await screenshotSlides(`${stem}.html`, dir) };
  }
  return { pdf: `${stem}.pdf` };
}

function compileCalepin({ work, mainDoc, tools }) {
  if (!tools.calepin) return { skip: "calepin not found (install it, or set OLEAFLY_CALEPIN)" };
  if (!tools.typst) return { skip: TYPST_MISSING };
  // Calepin runs the template's own chunks, so the preview shows their output.
  execFileSync(
    tools.calepin,
    ["compile", mainDoc, "preview-out.pdf", "--format", "pdf", "--set", `executables.typst='${tools.typst}'`],
    { cwd: work, stdio: "pipe", env: { ...process.env, CALEPIN_PYTHON: process.env.CALEPIN_PYTHON ?? "python3" } },
  );
  return { pdf: join(work, "preview-out.pdf") };
}

const COMPILERS = {
  tectonic: compileTectonic,
  typst: compileTypst,
  pandoc: compilePandoc,
  markdown: compilePandoc,
  quarto: compileQuarto,
  calepin: compileCalepin,
};

async function render(id, tools) {
  const dir = join(templatesDir, id);
  const manifestPath = join(dir, "template.json");
  if (!existsSync(manifestPath)) return { id, status: "skip", reason: "no manifest" };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const engineKind = manifest.requires?.engine ?? "tectonic";
  const compile = COMPILERS[engineKind];
  if (!compile) return { id, status: "skip", reason: `engine ${engineKind}` };
  const mainDoc = manifest.main_doc ?? "main.tex";

  const work = mkdtempSync(join(tmpdir(), `oleafly-preview-${id}-`));
  try {
    cpSync(dir, work, { recursive: true });
    rmSync(join(work, "template.json"), { force: true });
    rmSync(join(work, "preview.png"), { force: true });

    const out = await compile({ work, dir, mainDoc, manifest, tools });
    if (out.skip) return { id, status: "skip", reason: out.skip };
    if (out.kb !== undefined) return { id, status: "ok", reason: `${out.kb} KB` };
    if (!existsSync(out.pdf)) throw new Error("no PDF produced");
    const kb = rasterize(tools.pdftoppm, out.pdf, work, dir);
    return { id, status: "ok", reason: `${kb} KB` };
  } catch (e) {
    return { id, status: "fail", reason: String(e.message || e).slice(0, 200) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const pdftoppm = pdftoppmBinary();
  if (!pdftoppm) {
    console.error("pdftoppm not found. Install poppler-utils (macOS: brew install poppler).");
    process.exit(1);
  }
  const tools = {
    tectonic: tectonicBinary(),
    typst: sidecarBinary("typst"),
    pandoc: pandocBinary(),
    quarto: quartoBinary(),
    calepin: calepinBinary(),
    pdftoppm,
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

try {
  await main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
