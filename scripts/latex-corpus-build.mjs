#!/usr/bin/env node
//
// Build the package completion catalogs from the LaTeX packages themselves.
//
// Every LaTeX package declares its own public interface in its own source:
// \newcommand, \DeclareRobustCommand, \def, \newenvironment, \DeclareOption,
// \DeclareMathSymbol, and the LaTeX3 equivalents. This reads those
// declarations straight from a TeX installation and writes one catalog per
// package, so every entry traces back to the package that defines it.
//
// Some .sty files are only loaders, so a package that declares almost nothing
// itself is read together with the other sources in its bundle. Widening is a
// fallback, never the default: applied everywhere it would hand each package
// in a bundle the union of that bundle's commands.
//
// The output is generated, so regenerating against a newer TeX Live picks up
// new packages and new commands with no manual curation.
//
// Usage:
//   node scripts/latex-corpus-build.mjs --out public/latex-intelligence/packages
//   node scripts/latex-corpus-build.mjs --package amsmath --stdout
//   node scripts/latex-corpus-build.mjs --texmf /usr/local/texlive/2025/texmf-dist

import { readFile, readdir, mkdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TEXMF_CANDIDATES = [
  "/usr/local/texlive/2025/texmf-dist",
  "/usr/local/texlive/2024/texmf-dist",
  "/usr/share/texlive/texmf-dist",
  "/usr/share/texmf",
];

/** A macro name is a TeX control word (letters) or a single control symbol. */
const CONTROL_WORD = /^(?:[A-Za-z@]+|.)$/;

/** Escape a name for regex interpolation: \[ and \, are legal macro names. */
function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drop comments so a commented-out declaration is never read as a real one. */
function stripComments(source) {
  return source
    .split("\n")
    .map((line) => {
      let out = "";
      for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (c === "\\" && i + 1 < line.length) {
          out += c + line[i + 1];
          i += 1;
          continue;
        }
        if (c === "%") break;
        out += c;
      }
      return out;
    })
    .join("\n");
}

