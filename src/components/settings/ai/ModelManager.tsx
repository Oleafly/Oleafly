import { useState } from "react";
import { Loader2, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import type { StoredModel } from "@/lib/tauri";
import {
  addCustomModel,
  deleteModel,
  mergeFetchedModels,
  restoreSeedModels,
  seedProviderModels,
  setModelEnabled,
} from "@/lib/ai-model-state";
import { agentListModels } from "@/lib/tauri";
import { agentErrorKind } from "@/lib/agent-backend";

export interface ModelManagerProps {
  providerId: string;
  models: StoredModel[];
  apiKey: string;
  onChange: (next: StoredModel[]) => void;
}

export function ModelManager({ providerId, models, apiKey, onChange }: ModelManagerProps) {
  const [newId, setNewId] = useState("");
  const [addError, setAddError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<StoredModel | null>(null);

  const missingSeeds = seedProviderModels(providerId).filter(
    (s) => !models.some((m) => m.id === s.id)
  );

  async function refresh() {
    setRefreshing(true);
    setRefreshError("");
    try {
      const fetched = await agentListModels({ providerId, key: apiKey || undefined });
      onChange(mergeFetchedModels(models, fetched));
    } catch (error) {
      setRefreshError(
        agentErrorKind(error) === "auth" ? "Invalid API key." : "Could not reach the provider.",
      );
    } finally {
      setRefreshing(false);
    }
  }

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
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">Models</span>
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
        ))}
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
