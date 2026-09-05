#!/usr/bin/env node
import { readFile, writeFile, mkdir, rm, readdir, stat, lstat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findFrontmatterBounds,
  injectOleaflyMetadata,
  readFrontmatterField,
  validateSkillMarkdown,
} from "./frontmatter.mjs";
import { assertPythonYamlParses } from "./yaml-check.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const MANIFEST_PATH = join(SCRIPT_DIR, "kdense-manifest.json");
const DEST_ROOT = join(REPO_ROOT, "src-tauri", "resources", "skills");
const LICENSE_DEST = join(
  REPO_ROOT,
  "src-tauri",
  "resources",
  "licenses",
  "scientific-agent-skills-LICENSE.md",
);

const LICENSE_OK = /^MIT( License| license)?$/i;
const EXCLUDED_SCRIPT_BASENAMES = [
  "generate_schematic.py",
  "generate_schematic_ai.py",
  "generate_slide_image.py",
  "generate_slide_image_ai.py",
];

function parseArgs(argv) {
  const args = { source: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") {
      args.source = argv[i + 1];
      i++;
    }
  }
  return args;
}

function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (".+^${}()|[]\\".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  out += "$";
  return new RegExp(out);
}

function isExcluded(relPath, excludeRegexes) {
  return excludeRegexes.some((re) => re.test(relPath));
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function bodyReferencesExcludedScript(text) {
  return EXCLUDED_SCRIPT_BASENAMES.some((name) => text.includes(name));
}

function appendOleaflyNote(text) {
  const note =
    "\n## Oleafly note\n\n" +
    "The image-generation scripts referenced above (generate_schematic.py, generate_schematic_ai.py, " +
    "generate_slide_image.py, generate_slide_image_ai.py) are not bundled with this skill. " +
    "They call OpenRouter and read .env files outside the project, which does not fit Oleafly's sandboxed " +
    "agent runtime. Use Oleafly's own figure tools to produce diagrams and slide images instead.\n";
  return text.endsWith("\n") ? `${text}${note}` : `${text}\n${note}`;
}

async function copySkillTree(srcDir, destDir, excludeRegexes, maxFileBytes) {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  const files = await walk(srcDir);
  let fileCount = 0;
  let byteCount = 0;
  for (const filePath of files) {
    const rel = relative(srcDir, filePath).split("\\").join("/");
    if (isExcluded(rel, excludeRegexes)) continue;
    const st = await stat(filePath);
    if (st.size > maxFileBytes) continue;
    const destPath = join(destDir, rel);
    await mkdir(dirname(destPath), { recursive: true });
    const content = await readFile(filePath);
    await writeFile(destPath, content);
    fileCount++;
    byteCount += st.size;
  }
  return { fileCount, byteCount };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestRaw = await readFile(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(manifestRaw);
  const sourceRoot = args.source
    ? resolve(args.source)
    : (() => {
        throw new Error("Pass --source <path-to-scientific-agent-skills-clone>");
      })();

  const licenseSrc = join(sourceRoot, "LICENSE.md");
  const upstreamLicenseText = await readFile(licenseSrc, "utf8");

  const excludeRegexes = manifest.exclude.map((rule) => globToRegExp(rule.glob));
  const maxFileBytes = manifest.maxFileBytes ?? 5 * 1024 * 1024;

  const results = [];
  const writtenSkillMd = [];
  for (const entry of manifest.skills) {
    const skillSrcDir = join(sourceRoot, "skills", entry.id);
    const skillMdPath = join(skillSrcDir, "SKILL.md");
    const skillMdRaw = await readFile(skillMdPath, "utf8");
    const bounds = findFrontmatterBounds(skillMdRaw);
    if (!bounds) {
      throw new Error(`${entry.id}: SKILL.md has no frontmatter block`);
    }
    const license = readFrontmatterField(skillMdRaw, "license");
    if (!license || !LICENSE_OK.test(license)) {
      throw new Error(
        `${entry.id}: license "${license ?? "(missing)"}" does not match required MIT pattern, aborting`,
      );
    }

    const destDir = join(DEST_ROOT, entry.id);
    const { fileCount, byteCount } = await copySkillTree(
      skillSrcDir,
      destDir,
      excludeRegexes,
      maxFileBytes,
    );

    let finalText = injectOleaflyMetadata(skillMdRaw, {
      tier: "vendored",
      phase: entry.phase,
      origin: { repo: manifest.repo, commit: manifest.pin },
    });
    if (bodyReferencesExcludedScript(finalText)) {
      finalText = appendOleaflyNote(finalText);
    }
    validateSkillMarkdown(finalText, `${entry.id}/SKILL.md`);
    const destSkillMd = join(destDir, "SKILL.md");
    await writeFile(destSkillMd, finalText, "utf8");
    writtenSkillMd.push(destSkillMd);

    results.push({ id: entry.id, phase: entry.phase, license, files: fileCount, bytes: byteCount });
  }

  await mkdir(dirname(LICENSE_DEST), { recursive: true });
  const skillList = manifest.skills.map((s) => `- ${s.id}`).join("\n");
  const licenseDoc =
    `# License: scientific-agent-skills\n\n` +
    `Upstream repository: ${manifest.repo}\n` +
    `Pinned commit: ${manifest.pin}\n\n` +
    `The following skills are vendored from this repository into Oleafly under the MIT terms below:\n\n` +
    `${skillList}\n\n` +
    `---\n\n` +
    `${upstreamLicenseText}`;
  await writeFile(LICENSE_DEST, licenseDoc, "utf8");

  assertPythonYamlParses(writtenSkillMd, "vendored skills");

  console.log(`Synced ${results.length} skills from ${sourceRoot} @ ${manifest.pin}`);
  for (const r of results) {
    console.log(`  ${r.id.padEnd(30)} phase=${r.phase.padEnd(13)} files=${String(r.files).padStart(3)} bytes=${r.bytes}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
