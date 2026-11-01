// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import enResearch from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import {
  emptyTarget,
  executorFor,
  formatSlurmTime,
  isSlurmName,
  parseCount,
  parseMemory,
  parseSlurmTime,
  targetSummary,
  validateTarget,
  type ComputeTarget,
} from "./compute-api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function ssh(patch: Partial<Extract<ComputeTarget, { kind: "ssh" }>> = {}): ComputeTarget {
  return { ...(emptyTarget("ssh") as Extract<ComputeTarget, { kind: "ssh" }>), label: "Lab", host: "c", ...patch };
}

describe("compute-api", () => {
  it("mirrors the Rust validation rules", () => {
    expect(validateTarget(ssh({ host: "a b" }))).toEqual({ host: "host" });
    expect(validateTarget(ssh({ host: "-oProxyCommand=x" }))).toEqual({ host: "host" });
    expect(validateTarget(ssh({ port: 0 }))).toEqual({ port: "port" });
    expect(validateTarget(ssh({ user: "root;rm" }))).toEqual({ user: "user" });
    expect(validateTarget(ssh({ remoteRoot: "../x" }))).toEqual({ remoteRoot: "remoteRoot" });
    expect(validateTarget(ssh({ label: "" }))).toEqual({ label: "label" });
    expect(validateTarget(ssh({ host: "cluster.example.edu", port: 2222, user: "jdoe" }))).toEqual({});
    const slurm: ComputeTarget = {
      ...(emptyTarget("slurm") as Extract<ComputeTarget, { kind: "slurm" }>),
      label: "Cluster",
      host: "c",
      defaults: { partition: "gpu\n#SBATCH --x", timeMinutes: 0, gpus: 65, memoryGb: 16 },
    };
    expect(validateTarget(slurm)).toEqual({ partition: "name", time: "time", gpus: "count" });
    const cua: ComputeTarget = { kind: "cuaSpace", id: "", label: "Space", space: "bad name", perTask: false };
    expect(validateTarget(cua)).toEqual({ space: "name" });
    expect(validateTarget({ ...cua, perTask: true, space: "" })).toEqual({});
  });

  it("counts the setup lines in bytes, as Rust does", () => {
    expect(validateTarget(ssh({ prelude: "a".repeat(4096) }))).toEqual({});
    expect(validateTarget(ssh({ prelude: "模".repeat(2048) }))).toEqual({ prelude: "prelude" });
    expect(validateTarget(ssh({ prelude: "module load python\0" }))).toEqual({ prelude: "prelude" });
    expect(enResearch.compute.form.errors.prelude).toContain("4 KB");
  });

  it("reads Slurm times and memory sizes", () => {
    expect(parseSlurmTime("90")).toBe(90);
    expect(parseSlurmTime("2:00:00")).toBe(120);
    expect(parseSlurmTime("30:30")).toBe(31);
    expect(parseSlurmTime("1-00:00:00")).toBe(1440);
    expect(parseSlurmTime("1-12")).toBe(2160);
    expect(parseSlurmTime("abc")).toBeNull();
    expect(parseSlurmTime("0")).toBeNull();
    expect(formatSlurmTime(120)).toBe("2:00:00");
    expect(formatSlurmTime(2160)).toBe("1-12:00:00");
    expect(formatSlurmTime(null)).toBe("");
    expect(parseMemory("16")).toBe(16);
    expect(parseMemory("16G")).toBe(16);
    expect(parseMemory("16gb")).toBe(16);
    expect(parseMemory("1T")).toBe(1024);
    expect(parseMemory("16M")).toBeNull();
    expect(parseMemory("0")).toBeNull();
  });

  it("checks Slurm names and counts the way a target's defaults are checked", () => {
    expect(isSlurmName("gpu-a100,cpu")).toBe(true);
    expect(isSlurmName("gpu\n#SBATCH --x")).toBe(false);
    expect(isSlurmName("two words")).toBe(false);
    expect(isSlurmName("x".repeat(65))).toBe(false);
    expect(parseCount("4", 0, 64)).toBe(4);
    expect(parseCount(" 16 ", 1, 1024)).toBe(16);
    expect(parseCount("0", 1, 1024)).toBeNull();
    expect(parseCount("0", 0, 64)).toBe(0);
    expect(parseCount("65", 0, 64)).toBeNull();
    expect(parseCount("4 GPUs", 0, 64)).toBeNull();
    expect(parseCount("", 0, 64)).toBeNull();
    expect(parseCount("-1", 0, 64)).toBeNull();
  });

  it("summarizes targets", () => {
    expect(targetSummary(ssh({ user: "jdoe", host: "c", port: 2222 }))).toBe("jdoe@c:2222");
    expect(targetSummary(ssh({ host: "c" }), "jdoe@c.example.edu:22")).toBe("jdoe@c.example.edu:22");
    expect(targetSummary({ kind: "cuaSpace", id: "t", label: "S", space: "", perTask: true })).toBe(
      enResearch.compute.targets.perTaskSpace,
    );
    expect(targetSummary({ kind: "cuaSpace", id: "t", label: "S", space: "lab", perTask: false })).toBe("lab");
  });

  it("maps targets to their executors", () => {
    expect(executorFor(null)).toBe("local");
    expect(executorFor(ssh())).toBe("ssh");
    expect(executorFor(emptyTarget("slurm"))).toBe("slurm");
    expect(executorFor(emptyTarget("cuaSpace"))).toBe("cua-space");
  });
});
