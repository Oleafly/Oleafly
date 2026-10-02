import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ComponentType } from "react";
import { LibraryBig } from "lucide-react";
import { ArxivIcon } from "@/components/icons/ArxivIcon";
import {
  CrossrefBrandIcon,
  GoogleScholarBrandIcon,
  OpenAlexBrandIcon,
  PubMedBrandIcon,
  SemanticScholarBrandIcon,
} from "@/components/settings/IntegrationBrandIcons";
import {
  ConnectedBadge,
  IntegrationBusyButton,
  IntegrationCard,
  IntegrationKeyField,
} from "@/components/settings/IntegrationCard";
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

  const connectedLabel = t(($) => $.settings.citations.connected);

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

      <IntegrationCard
        framed
        icon={<SemanticScholarBrandIcon className="size-4 text-[#1857B6] dark:text-[#5B9BE6]" />}
        title={"Semantic Scholar"}
        badge={connected ? <ConnectedBadge label={connectedLabel} /> : null}
        description={t(($) => $.settings.citations.semanticScholar.hint)}
        docs={{
          href: "https://www.semanticscholar.org/product/api",
          label: t(($) => $.settings.citations.semanticScholar.docsLink),
        }}
        actions={
          connected && (
            <IntegrationBusyButton variant="outline" busy={busy} onClick={() => void remove()}>
              {t(($) => $.settings.citations.actions.removeKey)}
            </IntegrationBusyButton>
          )
        }
      >
        {!connected && (
          <IntegrationKeyField
            value={apiKey}
            onChange={setApiKey}
            label={t(($) => $.settings.citations.semanticScholar.keyLabel)}
            busy={busy}
            submitLabel={t(($) => $.settings.citations.actions.saveKey)}
            onSubmit={() => void save()}
          />
        )}
      </IntegrationCard>

      <IntegrationCard
        framed
        icon={<OpenAlexBrandIcon className="size-4 text-foreground" />}
        title={"OpenAlex"}
        badge={
          openAlexKeyConnected || openAlexConnected ? (
            <ConnectedBadge label={connectedLabel} />
          ) : null
        }
        description={t(($) => $.settings.citations.openAlex.hint)}
        docs={{
          href: "https://help.openalex.org/api/authentication/",
          label: t(($) => $.settings.citations.openAlex.docsLink),
        }}
        actions={
          <>
            {openAlexKeyConnected && (
              <IntegrationBusyButton
                variant="outline"
                busy={openAlexKeyBusy}
                onClick={() => void removeOpenAlexKey()}
              >
                {t(($) => $.settings.citations.actions.removeApiKey)}
              </IntegrationBusyButton>
            )}
            {openAlexConnected && (
              <IntegrationBusyButton
                variant="outline"
                busy={openAlexBusy}
                onClick={() => void removeOpenAlexEmail()}
              >
                {t(($) => $.settings.citations.actions.removeEmail)}
              </IntegrationBusyButton>
            )}
          </>
        }
      >
        {!openAlexKeyConnected && (
          <IntegrationKeyField
            inputTestId="openalex-api-key-input"
            submitTestId="openalex-api-key-save"
            value={openAlexKey}
            onChange={setOpenAlexKey}
            label={t(($) => $.settings.citations.openAlex.keyLabel)}
            busy={openAlexKeyBusy}
            submitLabel={t(($) => $.settings.citations.actions.saveApiKey)}
            onSubmit={() => void saveOpenAlexKey()}
          />
        )}
        {!openAlexConnected && (
          <IntegrationKeyField
            type="email"
            inputTestId="openalex-email-input"
            submitTestId="openalex-email-save"
            value={openAlexEmail}
            onChange={setOpenAlexEmail}
            label={t(($) => $.settings.citations.openAlex.emailLabel)}
            placeholder={t(($) => $.settings.citations.openAlex.emailPlaceholder)}
            busy={openAlexBusy}
            submitLabel={t(($) => $.settings.citations.actions.saveEmail)}
            onSubmit={() => void saveOpenAlexEmail()}
          />
        )}
      </IntegrationCard>

      <IntegrationCard
        framed
        icon={<GoogleScholarBrandIcon className="size-4 text-[#4285F4]" />}
        title={"Google Scholar (Serper)"}
        badge={serperConnected ? <ConnectedBadge label={connectedLabel} /> : null}
        description={t(($) => $.settings.citations.serper.hint)}
        docs={{
          href: "https://serper.dev",
          label: t(($) => $.settings.citations.serper.docsLink),
        }}
        actions={
          serperConnected && (
            <IntegrationBusyButton
              variant="outline"
              busy={serperBusy}
              onClick={() => void removeSerper()}
            >
              {t(($) => $.settings.citations.actions.removeKey)}
            </IntegrationBusyButton>
          )
        }
      >
        {!serperConnected && (
          <IntegrationKeyField
            inputTestId="serper-api-key-input"
            submitTestId="serper-api-key-save"
            value={serperKey}
            onChange={setSerperKey}
            label={t(($) => $.settings.citations.serper.keyLabel)}
            busy={serperBusy}
            submitLabel={t(($) => $.settings.citations.actions.saveKey)}
            onSubmit={() => void saveSerper()}
          />
        )}
      </IntegrationCard>

      <IntegrationCard
        framed
        title={t(($) => $.settings.citations.keyFree.title)}
        description={t(($) => $.settings.citations.keyFree.description)}
      >
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
      </IntegrationCard>
    </div>
  );
}
