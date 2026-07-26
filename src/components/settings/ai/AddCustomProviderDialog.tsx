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

type FieldErrors = Partial<Record<"id" | "name" | "baseURL", string>>;

function validate(form: AddCustomProviderInput): FieldErrors {
  const errors: FieldErrors = {};
  const id = form.id.trim();
  if (!id) errors.id = "ID is required.";
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    errors.id = "Use lowercase letters, digits, and dashes only, e.g. acme.";
  }
  if (!form.name.trim()) errors.name = "Name is required.";
  const baseURL = form.baseURL.trim();
  if (!baseURL) {
    errors.baseURL = "Base URL is required.";
  } else {
    try {
      const parsed = new URL(baseURL);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        errors.baseURL = "Use https://, or http:// for a local server.";
      } else if (!parsed.hostname) {
        errors.baseURL = "The URL is missing a host.";
      }
    } catch {
      errors.baseURL = "Enter a full URL, e.g. https://api.example.com/v1 or http://localhost:1234/v1.";
    }
  }
  return errors;
}

export function AddCustomProviderDialog({ open, onOpenChange, onSubmit }: AddCustomProviderDialogProps) {
  const [form, setForm] = useState<AddCustomProviderInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const reset = () => {
    setForm(EMPTY);
    setError("");
    setFieldErrors({});
    setBusy(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const setField = (key: keyof AddCustomProviderInput) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key !== "apiKey") setFieldErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async () => {
    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    setBusy(true);
    setError("");
    try {
      const res = await onSubmit({
        id: form.id.trim(),
        name: form.name.trim(),
        baseURL: form.baseURL.trim(),
        apiKey: form.apiKey.trim(),
      });
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
              onChange={(e) => setField("id")(e.target.value)}
              placeholder="acme"
              aria-invalid={Boolean(fieldErrors.id)}
              className="h-10 font-mono text-sm aria-[invalid=true]:border-destructive"
            />
            {fieldErrors.id && (
              <p data-testid="custom-provider-id-error" className="text-xs text-destructive">
                {fieldErrors.id}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label htmlFor="custom-provider-name" className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <Input
              id="custom-provider-name"
              data-testid="custom-provider-name"
              value={form.name}
              onChange={(e) => setField("name")(e.target.value)}
              placeholder="Acme"
              aria-invalid={Boolean(fieldErrors.name)}
              className="h-10 aria-[invalid=true]:border-destructive"
            />
            {fieldErrors.name && (
              <p data-testid="custom-provider-name-error" className="text-xs text-destructive">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label htmlFor="custom-provider-baseurl" className="text-xs font-medium text-muted-foreground">
              Base URL
            </label>
            <Input
              id="custom-provider-baseurl"
              data-testid="custom-provider-baseurl"
              value={form.baseURL}
              onChange={(e) => setField("baseURL")(e.target.value)}
              placeholder="https://api.example.com/v1"
              aria-invalid={Boolean(fieldErrors.baseURL)}
              className="h-10 font-mono text-sm aria-[invalid=true]:border-destructive"
            />
            {fieldErrors.baseURL && (
              <p data-testid="custom-provider-baseurl-error" className="text-xs text-destructive">
                {fieldErrors.baseURL}
              </p>
            )}
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
              onChange={(e) => setField("apiKey")(e.target.value)}
              placeholder="Leave blank if none is required"
              className="h-10 font-mono text-sm"
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
