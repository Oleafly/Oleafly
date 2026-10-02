import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ComponentType } from "react";
import { Check, ExternalLink, LibraryBig, Loader2 } from "lucide-react";
import { ArxivIcon } from "@/components/icons/ArxivIcon";
import {
  CrossrefBrandIcon,
  GoogleScholarBrandIcon,
  OpenAlexBrandIcon,
  PubMedBrandIcon,
  SemanticScholarBrandIcon,
} from "@/components/settings/IntegrationBrandIcons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getConnectorKey, setConnectorKey } from "@/lib/tauri";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const KEY_FREE_SOURCES: readonly {
  name: string;
  Icon: ComponentType<{ className?: string }>;
  tone: string;
}[] = [
  { name: "arXiv", Icon: ArxivIcon, tone: "text-[#B31B1B] dark:text-[#E05A5A]" },
  { name: "Crossref", Icon: CrossrefBrandIcon, tone: "" },
  { name: "PubMed", Icon: PubMedBrandIcon, tone: "text-[#326599] dark:text-[#6FA0D2]" },
];

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

  const [announcement, setAnnouncement] = useState("");

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

  const updateCredential = async (
    connector: string,
    value: string,
    setPending: (pending: boolean) => void,
    apply: () => void,
    doneMessage: string,
    failedMessage: string,
  ) => {
    setPending(true);
    setAnnouncement("");
    try {
      await setConnectorKey(connector, value);
      apply();
      setAnnouncement(doneMessage);
    } catch (error) {
      void logError(`citation search ${connector}`, error);
      toast.error(failedMessage);
    } finally {
      setPending(false);
    }
  };

  const save = async () => {
    const nextKey = apiKey.trim();
    if (!nextKey) return;
    await updateCredential(
      "semantic-scholar",
      nextKey,
      setBusy,
      () => {
        setApiKey("");
        setConnected(true);
      },
      t(($) => $.settings.citations.semanticScholar.keySaved),
      t(($) => $.settings.citations.semanticScholar.keySaveFailed),
    );
  };

  const remove = () =>
    updateCredential(
      "semantic-scholar",
      "",
      setBusy,
      () => setConnected(false),
      t(($) => $.settings.citations.semanticScholar.keyRemoved),
      t(($) => $.settings.citations.semanticScholar.keyRemoveFailed),
    );

  const saveOpenAlexEmail = async () => {
    const email = openAlexEmail.trim();
    if (!email) return;
    await updateCredential(
      "openalex-email",
      email,
      setOpenAlexBusy,
      () => {
        setOpenAlexEmail("");
        setOpenAlexConnected(true);
      },
      t(($) => $.settings.citations.openAlex.emailSaved),
      t(($) => $.settings.citations.openAlex.emailSaveFailed),
    );
  };

  const saveOpenAlexKey = async () => {
    const key = openAlexKey.trim();
    if (!key) return;
    await updateCredential(
      "openalex-api-key",
      key,
      setOpenAlexKeyBusy,
      () => {
        setOpenAlexKey("");
        setOpenAlexKeyConnected(true);
      },
      t(($) => $.settings.citations.openAlex.keySaved),
      t(($) => $.settings.citations.openAlex.keySaveFailed),
    );
  };

  const removeOpenAlexKey = () =>
    updateCredential(
      "openalex-api-key",
      "",
      setOpenAlexKeyBusy,
      () => setOpenAlexKeyConnected(false),
      t(($) => $.settings.citations.openAlex.keyRemoved),
      t(($) => $.settings.citations.openAlex.keyRemoveFailed),
    );

  const removeOpenAlexEmail = () =>
    updateCredential(
      "openalex-email",
      "",
      setOpenAlexBusy,
      () => setOpenAlexConnected(false),
      t(($) => $.settings.citations.openAlex.emailRemoved),
      t(($) => $.settings.citations.openAlex.emailRemoveFailed),
    );

  const saveSerper = async () => {
    const nextKey = serperKey.trim();
    if (!nextKey) return;
    await updateCredential(
      "serper",
      nextKey,
      setSerperBusy,
      () => {
        setSerperKey("");
        setSerperConnected(true);
      },
      t(($) => $.settings.citations.serper.keySaved),
      t(($) => $.settings.citations.serper.keySaveFailed),
    );
  };

  const removeSerper = () =>
    updateCredential(
      "serper",
      "",
      setSerperBusy,
      () => setSerperConnected(false),
      t(($) => $.settings.citations.serper.keyRemoved),
      t(($) => $.settings.citations.serper.keyRemoveFailed),
    );

  return (
    <div
      data-testid="citation-search-integration"
      className="space-y-4"
    >
      <output className="sr-only">{announcement}</output>
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
              <SemanticScholarBrandIcon className="size-4 text-[#1857B6] dark:text-[#5B9BE6]" />
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
              <OpenAlexBrandIcon className="size-4 text-foreground" />
              <h4 className="text-sm font-medium">{"OpenAlex"}</h4>
              {(openAlexKeyConnected || openAlexConnected) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check className="size-3" />
                  {t(($) => $.settings.citations.connected)}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t(($) => $.settings.citations.openAlex.hint)}
            </p>
            <a
              href="https://help.openalex.org/api/authentication/"
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
              {t(($) => $.settings.citations.actions.removeApiKey)}
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
              placeholder={t(($) => $.settings.citations.openAlex.keyLabel)}
              aria-label={t(($) => $.settings.citations.openAlex.keyLabel)}
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
              {t(($) => $.settings.citations.actions.saveApiKey)}
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
              <GoogleScholarBrandIcon className="size-4 text-[#4285F4]" />
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
          {KEY_FREE_SOURCES.map(({ name, Icon, tone }) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground"
            >
              <Icon className={cn("size-3.5", tone)} />
              {name}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
