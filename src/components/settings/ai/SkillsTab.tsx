import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { useFilesStore } from "@/store/files";
import {
  addSkill,
  createSkill,
  mergeToggledSkillRecord,
  removeSkill,
  setSkillEnabled,
  setSkillProjectEnabled,
  SKILLS_QUERY_KEY,
  skillsQueryKey,
  updateBuiltinSkill,
  updateSkill,
  upsertSkillRecord,
  useSkills,
  validateSkill,
  type CreateSkillInput,
  type SkillEntry,
  type SkillToggleScope,
  type UpdateSkillInput,
} from "@/lib/skills";
import { SkillCatalogList } from "./SkillCatalogList";
import { SkillShareCard } from "./SkillShareCard";

type EditorTarget = "create" | SkillEntry | null;

interface EditorForm {
  name: string;
  description: string;
  instructions: string;
}

const EMPTY_FORM: EditorForm = {
  name: "",
  description: "",
  instructions: "",
};

const PHASE_ORDER = [
  "research",
  "authoring",
  "figures",
  "review",
  "submission",
  "communication",
  "tooling",
] as const;

const PHASE_LABELS: Record<string, string> = {
  research: "Research",
  authoring: "Authoring",
  figures: "Figures",
  review: "Review",
  submission: "Submission",
  communication: "Communication",
  tooling: "Tooling",
};

interface SkillGroup {
  key: string;
  label: string;
  skills: SkillEntry[];
}

