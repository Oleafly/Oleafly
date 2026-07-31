import { useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  KeyRound,
  LibraryBig,
  Loader2,
  Mail,
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

  const [openAlexEmail, setOpenAlexEmail] = useState("");
  const [openAlexConnected, setOpenAlexConnected] = useState<boolean | null>(
    null,
  );
  const [openAlexBusy, setOpenAlexBusy] = useState(false);

  const [serperKey, setSerperKey] = useState("");
  const [serperConnected, setSerperConnected] = useState<boolean | null>(null);
  const [serperBusy, setSerperBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getConnectorKey("semantic-scholar")
      .then((key) => {
        if (!cancelled) setConnected(Boolean(key));
      })
      .catch(() => {
        if (!cancelled) setConnected(false);
      });
    void getConnectorKey("openalex-email")
      .then((email) => {
        if (!cancelled) setOpenAlexConnected(Boolean(email));
      })
      .catch(() => {
        if (!cancelled) setOpenAlexConnected(false);
      });
    void getConnectorKey("serper")
      .then((key) => {
        if (!cancelled) setSerperConnected(Boolean(key));
      })
      .catch(() => {
        if (!cancelled) setSerperConnected(false);
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

  const saveOpenAlexEmail = async () => {
    const email = openAlexEmail.trim();
    if (!email) return;
    setOpenAlexBusy(true);
    try {
      await setConnectorKey("openalex-email", email);
      setOpenAlexEmail("");
      setOpenAlexConnected(true);
      toast.success("OpenAlex contact email saved");
    } catch {
      toast.error("Could not save the OpenAlex contact email.");
    } finally {
      setOpenAlexBusy(false);
    }
  };

  const removeOpenAlexEmail = async () => {
    setOpenAlexBusy(true);
    try {
      await setConnectorKey("openalex-email", "");
      setOpenAlexConnected(false);
      toast.success("OpenAlex contact email removed");
    } catch {
      toast.error("Could not remove the OpenAlex contact email.");
    } finally {
      setOpenAlexBusy(false);
    }
  };

  const saveSerper = async () => {
    const nextKey = serperKey.trim();
    if (!nextKey) return;
    setSerperBusy(true);
    try {
      await setConnectorKey("serper", nextKey);
      setSerperKey("");
      setSerperConnected(true);
      toast.success("Serper API key saved");
    } catch {
      toast.error("Could not save the Serper API key.");
    } finally {
      setSerperBusy(false);
    }
  };

  const removeSerper = async () => {
    setSerperBusy(true);
    try {
      await setConnectorKey("serper", "");
      setSerperConnected(false);
      toast.success("Serper API key removed");
    } catch {
      toast.error("Could not remove the Serper API key.");
    } finally {
      setSerperBusy(false);
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-blue-600 dark:text-blue-300" />
              <h4 className="text-sm font-medium">OpenAlex</h4>
              {openAlexConnected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check className="size-3" />
                  Connected
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Optional contact email. OpenAlex uses it for higher rate limits
              (polite pool). Stored locally.
            </p>
            <a
              href="https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              OpenAlex rate limits
              <ExternalLink className="size-3" />
            </a>
          </div>
          {openAlexConnected && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={openAlexBusy}
              onClick={() => void removeOpenAlexEmail()}
            >
              {openAlexBusy && <Loader2 className="animate-spin" />}
              Remove email
            </Button>
          )}
        </div>

        {!openAlexConnected && (
          <div className="mt-4 flex max-w-md gap-2">
            <Input
              type="email"
              data-testid="openalex-email-input"
              value={openAlexEmail}
              onChange={(event) => setOpenAlexEmail(event.target.value)}
              placeholder="you@example.com"
              aria-label="OpenAlex contact email"
              className="h-9"
            />
            <Button
              type="button"
              size="sm"
              data-testid="openalex-email-save"
              disabled={openAlexBusy || !openAlexEmail.trim()}
              onClick={() => void saveOpenAlexEmail()}
            >
              {openAlexBusy && <Loader2 className="animate-spin" />}
              Save email
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-emerald-600 dark:text-emerald-300" />
              <h4 className="text-sm font-medium">Google Scholar (Serper)</h4>
              {serperConnected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check className="size-3" />
                  Connected
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Optional. Enables the Google Scholar source in Citation Search
              via Serper. Without a key, that source is skipped when selected.
            </p>
            <a
              href="https://serper.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Serper API
              <ExternalLink className="size-3" />
            </a>
          </div>
          {serperConnected && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={serperBusy}
              onClick={() => void removeSerper()}
            >
              {serperBusy && <Loader2 className="animate-spin" />}
              Remove key
            </Button>
          )}
        </div>
        {!serperConnected && (
          <div className="mt-4 flex max-w-md gap-2">
            <Input
              type="password"
              data-testid="serper-api-key-input"
              value={serperKey}
              onChange={(event) => setSerperKey(event.target.value)}
              placeholder="Serper API key"
              aria-label="Serper API key"
              className="h-9"
            />
            <Button
              type="button"
              size="sm"
              data-testid="serper-api-key-save"
              disabled={serperBusy || !serperKey.trim()}
              onClick={() => void saveSerper()}
            >
              {serperBusy && <Loader2 className="animate-spin" />}
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
