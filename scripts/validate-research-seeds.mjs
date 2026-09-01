import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadResearchSeedCatalog, seedFixtureDir } from "./research-seed-catalog.mjs";

const run = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "..");
const binaryRoot = join(repositoryRoot, "src-tauri", "binaries");
const TEX_BUNDLE_URL =
  process.env.OLEAFLY_TEX_BUNDLE_URL ||
  "https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar";

function platformSuffix() {
  const architecture = process.arch === "x64" ? "x86_64" : "aarch64";
  if (process.platform === "darwin") return `${architecture}-apple-darwin`;
  if (process.platform === "linux") return `${architecture}-unknown-linux-gnu`;
  throw new Error(`Unsupported platform for seed validation: ${process.platform}`);
}

function sidecar(name) {
  const path = join(binaryRoot, `${name}-${platformSuffix()}`);
  if (!existsSync(path)) {
    throw new Error(
      `Missing bundled ${name} sidecar at ${path}. Run the sidecar download step first.`,
    );
  }
  return path;
}

function diagnosticExcerpt(error) {
  const text = `${error.stderr ?? ""}${error.stdout ?? ""}`;
  const lines = text
    .split("\n")
    .filter((line) => /error|not found|undefined|failed|cannot|missing/i.test(line))
    .slice(0, 6);
  return (lines.join("\n") || String(error.message)).slice(0, 1200);
}

/**
 * Compiles a fixture with the same sidecar and arguments the desktop app uses,
 * so a fixture that passes here cannot fail for a toolchain reason in the app.
 */
export async function compileFixture(project, { keepOutput = false } = {}) {
  const source = project.sourceDir ?? seedFixtureDir(repositoryRoot, project);
  const work = await mkdtemp(join(tmpdir(), `seed-${project.slug}-`));
  const dir = join(work, project.slug);
  await cp(source, dir, { recursive: true });
  const outDir = join(dir, ".oleafly", "build");
  await mkdir(outDir, { recursive: true });
  const main = join(dir, project.mainDoc);
  try {
    if (!existsSync(main)) {
      throw new Error(`main document not found: ${project.mainDoc}`);
    }
    if (project.engine === "typst") {
      await run(
        sidecar("typst"),
        [
          "--color", "never",
          "compile",
          main,
          join(outDir, "output.pdf"),
          "--root", dir,
          "--diagnostic-format", "short",
        ],
        { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
      );
    } else {
      await run(
        sidecar("tectonic"),
        [
          "-X", "compile",
          "--bundle", TEX_BUNDLE_URL,
          "--synctex",
          "--keep-logs",
          "--keep-intermediates",
          "--print",
          "--outdir", outDir,
          `-Zsearch-path=${dir}`,
          main,
        ],
        { cwd: dir, timeout: 600_000, maxBuffer: 64 * 1024 * 1024 },
      );
    }
    const produced = await readdir(outDir);
    if (!produced.some((file) => file.endsWith(".pdf"))) {
      throw new Error("compiler exited cleanly but produced no PDF");
    }
    return { status: "pass", outDir: keepOutput ? outDir : null, work: keepOutput ? work : null };
  } catch (error) {
    return { status: "fail", reason: diagnosticExcerpt(error) };
  } finally {
    if (!keepOutput) await rm(work, { recursive: true, force: true });
  }
}

function flagValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  // Ad-hoc mode validates a directory that is not in the catalog yet, so a
  // fixture can be proven to compile while it is still being authored.
  const adHocDir = flagValue("dir");
  if (adHocDir) {
    const project = {
      slug: adHocDir.replace(/\/+$/, "").split("/").pop(),
      name: adHocDir,
      engine: flagValue("engine") ?? "xetex",
      mainDoc: flagValue("main") ?? "main.tex",
      sourceDir: resolve(adHocDir),
    };
    const result = await compileFixture(project);
    process.stdout.write(
      `${result.status === "pass" ? "pass" : "FAIL"}  ${project.slug} (${project.engine})\n` +
        (result.status === "fail" ? `${result.reason.replace(/^/gm, "        ")}\n` : ""),
    );
    if (result.status === "fail") process.exitCode = 1;
    return;
  }

  const filter = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));
  const catalog = loadResearchSeedCatalog(repositoryRoot).filter(
    (project) => filter.length === 0 || filter.includes(project.slug),
  );
  if (catalog.length === 0) throw new Error("No fixtures matched the requested filter");

  const results = [];
  let index = 0;
  const concurrency = Math.min(4, catalog.length);
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < catalog.length) {
      const project = catalog[index];
      index += 1;
      const started = Date.now();
      const result = await compileFixture(project);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      results.push({ slug: project.slug, name: project.name, engine: project.engine, ...result });
      process.stdout.write(
        `${result.status === "pass" ? "pass" : "FAIL"}  ${project.slug} (${project.engine}, ${seconds}s)\n` +
          (result.status === "fail" ? `${result.reason.replace(/^/gm, "        ")}\n` : ""),
      );
    }
  });
  await Promise.all(workers);

  const failed = results.filter((result) => result.status === "fail");
  await writeFile(
    join(repositoryRoot, "fixtures", "research-seeds", ".validation.json"),
    `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
  process.stdout.write(`\n${results.length - failed.length}/${results.length} fixtures compiled\n`);
  if (failed.length > 0) {
    process.stdout.write(`Failed: ${failed.map((result) => result.slug).join(", ")}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}

export { repositoryRoot, homedir };