function groupSkills(skills: readonly SkillEntry[]): SkillGroup[] {
  const byPhase = new Map<string, SkillEntry[]>();
  const yours: SkillEntry[] = [];
  const shelf: SkillEntry[] = [];
  for (const skill of skills) {
    if (skill.tier === "shelf") {
      shelf.push(skill);
      continue;
    }
    if (skill.phase && PHASE_LABELS[skill.phase]) {
      const list = byPhase.get(skill.phase) ?? [];
      list.push(skill);
      byPhase.set(skill.phase, list);
      continue;
    }
    yours.push(skill);
  }
  const byName = (list: SkillEntry[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
  const groups: SkillGroup[] = [];
  for (const phase of PHASE_ORDER) {
    const list = byPhase.get(phase);
    if (list && list.length > 0) {
      groups.push({ key: phase, label: PHASE_LABELS[phase], skills: byName(list) });
    }
  }
  if (yours.length > 0) groups.push({ key: "user", label: "Your skills", skills: byName(yours) });
  if (shelf.length > 0) groups.push({ key: "shelf", label: "Domain shelf", skills: byName(shelf) });
  return groups;
}

function sourceBadge(source: SkillEntry["source"]): string {
  if (source === "bundled") return "Built in";
  if (source === "catalog") return "Installed";
  return "Added";
}

function tierLine(skill: SkillEntry): string {
  if (skill.tier === "vendored") {
    const bits = [skill.author, skill.license].filter((value): value is string => Boolean(value));
    return bits.length > 0 ? `From ${bits.join(", ")}` : "Vendored skill";
  }
  if (skill.tier === "native") return "Oleafly workflow";
  if (skill.tier === "shelf") return skill.license ? `Domain shelf, ${skill.license}` : "Domain shelf skill";
  return "Your own skill";
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1000) return `${bytes} B`;
  const kb = bytes / 1000;
  if (kb < 1000) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1000;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function SkillEditorDialog({
  target,
  onOpenChange,
  onSubmit,
}: {
  target: EditorTarget;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: EditorForm) => Promise<string | null>;
}) {
  const [form, setForm] = useState<EditorForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = target !== null && target !== "create" ? target : null;

  useEffect(() => {
    if (!target) return;
    setForm(
      editing
        ? {
            name: editing.name,
            description: editing.description,
            instructions: editing.instructions,
          }
        : EMPTY_FORM,
    );
    setBusy(false);
    setError("");
  }, [editing, target]);

  const submit = async () => {
    const next = {
      name: form.name.trim(),
      description: form.description.trim(),
      instructions: form.instructions.trim(),
    };
    if (!next.name || !next.description || (editing && !next.instructions)) {
      setError(
        editing
          ? "Name, description, and instructions are required."
          : "Name and description are required.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const message = await onSubmit(next);
      if (message) {
        setError(message);
        return;
      }
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="z-[120]" overlayClassName="z-[120]">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit skill" : "Create skill"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Refine the metadata and instructions stored in SKILL.md."
              : "Create a SKILL.md draft in your Oleafly skills folder."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="skill-name" className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <Input
              id="skill-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Claim Checker"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="skill-description"
              className="text-xs font-medium text-muted-foreground"
            >
              Description
            </label>
            <Input
              id="skill-description"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="Check whether each claim has support."
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="skill-instructions"
              className="text-xs font-medium text-muted-foreground"
            >
              Instructions
            </label>
            <Textarea
              id="skill-instructions"
              value={form.instructions}
              onChange={(event) =>
                setForm((current) => ({ ...current, instructions: event.target.value }))
              }
              rows={8}
              placeholder="List when to use this skill and the steps the assistant should follow."
              className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {!editing && !form.instructions.trim() ? (
              <p className="text-xs text-muted-foreground">
                Leave this blank to create a minimal instruction scaffold.
              </p>
            ) : null}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SkillsTab() {
  const projectId = useFilesStore((s) => s.projectId);
  const queryClient = useQueryClient();
  const query = useSkills(projectId);
  const skills = query.data ?? [];
  const [editor, setEditor] = useState<EditorTarget>(null);
  const [removeTarget, setRemoveTarget] = useState<SkillEntry | null>(null);
  const [updateTarget, setUpdateTarget] = useState<SkillEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const cacheRecord = (record: SkillEntry) => {
    queryClient.setQueryData<SkillEntry[]>(skillsQueryKey(projectId), (current) => {
      const previous = (current ?? []).find((skill) => skill.id === record.id);
      return upsertSkillRecord(
        current,
        previous ? { ...record, projectEnabled: previous.projectEnabled } : record,
      );
    });
    void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY });
  };

  const cacheToggle = (record: SkillEntry, scope: SkillToggleScope) => {
    queryClient.setQueryData<SkillEntry[]>(skillsQueryKey(projectId), (current) =>
      mergeToggledSkillRecord(current, record, scope),
    );
    void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY });
  };

  const runRecordMutation = async (
    id: string,
    action: () => Promise<SkillEntry>,
    scope?: SkillToggleScope,
  ): Promise<SkillEntry | null> => {
    setBusyId(id);
    setMessage(null);
    try {
      const record = await action();
      if (scope) cacheToggle(record, scope);
      else cacheRecord(record);
      return record;
    } catch (error) {
      setMessage({ ok: false, text: String(error) });
      return null;
    } finally {
      setBusyId(null);
    }
  };

  const addFolder = async () => {
    const selected = await pickOpenPath({
      directory: true,
      multiple: false,
      title: "Add skill folder",
    });
    if (!selected || Array.isArray(selected)) return;
    const record = await runRecordMutation("add", () => addSkill(selected));
    if (record) setMessage({ ok: true, text: `Added ${record.name}.` });
  };

  const saveEditor = async (form: EditorForm): Promise<string | null> => {
    try {
      let record: SkillEntry;
      if (editor === "create") {
        const input: CreateSkillInput = {
          name: form.name,
          description: form.description,
          ...(form.instructions ? { instructions: form.instructions } : {}),
        };
        record = await createSkill(input);
      } else if (editor) {
        const input: UpdateSkillInput = form;
        record = await updateSkill(editor.id, input);
      } else {
        return "The skill editor is no longer open.";
      }
      cacheRecord(record);
      setMessage({
        ok: true,
        text: editor === "create" ? `Created ${record.name}.` : `Saved ${record.name}.`,
      });
      return null;
    } catch (error) {
      return String(error);
    }
  };

  const removeSelected = async () => {
    const target = removeTarget;
    setRemoveTarget(null);
    if (!target) return;
    setBusyId(target.id);
    setMessage(null);
    try {
      await removeSkill(target.id);
      queryClient.setQueryData<SkillEntry[]>(skillsQueryKey(projectId), (current) =>
        (current ?? []).filter((skill) => skill.id !== target.id),
      );
      setMessage({ ok: true, text: `Removed ${target.name}.` });
    } catch (error) {
      setMessage({ ok: false, text: String(error) });
    } finally {
      setBusyId(null);
    }
  };

  const confirmUpdate = async () => {
    const target = updateTarget;
    setUpdateTarget(null);
    if (!target) return;
    const record = await runRecordMutation(target.id, () => updateBuiltinSkill(target.id));
    if (record) setMessage({ ok: true, text: `Updated ${record.name}.` });
  };

  const toggleFiles = (id: string) => {
    setExpandedFiles((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const groups = groupSkills(skills);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Skills</p>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            A skill teaches the assistant a repeatable workflow. Turn one on here and it applies to
            every project on this device. Open a project and you can also turn a skill on for that
            project alone. The assistant loads a skill's full instructions only when it decides it
            needs one, or right away if you type /skill-id in the chat.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void addFolder()}>
            {busyId === "add" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FolderPlus className="size-3.5" />
            )}
            Add folder
          </Button>
          <Button type="button" size="sm" onClick={() => setEditor("create")}>
            <Plus className="size-3.5" />
            Create skill
          </Button>
        </div>
      </div>

      <SkillShareCard />

      {query.isPending ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Loading skills...
        </div>
      ) : query.isError && skills.length === 0 ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
        >
          Could not load skills. {String(query.error)}
        </div>
      ) : skills.length === 0 ? (
        <div className="rounded-md border px-3 py-4 text-xs text-muted-foreground">
          No skills found. Add a folder, or create one.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.key} data-testid={`skills-phase-${group.key}`} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.skills.map((skill) => {
                  const validationMessage =
                    skill.validation.status === "invalid" ? skill.validation.message : null;
                  const invalid = validationMessage !== null;
                  const busy = busyId === skill.id;
                  const filesExpanded = expandedFiles.has(skill.id);
                  const metaBits = [
                    tierLine(skill),
                    skill.version ? `v${skill.version}` : null,
                    skill.phase ? PHASE_LABELS[skill.phase] ?? skill.phase : null,
                  ].filter((value): value is string => Boolean(value));
                  const isUserSkill = skill.source === "user";
                  return (
                    <div
                      key={skill.id}
                      className="rounded-md border bg-card px-3 py-3"
                      data-testid={`skill-row-${skill.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{skill.name}</p>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {sourceBadge(skill.source)}
                            </span>
                            {invalid ? (
                              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                                Invalid
                              </span>
                            ) : null}
                          </div>
                          {metaBits.length > 0 ? (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {metaBits.join(" · ")}
                            </p>
                          ) : null}
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {skill.description || "This skill needs a description."}
                          </p>
                          {skill.files.length > 0 ? (
                            <div className="mt-1.5">
                              <button
                                type="button"
                                data-testid={`skill-files-toggle-${skill.id}`}
                                onClick={() => toggleFiles(skill.id)}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                {filesExpanded ? (
                                  <ChevronDown className="size-3" />
                                ) : (
                                  <ChevronRight className="size-3" />
                                )}
                                {skill.files.length} file{skill.files.length === 1 ? "" : "s"}
                              </button>
                              {filesExpanded ? (
                                <ul className="mt-1 space-y-0.5 rounded-md border bg-background p-2">
                                  {skill.files.map((file) => (
                                    <li
                                      key={file.path}
                                      className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                                    >
                                      <code className="min-w-0 truncate">{file.path}</code>
                                      <span className="shrink-0">{formatBytes(file.bytes)}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <Switch
                            checked={skill.enabled}
                            disabled={invalid || busy}
                            aria-label={`Enable ${skill.name}`}
                            onCheckedChange={(enabled) =>
                              void runRecordMutation(
                                skill.id,
                                () => setSkillEnabled(skill.id, enabled),
                                "device",
                              )
                            }
                          />
                          {projectId ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-muted-foreground">
                                Use in this project
                              </span>
                              <Switch
                                data-testid={`skill-project-toggle-${skill.id}`}
                                checked={skill.projectEnabled}
                                disabled={invalid || busy}
                                aria-label={`Use ${skill.name} in this project`}
                                onCheckedChange={(enabled) =>
                                  void runRecordMutation(
                                    skill.id,
                                    () => setSkillProjectEnabled(projectId, skill.id, enabled),
                                    "project",
                                  )
                                }
                              />
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {invalid ? (
                        <p
                          aria-live="polite"
                          className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
                        >
                          {validationMessage}
                        </p>
                      ) : null}

                      <div className="mt-2 flex items-center justify-end gap-1">
                        {skill.updateAvailable ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            data-testid={`skill-update-${skill.id}`}
                            disabled={busy}
                            onClick={() => setUpdateTarget(skill)}
                          >
                            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                            Update
                          </Button>
                        ) : null}
                        {isUserSkill ? (
                          <>
                            <Tooltip label={`Validate ${skill.name}`}>
                              <button
                                type="button"
                                aria-label={`Validate ${skill.name}`}
                                disabled={busy}
                                onClick={() =>
                                  void runRecordMutation(skill.id, () => validateSkill(skill.id))
                                }
                                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                              >
                                {busy ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="size-3.5" />
                                )}
                              </button>
                            </Tooltip>
                            <Tooltip label={`Edit ${skill.name}`}>
                              <button
                                type="button"
                                aria-label={`Edit ${skill.name}`}
                                disabled={busy}
                                onClick={() => setEditor(skill)}
                                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            </Tooltip>
                          </>
                        ) : null}
                        {skill.removable ? (
                          <Tooltip label={`Remove ${skill.name}`}>
                            <button
                              type="button"
                              aria-label={`Remove ${skill.name}`}
                              disabled={busy}
                              onClick={() => setRemoveTarget(skill)}
                              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </Tooltip>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <SkillCatalogList />

      {message ? (
        <div
          role={message.ok ? "status" : "alert"}
          aria-live="polite"
          className={
            message.ok
              ? "rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-600 dark:text-emerald-400"
              : "rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
          }
        >
          {message.text}
        </div>
      ) : null}

      <SkillEditorDialog
        target={editor}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        onSubmit={saveEditor}
      />

      <ConfirmationDialog
        open={removeTarget !== null}
        title="Remove skill"
        description={`Remove "${removeTarget?.name ?? ""}" and its folder from Oleafly? This cannot be undone.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => void removeSelected()}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmationDialog
        open={updateTarget !== null}
        title="Update skill"
        description={`Replace "${updateTarget?.name ?? ""}" with the latest bundled version? Any local edits to its files will be lost.`}
        confirmLabel="Update"
        destructive
        onConfirm={() => void confirmUpdate()}
        onCancel={() => setUpdateTarget(null)}
      />
    </div>
  );
}
