import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { appModalCoordinator } from "@/components/ui/use-modal-accessibility";
import { describeError } from "@/lib/app-error";
import { i18n } from "@/i18n";
import {
  mcpImportSource,
  type McpImportedServer,
  type McpImportSourceTool,
} from "@/lib/tauri";

const IMPORT_SOURCES: readonly McpImportSourceTool[] = [
  "claude-desktop",
  "claude-code",
  "codex",
  "cursor",
  "windsurf",
];

const SOURCE_LABELS: Record<McpImportSourceTool, string> = {
  "claude-desktop": "Claude Desktop",
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  windsurf: "Windsurf",
};

type SourceCandidates = Partial<Record<McpImportSourceTool, McpImportedServer[]>>;
type SourceErrors = Partial<Record<McpImportSourceTool, string>>;

function commandName(command: string) {
  return (
    command.trim().split(/[\\/]/).at(-1) ||
    i18n.t(($) => $.settings.mcp.import.summary.commandFallback)
  );
}

function transportSummary(server: McpImportedServer) {
  if (server.transport === "stdio") {
    return i18n.t(($) => $.settings.mcp.import.summary.stdio, {
      command: commandName(server.command),
      count: server.args.length,
    });
  }
  try {
    return i18n.t(($) => $.settings.mcp.import.summary.remote, {
      origin: new URL(server.url).origin,
    });
  } catch {
    return i18n.t(($) => $.settings.mcp.import.summary.remoteUnknown);
  }
}

function connectionKeys(server: McpImportedServer) {
  const keys = Object.keys(server.transport === "stdio" ? server.env : server.headers).sort(
    (a, b) => a.localeCompare(b),
  );
  if (keys.length === 0) return null;
  const names = keys.join(", ");
  return server.transport === "stdio"
    ? i18n.t(($) => $.settings.mcp.import.keys.environment, { names })
    : i18n.t(($) => $.settings.mcp.import.keys.headers, { names });
}

function candidateId(source: McpImportSourceTool, name: string) {
  return `${source}:${name}`;
}

export type McpServerDuplicateAction = "skip" | "overwrite";

export interface McpServerImportSelection {
  selected: McpImportedServer[];
  duplicateAction: McpServerDuplicateAction;
}

export interface McpServerImportDialogProps {
  open: boolean;
  existingNames: readonly string[];
  onClose: () => void;
  onImport: (selection: McpServerImportSelection) => Promise<void>;
}

