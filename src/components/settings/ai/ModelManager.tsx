import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { ModelCapabilityChips, ModelTrustBadge } from "@/components/ai/ModelSelector";
import type { ModelProbe, StoredModel } from "@/lib/tauri";
import {
  addCustomModel,
  claimModelListAutoRefresh,
  clearModelListThrottle,
  deleteModel,
  describeModelListChange,
  diffModelLists,
  formatRelativeTime,
  mergeFetchedModels,
  modelListThrottledUntil,
  probeKey,
  readableFetchedModels,
  resolveModelTrust,
  restoreSeedModels,
  seedProviderModels,
  setModelEnabled,
  shouldAutoRefreshModels,
  throttleModelListRefresh,
} from "@/lib/ai-model-state";
import {
  agentListModels,
  agentModelMetadataStatus,
  agentRefreshModelMetadata,
} from "@/lib/tauri";
import { agentErrorKind } from "@/lib/agent-backend";
import { staleTimes } from "@/lib/query";

export interface ModelManagerProps {
  providerId: string;
  models: StoredModel[];
  apiKey: string;
  onChange: (next: StoredModel[]) => void;
  onRefreshed?: (next: StoredModel[], refreshedAt: number) => void;
  refreshedAt?: number;
  probes?: Record<string, ModelProbe>;
  discoverable?: boolean;
}

const NOTICE_MS = 4000;
const UNREADABLE_LIST = "The provider returned models Oleafly could not read.";
const METADATA_STATUS_KEY = ["ai-model-metadata-status"] as const;

type Notice = { text: string; tone: "info" | "error" };

