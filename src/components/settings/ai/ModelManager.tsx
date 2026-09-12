import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  diffModelLists,
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
import { formatDate, formatRelativeTime } from "@/lib/intl";
import { logError } from "@/lib/log";
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
const METADATA_STATUS_KEY = ["ai-model-metadata-status"] as const;

type Notice =
  | { kind: "unreadable" }
  | { kind: "changed"; added: number; removed: number };

type RefreshError = "" | "invalidKey" | "unreachable";

type AddError = "" | "empty" | "spaces" | "duplicate";

function relativeUpdated(then: number, now: number): string {
  const seconds = Math.floor(Math.max(0, now - then) / 1000);
  if (seconds < 60) return formatRelativeTime(-seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatRelativeTime(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatRelativeTime(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return formatRelativeTime(-days, "day");
  return formatDate(then);
}

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
  const { t } = useTranslation(["common", "settings"]);
  const [newId, setNewId] = useState("");
  const [addError, setAddError] = useState<AddError>("");
  const [confirmDelete, setConfirmDelete] = useState<StoredModel | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [throttledUntil, setThrottledUntil] = useState(() =>
    modelListThrottledUntil(providerId, Date.now()),
  );
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<RefreshError>("");
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const applyRef = useRef({ onChange, onRefreshed });
  applyRef.current = { onChange, onRefreshed };
  const autoRefreshChecked = useRef(false);

  const missingSeeds = seedProviderModels(providerId).filter(
    (s) => !models.some((m) => m.id === s.id)
  );

  const runRefresh = useCallback(
    async (trigger: "manual" | "auto") => {
      const now = Date.now();
      if (modelListThrottledUntil(providerId, now) > 0) return;
      setThrottledUntil(throttleModelListRefresh(providerId, now));
      setNotice(null);
      setRefreshError("");
      setRefreshing(true);
      try {
        const fetched = await agentListModels({ providerId, key: apiKey || undefined });
        const current = modelsRef.current;
        const usable = readableFetchedModels(fetched ?? []);
        if ((fetched?.length ?? 0) > 0 && usable.length === 0) {
          setNotice({ kind: "unreadable" });
          return;
        }
        const merged = mergeFetchedModels(current, fetched ?? []);
        setNotice({ kind: "changed", ...diffModelLists(current, merged) });
        const apply = applyRef.current;
        if (apply.onRefreshed) apply.onRefreshed(merged, Date.now());
        else apply.onChange(merged);
      } catch (e) {
        void logError("refresh provider models", e);
        if (trigger === "auto") {
          clearModelListThrottle(providerId);
          setThrottledUntil(0);
          return;
        }
        setRefreshError(agentErrorKind(e) === "auth" ? "invalidKey" : "unreachable");
      } finally {
        setRefreshing(false);
      }
    },
    [apiKey, providerId],
  );

  useEffect(() => {
    if (autoRefreshChecked.current) return;
    autoRefreshChecked.current = true;
    if (!discoverable) return;
    const now = Date.now();
    if (!shouldAutoRefreshModels(refreshedAt, now)) return;
    if (!claimModelListAutoRefresh(providerId, now)) return;
    void runRefresh("auto");
  }, [discoverable, providerId, refreshedAt, runRefresh]);

  useEffect(() => {
    if (!throttledUntil) return;
    const wait = Math.max(0, throttledUntil - Date.now());
    const timer = window.setTimeout(() => setThrottledUntil(0), wait);
    return () => window.clearTimeout(timer);
  }, [throttledUntil]);

  useEffect(() => {
    if (notice?.kind !== "changed") return;
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
  const updatedLabel = refreshedAt
    ? t(($) => $.settings.ai.models.updated, { time: relativeUpdated(refreshedAt, now) })
    : "";

  function submitNewModel() {
    const trimmed = newId.trim();
    if (!trimmed) {
      setAddError("empty");
      return;
    }
    if (/\s/.test(trimmed)) {
      setAddError("spaces");
      return;
    }
    if (models.some((m) => m.id === trimmed)) {
      setAddError("duplicate");
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
          <span className="text-[11px] font-medium text-muted-foreground">
            {t(($) => $.settings.ai.models.title)}
          </span>
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
            <Tooltip label={t(($) => $.settings.ai.models.restoreTooltip)}>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-[11px]"
                data-testid={`ai-restore-models-${providerId}`}
                onClick={() => onChange(restoreSeedModels(models, providerId))}
              >
                <RotateCcw className="size-3" />
                {t(($) => $.settings.ai.models.restore)}
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
              onClick={() => void runRefresh("manual")}
            >
              {refreshing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              {t(($) => $.settings.ai.models.refresh)}
            </Button>
          )}
        </div>
      </div>

      {refreshError && (
        <p className="text-[11px] text-destructive">
          {refreshError === "invalidKey"
            ? t(($) => $.settings.ai.models.invalidKey)
            : t(($) => $.settings.ai.models.unreachable)}
        </p>
      )}
      {notice && (
        <p
          data-testid={`ai-refresh-notice-${providerId}`}
          className={
            notice.kind === "unreadable"
              ? "text-[11px] text-destructive"
              : "text-[11px] text-muted-foreground"
          }
        >
          {notice.kind === "unreadable"
            ? t(($) => $.settings.ai.models.unreadableList)
            : notice.added === 0 && notice.removed === 0
              ? t(($) => $.settings.ai.models.noChanges)
              : t(($) => $.settings.ai.models.changeSummary, {
                  added: notice.added,
                  removed: notice.removed,
                })}
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
                    <ModelTrustBadge trust={resolved.trust} reason={resolved.reason} focusable />
                    <ModelCapabilityChips metadata={m.metadata} />
                  </span>
                )}
              </span>
              {m.source === "custom" && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {t(($) => $.settings.ai.models.custom)}
                </span>
              )}
              <Tooltip label={t(($) => $.settings.ai.models.deleteTooltip)}>
                <button
                  type="button"
                  data-testid={`ai-model-delete-${m.id}`}
                  aria-label={t(($) => $.settings.ai.models.deleteAriaLabel, { model: m.name })}
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
          <p className="px-1.5 py-1 text-[11px] text-muted-foreground">
            {t(($) => $.settings.ai.models.empty)}
          </p>
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
            placeholder={t(($) => $.settings.ai.models.addPlaceholder)}
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
            {t(($) => $.common.actions.add)}
          </Button>
        </div>
        {addError && (
          <p data-testid={`ai-add-model-error-${providerId}`} className="mt-1 text-[11px] text-destructive">
            {addError === "empty"
              ? t(($) => $.settings.ai.models.addError.empty)
              : addError === "spaces"
                ? t(($) => $.settings.ai.models.addError.spaces)
                : t(($) => $.settings.ai.models.addError.duplicate)}
          </p>
        )}
      </div>

      <ConfirmationDialog
        open={confirmDelete !== null}
        title={t(($) => $.settings.ai.models.deleteDialog.title)}
        description={t(($) => $.settings.ai.models.deleteDialog.description, {
          model: confirmDelete?.name ?? "",
        })}
        confirmLabel={t(($) => $.common.actions.delete)}
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

export function ModelMetadataStatusLine() {
  const { t } = useTranslation(["common", "settings"]);
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
  const date = Number.isNaN(generated.getTime())
    ? t(($) => $.settings.ai.models.metadata.unknownDate)
    : formatDate(generated);
  const source = status.data.source;
  return (
    <div
      data-testid="ai-model-metadata-status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"
    >
      <span>
        {source === "bundled"
          ? t(($) => $.settings.ai.models.metadata.updatedBundled, { date })
          : source === "cache"
            ? t(($) => $.settings.ai.models.metadata.updatedFromCache, { date })
            : t(($) => $.settings.ai.models.metadata.updated, { date })}
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
        {t(($) => $.settings.ai.models.refresh)}
      </Button>
      {refresh.isError && (
        <span className="text-destructive">
          {t(($) => $.settings.ai.models.metadata.refreshFailed)}
        </span>
      )}
    </div>
  );
}