export function McpServerImportDialog({
  open,
  existingNames,
  onClose,
  onImport,
}: Readonly<McpServerImportDialogProps>) {
  const { t } = useTranslation(["common", "settings"]);
  const [candidates, setCandidates] = useState<SourceCandidates>({});
  const [sourceErrors, setSourceErrors] = useState<SourceErrors>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [duplicateAction, setDuplicateAction] =
    useState<McpServerDuplicateAction>("skip");
  const [detecting, setDetecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const detectionGeneration = useRef(0);
  const scanStartedForOpen = useRef(false);

  const resetDialogState = useCallback(() => {
    detectionGeneration.current += 1;
    setCandidates({});
    setSourceErrors({});
    setSelectedIds(new Set());
    setDuplicateAction("skip");
    setDetecting(false);
    setImporting(false);
    setImportError(null);
  }, []);

  useEffect(() => {
    if (!open) {
      scanStartedForOpen.current = false;
      resetDialogState();
      return;
    }
    if (scanStartedForOpen.current) return;
    scanStartedForOpen.current = true;
    resetDialogState();
    const generation = detectionGeneration.current;
    setDetecting(true);
    void Promise.all(
      IMPORT_SOURCES.map(async (source) => {
        try {
          const servers = await mcpImportSource(source);
          if (detectionGeneration.current !== generation) return;
          setCandidates((current) => ({ ...current, [source]: servers }));
          setSelectedIds((current) => {
            const next = new Set(current);
            servers.forEach((server) => {
              next.add(candidateId(source, server.name));
            });
            return next;
          });
        } catch (error) {
          if (detectionGeneration.current !== generation) return;
          setSourceErrors((current) => ({
            ...current,
            [source]: describeError(error),
          }));
        }
      }),
    ).then(() => {
      if (detectionGeneration.current === generation) setDetecting(false);
    });
  }, [open, resetDialogState]);

  const selected = IMPORT_SOURCES.flatMap((source) =>
    (candidates[source] ?? []).filter((server) =>
      selectedIds.has(candidateId(source, server.name)),
    ),
  );
  const candidateCount = IMPORT_SOURCES.reduce(
    (count, source) => count + (candidates[source]?.length ?? 0),
    0,
  );

  const closeDialog = () => {
    scanStartedForOpen.current = false;
    resetDialogState();
    onClose();
  };

  const importSelected = async () => {
    setImporting(true);
    setImportError(null);
    try {
      await onImport({ selected, duplicateAction });
      closeDialog();
    } catch (error) {
      setImportError(describeError(error));
      setImporting(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modalId = appModalCoordinator.add(opener);
    return () => {
      appModalCoordinator.remove(modalId)?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && !importing && closeDialog()}
    >
      <DialogContent
        closeDisabled={importing}
        onEscapeKeyDown={(event) => importing && event.preventDefault()}
        onPointerDownOutside={(event) => importing && event.preventDefault()}
        className="z-[120] max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl"
        overlayClassName="z-[120]"
      >
        <DialogHeader>
          <DialogTitle>{t(($) => $.settings.mcp.import.title)}</DialogTitle>
          <DialogDescription>
            {t(($) => $.settings.mcp.import.description)}
          </DialogDescription>
        </DialogHeader>

        {detecting ? (
          <output className="block text-sm text-muted-foreground">
            {t(($) => $.settings.mcp.import.detecting)}
          </output>
        ) : null}

        {IMPORT_SOURCES.map((source) =>
          sourceErrors[source] ? (
            <p
              key={source}
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {t(($) => $.settings.mcp.import.sourceError, {
                source: SOURCE_LABELS[source],
                message: sourceErrors[source],
              })}
            </p>
          ) : null,
        )}

        {IMPORT_SOURCES.map((source) => {
          const servers = candidates[source] ?? [];
          if (servers.length === 0) return null;
          return (
            <fieldset key={source} className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">{SOURCE_LABELS[source]}</legend>
              {servers.map((server, index) => {
                const duplicate = existingNames.includes(server.name);
                const keys = connectionKeys(server);
                const checkboxId = `mcp-import-${source}-${index}`;
                const id = candidateId(source, server.name);
                return (
                  <label
                    key={`${source}:${server.name}`}
                    htmlFor={checkboxId}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={selectedIds.has(id)}
                      disabled={importing}
                      onCheckedChange={(checked) => {
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (checked === true) next.add(id);
                          else next.delete(id);
                          return next;
                        });
                      }}
                      className="mt-0.5"
                      aria-label={t(($) => $.settings.mcp.import.candidateLabel, {
                        name: server.name,
                        source: SOURCE_LABELS[source],
                      })}
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="block text-sm font-medium">{server.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {transportSummary(server)}
                      </span>
                      {keys ? (
                        <span className="block text-xs text-muted-foreground">{keys}</span>
                      ) : null}
                      {duplicate ? (
                        <span className="block text-xs text-amber-600 dark:text-amber-400">
                          {duplicateAction === "skip"
                            ? t(($) => $.settings.mcp.import.duplicateSkipped)
                            : t(($) => $.settings.mcp.import.duplicateOverwritten)}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          );
        })}

        {!detecting && candidateCount === 0 && Object.keys(sourceErrors).length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            {t(($) => $.settings.mcp.import.emptyState)}
          </p>
        ) : null}

        {candidateCount > 0 ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t(($) => $.settings.mcp.import.duplicates.legend)}</legend>
            <RadioGroup
              value={duplicateAction}
              disabled={importing}
              onValueChange={(value) =>
                setDuplicateAction(value as McpServerDuplicateAction)
              }
            >
              <label
                htmlFor="mcp-import-skip-existing"
                className="flex cursor-pointer items-start gap-3 rounded-md border p-3"
              >
                <RadioGroupItem
                  id="mcp-import-skip-existing"
                  value="skip"
                  aria-label={t(($) => $.settings.mcp.import.duplicates.skip.label)}
                  className="mt-0.5"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    {t(($) => $.settings.mcp.import.duplicates.skip.label)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(($) => $.settings.mcp.import.duplicates.skip.description)}
                  </span>
                </span>
              </label>
              <label
                htmlFor="mcp-import-overwrite-existing"
                className="flex cursor-pointer items-start gap-3 rounded-md border p-3"
              >
                <RadioGroupItem
                  id="mcp-import-overwrite-existing"
                  value="overwrite"
                  aria-label={t(($) => $.settings.mcp.import.duplicates.overwrite.label)}
                  className="mt-0.5"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    {t(($) => $.settings.mcp.import.duplicates.overwrite.label)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(($) => $.settings.mcp.import.duplicates.overwrite.description)}
                  </span>
                </span>
              </label>
            </RadioGroup>
          </fieldset>
        ) : null}

        {importError ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {importError}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={closeDialog} disabled={importing}>
            {t(($) => $.common.actions.cancel)}
          </Button>
          <Button
            type="button"
            onClick={() => void importSelected()}
            disabled={detecting || importing || selected.length === 0}
          >
            {importing
              ? t(($) => $.settings.mcp.import.importing)
              : t(($) => $.settings.mcp.import.submit)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
