import { useCallback, useEffect, useRef, useState } from "react";
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function commandName(command: string) {
  return command.trim().split(/[\\/]/).at(-1) || "Local command";
}

function transportSummary(server: McpImportedServer) {
  if (server.transport === "stdio") {
    const noun = server.args.length === 1 ? "argument" : "arguments";
    return `Local command: ${commandName(server.command)}. ${server.args.length} ${noun}.`;
  }
  try {
    return `Remote server: ${new URL(server.url).origin}.`;
  } catch {
    return "Remote server.";
  }
}

function connectionKeys(server: McpImportedServer) {
  const keys = Object.keys(server.transport === "stdio" ? server.env : server.headers).sort();
  if (keys.length === 0) return null;
  return `${server.transport === "stdio" ? "Environment" : "Headers"}: ${keys.join(", ")}`;
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
}: McpServerImportDialogProps) {
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
            [source]: errorMessage(error),
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
      setImportError(errorMessage(error));
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
          <DialogTitle>Import MCP servers</DialogTitle>
          <DialogDescription>
            Choose servers from the tools installed on this computer.
          </DialogDescription>
        </DialogHeader>

        {detecting ? (
          <p role="status" className="text-sm text-muted-foreground">
            Looking for MCP servers...
          </p>
        ) : null}

        {IMPORT_SOURCES.map((source) =>
          sourceErrors[source] ? (
            <p
              key={source}
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {SOURCE_LABELS[source]}: {sourceErrors[source]}
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
                      aria-label={`Import ${server.name} from ${SOURCE_LABELS[source]}`}
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
                          Already exists. It will be {duplicateAction === "skip" ? "skipped" : "overwritten"}.
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
            No MCP server configurations were found.
          </p>
        ) : null}

        {candidateCount > 0 ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">When names match</legend>
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
                  aria-label="Skip existing"
                  className="mt-0.5"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">Skip existing</span>
                  <span className="block text-xs text-muted-foreground">
                    Keep the server already saved in Oleafly.
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
                  aria-label="Overwrite existing"
                  className="mt-0.5"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">Overwrite existing</span>
                  <span className="block text-xs text-muted-foreground">
                    Replace it with the selected server.
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
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void importSelected()}
            disabled={detecting || importing || selected.length === 0}
          >
            {importing ? "Importing..." : "Import selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
