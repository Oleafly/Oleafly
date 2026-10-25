import type { DiffConfig } from "@codemirror/merge";

export const MERGE_DIFF_CONFIG: DiffConfig = { scanLimit: 20_000, timeout: 1_000 };
