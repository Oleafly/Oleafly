import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
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

export interface CustomProviderEditTarget {
  id: string;
  name: string;
  baseURL: string;
  hasStoredKey: boolean;
}

export interface AddCustomProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: AddCustomProviderInput) => Promise<{ ok: boolean; message?: string }>;
  editing?: CustomProviderEditTarget | null;
}

const EMPTY: AddCustomProviderInput = { id: "", name: "", baseURL: "", apiKey: "" };

type FieldErrors = Partial<Record<"id" | "name" | "baseURL" | "apiKey", string>>;

export function normalizeBaseURL(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function validate(form: AddCustomProviderInput, editing: CustomProviderEditTarget | null): FieldErrors {
  const errors: FieldErrors = {};
  const id = form.id.trim();
  if (!editing) {
    if (!id) errors.id = "ID is required.";
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      errors.id = "Use lowercase letters, digits, and dashes only, e.g. acme.";
    }
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

function baseURLWillResendKey(
  form: AddCustomProviderInput,
  editing: CustomProviderEditTarget | null,
): boolean {
  if (!editing?.hasStoredKey) return false;
  return normalizeBaseURL(form.baseURL) !== normalizeBaseURL(editing.baseURL);
}

export function AddCustomProviderDialog({
  open,
  onOpenChange,
  onSubmit,
  editing = null,
}: AddCustomProviderDialogProps) {
  const [form, setForm] = useState<AddCustomProviderInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const editingId = editing?.id ?? "";
  const editingName = editing?.name ?? "";
  const editingBaseURL = editing?.baseURL ?? "";

  useEffect(() => {
    if (!open) return;
    setForm(
      editingId
        ? { id: editingId, name: editingName, baseURL: editingBaseURL, apiKey: "" }
        : EMPTY,
    );
    setError("");
    setFieldErrors({});
  }, [open, editingId, editingName, editingBaseURL]);

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
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async () => {
    const errors = validate(form, editing);
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
        setError(res.message ?? (editing ? "Could not save that provider." : "Could not add that provider."));
        return;
      }
      handleOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const keyLabel = editing
    ? editing.hasStoredKey
      ? "API key (leave blank to keep the saved key)"
      : "API key (optional)"
    : "API key (optional)";
  const showKeyResendNote = baseURLWillResendKey(form, editing);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="z-[120]"
        overlayClassName="z-[120]"
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? "Edit custom provider" : "Add custom provider"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Change the name or base URL."
              : "Connect any OpenAI-compatible endpoint by its base URL."}
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
              disabled={Boolean(editing)}
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
            {!fieldErrors.baseURL && showKeyResendNote && (
              <p data-testid="custom-provider-baseurl-note" className="text-xs text-muted-foreground">
                Your saved API key will be sent to this new address.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label htmlFor="custom-provider-key" className="text-xs font-medium text-muted-foreground">
              {keyLabel}
            </label>
            <Input
              id="custom-provider-key"
              data-testid="custom-provider-key"
              type="password"
              value={form.apiKey}
              onChange={(e) => setField("apiKey")(e.target.value)}
              placeholder={editing?.hasStoredKey ? "Saved key stays unless you enter a new one" : "Leave blank if none is required"}
              aria-invalid={Boolean(fieldErrors.apiKey)}
              className="h-10 font-mono text-sm aria-[invalid=true]:border-destructive"
            />
            {fieldErrors.apiKey && (
              <p data-testid="custom-provider-key-error" className="text-xs text-destructive">
                {fieldErrors.apiKey}
              </p>
            )}
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
            {editing ? "Save" : "Add provider"}
            <Kbd className="h-4 min-w-4 bg-background/25 px-1 text-[10px] text-current">↵</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
