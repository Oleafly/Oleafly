import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MACHINE_X64,
  compareVersions,
  newestCrtDirectory,
  newestRedistVersion,
  peMachine,
  powerShellFailure,
  signatureProblem,
  windowsPowerShellEnvironment,
} from "./stage-windows-vcruntime.mjs";

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "stage-windows-vcruntime.mjs");

function portableExecutable(machine) {
  const bytes = Buffer.alloc(0x100);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.writeUInt32LE(0x00004550, 0x80);
  bytes.writeUInt16LE(machine, 0x84);
  return bytes;
}

test("versions compare numerically, segment by segment", () => {
  assert.ok(compareVersions("14.44.35112", "14.38.33130") > 0);
  assert.ok(compareVersions("14.9.1", "14.10.0") < 0);
  assert.equal(compareVersions("14.40", "14.40.0"), 0);
});

test("the newest MSVC redistributable folder wins and the v143 alias is ignored", () => {
  assert.equal(newestRedistVersion(["v143", "14.38.33130", "14.44.35112", "14.40.33807"]), "14.44.35112");
  assert.equal(newestRedistVersion(["v143", "debug_nonredist"]), undefined);
});

test("the newest CRT folder wins over older toolsets and other runtimes", () => {
  assert.equal(
    newestCrtDirectory(["Microsoft.VC142.CRT", "Microsoft.VC143.CRT", "Microsoft.VC143.OpenMP", "Microsoft.VC143.MFC"]),
    "Microsoft.VC143.CRT",
  );
  assert.equal(newestCrtDirectory(["Microsoft.VC143.OpenMP"]), undefined);
});

test("only an x64 portable executable reports the x64 machine", () => {
  assert.equal(peMachine(portableExecutable(MACHINE_X64)), MACHINE_X64);
  assert.equal(peMachine(portableExecutable(0x014c)), 0x014c);
  assert.equal(peMachine(Buffer.from("not a dll")), undefined);
  const truncated = portableExecutable(MACHINE_X64).subarray(0, 0x50);
  assert.equal(peMachine(truncated), undefined);
});

test("only a valid Microsoft Corporation signature is accepted", () => {
  const microsoft = "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US";
  assert.equal(signatureProblem({ status: "Valid", subject: microsoft }), undefined);
  assert.match(signatureProblem({ status: "NotSigned", subject: "" }), /NotSigned/);
  assert.match(signatureProblem({ status: "HashMismatch", subject: microsoft }), /HashMismatch/);
  assert.match(
    signatureProblem({ status: "Valid", subject: "CN=Microsoft Corporation, O=Someone Else, C=US" }),
    /not Microsoft Corporation/,
  );
  assert.match(signatureProblem(undefined), /unknown/);
});

test("Windows PowerShell starts without a module path inherited from PowerShell 7", () => {
  const environment = windowsPowerShellEnvironment(
    { PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules", psmodulepath: "x", Path: "C:\\bin" },
    "C:\\Windows\\System32\\vcruntime140.dll",
  );
  assert.deepEqual(Object.keys(environment).sort(), ["OLEAFLY_VCRUNTIME_CANDIDATE", "Path"]);
  assert.equal(environment.OLEAFLY_VCRUNTIME_CANDIDATE, "C:\\Windows\\System32\\vcruntime140.dll");
});

test("a PowerShell failure is reported as one readable line", () => {
  const stderr =
    '#< CLIXML\r\n<Objs Version="1.1.0.1"><S S="Error">Get-AuthenticodeSignature : The module could _x000D__x000A_</S><S S="Error">not be loaded.</S></Objs>';
  assert.equal(
    powerShellFailure({ stderr, message: "Command failed" }),
    "PowerShell could not check its signature (Get-AuthenticodeSignature : The module could not be loaded.)",
  );
  assert.equal(
    powerShellFailure({ message: "spawn powershell.exe ENOENT" }),
    "PowerShell could not check its signature (spawn powershell.exe ENOENT)",
  );
});

test("the script does nothing outside Windows", { skip: process.platform === "win32" }, () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /only staged on Windows/);
});
