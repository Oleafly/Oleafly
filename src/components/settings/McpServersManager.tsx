import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Download,
  Globe2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import {
  McpServerImportDialog,
  type McpServerImportSelection,
} from "@/components/settings/McpServerImportDialog";
import { Badge } from "@/components/ui/badge";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { appModalCoordinator } from "@/components/ui/use-modal-accessibility";
import { notifyMcpAgentToolsChanged } from "@/lib/mcp-agent-tools";
import {
  parseMcpServerJson,
  runMcpServerImport,
  serializeMcpServerJson,
  type McpServerImportResult,
} from "@/lib/mcp-server-config";
import {
  REDACTED_MARKER,
  mcpServerAdd,
  mcpServerRemove,
  mcpServerSetEnabled,
  mcpServersList,
  mcpServerUpdate,
  mcpServerUpdateValidated,
  mcpServerValidate,
  type McpManagedServer,
  type McpServerConfig,
  type McpServerValidation,
  type McpServerValidationStatus,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";

type PairValue = {
  id: number;
  key: string;
  value: string;
  stored: boolean;
};

type EditorState =
  | { mode: "add"; originalName: null; config: McpServerConfig }
  | { mode: "edit"; originalName: string; config: McpServerConfig };

const LIVE_STATUS_REFRESH_MS = 60_000;
const AUTO_VALIDATION_LIMIT = 64;
const AUTO_VALIDATION_CONCURRENCY = 4;

const emptyStdioConfig = (): McpServerConfig => ({
  name: "",
  enabled: true,
  transport: "stdio",
  command: "",
  args: [],
  env: {},
});

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function replaceRecord(records: McpManagedServer[], next: McpManagedServer) {
  const found = records.some((record) => record.config.name === next.config.name);
  if (!found) return [...records, next];
  return records.map((record) =>
    record.config.name === next.config.name ? next : record,
  );
}

function replaceValidation(
  records: McpManagedServer[],
  name: string,
  validation: McpServerValidation,
) {
  return records.map((record) =>
    record.config.name === name ? { ...record, validation } : record,
  );
}

function validationError(name: string, error: unknown): McpServerValidation {
  return {
    name,
    status: "error",
    tool_count: 0,
    tools: [],
    error: errorMessage(error),
  };
}

function statusLabel(status: McpServerValidationStatus) {
  if (status === "connected") return "Connected";
  if (status === "error") return "Error";
  if (status === "disabled") return "Disabled";
  return "Checking...";
}

function liveStatus(record: McpManagedServer) {
  const { name, enabled } = record.config;
  const { status, tool_count: toolCount } = record.validation;
  const tools = toolCount === 1 ? "1 tool" : `${toolCount} tools`;
  if (status === "checking") return `Checking ${name}.`;
  if (!enabled) {
    if (status === "connected") return `${name} is disabled. Last check found ${tools}.`;
    if (status === "error") return `${name} is disabled. Last check failed.`;
    return `${name} is disabled.`;
  }
  if (status === "connected") return `${name} connected. ${tools} available.`;
  if (status === "error") return `${name} validation failed.`;
  return `${name} is disabled.`;
}

function StatusBadge({ record }: { record: McpManagedServer }) {
  const status = record.config.enabled ? record.validation.status : "disabled";
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "connected" && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
        status === "error" && "border-destructive/30 text-destructive",
        status === "checking" && "text-muted-foreground",
      )}
    >
      {status === "checking" ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
      {statusLabel(status)}
    </Badge>
  );
}

function initialPairs(values: Record<string, string>): PairValue[] {
  const entries = Object.entries(values);
  if (entries.length === 0) return [{ id: 1, key: "", value: "", stored: false }];
  return entries.map(([key, value], index) => ({
    id: index + 1,
    key,
    value: value === REDACTED_MARKER ? "" : value,
    stored: value === REDACTED_MARKER,
  }));
}