/** Read a balanced brace group at `open`; returns its body and end index. */
function readGroup(text, open) {
  if (text[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** Read a balanced [..] group at `pos`, skipping leading whitespace. */
function readOptional(text, pos) {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] !== "[") return null;
  let depth = 0;
  for (let j = i; j < text.length; j += 1) {
    const c = text[j];
    if (c === "\\") {
      j += 1;
      continue;
    }
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) return { body: text.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

/** A snippet mirrors the call shape: one placeholder per declared argument. */
function buildSnippet(name, argCount, hasOptional) {
  if (!argCount) return null;
  const parts = [];
  let index = 1;
  let remaining = argCount;
  if (hasOptional) {
    parts.push(`[\${${index}:opt}]`);
    index += 1;
    remaining -= 1;
  }
  for (let i = 0; i < remaining; i += 1) {
    parts.push(`{\${${index}:arg${index}}}`);
    index += 1;
  }
  return `${name}${parts.join("")}`;
}

/** Registers hold a value and are never called with arguments. */
function looksUnusual(name, source) {
  const n = reEscape(name);
  return (
    new RegExp(`\\\\newlength\\s*\\{?\\\\${n}(?![A-Za-z@])`).test(source) ||
    new RegExp(`\\\\newcounter\\s*\\{${n}\\}`).test(source) ||
    new RegExp(`\\\\newdimen\\s*\\\\${n}(?![A-Za-z@])`).test(source)
  );
}

export function extract(source, pkgName) {
  const text = stripComments(source);
  const macros = new Map();
  const envs = new Set();
  const deps = new Set();
  const keys = {};
  const args = [];

  const addMacro = (name, entry) => {
    if (!name || !CONTROL_WORD.test(name)) return;
    if (name.includes("@")) return; // package-internal by convention
    const list = macros.get(name) ?? [];
    if (!list.some((e) => e.snippet === entry.snippet)) list.push(entry);
    macros.set(name, list);
  };

  // \newcommand{\foo}[n][default]{...} and the LaTeX2e/xparse relatives.
  const cmdRe =
    /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareTextCommand|NewDocumentCommand|DeclareDocumentCommand|ProvideDocumentCommand)\s*\*?\s*/g;
  for (let m = cmdRe.exec(text); m; m = cmdRe.exec(text)) {
    let pos = m.index + m[0].length;
    let name = null;
    if (text[pos] === "{") {
      const g = readGroup(text, pos);
      if (!g) continue;
      name = g.body.trim().replace(/^\\/, "");
      pos = g.end;
    } else if (text[pos] === "\\") {
      const mm = /^\\([A-Za-z@]+|.)/.exec(text.slice(pos));
      if (!mm) continue;
      name = mm[1];
      pos += mm[0].length;
    } else continue;

    let argCount = 0;
    let hasOptional = false;
    let probe = pos;
    while (probe < text.length && /\s/.test(text[probe])) probe += 1;
    const sig = readGroup(text, probe);
    if (sig && /^[\ssmoOtdDvrRlgGebB+!]*$/.test(sig.body) && /[smo]/i.test(sig.body)) {
      const tokens = sig.body.replace(/\s+/g, "");
      argCount = tokens.replace(/[+!]/g, "").length;
      hasOptional = /[oOdD]/.test(tokens);
    } else {
      const opt = readOptional(text, pos);
      if (opt && /^\d+$/.test(opt.body.trim())) {
        argCount = Number(opt.body.trim());
        hasOptional = Boolean(readOptional(text, opt.end));
      }
    }

    const snippet = buildSnippet(name, argCount, hasOptional);
    if (snippet) {
      addMacro(name, { name, snippet });
      addMacro(name, { name });
    } else {
      addMacro(name, looksUnusual(name, text) ? { name, unusual: true } : { name });
    }
  }

  // Plain TeX: \def\foo#1#2{...}, including the \long/\global/\protected forms
  // that many packages use for their entire public interface.
  const defRe =
    /\\(?:long\s*|global\s*|outer\s*|protected\s*)*\\?(?:def|gdef|edef|xdef)\s*\\([A-Za-z@]+)((?:#\d|[^{\n]){0,40}?)\{/g;
  for (let m = defRe.exec(text); m; m = defRe.exec(text)) {
    const name = m[1];
    const count = ((m[2] ?? "").match(/#\d/g) ?? []).length;
    const snippet = buildSnippet(name, count, false);
    if (snippet) {
      addMacro(name, { name, snippet });
      addMacro(name, { name });
    } else {
      addMacro(name, { name });
    }
  }

  // \let aliases expose a usable name too.
  const letRe = /\\let\s*\\([A-Za-z@]+)\s*=?\s*\\[A-Za-z@]+/g;
  for (let m = letRe.exec(text); m; m = letRe.exec(text)) addMacro(m[1], { name: m[1] });

  const opRe = /\\DeclareMathOperator\s*\*?\s*\{\\([A-Za-z@]+)\}/g;
  for (let m = opRe.exec(text); m; m = opRe.exec(text)) addMacro(m[1], { name: m[1] });

  // Symbol declarations — how the maths font packages name hundreds of glyphs.
  for (const re of [
    /\\DeclareMathSymbol\s*\{?\\([A-Za-z@]+)/g,
    /\\DeclareMathDelimiter\s*\{?\\([A-Za-z@]+)/g,
    /\\DeclareMathAccent\s*\{?\\([A-Za-z@]+)/g,
    /\\DeclareMathRadical\s*\{?\\([A-Za-z@]+)/g,
    /\\DeclareTextSymbol\s*\{?\\([A-Za-z@]+)/g,
    /\\DeclareTextAccent\s*\{?\\([A-Za-z@]+)/g,
  ]) {
    for (let m = re.exec(text); m; m = re.exec(text)) addMacro(m[1], { name: m[1] });
  }

  // LaTeX3 document-level commands; \__private ones stay private.
  const expl3Re = /\\cs_(?:new|set|gset)(?:_protected)?(?::Npn|:Npx|_nopar:Npn)\s*\\([A-Za-z@_]+)/g;
  for (let m = expl3Re.exec(text); m; m = expl3Re.exec(text)) {
    const name = m[1];
    if (!name.startsWith("__") && !/^[a-z]+_/.test(name)) addMacro(name, { name });
  }

  // Registers: settable, never called.
  for (const re of [
    /\\newlength\s*\{?\\([A-Za-z@]+)/g,
    /\\newdimen\s*\\([A-Za-z@]+)/g,
    /\\newskip\s*\\([A-Za-z@]+)/g,
    /\\newcount\s*\\([A-Za-z@]+)/g,
    /\\newtoks\s*\\([A-Za-z@]+)/g,
    /\\newbox\s*\\([A-Za-z@]+)/g,
    /\\newcounter\s*\{([A-Za-z@]+)\}/g,
  ]) {
    for (let m = re.exec(text); m; m = re.exec(text)) addMacro(m[1], { name: m[1], unusual: true });
  }

  const envRe =
    /\\(?:newenvironment|renewenvironment|NewDocumentEnvironment|DeclareDocumentEnvironment|newtheorem)\s*\*?\s*\{([A-Za-z@*]+)\}/g;
  for (let m = envRe.exec(text); m; m = envRe.exec(text)) {
    if (!m[1].includes("@")) envs.add(m[1]);
  }

  const reqRe = /\\RequirePackage\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  for (let m = reqRe.exec(text); m; m = reqRe.exec(text)) {
    for (const d of m[1].split(",")) {
      const name = d.trim();
      if (name && name !== pkgName && /^[A-Za-z0-9@_-]+$/.test(name)) deps.add(name);
    }
  }

  const optNames = [];
  const optRe = /\\DeclareOption\s*\{([^}*]+)\}/g;
  for (let m = optRe.exec(text); m; m = optRe.exec(text)) {
    const name = m[1].trim();
    if (name && name !== "*") optNames.push(name);
  }
  // Key=value families: \define@key{FAMILY}{key}. Collect per family so the
  // keys can also be offered inside whichever command consumes that family.
  const byFamily = new Map();
  const keyRe = /\\define@key\s*\{([^}]*)\}\s*\{([^}]+)\}/g;
  for (let m = keyRe.exec(text); m; m = keyRe.exec(text)) {
    const family = m[1].trim();
    const key = m[2].trim();
    optNames.push(key);
    const set = byFamily.get(family) ?? new Set();
    set.add(key);
    byFamily.set(family, set);
  }

  // A command whose body calls \setkeys{FAMILY} takes that family's keys, so
  // \hypersetup{} offers the same keys as \usepackage[...]{hyperref}.
  const consumers = new Map();
  const consumerRe =
    /\\(?:newcommand|providecommand|DeclareRobustCommand|def|gdef)\s*\*?\s*\{?\\([A-Za-z@]+)\}?[^\n]{0,80}?\{([\s\S]{0,400}?)(?:\n|\})/g;
  for (let m = consumerRe.exec(text); m; m = consumerRe.exec(text)) {
    const name = m[1];
    if (name.includes("@")) continue;
    const body = m[2] ?? "";
    // The captured body may stop mid-group, so the closing brace is optional.
    const fam = /\\(?:kv)?setkeys\s*(?:\[[^\]]*\])?\s*\{([^}\s]+)\}?/.exec(body);
    if (fam && byFamily.has(fam[1].trim())) {
      consumers.set(name, fam[1].trim());
    }
  }

  if (optNames.length) {
    const pkgId = `\\usepackage/${pkgName}#c`;
    const all = [...new Set(optNames)].sort();
    const consumerNames = [...consumers.keys()].map((n) => `\\${n}`);
    const id = consumerNames.length ? `${consumerNames.join(",")},${pkgId}` : pkgId;
    args.push(id);
    keys[id] = all;
  }

  const macroList = [];
  for (const list of macros.values()) for (const e of list) macroList.push(e);
  macroList.sort(
    (a, b) => a.name.localeCompare(b.name) || (a.snippet ?? "").localeCompare(b.snippet ?? ""),
  );

  return {
    args,
    deps: [...deps].sort(),
    envs: [...envs].sort().map((name) => ({ name })),
    keys,
    macros: macroList,
  };
}

function findTexmf(explicit) {
  if (explicit) return explicit;
  for (const c of TEXMF_CANDIDATES) if (existsSync(join(c, "tex"))) return c;
  throw new Error("no TeX installation found; pass --texmf <path to texmf-dist>");
}

/** Index the .sty files, plus every readable source grouped by its bundle. */
async function collectSources(texmf) {
  const root = join(texmf, "tex");
  const sty = new Map();
  const cls = new Map();
  const byBundle = new Map();
  const KEEP = new Set([".sty", ".cls", ".def", ".cfg", ".tex", ".clo", ".ldf"]);
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
        continue;
      }
      if (!KEEP.has(extname(e.name))) continue;
      if (extname(e.name) === ".sty" && !sty.has(basename(e.name, ".sty"))) {
        sty.set(basename(e.name, ".sty"), p);
      }
      if (extname(e.name) === ".cls" && !cls.has(basename(e.name, ".cls"))) {
        cls.set(basename(e.name, ".cls"), p);
      }
      const rel = p.slice(root.length + 1).split("/");
      const bundle = rel.length > 1 ? join(root, rel[0], rel[1]) : dir;
      const list = byBundle.get(bundle) ?? [];
      list.push(p);
      byBundle.set(bundle, list);
    }
  }
  await walk(root);
  return { sty, cls, byBundle };
}

/**
 * Read a package's own source, widening to its bundle only when the .sty turns
 * out to be a loader.
 */
async function readPackageSources(styPath, byBundle, pkgName) {
  const primary = await readFile(styPath, "utf8").catch(() => null);
  if (primary === null) return null;

  const direct = extract(primary, pkgName);
  const delegates = /\\(?:input|RequirePackage|LoadClass)\b/.test(primary);
  if (direct.macros.length >= 12 || !delegates) return primary;

  const rel = styPath.split("/tex/")[1]?.split("/") ?? [];
  const bundleKey =
    rel.length > 1
      ? join(styPath.slice(0, styPath.indexOf("/tex/") + 4), rel[0], rel[1])
      : dirname(styPath);
  const siblings = (byBundle.get(bundleKey) ?? []).filter((p) => p !== styPath);
  // A small bundle is one package split across a few files, and reading it
  // whole is right. A large one holds many independent packages, and reading
  // it whole would make every shim in it claim the bundle's entire interface.
  if (siblings.length > 60) return primary;

  const parts = [primary];
  let budget = 2_000_000;
  for (const sp of siblings) {
    if (budget <= 0) break;
    // Skip a package's own legacy-compatibility sources. Their commands still
    // work, but they exist to keep old documents compiling — suggesting them
    // in a new document points people at the interface they should not use.
    if (/-(?:v[12]|compat|legacy|deprecated|obsolete)\b/.test(basename(sp))) continue;
    let size = 0;
    try {
      size = (await stat(sp)).size;
    } catch {
      continue;
    }
    if (size > budget) continue;
    const text = await readFile(sp, "utf8").catch(() => null);
    if (text === null) continue;
    parts.push(text);
    budget -= size;
  }
  return parts.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  const texmf = findTexmf(arg("--texmf"));
  const only = arg("--package");
  const toStdout = argv.includes("--stdout");
  const outDir = resolve(ROOT, arg("--out") ?? join("public", "latex-intelligence", "packages"));

  const { sty, cls, byBundle } = await collectSources(texmf);
  process.stderr.write(`texmf: ${texmf}\n${sty.size} .sty, ${cls.size} .cls\n`);

  // Document classes are catalogued the same way and addressed as class-<name>.
  const targets = only
    ? [only]
    : [...[...sty.keys()].sort(), ...[...cls.keys()].sort().map((n) => `class-${n}`)];
  if (!toStdout) await mkdir(outDir, { recursive: true });

  let written = 0;
  let macros = 0;
  let envs = 0;
  for (const name of targets) {
    const isClass = name.startsWith("class-");
    const realName = isClass ? name.slice("class-".length) : name;
    const path = isClass ? cls.get(realName) : sty.get(realName);
    if (!path) {
      process.stderr.write(`  no source for ${name}\n`);
      continue;
    }
    const source = await readPackageSources(path, byBundle, realName);
    if (source === null) continue;
    const catalog = extract(source, realName);
    if (!catalog.macros.length && !catalog.envs.length) continue;
    macros += catalog.macros.length;
    envs += catalog.envs.length;
    if (toStdout) process.stdout.write(`${JSON.stringify(catalog, null, 1)}\n`);
    else await writeFile(join(outDir, `${name}.json`), `${JSON.stringify(catalog)}\n`);
    written += 1;
  }
  process.stderr.write(`wrote ${written} catalogs: ${macros} macros, ${envs} environments\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
