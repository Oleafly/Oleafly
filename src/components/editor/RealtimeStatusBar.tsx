import { useState, useSyncExternalStore, type FormEvent } from "react";
import { Radio, Unplug } from "lucide-react";
import { useFilesStore } from "@/store/files";
import {
  loadRealtimeConfig,
  realtimeExperimentEnabled,
  realtimeRuntime,
  saveRealtimeConfig,
  saveStateLabel,
  type ExperimentalRealtimeConfig,
} from "@/lib/realtime/runtime";

const EMPTY_CONFIG: ExperimentalRealtimeConfig = {
  baseUrl: "http://127.0.0.1:8787",
  projectId: "",
  actorId: "",
  replicaId: "",
  fileId: "0198cf35-0000-7000-8000-000000000002",
  devToken: "oleafly-local-e2e",
  seedFromLocalFile: false,
};

export function RealtimeStatusBar() {
  const enabled = realtimeExperimentEnabled();
  const runtime = useSyncExternalStore(
    realtimeRuntime.subscribe,
    realtimeRuntime.getSnapshot,
  );
  const projectId = useFilesStore((state) => state.projectId);
  const activePath = useFilesStore((state) => state.activePath);
  const [open, setOpen] = useState(() => enabled && !loadRealtimeConfig());
  const [config, setConfig] = useState<ExperimentalRealtimeConfig>(
    () => loadRealtimeConfig() ?? EMPTY_CONFIG,
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  if (!enabled) return null;

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (!projectId || !activePath) return;
    saveRealtimeConfig(config);
    const content = useFilesStore.getState().files[activePath]?.content ?? "";
    await realtimeRuntime
      .connect(
        config,
        projectId,
        activePath,
        content,
        username && password ? { username, password } : undefined,
      )
      .then(() => setOpen(false))
      .catch(() => setOpen(true));
    setPassword("");
  };

  return (
    <div className="shrink-0 border-b bg-muted/30 px-3 py-1.5 text-xs" data-testid="realtime-status">
      <div className="flex items-center gap-2">
        <Radio className="size-3.5 text-primary" />
        <span>{saveStateLabel(runtime.saveState)}</span>
        {runtime.error && <span className="truncate text-destructive">{runtime.error}</span>}
        {runtime.saveState?.kind === "error" && (
          <button
            type="button"
            className="rounded px-2 py-0.5 hover:bg-accent"
            onClick={() => void realtimeRuntime.retryStorage()}
          >
            Retry local save
          </button>
        )}
        <button
          type="button"
          className="ml-auto rounded px-2 py-0.5 hover:bg-accent"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close setup" : "Live setup"}
        </button>
        {runtime.connection !== "off" && (
          <button
            type="button"
            aria-label="Disconnect live editing"
            className="rounded p-0.5 hover:bg-accent"
            onClick={() => void realtimeRuntime.disconnect()}
          >
            <Unplug className="size-3.5" />
          </button>
        )}
      </div>
      {open && (
        <form className="mt-2 grid grid-cols-2 gap-2 pb-1" onSubmit={connect}>
          <Field label="Server URL" value={config.baseUrl} onChange={(baseUrl) => setConfig({ ...config, baseUrl })} />
          <Field label="Shared project ID" value={config.projectId} onChange={(projectIdValue) => setConfig({ ...config, projectId: projectIdValue })} />
          <Field label="Replica ID" value={config.replicaId} onChange={(replicaId) => setConfig({ ...config, replicaId })} />
          <Field label="File ID" value={config.fileId} onChange={(fileIdValue) => setConfig({ ...config, fileId: fileIdValue })} />
          <Field label="Actor ID (development)" value={config.actorId ?? ""} onChange={(actorId) => setConfig({ ...config, actorId })} />
          <Field label="Development token" value={config.devToken ?? ""} secret onChange={(devToken) => setConfig({ ...config, devToken })} />
          <Field label="Username (self-hosted server)" value={username} onChange={setUsername} />
          <Field label="Password" value={password} secret onChange={setPassword} />
          <label className="col-span-2 flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={config.seedFromLocalFile}
              onChange={(event) => setConfig({ ...config, seedFromLocalFile: event.target.checked })}
            />
            Initialize a new room from the open file
          </label>
          <div className="col-span-2 flex items-center justify-end gap-2">
            <span className="mr-auto text-muted-foreground">
              Source mode only. Use Initialize on the first client, then turn it off for clients that join.
            </span>
            <button
              type="submit"
              disabled={!projectId || !activePath || runtime.connection === "connecting"}
              className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
            >
              {runtime.connection === "connecting" ? "Connecting..." : "Connect"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  secret = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  secret?: boolean;
}) {
  return (
    <label className="grid gap-1 text-muted-foreground">
      {label}
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded border bg-background px-2 py-1 text-foreground"
      />
    </label>
  );
}
