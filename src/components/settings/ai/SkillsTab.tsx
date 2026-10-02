import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
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
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { formatList, formatNumber } from "@/lib/intl";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { useFilesStore } from "@/store/files";
import {
  addSkill,
  createSkill,
  isSkillAvailable,
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
  type SkillProjectOverride,
  type SkillToggleScope,
  type UpdateSkillInput,
} from "@/lib/skills";
import { groupSkills, matchesSkillSearch } from "@/lib/skill-groups";
import { cn } from "@/lib/utils";
import { SkillCatalogList, SkillResultMessage, SkillsNoMatch } from "./SkillCatalogList";
import { SkillShareCard } from "./SkillShareCard";

type EditorTarget = "create" | SkillEntry | null;

/** Which setting the skill toggles show and change while a project is open. */
type SkillScope = "device" | "project";

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

function sourceBadge(source: SkillEntry["source"]): string {
  if (source === "bundled") return i18n.t(($) => $.settings.ai.skills.source.bundled);
  if (source === "catalog") return i18n.t(($) => $.settings.ai.skills.source.catalog);
  return i18n.t(($) => $.settings.ai.skills.source.added);
}

function tierLine(skill: SkillEntry): string {
  if (skill.tier === "vendored") {
    const bits = [skill.author, skill.license].filter((value): value is string => Boolean(value));
    return bits.length > 0
      ? i18n.t(($) => $.settings.ai.skills.tier.credits, {
          credits: formatList(bits, { type: "conjunction", style: "narrow" }),
        })
      : i18n.t(($) => $.settings.ai.skills.tier.vendored);
  }
  if (skill.tier === "native") return i18n.t(($) => $.settings.ai.skills.tier.native);
  if (skill.tier === "shelf")
    return skill.license
      ? i18n.t(($) => $.settings.ai.skills.tier.shelfWithLicense, { license: skill.license })
      : i18n.t(($) => $.settings.ai.skills.tier.shelf);
  return i18n.t(($) => $.settings.ai.skills.tier.user);
}

