import { useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  KeyRound,
  LibraryBig,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getConnectorKey, setConnectorKey } from "@/lib/tauri";
import { toast } from "@/lib/toast";

const KEY_FREE_SOURCES = [
  "arXiv",
  "Crossref",
  "PubMed",
  "OpenAlex",
] as const;

export function CitationSearchIntegrationSection() {
  const [apiKey, setApiKey] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getConnectorKey("semantic-scholar")
      .then((key) => {
        if (!cancelled) setConnected(Boolean(key));
      })
      .catch(() => {
        if (!cancelled) setConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    const nextKey = apiKey.trim();
    if (!nextKey) return;
    setBusy(true);
    try {
      await setConnectorKey("semantic-scholar", nextKey);
      setApiKey("");
      setConnected(true);
      toast.success("Semantic Scholar API key saved");
    } catch {
      toast.error("Could not save the Semantic Scholar API key.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await setConnectorKey("semantic-scholar", "");
      setConnected(false);
      toast.success("Semantic Scholar API key removed");
    } catch {
      toast.error("Could not remove the Semantic Scholar API key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="citation-search-integration"
      className="space-y-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-blue-500/10 text-blue-700 dark:text-blue-300">
          <LibraryBig className="size-5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Citation Search</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Manage credentials used by scholarly search sources.
          </p>
        </div>
      </div>

      <section className="rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-blue-600 dark:text-blue-300" />
              <h4 className="text-sm font-medium">Semantic Scholar</h4>
              {connected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check className="size-3" />
                  Connected
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              An API key is optional. Anonymous searches use Semantic
              Scholar’s public limits.
            </p>
            <a
              href="https://www.semanticscholar.org/product/api"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Semantic Scholar API information
              <ExternalLink className="size-3" />
            </a>
          </div>
          {connected && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy && <Loader2 className="animate-spin" />}
              Remove key
            </Button>
          )}
        </div>

        {!connected && (
          <div className="mt-4 flex max-w-md gap-2">
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Semantic Scholar API key"
              aria-label="Semantic Scholar API key"
              className="h-9"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !apiKey.trim()}
              onClick={() => void save()}
            >
              {busy && <Loader2 className="animate-spin" />}
              Save key
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-background p-4">
        <h4 className="text-sm font-medium">Sources without credentials</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          These sources are available without an API key.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {KEY_FREE_SOURCES.map((source) => (
            <span
              key={source}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
            >
              <Check className="size-3.5" />
              {source}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
