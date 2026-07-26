import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface AddCustomProviderInput {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
}

export interface AddCustomProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: AddCustomProviderInput) => Promise<{ ok: boolean; message?: string }>;
}

const EMPTY: AddCustomProviderInput = { id: "", name: "", baseURL: "", apiKey: "" };

export function AddCustomProviderDialog({ open, onOpenChange, onSubmit }: AddCustomProviderDialogProps) {
  const [form, setForm] = useState<AddCustomProviderInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setForm(EMPTY);
    setError("");
    setBusy(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    const id = form.id.trim();
    const name = form.name.trim();
    const baseURL = form.baseURL.trim();
    if (!id || !name || !baseURL) {
      setError("ID, name, and base URL are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await onSubmit({ id, name, baseURL, apiKey: form.apiKey.trim() });
      if (!res.ok) {
        setError(res.message ?? "Could not add that provider.");
        return;
      }
      handleOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="z-[120]" overlayClassName="z-[120]">
        <DialogHeader>
          <DialogTitle>Add custom provider</DialogTitle>
          <DialogDescription>
            Connect any OpenAI-compatible endpoint by its base URL.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="custom-provider-id" className="text-xs font-medium text-muted-foreground">
              ID
            </label>
            <Input
              id="custom-provider-id"
              data-testid="custom-provider-id"
              value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              placeholder="acme"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="custom-provider-name" className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <Input
              id="custom-provider-name"
              data-testid="custom-provider-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Acme"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="custom-provider-baseurl" className="text-xs font-medium text-muted-foreground">
              Base URL
            </label>
            <Input
              id="custom-provider-baseurl"
              data-testid="custom-provider-baseurl"
              value={form.baseURL}
              onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
              placeholder="https://api.example.com/v1"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="custom-provider-key" className="text-xs font-medium text-muted-foreground">
              API key (optional)
            </label>
            <Input
              id="custom-provider-key"
              data-testid="custom-provider-key"
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder="Leave blank if none is required"
              className="font-mono text-xs"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            data-testid="custom-provider-submit"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Add provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
