import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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

const KEY_FREE_SOURCES = ["arXiv", "Crossref", "PubMed"] as const;

export function CitationSearchIntegrationSection() {
  const { t } = useTranslation(["common", "settings"]);
  const [apiKey, setApiKey] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const [openAlexEmail, setOpenAlexEmail] = useState("");
  const [openAlexConnected, setOpenAlexConnected] = useState<boolean | null>(
    null,
  );
  const [openAlexBusy, setOpenAlexBusy] = useState(false);

  const [openAlexKey, setOpenAlexKey] = useState("");
  const [openAlexKeyConnected, setOpenAlexKeyConnected] = useState<
    boolean | null
  >(null);
  const [openAlexKeyBusy, setOpenAlexKeyBusy] = useState(false);

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
    void getConnectorKey("openalex-api-key")
      .then((key) => {
        if (!cancelled) setOpenAlexKeyConnected(Boolean(key));
      })
      .catch(() => {
        if (!cancelled) setOpenAlexKeyConnected(false);
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
      toast.success(t(($) => $.settings.citations.semanticScholar.keySaved));
    } catch {
      toast.error(t(($) => $.settings.citations.semanticScholar.keySaveFailed));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await setConnectorKey("semantic-scholar", "");
      setConnected(false);
      toast.success(t(($) => $.settings.citations.semanticScholar.keyRemoved));
    } catch {
      toast.error(t(($) => $.settings.citations.semanticScholar.keyRemoveFailed));
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
      toast.success(t(($) => $.settings.citations.openAlex.emailSaved));
    } catch {
      toast.error(t(($) => $.settings.citations.openAlex.emailSaveFailed));
    } finally {
      setOpenAlexBusy(false);
    }
  };

  const saveOpenAlexKey = async () => {
    const key = openAlexKey.trim();
    if (!key) return;
    setOpenAlexKeyBusy(true);
    try {
      await setConnectorKey("openalex-api-key", key);
      setOpenAlexKey("");
      setOpenAlexKeyConnected(true);
      toast.success("OpenAlex API key saved");
    } catch {
      toast.error("Could not save the OpenAlex API key.");
    } finally {
      setOpenAlexKeyBusy(false);
    }
  };

  const removeOpenAlexKey = async () => {
    setOpenAlexKeyBusy(true);
    try {
      await setConnectorKey("openalex-api-key", "");
      setOpenAlexKeyConnected(false);
      toast.success("OpenAlex API key removed");
    } catch {
      toast.error("Could not remove the OpenAlex API key.");
    } finally {
      setOpenAlexKeyBusy(false);
    }
  };

  const removeOpenAlexEmail = async () => {
    setOpenAlexBusy(true);
    try {
      await setConnectorKey("openalex-email", "");
      setOpenAlexConnected(false);
      toast.success(t(($) => $.settings.citations.openAlex.emailRemoved));
    } catch {
      toast.error(t(($) => $.settings.citations.openAlex.emailRemoveFailed));
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
      toast.success(t(($) => $.settings.citations.serper.keySaved));
    } catch {
      toast.error(t(($) => $.settings.citations.serper.keySaveFailed));
    } finally {
      setSerperBusy(false);
    }
  };

  const removeSerper = async () => {
    setSerperBusy(true);
    try {
      await setConnectorKey("serper", "");
      setSerperConnected(false);
      toast.success(t(($) => $.settings.citations.serper.keyRemoved));
    } catch {
      toast.error(t(($) => $.settings.citations.serper.keyRemoveFailed));
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
          <h3 className="text-sm font-semibold">
            {t(($) => $.settings.citations.title)}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t(($) => $.settings.citations.description)}
          </p>
        </div>
      </div>

      <section className="rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-blue-600 dark:text-blue-300" />
              <h4 className="text-sm font-medium">{"Semantic Scholar"}</h4>
              {connected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check className="size-3" />
                  {t(($) => $.settings.citations.connected)}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t(($) => $.settings.citations.semanticScholar.hint)}
            </p>
            <a
              href="https://www.semanticscholar.org/product/api"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t(($) => $.settings.citations.semanticScholar.docsLink)}
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
              {t(($) => $.settings.citations.actions.removeKey)}
            </Button>
          )}
        </div>

        {!connected && (
          <div className="mt-4 flex max-w-md gap-2">
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={t(($) => $.settings.citations.semanticScholar.keyLabel)}
              aria-label={t(($) => $.settings.citations.semanticScholar.keyLabel)}
              className="h-9"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !apiKey.trim()}
              onClick={() => void save()}
            >
              {busy && <Loader2 className="animate-spin" />}
              {t(($) => $.settings.citations.actions.saveKey)}
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-blue-600 dark:text-blue-300" />
              <h4 className="text-sm font-medium">{"OpenAlex"}</h4>
              {openAlexConnected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check className="size-3" />
                  {t(($) => $.settings.citations.connected)}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              An API key is recommended: OpenAlex made keys mandatory in
              February 2026, and keyless searches draw from a small shared
              daily pool. The contact email adds the polite pool on top.
              Both are stored locally.
            </p>
            <a
              href="https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t(($) => $.settings.citations.openAlex.docsLink)}
              <ExternalLink className="size-3" />
            </a>
          </div>
          {openAlexKeyConnected && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={openAlexKeyBusy}
              onClick={() => void removeOpenAlexKey()}
            >
              {openAlexKeyBusy && <Loader2 className="animate-spin" />}
              Remove API key
            </Button>
          )}
          {openAlexConnected && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={openAlexBusy}
              onClick={() => void removeOpenAlexEmail()}
            >
              {openAlexBusy && <Loader2 className="animate-spin" />}
              {t(($) => $.settings.citations.actions.removeEmail)}
            </Button>
          )}
        </div>

        {!openAlexKeyConnected && (
          <div className="mt-4 flex max-w-md gap-2">
            <Input
              type="password"
              data-testid="openalex-api-key-input"
              value={openAlexKey}
              onChange={(event) => setOpenAlexKey(event.target.value)}
              placeholder="OpenAlex API key"
              aria-label="OpenAlex API key"
              className="h-9"
            />
            <Button
              type="button"
              size="sm"
              data-testid="openalex-api-key-save"
              disabled={openAlexKeyBusy || !openAlexKey.trim()}
              onClick={() => void saveOpenAlexKey()}
            >
              {openAlexKeyBusy && <Loader2 className="animate-spin" />}
              Save API key
            </Button>
          </div>
        )}

        {!openAlexConnected && (
          <div className="mt-4 flex max-w-md gap-2">
            <Input
              type="email"
              data-testid="openalex-email-input"
              value={openAlexEmail}
              onChange={(event) => setOpenAlexEmail(event.target.value)}
              placeholder={t(($) => $.settings.citations.openAlex.emailPlaceholder)}
              aria-label={t(($) => $.settings.citations.openAlex.emailLabel)}
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
              {t(($) => $.settings.citations.actions.saveEmail)}
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-emerald-600 dark:text-emerald-300" />
              <h4 className="text-sm font-medium">{"Google Scholar (Serper)"}</h4>
              {serperConnected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check className="size-3" />
                  {t(($) => $.settings.citations.connected)}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t(($) => $.settings.citations.serper.hint)}
            </p>
            <a
              href="https://serper.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t(($) => $.settings.citations.serper.docsLink)}
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
              {t(($) => $.settings.citations.actions.removeKey)}
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
              placeholder={t(($) => $.settings.citations.serper.keyLabel)}
              aria-label={t(($) => $.settings.citations.serper.keyLabel)}
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
              {t(($) => $.settings.citations.actions.saveKey)}
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-background p-4">
        <h4 className="text-sm font-medium">
          {t(($) => $.settings.citations.keyFree.title)}
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t(($) => $.settings.citations.keyFree.description)}
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
