#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");

export const RUNTIME_DLL = "vcruntime140.dll";
export const STAGED_PATH = join(ROOT, "src-tauri", "binaries", RUNTIME_DLL);
export const MACHINE_X64 = 0x8664;

const VERSION_PATTERN = /^\d+(\.\d+)+$/;
const CRT_DIRECTORY_PATTERN = /^Microsoft\.VC(\d+)\.CRT$/i;
const MICROSOFT_ORGANIZATION = /(^|,\s*)O=Microsoft Corporation(\s*,|$)/;

export function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function newestRedistVersion(names) {
  return names.filter((name) => VERSION_PATTERN.test(name)).toSorted(compareVersions).at(-1);
}

export function newestCrtDirectory(names) {
  return names
    .filter((name) => CRT_DIRECTORY_PATTERN.test(name))
    .toSorted((left, right) => Number(left.match(CRT_DIRECTORY_PATTERN)[1]) - Number(right.match(CRT_DIRECTORY_PATTERN)[1]))
    .at(-1);
}

export function peMachine(bytes) {
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) return undefined;
  const header = bytes.readUInt32LE(0x3c);
  if (header + 6 > bytes.length || bytes.readUInt32LE(header) !== 0x00004550) return undefined;
  return bytes.readUInt16LE(header + 4);
}

export function signatureProblem(report) {
  if (report?.status !== "Valid") return `its signature status is ${report?.status ?? "unknown"}`;
  if (!MICROSOFT_ORGANIZATION.test(report.subject ?? "")) {
    return `it is signed by ${report.subject || "nobody"}, not Microsoft Corporation`;
  }
  return undefined;
}

function visualStudioRedistCandidates(env) {
  const programFiles = env["ProgramFiles(x86)"] ?? String.raw`C:\Program Files (x86)`;
  const vswhere = join(programFiles, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere)) return [];
  const installations = execFileSync(
    vswhere,
    ["-all", "-products", "*", "-property", "installationPath"],
    { encoding: "utf8" },
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = [];
  for (const installation of installations) {
    const redist = join(installation, "VC", "Redist", "MSVC");
    if (!existsSync(redist)) continue;
    const version = newestRedistVersion(readdirSync(redist));
    if (!version) continue;
    const x64 = join(redist, version, "x64");
    if (!existsSync(x64)) continue;
    const crt = newestCrtDirectory(readdirSync(x64));
    if (crt) candidates.push({ path: join(x64, crt, RUNTIME_DLL), version });
  }
  return candidates.toSorted((left, right) => compareVersions(right.version, left.version)).map(({ path }) => path);
}

function systemRoot(env) {
  return env.SystemRoot ?? String.raw`C:\Windows`;
}

function systemCandidate(env) {
  return join(systemRoot(env), "System32", RUNTIME_DLL);
}

export function windowsPowerShellEnvironment(env, candidate) {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([name]) => name.toLowerCase() !== "psmodulepath"),
  );
  return { ...cleaned, OLEAFLY_VCRUNTIME_CANDIDATE: candidate };
}

function inspect(path) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    String.raw`Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')`,
    "$path = $env:OLEAFLY_VCRUNTIME_CANDIDATE",
    "$signature = Get-AuthenticodeSignature -LiteralPath $path",
    "$subject = ''",
    "if ($signature.SignerCertificate) { $subject = $signature.SignerCertificate.Subject }",
    "[pscustomobject]@{ status = $signature.Status.ToString(); subject = $subject; version = (Get-Item -LiteralPath $path).VersionInfo.FileVersion } | ConvertTo-Json -Compress",
  ].join("; ");
  const output = execFileSync(
    join(systemRoot(process.env), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { encoding: "utf8", env: windowsPowerShellEnvironment(process.env, path), stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(output.trim());
}

function withoutMarkup(text) {
  let result = "";
  let insideTag = false;
  for (const character of text) {
    if (character === "<") {
      insideTag = true;
      result += " ";
    } else if (character === ">" && insideTag) {
      insideTag = false;
    } else if (!insideTag) {
      result += character;
    }
  }
  return result;
}

export function powerShellFailure(error) {
  const stderr = `${error?.stderr ?? ""}`.replace(/^#< CLIXML/, "").replaceAll("_x000D__x000A_", " ");
  const detail = withoutMarkup(stderr).replaceAll(/\s+/g, " ").trim();
  return `PowerShell could not check its signature (${detail || error?.message || "no output"})`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function main() {
  if (process.platform !== "win32") {
    console.log(`${RUNTIME_DLL} is only staged on Windows; nothing to do on ${process.platform}`);
    return;
  }
  const problems = [];
  for (const candidate of [...visualStudioRedistCandidates(process.env), systemCandidate(process.env)]) {
    if (!existsSync(candidate)) {
      problems.push(`${candidate}: not found`);
      continue;
    }
    const bytes = readFileSync(candidate);
    const machine = peMachine(bytes);
    if (machine !== MACHINE_X64) {
      problems.push(`${candidate}: not an x64 DLL (machine ${machine?.toString(16) ?? "unknown"})`);
      continue;
    }
    let report;
    try {
      report = inspect(candidate);
    } catch (error) {
      problems.push(`${candidate}: ${powerShellFailure(error)}`);
      continue;
    }
    const problem = signatureProblem(report);
    if (problem) {
      problems.push(`${candidate}: ${problem}`);
      continue;
    }
    mkdirSync(dirname(STAGED_PATH), { recursive: true });
    copyFileSync(candidate, STAGED_PATH);
    console.log(`staged ${RUNTIME_DLL} ${report.version} from ${candidate}`);
    console.log(`signer: ${report.subject}`);
    console.log(`sha256: ${sha256(bytes)}`);
    return;
  }
  console.error(`could not stage ${RUNTIME_DLL}; install Visual Studio Build Tools with the C++ workload or the Microsoft Visual C++ 2015-2022 x64 Redistributable`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main();
}
