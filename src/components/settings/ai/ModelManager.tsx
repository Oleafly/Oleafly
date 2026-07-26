import { useState } from "react";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { StoredModel } from "@/lib/tauri";
import { addCustomModel, deleteModel, mergeFetchedModels, setModelEnabled } from "@/lib/ai-model-state";
import { discoveryFor, fetchProviderModels, getProvider } from "@/lib/ai-providers";

export interface ModelManagerProps {
  providerId: string;
  models: StoredModel[];
  apiKey: string;
  onChange: (next: StoredModel[]) => void;
}

export function ModelManager({ providerId, models, apiKey, onChange }: ModelManagerProps) {
  const [newId, setNewId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  async function refresh() {
    setRefreshing(true);
    setRefreshError("");
    const provider = getProvider(providerId);
    const res = await fetchProviderModels({
      providerId,
      baseURL: provider?.baseURL,
      key: apiKey,
      discovery: discoveryFor(providerId),
      seed: provider?.models ?? [],
    });
    setRefreshing(false);
    if (res.ok) {
      onChange(mergeFetchedModels(models, res.models));
    } else {
      setRefreshError(res.reason === "invalid-key" ? "Invalid API key." : "Could not reach the provider.");
    }
  }

  function submitNewModel() {
    const trimmed = newId.trim();
    if (!trimmed) return;
    onChange(addCustomModel(models, { id: trimmed, name: trimmed }));
    setNewId("");
  }

  return (
    <div className="mt-3 space-y-1.5 border-t pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">Models</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[11px]"
          data-testid={`ai-refresh-models-${providerId}`}
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          Refresh
        </Button>
      </div>

      {refreshError && <p className="text-[11px] text-destructive">{refreshError}</p>}

      <div className="space-y-1">
        {models.map((m) => (
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
            <span className="min-w-0 flex-1 truncate text-xs">{m.name}</span>
            {m.source === "custom" && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                Custom
              </span>
            )}
            <button
              type="button"
              data-testid={`ai-model-delete-${m.id}`}
              aria-label={`Delete model ${m.name}`}
              title="Delete model"
              onClick={() => onChange(deleteModel(models, m.id))}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
        {models.length === 0 && (
          <p className="px-1.5 py-1 text-[11px] text-muted-foreground">No models yet. Add one below.</p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Input
          type="text"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitNewModel();
          }}
          placeholder="Add a model id"
          data-testid={`ai-add-model-id-${providerId}`}
          className="h-8 flex-1 font-mono text-xs"
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
    </div>
  );
}