function formatBytes(bytes: number): string {
  if (!bytes) return i18n.t(($) => $.settings.ai.skills.size.bytes, { value: formatNumber(0) });
  if (bytes < 1000)
    return i18n.t(($) => $.settings.ai.skills.size.bytes, { value: formatNumber(bytes) });
  const kb = bytes / 1000;
  if (kb < 1000) {
    const digits = kb >= 10 ? 0 : 1;
    return i18n.t(($) => $.settings.ai.skills.size.kilobytes, {
      value: formatNumber(kb, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    });
  }
  const mb = kb / 1000;
  const digits = mb >= 10 ? 0 : 1;
  return i18n.t(($) => $.settings.ai.skills.size.megabytes, {
    value: formatNumber(mb, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  });
}

function SkillEditorDialog({
  target,
  onOpenChange,
  onSubmit,
}: Readonly<{
  target: EditorTarget;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: EditorForm) => Promise<string | null>;
}>) {
  const { t } = useTranslation(["common", "settings"]);
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
          ? t(($) => $.settings.ai.skills.editor.requiredAll)
          : t(($) => $.settings.ai.skills.editor.requiredBasics),
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
          <DialogTitle>
            {editing
              ? t(($) => $.settings.ai.skills.editor.editTitle)
              : t(($) => $.settings.ai.skills.editor.createTitle)}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? t(($) => $.settings.ai.skills.editor.editDescription)
              : t(($) => $.settings.ai.skills.editor.createDescription)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="skill-name" className="text-xs font-medium text-muted-foreground">
              {t(($) => $.common.labels.name)}
            </label>
            <Input
              id="skill-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder={t(($) => $.settings.ai.skills.editor.namePlaceholder)}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="skill-description"
              className="text-xs font-medium text-muted-foreground"
            >
              {t(($) => $.common.labels.description)}
            </label>
            <Input
              id="skill-description"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder={t(($) => $.settings.ai.skills.editor.descriptionPlaceholder)}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="skill-instructions"
              className="text-xs font-medium text-muted-foreground"
            >
              {t(($) => $.settings.ai.skills.editor.instructions)}
            </label>
            <Textarea
              id="skill-instructions"
              value={form.instructions}
              onChange={(event) =>
                setForm((current) => ({ ...current, instructions: event.target.value }))
              }
              rows={8}
              placeholder={t(($) => $.settings.ai.skills.editor.instructionsPlaceholder)}
              className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-xs leading-relaxed focus:border-ring"
            />
            {!editing && !form.instructions.trim() ? (
              <p className="text-xs text-muted-foreground">
                {t(($) => $.settings.ai.skills.editor.instructionsHint)}
              </p>
            ) : null}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {editing
              ? t(($) => $.common.actions.save)
              : t(($) => $.settings.ai.skills.editor.submitCreate)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type SkillGroup = ReturnType<typeof groupSkills>[number];

/** The groups with only the skills that match the search, empty groups dropped. */
function filterSkillGroups(
  groups: SkillGroup[],
  search: string,
  phaseLabels: Record<string, string>,
  groupLabels: Record<string, string>,
): SkillGroup[] {
  if (search.trim().length === 0) return groups;
  return groups
    .map((group) => ({
      ...group,
      skills: group.skills.filter((skill) =>
        matchesSkillSearch(search, [
          skill.name,
          skill.id,
          skill.description,
          skill.author,
          skill.phase,
          skill.phase ? phaseLabels[skill.phase] : null,
          groupLabels[group.key] ?? group.label,
          sourceBadge(skill.source),
        ]),
      ),
    }))
    .filter((group) => group.skills.length > 0);
}

/** What the installed list shows once loading and load errors are out of the way. */
function installedListState(
  skillCount: number,
  showNoMatch: boolean,
  visibleGroupCount: number,
): "empty" | "list" | null {
  if (skillCount === 0) return "empty";
  if (showNoMatch || visibleGroupCount > 0) return "list";
  return null;
}

const SCOPE_SEGMENT =
  "rounded border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:border-primary/50";
const SCOPE_SEGMENT_ACTIVE = "border-border bg-background text-foreground";
const SCOPE_SEGMENT_IDLE =
  "border-transparent text-muted-foreground hover:text-foreground focus-visible:bg-background/60 focus-visible:text-foreground";

/** All projects or This project: what each skill's switch changes. */
function SkillScopeControl({
  scope,
  onChange,
}: Readonly<{ scope: SkillScope; onChange: (scope: SkillScope) => void }>) {
  const { t } = useTranslation(["settings"]);
  const labels: Record<SkillScope, string> = {
    device: t(($) => $.settings.ai.skills.scope.device),
    project: t(($) => $.settings.ai.skills.scope.project),
  };
  return (
    <fieldset
      aria-label={t(($) => $.settings.ai.skills.scope.label)}
      data-testid="skills-scope"
      className="m-0 flex min-w-0 shrink-0 items-center rounded-md border-0 bg-muted p-0.5"
    >
      {(["device", "project"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={scope === value}
          data-testid={`skills-scope-${value}`}
          onClick={() => onChange(value)}
          className={cn(SCOPE_SEGMENT, scope === value ? SCOPE_SEGMENT_ACTIVE : SCOPE_SEGMENT_IDLE)}
        >
          {labels[value]}
        </button>
      ))}
    </fieldset>
  );
}

/** One installed skill: its switch, the project marker, files and actions. */
function SkillCard({
  skill,
  busy,
  filesExpanded,
  projectScope,
  phaseLabels,
  onToggle,
  onResetProject,
  onToggleFiles,
  onUpdate,
  onValidate,
  onEdit,
  onRemove,
}: Readonly<{
  skill: SkillEntry;
  busy: boolean;
  filesExpanded: boolean;
  projectScope: boolean;
  phaseLabels: Record<string, string>;
  onToggle: (skill: SkillEntry, enabled: boolean) => void;
  onResetProject: (skillId: string) => void;
  onToggleFiles: (skillId: string) => void;
  onUpdate: (skill: SkillEntry) => void;
  onValidate: (skillId: string) => void;
  onEdit: (skill: SkillEntry) => void;
  onRemove: (skill: SkillEntry) => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const validationMessage =
    skill.validation.status === "invalid" ? skill.validation.message : null;
  const invalid = validationMessage !== null;
  const metaBits = [
    tierLine(skill),
    skill.version ? `v${skill.version}` : null,
    skill.phase ? phaseLabels[skill.phase] ?? skill.phase : null,
  ].filter((value): value is string => Boolean(value));
  const isUserSkill = skill.source === "user";
  const projectAvailable = isSkillAvailable(skill);
  const changedForProject = projectScope && projectAvailable !== skill.enabled;
  const renderSkillActions = () => (
    <div className="mt-2 flex items-center justify-end gap-1">
      {skill.updateAvailable ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid={`skill-update-${skill.id}`}
          disabled={busy}
          onClick={() => onUpdate(skill)}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {t(($) => $.settings.ai.skills.updateAction)}
        </Button>
      ) : null}
      {isUserSkill ? (
        <>
          <Tooltip
            label={t(($) => $.settings.ai.skills.validateAria, {
              name: skill.name,
            })}
          >
            <button
              type="button"
              aria-label={t(($) => $.settings.ai.skills.validateAria, {
                name: skill.name,
              })}
              disabled={busy}
              onClick={() => onValidate(skill.id)}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </button>
          </Tooltip>
          <Tooltip
            label={t(($) => $.settings.ai.skills.editAria, { name: skill.name })}
          >
            <button
              type="button"
              aria-label={t(($) => $.settings.ai.skills.editAria, {
                name: skill.name,
              })}
              disabled={busy}
              onClick={() => onEdit(skill)}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Pencil className="size-3.5" />
            </button>
          </Tooltip>
        </>
      ) : null}
      {skill.removable ? (
        <Tooltip
          label={t(($) => $.settings.ai.skills.removeAria, { name: skill.name })}
        >
          <button
            type="button"
            aria-label={t(($) => $.settings.ai.skills.removeAria, {
              name: skill.name,
            })}
            disabled={busy}
            onClick={() => onRemove(skill)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );

  const renderSkillFiles = () => (
    skill.files.length > 0 ? (
      <div className="mt-1.5">
        <button
          type="button"
          data-testid={`skill-files-toggle-${skill.id}`}
          onClick={() => onToggleFiles(skill.id)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {filesExpanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {t(($) => $.settings.ai.skills.fileCount, {
            count: skill.files.length,
          })}
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
    ) : null
  );

  return (
    <div
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
                {t(($) => $.settings.ai.skills.invalidBadge)}
              </span>
            ) : null}
          </div>
          {metaBits.length > 0 ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {metaBits.join(" · ")}
            </p>
          ) : null}
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {skill.description || t(($) => $.settings.ai.skills.missingDescription)}
          </p>
          {renderSkillFiles()}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Switch
            data-testid={`skill-toggle-${skill.id}`}
            checked={projectScope ? projectAvailable : skill.enabled}
            disabled={invalid || busy}
            aria-label={
              projectScope
                ? t(($) => $.settings.ai.skills.useInProjectAria, {
                    name: skill.name,
                  })
                : t(($) => $.settings.ai.skills.useInAllProjectsAria, {
                    name: skill.name,
                  })
            }
            onCheckedChange={(enabled) => onToggle(skill, enabled)}
          />
          {changedForProject ? (
            <div
              data-testid={`skill-project-changed-${skill.id}`}
              className="flex items-center gap-1"
            >
              <span className="text-[10px] text-muted-foreground">
                {t(($) => $.settings.ai.skills.changedForProject)}
              </span>
              <button
                type="button"
                data-testid={`skill-project-reset-${skill.id}`}
                disabled={busy}
                aria-label={t(($) => $.settings.ai.skills.resetProjectAria, {
                  name: skill.name,
                })}
                onClick={() => onResetProject(skill.id)}
                className="rounded px-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 disabled:opacity-50"
              >
                {t(($) => $.settings.ai.skills.resetProject)}
              </button>
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

      {renderSkillActions()}
    </div>
  );
}

export function SkillsTab() {
  const { t } = useTranslation(["common", "settings"]);
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
  const [scope, setScope] = useState<SkillScope>("device");
  const [search, setSearch] = useState("");
  const [shelfMatches, setShelfMatches] = useState<number | null>(null);
  const projectScope = projectId !== null && scope === "project";

  const cacheRecord = (record: SkillEntry) => {
    queryClient.setQueryData<SkillEntry[]>(skillsQueryKey(projectId), (current) => {
      const previous = (current ?? []).find((skill) => skill.id === record.id);
      return upsertSkillRecord(
        current,
        previous
          ? {
              ...record,
              projectEnabled: previous.projectEnabled,
              projectDisabled: previous.projectDisabled,
            }
          : record,
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
      setMessage({ ok: false, text: describeError(error) });
      return null;
    } finally {
      setBusyId(null);
    }
  };

  const runSkillValidation = (skillId: string) => {
    void runRecordMutation(skillId, () => validateSkill(skillId));
  };

  const applyProjectScope = (skillId: string, enabled: SkillProjectOverride) => {
    if (!projectId) return;
    void runRecordMutation(
      skillId,
      () => setSkillProjectEnabled(projectId, skillId, enabled),
      "project",
    );
  };

  // In This project, a choice that matches the device setting clears the
  // override instead of pinning it, so the skill keeps following the device.
  const toggleSkill = (skill: SkillEntry, enabled: boolean) => {
    if (projectScope) {
      applyProjectScope(skill.id, enabled === skill.enabled ? null : enabled);
      return;
    }
    void runRecordMutation(skill.id, () => setSkillEnabled(skill.id, enabled), "device");
  };

  const addFolder = async () => {
    const selected = await pickOpenPath({
      directory: true,
      multiple: false,
      title: t(($) => $.settings.ai.skills.addFolderDialogTitle),
    });
    if (!selected || Array.isArray(selected)) return;
    const record = await runRecordMutation("add", () => addSkill(selected));
    if (record) {
      setMessage({
        ok: true,
        text: t(($) => $.settings.ai.skills.messages.added, { name: record.name }),
      });
    }
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
        return t(($) => $.settings.ai.skills.messages.editorClosed);
      }
      cacheRecord(record);
      setMessage({
        ok: true,
        text:
          editor === "create"
            ? t(($) => $.settings.ai.skills.messages.created, { name: record.name })
            : t(($) => $.settings.ai.skills.messages.saved, { name: record.name }),
      });
      return null;
    } catch (error) {
      return describeError(error);
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
      setMessage({
        ok: true,
        text: t(($) => $.settings.ai.skills.messages.removed, { name: target.name }),
      });
    } catch (error) {
      setMessage({ ok: false, text: describeError(error) });
    } finally {
      setBusyId(null);
    }
  };

  const confirmUpdate = async () => {
    const target = updateTarget;
    setUpdateTarget(null);
    if (!target) return;
    const record = await runRecordMutation(target.id, () => updateBuiltinSkill(target.id));
    if (record) {
      setMessage({
        ok: true,
        text: t(($) => $.settings.ai.skills.messages.updated, { name: record.name }),
      });
    }
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
  const phaseLabels: Record<string, string> = {
    research: t(($) => $.settings.ai.skills.phases.research),
    authoring: t(($) => $.settings.ai.skills.phases.authoring),
    figures: t(($) => $.settings.ai.skills.phases.figures),
    review: t(($) => $.settings.ai.skills.phases.review),
    submission: t(($) => $.settings.ai.skills.phases.submission),
    communication: t(($) => $.settings.ai.skills.phases.communication),
    tooling: t(($) => $.settings.ai.skills.phases.tooling),
  };
  const groupLabels: Record<string, string> = {
    ...phaseLabels,
    user: t(($) => $.settings.ai.skills.groups.user),
    shelf: t(($) => $.settings.ai.skills.groups.shelf),
  };
  const searching = search.trim().length > 0;
  const visibleGroups = filterSkillGroups(groups, search, phaseLabels, groupLabels);
  const installedMatches = visibleGroups.reduce(
    (count, group) => count + group.skills.length,
    0,
  );
  // One "No skills match" for the whole tab when neither list has a hit.
  const showNoMatch =
    searching && skills.length > 0 && installedMatches === 0 && shelfMatches === 0;
  const listState =
    query.isPending || (query.isError && skills.length === 0)
      ? null
      : installedListState(skills.length, showNoMatch, visibleGroups.length);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{t(($) => $.settings.ai.skills.title)}</p>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t(($) => $.settings.ai.skills.description)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void addFolder()}>
            {busyId === "add" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FolderPlus className="size-3.5" />
            )}
            {t(($) => $.settings.ai.skills.addFolder)}
          </Button>
          <Button type="button" size="sm" onClick={() => setEditor("create")}>
            <Plus className="size-3.5" />
            {t(($) => $.settings.ai.skills.createSkill)}
          </Button>
        </div>
      </div>

      <SkillShareCard />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            data-testid="skills-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t(($) => $.settings.ai.skills.search.ariaLabel)}
            placeholder={t(($) => $.settings.ai.skills.search.placeholder)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        {projectId ? <SkillScopeControl scope={scope} onChange={setScope} /> : null}
      </div>

      {query.isPending ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t(($) => $.settings.ai.skills.loading)}
        </div>
      ) : null}
      {!query.isPending && query.isError && skills.length === 0 ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
        >
          {t(($) => $.settings.ai.skills.loadFailed, { message: describeError(query.error) })}
        </div>
      ) : null}
      {listState === "empty" ? (
        <div className="rounded-md border px-3 py-4 text-xs text-muted-foreground">
          {t(($) => $.settings.ai.skills.empty)}
        </div>
      ) : null}
      {listState === "list" ? (
        <div className="space-y-4">
          {showNoMatch ? <SkillsNoMatch /> : null}
          {visibleGroups.map((group) => (
            <div key={group.key} data-testid={`skills-phase-${group.key}`} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {groupLabels[group.key] ?? group.label}
              </h3>
              <div className="space-y-2">
                {group.skills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    busy={busyId === skill.id}
                    filesExpanded={expandedFiles.has(skill.id)}
                    projectScope={projectScope}
                    phaseLabels={phaseLabels}
                    onToggle={toggleSkill}
                    onResetProject={(skillId) => applyProjectScope(skillId, null)}
                    onToggleFiles={toggleFiles}
                    onUpdate={setUpdateTarget}
                    onValidate={runSkillValidation}
                    onEdit={setEditor}
                    onRemove={setRemoveTarget}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <SkillCatalogList
        search={search}
        hideNoMatch={showNoMatch}
        onMatchCountChange={setShelfMatches}
      />

      {message ? <SkillResultMessage ok={message.ok} text={message.text} /> : null}

      <SkillEditorDialog
        target={editor}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        onSubmit={saveEditor}
      />

      <ConfirmationDialog
        open={removeTarget !== null}
        title={t(($) => $.settings.ai.skills.removeDialog.title)}
        description={t(($) => $.settings.ai.skills.removeDialog.description, {
          name: removeTarget?.name ?? "",
        })}
        confirmLabel={t(($) => $.common.actions.remove)}
        destructive
        onConfirm={() => void removeSelected()}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmationDialog
        open={updateTarget !== null}
        title={t(($) => $.settings.ai.skills.updateDialog.title)}
        description={t(($) => $.settings.ai.skills.updateDialog.description, {
          name: updateTarget?.name ?? "",
        })}
        confirmLabel={t(($) => $.settings.ai.skills.updateAction)}
        destructive
        onConfirm={() => void confirmUpdate()}
        onCancel={() => setUpdateTarget(null)}
      />
    </div>
  );
}