export function ModelManager({
  providerId,
  models,
  apiKey,
  onChange,
  onRefreshed,
  refreshedAt,
  probes,
  discoverable = true,
}: ModelManagerProps) {
  const [newId, setNewId] = useState("");
  const [addError, setAddError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<StoredModel | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [throttledUntil, setThrottledUntil] = useState(() =>
    modelListThrottledUntil(providerId, Date.now()),
  );
  const [now, setNow] = useState(() => Date.now());
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const triggerRef = useRef<"manual" | "auto">("manual");
  const autoRefreshChecked = useRef(false);

  const missingSeeds = seedProviderModels(providerId).filter(
    (s) => !models.some((m) => m.id === s.id)
  );

  const refresh = useMutation({
    mutationFn: () => agentListModels({ providerId, key: apiKey || undefined }),
    onSuccess: (fetched) => {
      const current = modelsRef.current;
      const usable = readableFetchedModels(fetched ?? []);
      if ((fetched?.length ?? 0) > 0 && usable.length === 0) {
        setNotice({ text: UNREADABLE_LIST, tone: "error" });
        return;
      }
      const merged = mergeFetchedModels(current, fetched ?? []);
      setNotice({ text: describeModelListChange(diffModelLists(current, merged)), tone: "info" });
      if (onRefreshed) onRefreshed(merged, Date.now());
      else onChange(merged);
    },
    onError: () => {
      if (triggerRef.current !== "auto") return;
      clearModelListThrottle(providerId);
      setThrottledUntil(0);
    },
    meta: { silent: true },
  });
  const { mutate: startRefresh } = refresh;
  const refreshing = refresh.isPending;
  const refreshError =
    refresh.isError && triggerRef.current === "manual"
      ? agentErrorKind(refresh.error) === "auth"
        ? "Invalid API key."
        : "Could not reach the provider."
      : "";

  const runRefresh = useCallback(
    (trigger: "manual" | "auto") => {
      const now = Date.now();
      if (modelListThrottledUntil(providerId, now) > 0) return;
      triggerRef.current = trigger;
      setThrottledUntil(throttleModelListRefresh(providerId, now));
      setNotice(null);
      startRefresh();
    },
    [providerId, startRefresh],
  );

  useEffect(() => {
    if (autoRefreshChecked.current) return;
    autoRefreshChecked.current = true;
    if (!discoverable) return;
    const now = Date.now();
    if (!shouldAutoRefreshModels(refreshedAt, now)) return;
    if (!claimModelListAutoRefresh(providerId, now)) return;
    runRefresh("auto");
  }, [discoverable, providerId, refreshedAt, runRefresh]);

  useEffect(() => {
    if (!throttledUntil) return;
    const wait = Math.max(0, throttledUntil - Date.now());
    const timer = window.setTimeout(() => setThrottledUntil(0), wait);
    return () => window.clearTimeout(timer);
  }, [throttledUntil]);

  useEffect(() => {
    if (notice?.tone !== "info") return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!refreshedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [refreshedAt]);

  const throttled = throttledUntil > 0;
  const updatedLabel = refreshedAt ? `Updated ${formatRelativeTime(refreshedAt, now)}` : "";

  function submitNewModel() {
    const trimmed = newId.trim();
    if (!trimmed) {
      setAddError("Enter a model id.");
      return;
    }
    if (/\s/.test(trimmed)) {
      setAddError("Model ids can't contain spaces.");
      return;
    }
    if (models.some((m) => m.id === trimmed)) {
      setAddError("That model is already in the list.");
      return;
    }
    setAddError("");
    onChange(addCustomModel(models, { id: trimmed, name: trimmed }));
    setNewId("");
  }

  return (
    <div className="mt-3 space-y-1.5 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Models</span>
          {updatedLabel && (
            <span
              data-testid={`ai-models-updated-${providerId}`}
              className="truncate text-[10px] text-muted-foreground/80"
            >
              {updatedLabel}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {missingSeeds.length > 0 && (
            <Tooltip label="Re-add this provider's built-in models">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-[11px]"
                data-testid={`ai-restore-models-${providerId}`}
                onClick={() => onChange(restoreSeedModels(models, providerId))}
              >
                <RotateCcw className="size-3" />
                Restore defaults
              </Button>
            </Tooltip>
          )}
          {discoverable && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px]"
              data-testid={`ai-refresh-models-${providerId}`}
              disabled={refreshing || throttled}
              onClick={() => runRefresh("manual")}
            >
              {refreshing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              Refresh
            </Button>
          )}
        </div>
      </div>

      {refreshError && <p className="text-[11px] text-destructive">{refreshError}</p>}
      {notice && (
        <p
          data-testid={`ai-refresh-notice-${providerId}`}
          className={
            notice.tone === "error" ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"
          }
        >
          {notice.text}
        </p>
      )}

      <div className="space-y-1">
        {models.map((m) => {
          const resolved = resolveModelTrust(m, probes?.[probeKey(providerId, m.id)]);
          return (
            <div
              key={m.id}
              data-testid={`ai-model-row-${m.id}`}
              className="flex items-center gap-2 rounded-md border border-transparent px-1.5 py-1 hover:border-border"
            >
              <Switch
                data-testid={`ai-model-toggle-${m.id}`}
                checked={m.enabled}
                onCheckedChange={(checked) => onChange(setModelEnabled(models, m.id, checked))}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="min-w-0 truncate text-xs">{m.name}</span>
                {(resolved.trust || m.metadata) && (
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    <ModelTrustBadge trust={resolved.trust} reason={resolved.reason} />
                    <ModelCapabilityChips metadata={m.metadata} />
                  </span>
                )}
              </span>
              {m.source === "custom" && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  Custom
                </span>
              )}
              <Tooltip label="Delete model">
                <button
                  type="button"
                  data-testid={`ai-model-delete-${m.id}`}
                  aria-label={`Delete model ${m.name}`}
                  onClick={() => setConfirmDelete(m)}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </Tooltip>
            </div>
          );
        })}
        {models.length === 0 && (
          <p className="px-1.5 py-1 text-[11px] text-muted-foreground">No models yet. Add one below.</p>
        )}
      </div>

      <div className="pt-1">
        <div className="flex gap-2">
          <Input
            type="text"
            value={newId}
            onChange={(e) => {
              setNewId(e.target.value);
              if (addError) setAddError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewModel();
            }}
            placeholder="Add a model id"
            data-testid={`ai-add-model-id-${providerId}`}
            aria-invalid={Boolean(addError)}
            className="h-8 flex-1 font-mono text-xs aria-[invalid=true]:border-destructive"
          />
          <Button
            size="sm"
            variant="secondary"
            data-testid={`ai-add-model-submit-${providerId}`}
            onClick={submitNewModel}
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
        {addError && (
          <p data-testid={`ai-add-model-error-${providerId}`} className="mt-1 text-[11px] text-destructive">
            {addError}
          </p>
        )}
      </div>

      <ConfirmationDialog
        open={confirmDelete !== null}
        title="Delete model"
        description={`Remove "${confirmDelete?.name ?? ""}" from this provider's model list? Built-in models can come back through Restore defaults. Custom models can be added again by ID.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (confirmDelete) onChange(deleteModel(models, confirmDelete.id));
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function describeMetadataSource(source: "cdn" | "bundled" | "cache"): string {
  if (source === "bundled") return ", bundled with the app";
  if (source === "cache") return ", from the last download";
  return "";
}

export function ModelMetadataStatusLine() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: METADATA_STATUS_KEY,
    queryFn: agentModelMetadataStatus,
    staleTime: staleTimes.catalog,
    retry: false,
    meta: { silent: true },
  });
  const refresh = useMutation({
    mutationFn: () => agentRefreshModelMetadata(true),
    onSuccess: (next) => queryClient.setQueryData(METADATA_STATUS_KEY, next),
    meta: { silent: true },
  });
  if (!status.data) return null;
  const generated = new Date(status.data.generatedAt);
  const dateLabel = Number.isNaN(generated.getTime())
    ? "unknown date"
    : generated.toLocaleDateString();
  return (
    <div
      data-testid="ai-model-metadata-status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"
    >
      <span>
        Model data updated {dateLabel}
        {describeMetadataSource(status.data.source)}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-[11px]"
        data-testid="ai-model-metadata-refresh"
        disabled={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        {refresh.isPending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <RefreshCw className="size-3" />
        )}
        Refresh
      </Button>
      {refresh.isError && (
        <span className="text-destructive">Could not refresh model data.</span>
      )}
    </div>
  );
}
