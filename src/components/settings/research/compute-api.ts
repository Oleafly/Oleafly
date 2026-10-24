import { invoke } from "@tauri-apps/api/core";
import { i18n } from "@/i18n";
import type { ComputeResources } from "@/lib/research-tasks";

export type { ComputeResources, RunProfile } from "@/lib/research-tasks";

export type GpuFlag = "gres" | "gpus";

export type ComputeTarget =
  | {
      kind: "ssh";
      id: string;
      label: string;
      host: string;
      user?: string | null;
      port?: number | null;
      remoteRoot?: string | null;
      prelude: string;
    }
  | {
      kind: "slurm";
      id: string;
      label: string;
      host: string;
      user?: string | null;
      port?: number | null;
      remoteRoot?: string | null;
      prelude: string;
      defaults: Partial<ComputeResources>;
      gpuFlag: GpuFlag;
    }
  | {
      kind: "cuaSpace";
      id: string;
      label: string;
      space: string;
      perTask: boolean;
      image?: string | null;
    };

export type ComputeKind = ComputeTarget["kind"];

export interface TestSummary {
  at: number;
  ok: boolean;
  resolved?: string | null;
  relay?: boolean;
}

export type ComputePlatform = "windows" | "macos" | "linux" | "other";

export interface ComputeView {
  platform: ComputePlatform;
  targets: ComputeTarget[];
  tested: Record<string, TestSummary>;
  sshAvailable: boolean;
  rsyncAvailable: boolean;
  cuaAvailable: boolean;
}

export type CheckId = "connect" | "echo" | "disk" | "python" | "gpu" | "rsync" | "slurm" | "cua" | "space";
export type CheckStatus = "pass" | "warn" | "fail" | "skipped";

export interface HostKeyPrompt {
  host: string;
  keys: { keyType: string; fingerprint: string }[];
  changed: boolean;
}

export interface ComputeTestReport {
  targetId: string;
  checks: { id: CheckId; status: CheckStatus; detail: string }[];
  hostKey?: HostKeyPrompt | null;
  resolved?: string | null;
  finishedAt: number;
  error?: string | null;
}

export interface SshConfigHost {
  alias: string;
  hostName?: string | null;
  user?: string | null;
  port?: number | null;
}

export interface RuntimeInstall {
  kind: "python" | "conda" | "venv" | "uv" | "pixi" | "r" | "julia" | "node";
  executable: string;
  prefix: string;
  source: "path" | "project" | "known_dir";
  note?: string | null;
}

export interface SandboxStatus {
  platform: ComputePlatform;
  available: boolean;
  reason?: string | null;
  windowsEnabled?: boolean | null;
  runtimes: RuntimeInstall[];
  grants: { path: string; scope: string; project?: string | null }[];
}

export interface SandboxCheckReport {
  platform: string;
  available: boolean;
  reason?: string | null;
  checks: { id: string; ok: boolean; expected: string; detail: string }[];
  privileges?: string | null;
}

/** Fired on `window` after a target is saved or removed. */
export const COMPUTE_TARGETS_CHANGED = "oleafly:compute-targets-changed";

export function announceTargetsChanged() {
  window.dispatchEvent(new CustomEvent(COMPUTE_TARGETS_CHANGED));
}

/** Fired on `window` after the Windows sandbox switch is saved; `detail` is the new `SandboxStatus`. */
export const COMPUTE_SANDBOX_CHANGED = "oleafly:compute-sandbox-changed";

export function announceSandboxChanged(status: SandboxStatus) {
  window.dispatchEvent(new CustomEvent<SandboxStatus>(COMPUTE_SANDBOX_CHANGED, { detail: status }));
}

/** The executor that runs a target's runs (`local` for this computer). */
export function executorFor(target: ComputeTarget | null | undefined): string {
  if (!target) return "local";
  if (target.kind === "cuaSpace") return "cua-space";
  return target.kind;
}

export type TargetField =
  | "label"
  | "host"
  | "user"
  | "port"
  | "remoteRoot"
  | "time"
  | "partition"
  | "account"
  | "qos"
  | "mem"
  | "gpus"
  | "cpus"
  | "space"
  | "image"
  | "prelude";

