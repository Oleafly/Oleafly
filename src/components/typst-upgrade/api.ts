import { invoke } from "@tauri-apps/api/core";

export interface TypstUpgradeRun {
  version: string;
  ok: boolean;
  pages: number | null;
  errors: number;
  warnings: number;
  compileTimeMs: number;
  failure: string | null;
}

export interface TypstUpgradeFinding {
  kind: "error" | "warning";
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
  hints: string[];
}

export interface TypstUpgradeReport {
  current: TypstUpgradeRun;
  candidate: TypstUpgradeRun;
  added: TypstUpgradeFinding[];
  removed: TypstUpgradeFinding[];
  unchanged: number;
}

export interface TypstUpgradeRequest {
  projectId: string;
  mainDoc: string;
  version: string;
  offline: boolean;
  typstVariant: string | null;
}

export const typstUpgradeCheck = (request: TypstUpgradeRequest) =>
  invoke<TypstUpgradeReport>("typst_upgrade_check", { ...request });