function pairsToRecord(rows: PairValue[]) {
  return Object.fromEntries(
    rows
      .filter((row) => row.key.trim().length > 0)
      .map((row) => [row.key.trim(), row.stored && row.value === "" ? REDACTED_MARKER : row.value]),
  );
}

function PairEditor({
  kind,
  rows,
  onChange,
}: {
  kind: "Environment" | "Header";
  rows: PairValue[];
  onChange: (rows: PairValue[]) => void;
}) {
  const nextId = useRef(Math.max(1, ...rows.map((row) => row.id)) + 1);
  const noun = kind === "Environment" ? "variable" : "header";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium">
          {kind === "Environment" ? "Environment variables" : "Request headers"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            onChange([...rows, { id: nextId.current++, key: "", value: "", stored: false }]);
          }}
        >
          <Plus aria-hidden />
          Add {noun}
        </Button>
      </div>
      {rows.map((row, index) => (
        <div key={row.id} className="flex items-center gap-2">
          <Input
            aria-label={`${kind} key ${index + 1}`}
            autoComplete="off"
            placeholder="Name"
            value={row.key}
            onChange={(event) =>
              onChange(
                rows.map((candidate) =>
                  candidate.id === row.id
                    ? { ...candidate, key: event.target.value }
                    : candidate,
                ),
              )
            }
          />
          <Input
            aria-label={`${kind} value ${index + 1}`}
            autoComplete="off"
            placeholder={row.stored ? "Stored value" : "Value"}
            type="password"
            value={row.value}
            onChange={(event) =>
              onChange(
                rows.map((candidate) =>
                  candidate.id === row.id
                    ? { ...candidate, value: event.target.value, stored: false }
                    : candidate,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${noun} ${index + 1}`}
            onClick={() => {
              const remaining = rows.filter((candidate) => candidate.id !== row.id);
              onChange(
                remaining.length > 0
                  ? remaining
                  : [{ id: nextId.current++, key: "", value: "", stored: false }],
              );
            }}
          >
            <X aria-hidden />
          </Button>
        </div>
      ))}
    </div>
  );
}

function ServerEditor({
  state,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  state: EditorState | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (originalName: string | null, config: McpServerConfig) => Promise<void>;
}) {
  const [config, setConfig] = useState<McpServerConfig>(state?.config ?? emptyStdioConfig());
  const [argsText, setArgsText] = useState(
    state?.config.transport === "stdio" ? state.config.args.join("\n") : "",
  );
  const [pairs, setPairs] = useState<PairValue[]>(
    state?.config.transport === "remote"
      ? initialPairs(state.config.headers)
      : initialPairs(state?.config.transport === "stdio" ? state.config.env : {}),
  );
  const [editorView, setEditorView] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const serverNameRef = useRef<HTMLInputElement>(null);

  const applyFormConfig = (next: McpServerConfig) => {
    setConfig(next);
    setArgsText(next.transport === "stdio" ? next.args.join("\n") : "");
    setPairs(
      next.transport === "remote" ? initialPairs(next.headers) : initialPairs(next.env),
    );
  };

  useEffect(() => {
    if (!state) return;
    setConfig(state.config);
    setArgsText(state.config.transport === "stdio" ? state.config.args.join("\n") : "");
    setPairs(
      state.config.transport === "remote"
        ? initialPairs(state.config.headers)
        : initialPairs(state.config.env),
    );
    setEditorView("form");
    setJsonText("");
    setJsonError(null);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modalId = appModalCoordinator.add(opener);
    return () => {
      appModalCoordinator.remove(modalId)?.focus({ preventScroll: true });
    };
  }, [state]);

  const formConfig = (): McpServerConfig =>
    config.transport === "stdio"
      ? {
          ...config,
          name: config.name.trim(),
          command: config.command.trim(),
          args: argsText.split(/\r?\n/).filter((argument) => argument.length > 0),
          env: pairsToRecord(pairs),
        }
      : {
          ...config,
          name: config.name.trim(),
          url: config.url.trim(),
          headers: pairsToRecord(pairs),
        };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!state) return;
    if (state.mode === "add" && editorView === "json") {
      try {
        setJsonError(null);
        void onSubmit(state.originalName, parseMcpServerJson(jsonText));
      } catch (parseError) {
        setJsonError(errorMessage(parseError));
      }
      return;
    }
    void onSubmit(state.originalName, formConfig());
  };

  const valid =
    state?.mode === "add" && editorView === "json"
      ? jsonText.trim().length > 0
      : config.name.trim().length > 0 &&
        (config.transport === "stdio"
          ? config.command.trim().length > 0
          : config.url.trim().length > 0);

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="z-[120] max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl"
        overlayClassName="z-[120]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          serverNameRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
          <DialogDescription>
            Enabled servers are checked before their settings are saved.
          </DialogDescription>
        </DialogHeader>
        {state?.mode === "add" ? (
          <fieldset
            className="absolute right-11 top-3 flex rounded-md bg-muted p-0.5"
            aria-label="Configuration editor"
          >
            <Button
              type="button"
              variant={editorView === "form" ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={editorView === "form"}
              onClick={() => {
                if (editorView === "json") {
                  try {
                    applyFormConfig(parseMcpServerJson(jsonText));
                    setEditorView("form");
                    setJsonError(null);
                  } catch (parseError) {
                    setJsonError(errorMessage(parseError));
                  }
                }
              }}
            >
              Form
            </Button>
            <Button
              type="button"
              variant={editorView === "json" ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={editorView === "json"}
              onClick={() => {
                if (editorView === "json") return;
                setJsonText(serializeMcpServerJson(formConfig()));
                setEditorView("json");
                setJsonError(null);
              }}
            >
              JSON
            </Button>
          </fieldset>
        ) : null}
        <form className="space-y-4" onSubmit={submit}>
          {state?.mode === "add" && editorView === "json" ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="mcp-server-json">
                Full configuration
              </label>
              <Textarea
                id="mcp-server-json"
                className="min-h-64 font-mono text-xs"
                spellCheck={false}
                value={jsonText}
                onChange={(event) => {
                  setJsonText(event.target.value);
                  setJsonError(null);
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Paste one server keyed by name, or a block wrapped in mcpServers.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor="mcp-server-name">
                  Server name
                </label>
                <Input
                  ref={serverNameRef}
                  id="mcp-server-name"
                  autoComplete="off"
                  value={config.name}
                  onChange={(event) => setConfig({ ...config, name: event.target.value })}
                />
              </div>

              <fieldset className="space-y-2">
                <legend className="text-xs font-medium">Transport</legend>
                <RadioGroup
                  className="grid grid-cols-2 gap-2"
                  value={config.transport}
                  onValueChange={(transport) => {
                    if (transport === "stdio") {
                      setConfig({
                        name: config.name,
                        enabled: config.enabled,
                        transport: "stdio",
                        command: "",
                        args: [],
                        env: {},
                      });
                    } else {
                      setConfig({
                        name: config.name,
                        enabled: config.enabled,
                        transport: "remote",
                        url: "",
                        headers: {},
                      });
                    }
                    setArgsText("");
                    setPairs(initialPairs({}));
                  }}
                >
                  <label
                    htmlFor="mcp-transport-stdio"
                    className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm"
                  >
                    <RadioGroupItem id="mcp-transport-stdio" value="stdio" />
                    <Terminal aria-hidden className="size-4 text-muted-foreground" />
                    Local command
                  </label>
                  <label
                    htmlFor="mcp-transport-remote"
                    className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm"
                  >
                    <RadioGroupItem id="mcp-transport-remote" value="remote" />
                    <Globe2 aria-hidden className="size-4 text-muted-foreground" />
                    Remote URL
                  </label>
                </RadioGroup>
              </fieldset>

              {config.transport === "stdio" ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="mcp-server-command">
                      Command
                    </label>
                    <Input
                      id="mcp-server-command"
                      autoComplete="off"
                      placeholder="npx"
                      value={config.command}
                      onChange={(event) =>
                        setConfig({ ...config, command: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="mcp-server-args">
                      Arguments
                    </label>
                    <Textarea
                      id="mcp-server-args"
                      className="min-h-24 font-mono text-xs"
                      placeholder={
                        "-y\n@modelcontextprotocol/server-filesystem\n/path/to/project"
                      }
                      value={argsText}
                      onChange={(event) => setArgsText(event.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Enter one argument per line.
                    </p>
                  </div>
                  <PairEditor kind="Environment" rows={pairs} onChange={setPairs} />
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="mcp-server-url">
                      Remote URL
                    </label>
                    <Input
                      id="mcp-server-url"
                      autoComplete="off"
                      placeholder="https://example.com/mcp"
                      type="url"
                      value={config.url}
                      onChange={(event) => setConfig({ ...config, url: event.target.value })}
                    />
                  </div>
                  <PairEditor kind="Header" rows={pairs} onChange={setPairs} />
                </>
              )}
            </>
          )}

          {jsonError ?? error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {jsonError ?? error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {state?.mode === "edit" && !config.enabled
                ? "Save changes"
                : state?.mode === "edit"
                  ? "Save and validate"
                  : "Add and validate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function McpServersManager() {
  const [records, setRecords] = useState<McpManagedServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importSummary, setImportSummary] = useState<McpServerImportResult | null>(null);
  const [removeName, setRemoveName] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const validationGenerations = useRef(new Map<string, number>());
  const validationInFlight = useRef(new Map<string, number>());
  const recordsRef = useRef(records);
  const activeAutoValidation = useRef<symbol | null>(null);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  const setBusyFor = useCallback((key: string, value: boolean) => {
    setBusy((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const invalidateValidation = useCallback(
    (name: string) => {
      const next = (validationGenerations.current.get(name) ?? 0) + 1;
      validationGenerations.current.set(name, next);
      validationInFlight.current.delete(name);
      setBusyFor(`validate:${name}`, false);
    },
    [setBusyFor],
  );

  const validate = useCallback(
    async (name: string) => {
      if (validationInFlight.current.has(name)) return;
      const generation = (validationGenerations.current.get(name) ?? 0) + 1;
      validationGenerations.current.set(name, generation);
      validationInFlight.current.set(name, generation);
      setBusyFor(`validate:${name}`, true);
      setRecords((current) =>
        replaceValidation(current, name, {
          name,
          status: "checking",
          tool_count: 0,
          tools: [],
          error: null,
        }),
      );
      try {
        const validation = await mcpServerValidate(name);
        if (validationGenerations.current.get(name) !== generation) return;
        setRecords((current) => replaceValidation(current, name, validation));
      } catch (error) {
        if (validationGenerations.current.get(name) !== generation) return;
        setRecords((current) => replaceValidation(current, name, validationError(name, error)));
      } finally {
        if (validationInFlight.current.get(name) === generation) {
          validationInFlight.current.delete(name);
        }
        if (validationGenerations.current.get(name) === generation) {
          setBusyFor(`validate:${name}`, false);
        }
      }
    },
    [setBusyFor],
  );

  const validateEnabledServers = useCallback(
    async (servers: McpManagedServer[]) => {
      if (activeAutoValidation.current) return;
      const names = servers
        .filter((server) => server.config.enabled)
        .slice(0, AUTO_VALIDATION_LIMIT)
        .map((server) => server.config.name);
      if (names.length === 0) return;
      const token = Symbol("mcp-auto-validation");
      activeAutoValidation.current = token;
      let cursor = 0;
      const worker = async () => {
        while (activeAutoValidation.current === token && cursor < names.length) {
          const name = names[cursor++];
          await validate(name);
        }
      };
      try {
        await Promise.all(
          Array.from(
            { length: Math.min(AUTO_VALIDATION_CONCURRENCY, names.length) },
            worker,
          ),
        );
      } finally {
        if (activeAutoValidation.current === token) activeAutoValidation.current = null;
      }
    },
    [validate],
  );

  useEffect(() => {
    let active = true;
    void mcpServersList()
      .then((servers) => {
        if (!active) return;
        setRecords(servers);
        setLoading(false);
        void validateEnabledServers(servers);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(errorMessage(error));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [validateEnabledServers]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void validateEnabledServers(recordsRef.current);
    }, LIVE_STATUS_REFRESH_MS);
    return () => {
      activeAutoValidation.current = null;
      window.clearInterval(interval);
    };
  }, [validateEnabledServers]);

  const sortedRecords = useMemo(
    () => [...records].sort((left, right) => left.config.name.localeCompare(right.config.name)),
    [records],
  );

  const submitEditor = async (originalName: string | null, config: McpServerConfig) => {
    setEditorError(null);
    setBusyFor("editor", true);
    try {
      const next = originalName
        ? await mcpServerUpdate(originalName, config)
        : await mcpServerAdd(config);
      if (originalName) invalidateValidation(originalName);
      if (next.config.name !== originalName) invalidateValidation(next.config.name);
      setRecords((current) => {
        const withoutOriginal = originalName
          ? current.filter((record) => record.config.name !== originalName)
          : current;
        return replaceRecord(withoutOriginal, next);
      });
      notifyMcpAgentToolsChanged();
      setEditor(null);
    } catch (error) {
      setEditorError(errorMessage(error));
    } finally {
      setBusyFor("editor", false);
    }
  };

  const importServers = async (selection: McpServerImportSelection) => {
    const result = await runMcpServerImport(selection.selected, {
      existingNames: recordsRef.current.map((record) => record.config.name),
      duplicateAction: selection.duplicateAction,
      add: mcpServerAdd,
      update: mcpServerUpdateValidated,
    });
    for (const record of result.records) {
      invalidateValidation(record.config.name);
    }
    if (result.records.length > 0) {
      setRecords((current) =>
        result.records.reduce(
          (nextRecords, record) => replaceRecord(nextRecords, record),
          current,
        ),
      );
      notifyMcpAgentToolsChanged();
    }
    setImportSummary(result);
  };

  const toggle = async (record: McpManagedServer, enabled: boolean) => {
    const name = record.config.name;
    setBusyFor(`toggle:${name}`, true);
    try {
      const next = await mcpServerSetEnabled(name, enabled);
      invalidateValidation(name);
      setRecords((current) => replaceRecord(current, next));
      notifyMcpAgentToolsChanged();
    } catch (error) {
      setRecords((current) => replaceValidation(current, name, validationError(name, error)));
    } finally {
      setBusyFor(`toggle:${name}`, false);
    }
  };

  const remove = async () => {
    if (!removeName) return;
    const name = removeName;
    setBusyFor(`remove:${name}`, true);
    try {
      await mcpServerRemove(name);
      invalidateValidation(name);
      setRecords((current) => current.filter((record) => record.config.name !== name));
      notifyMcpAgentToolsChanged();
      setRemoveName(null);
    } catch (error) {
      setRecords((current) => replaceValidation(current, name, validationError(name, error)));
      setRemoveName(null);
    } finally {
      setBusyFor(`remove:${name}`, false);
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="assistant-mcp-servers-heading">
      <div>
        <h3 id="assistant-mcp-servers-heading" className="text-sm font-medium">
          Assistant MCP servers
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Connect the AI Assistant to local commands or remote MCP endpoints. Oleafly checks each
          enabled server when this page opens, every minute, and on demand. It also shows the tools
          each server provides.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || loadError !== null}
          onClick={() => {
            setImportSummary(null);
            setImportOpen(true);
          }}
        >
          <Download aria-hidden />
          Import from...
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setEditorError(null);
            setEditor({ mode: "add", originalName: null, config: emptyStdioConfig() });
          }}
        >
          <Plus aria-hidden />
          Add server
        </Button>
      </div>

      {importSummary ? (
        <div
          role="status"
          aria-live="polite"
          className="space-y-1 rounded-md border bg-card px-3 py-2 text-xs"
        >
          <p>
            Imported {importSummary.imported}, skipped {importSummary.skipped}, failed{" "}
            {importSummary.failed}.
          </p>
          {importSummary.failures.length > 0 ? (
            <ul className="m-0 list-none space-y-1 p-0 text-destructive">
              {importSummary.failures.map((failure) => (
                <li key={`${failure.name}:${failure.reason}`}>
                  {failure.name}: {failure.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border bg-card p-3 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading servers...
        </div>
      ) : null}

      {loadError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {loadError}
        </p>
      ) : null}

      {!loading && !loadError && sortedRecords.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          No servers added.
        </p>
      ) : null}

      <div className="space-y-2">
        {sortedRecords.map((record) => {
          const name = record.config.name;
          const validating = busy.has(`validate:${name}`);
          const toggling = busy.has(`toggle:${name}`);
          const endpoint =
            record.config.transport === "stdio"
              ? [record.config.command, ...record.config.args].join(" ")
              : record.config.url;
          return (
            <article key={name} className="space-y-3 rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-medium">{name}</h4>
                    <StatusBadge record={record} />
                  </div>
                  <p className="truncate font-mono text-[11px] text-muted-foreground" title={endpoint}>
                    {endpoint}
                  </p>
                </div>
                <Switch
                  aria-label={`Enable ${name}`}
                  checked={record.config.enabled}
                  disabled={toggling}
                  onCheckedChange={(enabled) => void toggle(record, enabled)}
                />
              </div>

              {record.validation.error ? (
                <p role="alert" className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                  {record.validation.error}
                </p>
              ) : null}

              <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {liveStatus(record)}
              </p>

              {record.validation.tools.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {record.validation.tool_count === 1
                      ? "1 tool"
                      : `${record.validation.tool_count} tools`}
                  </p>
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={`Tools from ${name}`}>
                    {record.validation.tools.map((tool) => (
                      <li key={tool.name}>
                        <Badge variant="quiet" title={tool.description ?? undefined}>
                          {tool.name}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : record.validation.status === "connected" ? (
                <p className="text-[11px] text-muted-foreground">No tools reported.</p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`Validate ${name}`}
                  disabled={validating || toggling}
                  onClick={() => void validate(name)}
                >
                  <RefreshCw className={cn(validating && "animate-spin")} aria-hidden />
                  Validate
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`Edit ${name}`}
                  onClick={() => {
                    setEditorError(null);
                    setEditor({ mode: "edit", originalName: name, config: record.config });
                  }}
                >
                  <Pencil aria-hidden />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-destructive hover:text-destructive"
                  aria-label={`Remove ${name}`}
                  onClick={() => setRemoveName(name)}
                >
                  <Trash2 aria-hidden />
                  Remove
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      <ServerEditor
        key={editor ? `${editor.mode}:${editor.originalName ?? "new"}` : "closed"}
        state={editor}
        busy={busy.has("editor")}
        error={editorError}
        onClose={() => {
          if (busy.has("editor")) return;
          setEditor(null);
          setEditorError(null);
        }}
        onSubmit={submitEditor}
      />

      <McpServerImportDialog
        open={importOpen}
        existingNames={records.map((record) => record.config.name)}
        onClose={() => setImportOpen(false)}
        onImport={importServers}
      />

      <ConfirmationDialog
        open={removeName !== null}
        title="Remove server?"
        description={`This removes ${removeName ?? "this server"} from Oleafly. You can add it again later.`}
        confirmLabel="Remove server"
        destructive
        onCancel={() => setRemoveName(null)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}
