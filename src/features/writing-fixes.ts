import type { FileEdits, Finding, TextEdit } from "@oleafly/preflight";
import {
  parseWritingSettings,
  serializeWritingSettings,
  type WritingSettings,
} from "@oleafly/preflight/writing/settings";
import { applyReferencePlan } from "@/lib/file-references/follow-rename";
import { setProjectWritingSettingsCmd } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

export interface WritingFixPlan {
  readonly files: ReadonlyMap<string, readonly TextEdit[]>;
  readonly applied: readonly Finding[];
  readonly skipped: number;
}

export interface WritingFixOutcome {
  readonly applied: number;
  readonly skipped: number;
  readonly failedFiles: readonly string[];
}

function fixFiles(finding: Finding, fallbackPath: string): FileEdits[] {
  if (!finding.fix) return [];
  return [{ file: finding.file ?? fallbackPath, edits: finding.fix.edits }, ...(finding.fix.otherFiles ?? [])];
}

function collides(taken: readonly TextEdit[], edit: TextEdit): boolean {
  return taken.some((other) =>
    edit.from === edit.to && other.from === other.to
      ? edit.from === other.from
      : (edit.from < other.to && other.from < edit.to) || edit.from === other.from,
  );
}

export function planWritingFixes(findings: readonly Finding[], fallbackPath: string): WritingFixPlan {
  const files = new Map<string, TextEdit[]>();
  const applied: Finding[] = [];
  let skipped = 0;
  for (const finding of findings) {
    const groups = fixFiles(finding, fallbackPath);
    if (groups.length === 0) continue;
    const fits = groups.every((group) => group.edits.every((edit) => !collides(files.get(group.file) ?? [], edit)));
    if (!fits) {
      skipped += 1;
      continue;
    }
    for (const group of groups) files.set(group.file, [...(files.get(group.file) ?? []), ...group.edits]);
    applied.push(finding);
  }
  return { files, applied, skipped };
}

function currentText(path: string): string | undefined {
  return useFilesStore.getState().files[path]?.content ?? useIndexStore.getState().texts[path];
}

export async function applyWritingFixes(findings: readonly Finding[]): Promise<WritingFixOutcome> {
  const state = useFilesStore.getState();
  const projectId = state.projectId;
  if (!projectId) return { applied: 0, skipped: findings.length, failedFiles: [] };
  const plan = planWritingFixes(findings, state.activePath ?? state.mainDoc);
  const missing: string[] = [];
  const planned = [...plan.files].flatMap(([path, edits]) => {
    const text = currentText(path);
    if (text === undefined) {
      missing.push(path);
      return [];
    }
    return [{ path, text, edits, references: edits.length }];
  });
  const failed = await applyReferencePlan(projectId, {
    files: planned,
    references: planned.reduce((sum, file) => sum + file.references, 0),
  });
  const failedFiles = [...missing, ...failed];
  const failedSet = new Set(failedFiles);
  const applied = plan.applied.filter((finding) =>
    fixFiles(finding, state.activePath ?? state.mainDoc).every((group) => !failedSet.has(group.file)),
  ).length;
  return { applied, skipped: plan.skipped, failedFiles };
}

export async function updateWritingSettings(change: (current: WritingSettings) => WritingSettings): Promise<WritingSettings | null> {
  const state = useFilesStore.getState();
  const projectId = state.projectId;
  if (!projectId) return null;
  const next = change(state.projectWritingSettings);
  const meta = await setProjectWritingSettingsCmd(projectId, serializeWritingSettings(next));
  const saved = parseWritingSettings(meta.writing);
  if (useFilesStore.getState().projectId === projectId) useFilesStore.setState({ projectWritingSettings: saved });
  return saved;
}

export function ignoreWritingFinding(finding: Finding): Promise<WritingSettings | null> {
  const fingerprint = finding.fingerprint;
  if (!fingerprint) return Promise.resolve(null);
  return updateWritingSettings((current) =>
    current.ignored.includes(fingerprint) ? current : { ...current, ignored: [...current.ignored, fingerprint] },
  );
}