export type TargetError =
  | "label"
  | "host"
  | "user"
  | "port"
  | "remoteRoot"
  | "time"
  | "name"
  | "mem"
  | "count"
  | "prelude";

/** Rust's limit on a target's setup lines, in UTF-8 bytes. */
const MAX_PRELUDE_BYTES = 4 * 1024;

const HOST = /^[A-Za-z0-9._:%-]{1,253}$/;
const USER = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/;
const REMOTE_ROOT = /^[A-Za-z0-9._/-]{1,200}$/;
const NAME = /^[A-Za-z0-9_.,-]{1,64}$/;
const SPACE = /^[A-Za-z0-9._-]{1,63}$/;
const IMAGE = /^[A-Za-z0-9._/:@-]{1,200}$/;

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function wholeIn(value: number | null | undefined, min: number, max: number) {
  return value === null || value === undefined || (Number.isInteger(value) && value >= min && value <= max);
}

function hasControl(text: string) {
  return [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

type TargetErrors = Partial<Record<TargetField, TargetError>>;
type CuaSpaceTarget = Extract<ComputeTarget, { kind: "cuaSpace" }>;
type SlurmTarget = Extract<ComputeTarget, { kind: "slurm" }>;

function validateCuaSpace(target: CuaSpaceTarget, errors: TargetErrors) {
  if (!target.perTask && !SPACE.test(target.space)) errors.space = "name";
  if (present(target.image) && !IMAGE.test(target.image)) errors.image = "name";
}

function validateRemoteHost(target: Exclude<ComputeTarget, CuaSpaceTarget>, errors: TargetErrors) {
  if (!HOST.test(target.host) || target.host.startsWith("-")) errors.host = "host";
  if (present(target.user) && !USER.test(target.user)) errors.user = "user";
  if (!wholeIn(target.port, 1, 65_535)) errors.port = "port";
  if (
    present(target.remoteRoot) &&
    (!REMOTE_ROOT.test(target.remoteRoot) ||
      target.remoteRoot.startsWith("-") ||
      target.remoteRoot.split("/").includes(".."))
  ) {
    errors.remoteRoot = "remoteRoot";
  }
  // Rust counts bytes, so accented or CJK setup lines reach the limit sooner than the character count suggests.
  const prelude = target.prelude ?? "";
  if (new TextEncoder().encode(prelude).length > MAX_PRELUDE_BYTES || prelude.includes("\0")) {
    errors.prelude = "prelude";
  }
}

function validateSlurmDefaults(defaults: SlurmTarget["defaults"], errors: TargetErrors) {
  if (!wholeIn(defaults.timeMinutes, 1, 43_200)) errors.time = "time";
  for (const field of ["partition", "account", "qos"] as const) {
    const value = defaults[field];
    if (present(value) && !NAME.test(value)) errors[field] = "name";
  }
  if (!wholeIn(defaults.memoryGb, 1, 65_536)) errors.mem = "mem";
  if (!wholeIn(defaults.gpus, 0, 64)) errors.gpus = "count";
  if (!wholeIn(defaults.cpus, 1, 1024)) errors.cpus = "count";
}

/** The same rules the Rust side applies; values are error keys under `compute.form.errors`. */
export function validateTarget(target: ComputeTarget): TargetErrors {
  const errors: TargetErrors = {};
  const label = target.label.trim();
  if (label.length === 0 || [...label].length > 80 || hasControl(target.label)) errors.label = "label";
  if (target.kind === "cuaSpace") {
    validateCuaSpace(target, errors);
    return errors;
  }
  validateRemoteHost(target, errors);
  if (target.kind === "slurm") validateSlurmDefaults(target.defaults, errors);
  return errors;
}

/**
 * Minutes from a Slurm time: `minutes`, `minutes:seconds`,
 * `hours:minutes:seconds`, `days-hours`, `days-hours:minutes` or
 * `days-hours:minutes:seconds`. Seconds round up to a minute.
 */
export function parseSlurmTime(text: string): number | null {
  const value = text.trim();
  if (value === "") return null;
  const day = /^(\d+)-(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/.exec(value);
  let seconds: number;
  if (day) {
    const [, days, hours, minutes = "0", secs = "0"] = day;
    seconds = Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(secs);
  } else {
    const parts = value.split(":");
    if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
    const numbers = parts.map(Number);
    if (numbers.length === 1) seconds = numbers[0] * 60;
    else if (numbers.length === 2) seconds = numbers[0] * 60 + numbers[1];
    else seconds = numbers[0] * 3_600 + numbers[1] * 60 + numbers[2];
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 1 && minutes <= 43_200 ? minutes : null;
}

/** A Slurm time for a number of minutes (`2:00:00`, `1-12:00:00`). */
export function formatSlurmTime(minutes: number | null | undefined): string {
  if (!minutes) return "";
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  const clock = `${hours}:${String(rest).padStart(2, "0")}:00`;
  return days > 0 ? `${days}-${clock.padStart(8, "0")}` : clock;
}

/** Whether `value` is a name Slurm accepts for a partition, account or QOS (the same rule the Rust side applies). */
export function isSlurmName(value: string): boolean {
  return NAME.test(value);
}

/** A whole number from `min` to `max`, or `null` for anything else (such as "4 GPUs"). */
export function parseCount(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/** Gigabytes from `16`, `16G`, `16GB` or `1T`. */
export function parseMemory(text: string): number | null {
  const match = /^(\d{1,7})\s*([gt])?b?$/i.exec(text.trim());
  if (!match) return null;
  const amount = Number(match[1]) * (match[2]?.toLowerCase() === "t" ? 1024 : 1);
  return amount >= 1 && amount <= 65_536 ? amount : null;
}

/** Where a target runs, for one line of text. */
export function targetSummary(target: ComputeTarget, resolved?: string | null): string {
  if (resolved) return resolved;
  if (target.kind === "cuaSpace") {
    return target.perTask ? i18n.t(($) => $.researchTools.compute.targets.perTaskSpace) : target.space;
  }
  const user = present(target.user) ? `${target.user}@` : "";
  const port = target.port ? `:${target.port}` : "";
  return `${user}${target.host}${port}`;
}

export function emptyTarget(kind: ComputeKind): ComputeTarget {
  switch (kind) {
    case "ssh":
      return { kind, id: "", label: "", host: "", user: null, port: null, remoteRoot: null, prelude: "" };
    case "slurm":
      return {
        kind,
        id: "",
        label: "",
        host: "",
        user: null,
        port: null,
        remoteRoot: null,
        prelude: "",
        defaults: {},
        gpuFlag: "gres",
      };
    case "cuaSpace":
      return { kind, id: "", label: "", space: "", perTask: false, image: null };
  }
}

export const computeSettings = () => invoke<ComputeView>("research_compute_settings");
export const saveComputeTarget = (target: ComputeTarget) =>
  invoke<ComputeView>("research_compute_target_save", { target });
export const removeComputeTarget = (targetId: string) =>
  invoke<ComputeView>("research_compute_target_remove", { targetId });
export const sshConfigHosts = () => invoke<SshConfigHost[]>("research_compute_ssh_hosts");
export const testComputeTarget = (targetId: string) =>
  invoke<ComputeTestReport>("research_compute_target_test", { targetId });
export const trustHostKey = (targetId: string, fingerprints: string[]) =>
  invoke<ComputeTestReport>("research_compute_trust_host_key", { targetId, fingerprints });
export const forgetHostKey = (targetId: string) =>
  invoke<ComputeView>("research_compute_forget_host_key", { targetId });
export const sandboxStatus = (refresh = false) => invoke<SandboxStatus>("research_sandbox_status", { refresh });
export const setWindowsSandbox = (enabled: boolean) =>
  invoke<SandboxStatus>("research_sandbox_set_windows", { enabled });
export const removeSandboxAccess = () => invoke<SandboxStatus>("research_sandbox_remove_access");
export const checkSandbox = () => invoke<SandboxCheckReport>("research_sandbox_check");
