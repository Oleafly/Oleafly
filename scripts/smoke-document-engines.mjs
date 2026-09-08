// Real compiler smoke tests. No user projects are read or modified.
// Optional: OLEAFLY_TEX_BIN_DIR enables pdfLaTeX, XeLaTeX and LuaLaTeX.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const suffix = process.platform === "win32" ? ".exe" : "";
const target = process.env.OLEAFLY_SIDECAR_TARGET ?? (
  process.platform === "win32" ? "x86_64-pc-windows-msvc" :
  process.platform === "darwin" ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin` :
  `${process.arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-gnu`
);
const sidecar = (name) => join(repo, "src-tauri", "binaries", `${name}-${target}${suffix}`);
const root = mkdtempSync(join(tmpdir(), "oleafly-engine-smoke-"));
const texBin = process.env.OLEAFLY_TEX_BIN_DIR;
const env = { ...process.env };
if (texBin) env.PATH = `${texBin}${process.platform === "win32" ? ";" : ":"}${env.PATH ?? ""}`;

const latex = (font = "") => String.raw`\documentclass{article}
\usepackage{amsmath,amssymb}
${font}
\begin{document}
\section{Engine smoke test}\label{sec:smoke}
Windows compilation, math, tables, and references.
\input{chapter}
\begin{equation}\label{eq:smoke}\sum_{i=1}^{n}i=\frac{n(n+1)}{2}\end{equation}
Equation~\ref{eq:smoke} in Section~\ref{sec:smoke}.
\begin{tabular}{lr}Case & Result\\Base & 42\end{tabular}
\end{document}
`;
const fontspec = String.raw`\usepackage{fontspec}\setmainfont{${process.platform === "win32" ? "Arial" : "Latin Modern Roman"}}`;
const typst = (font = "") => `#set page(margin: 1in)
#set heading(numbering: "1.")
${font}
= Engine smoke test <smoke>
Math: $ sum_(i=1)^n i = (n (n+1))/2 $.
#include "chapter.typ"
See @smoke.
#table(columns: 2, [Case], [Result], [Base], [42])
`;
const cases = [];
for (const [name, source] of [["base", latex()], ["fontspec", latex(fontspec)], ["invalid", "\\documentclass{article}\\begin{document}\\unknownsmokecommand\\end{document}"]]) {
  cases.push({ name: `tectonic-${name}`, executable: sidecar("tectonic"), args: ["--keep-logs", "--synctex", "main.tex"], source, extension: "tex", invalid: name === "invalid" });
}
const typstCases = [["base", typst()], ["font", typst('#set text(font: "Libertinus Serif")')], ["invalid", "#unknownsmokecommand()"]];
if (process.platform === "win32") typstCases.push(["system-font", typst('#set text(font: "Arial")')]);
for (const [name, source] of typstCases) {
  cases.push({ name: `typst-${name}`, executable: sidecar("typst"), args: ["compile", "main.typ", "main.pdf"], source, extension: "typ", invalid: name === "invalid" });
}
if (texBin) {
  for (const [engine, flag] of [["pdflatex", "-pdf"], ["xelatex", "-xelatex"], ["lualatex", "-lualatex"]]) {
    for (const invalid of [false, true]) {
      cases.push({ name: `${engine}-${invalid ? "invalid" : "base"}`, executable: join(texBin, `latexmk${suffix}`), args: [flag, "-interaction=nonstopmode", "-halt-on-error", "-synctex=1", "main.tex"], source: invalid ? "\\documentclass{article}\\begin{document}\\unknownsmokecommand\\end{document}" : latex(engine === "pdflatex" ? "" : fontspec), extension: "tex", invalid });
    }
  }
}
const results = [];
for (const item of cases) {
  const cwd = join(root, item.name);
  mkdirSync(cwd);
  writeFileSync(join(cwd, `main.${item.extension}`), item.source);
  writeFileSync(join(cwd, "chapter.tex"), "Included source with an accented word: caf\\'e.\n");
  writeFileSync(join(cwd, "chapter.typ"), "Included source with Unicode: café.\n");
  const start = performance.now();
  const run = spawnSync(item.executable, item.args, { cwd, env, encoding: "utf8", timeout: 180_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const log = `${run.stdout ?? ""}\n${run.stderr ?? ""}\n${run.error ?? ""}`;
  writeFileSync(join(cwd, "compiler.log"), log);
  let pdf = false;
  try { pdf = readFileSync(join(cwd, "main.pdf")).subarray(0, 5).toString() === "%PDF-"; } catch {}
  const passed = !run.error && (item.invalid
    ? run.status > 0 && run.status < 128 && !pdf && /unknownsmokecommand|Undefined control sequence/.test(log)
    : run.status === 0 && pdf && !/unknown font family/i.test(log));
  const result = { name: item.name, passed, exitCode: run.status, pdf, elapsedMs: Math.round(performance.now() - start) };
  results.push(result);
  console.log(JSON.stringify(result));
}
writeFileSync(join(root, "results.json"), JSON.stringify({ results, texLiveEnabled: Boolean(texBin) }, null, 2));
console.log(`Compiler logs and fixtures: ${root}`);
if (!texBin) console.log("TeX Live engines were not run: set OLEAFLY_TEX_BIN_DIR to enable them.");
if (results.some((result) => !result.passed)) process.exitCode = 1;
