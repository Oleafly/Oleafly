import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, Globe, Package, Server, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckBadge } from "@/components/ui/check-badge";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/section-heading";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import {
  getDownloadSettings,
  setDownloadSettings,
  type DownloadSettings,
  type DownloadSettingsInput,
  type DownloadSourceChoice,
} from "@/lib/tauri";

type RepositoryChoice = "automatic" | "custom";
type Field = "mirror" | "repository";

const SOURCE_ICONS: Record<DownloadSourceChoice, LucideIcon> = {
  automatic: Cloud,
  original: Globe,
  custom: Server,
};
const SOURCES: DownloadSourceChoice[] = ["automatic", "original", "custom"];
const REPOSITORIES: RepositoryChoice[] = ["automatic", "custom"];

function addressHost(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

function ChoiceCard({
  selected,
  saved,
  disabled,
  icon: Icon,
  name,
  detail,
  testId,
  onSelect,
  children,
}: Readonly<{
  selected: boolean;
  saved: boolean;
  disabled: boolean;
  icon: LucideIcon;
  name: string;
  detail: string;
  testId: string;
  onSelect: () => void;
  children?: ReactNode;
}>) {
  return (
    <div className={cn("rounded-lg border transition-colors", selected && "border-primary")}>
      <button
        type="button"
        data-testid={testId}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onSelect}
        className="w-full rounded-lg p-3 text-left hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
      >
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span className="text-sm">{name}</span>
          {saved && <CheckBadge />}
        </div>
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">{detail}</p>
      </button>
      {children}
    </div>
  );
}

function AddressForm({
  value,
  placeholder,
  label,
  saveLabel,
  busy,
  disabled,
  error,
  testId,
  onChange,
  onSave,
}: Readonly<{
  value: string;
  placeholder: string;
  label: string;
  saveLabel: string;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  testId: string;
  onChange: (value: string) => void;
  onSave: () => void;
}>) {
  return (
    <form
      className="flex flex-col gap-1.5 px-3 pb-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          data-testid={`${testId}-input`}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={2048}
          disabled={disabled}
          className="min-w-0 flex-1 font-mono text-xs"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={disabled || busy || value.trim().length === 0}
          data-testid={`${testId}-save`}
        >
          {saveLabel}
        </Button>
      </div>
      {error && (
        <p role="alert" className="select-text text-xs text-destructive" data-testid={`${testId}-error`}>
          {error}
        </p>
      )}
    </form>
  );
}

export function DownloadSources() {
  const { t } = useTranslation(["settings"]);
  const [settings, setSettings] = useState<DownloadSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<DownloadSourceChoice>("automatic");
  const [repository, setRepository] = useState<RepositoryChoice>("automatic");
  const [mirrorDraft, setMirrorDraft] = useState("");
  const [repositoryDraft, setRepositoryDraft] = useState("");
  const [saving, setSaving] = useState<Field | null>(null);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);

  const adopt = useCallback((next: DownloadSettings) => {
    setSettings(next);
    setSource(next.source);
    setRepository(next.texRepository ? "custom" : "automatic");
    setMirrorDraft(next.mirrorUrl ?? "");
    setRepositoryDraft(next.texRepository ?? "");
  }, []);

  useEffect(() => {
    let live = true;
    getDownloadSettings()
      .then((next) => {
        if (live) adopt(next);
      })
      .catch((reason: unknown) => {
        if (live) setLoadError(describeError(reason));
      });
    return () => {
      live = false;
    };
  }, [adopt]);

  if (loadError) {
    return (
      <p role="alert" className="select-text text-sm text-destructive">
        {loadError}
      </p>
    );
  }
  if (!settings) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  const save = async (field: Field, changes: Partial<DownloadSettingsInput>) => {
    setSaving(field);
    setError(null);
    try {
      adopt(
        await setDownloadSettings({
          source: settings.source,
          mirrorUrl: settings.mirrorUrl,
          texRepository: settings.texRepository,
          ...changes,
        }),
      );
    } catch (reason) {
      setError({ field, message: describeError(reason) });
    } finally {
      setSaving(null);
    }
  };

  const chooseSource = (choice: DownloadSourceChoice) => {
    setError(null);
    setSource(choice);
    if (choice !== "custom" || settings.mirrorUrl) {
      void save("mirror", { source: choice });
    }
  };

  const chooseRepository = (choice: RepositoryChoice) => {
    setError(null);
    setRepository(choice);
    if (choice === "automatic") void save("repository", { texRepository: null });
  };

  const sourceLocked = settings.environmentSource !== null;
  const repositoryLocked = settings.environmentTexRepository !== null;
  const mirrorHost = addressHost(settings.oleaflyMirror);
  const automaticRepositoryHost = addressHost(settings.automaticTexRepository);

  return (
    <div className="flex flex-col gap-6" data-testid="download-sources">
      <section className="flex flex-col gap-2" aria-label={t(($) => $.settings.downloads.sources.files.heading)}>
        <SectionHeading>{t(($) => $.settings.downloads.sources.files.heading)}</SectionHeading>
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.downloads.sources.files.intro)}</p>
        {sourceLocked && (
          <p className="text-xs text-muted-foreground" data-testid="download-sources-environment">
            {t(($) => $.settings.downloads.sources.environment, {
              variable: "OLEAFLY_DOWNLOAD_MIRROR",
              value: settings.environmentSource,
            })}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {SOURCES.map((choice) => (
            <ChoiceCard
              key={choice}
              selected={!sourceLocked && source === choice}
              saved={!sourceLocked && settings.source === choice}
              disabled={sourceLocked || saving !== null}
              icon={SOURCE_ICONS[choice]}
              name={t(($) => $.settings.downloads.sources.files.choices[choice].name)}
              detail={t(($) => $.settings.downloads.sources.files.choices[choice].detail, { host: mirrorHost })}
              testId={`download-source-${choice}`}
              onSelect={() => chooseSource(choice)}
            >
              {choice === "custom" && source === "custom" && !sourceLocked && (
                <AddressForm
                  value={mirrorDraft}
                  placeholder={t(($) => $.settings.downloads.sources.files.addressPlaceholder)}
                  label={t(($) => $.settings.downloads.sources.files.addressLabel)}
                  saveLabel={t(($) => $.settings.downloads.sources.save)}
                  busy={saving === "mirror"}
                  disabled={saving !== null}
                  error={error?.field === "mirror" ? error.message : null}
                  testId="download-mirror"
                  onChange={setMirrorDraft}
                  onSave={() => void save("mirror", { source: "custom", mirrorUrl: mirrorDraft })}
                />
              )}
            </ChoiceCard>
          ))}
        </div>
        {error?.field === "mirror" && source !== "custom" && (
          <p role="alert" className="select-text text-xs text-destructive">
            {error.message}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label={t(($) => $.settings.downloads.sources.repository.heading)}>
        <SectionHeading>{t(($) => $.settings.downloads.sources.repository.heading)}</SectionHeading>
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.downloads.sources.repository.intro)}</p>
        {repositoryLocked && (
          <p className="text-xs text-muted-foreground" data-testid="download-repository-environment">
            {t(($) => $.settings.downloads.sources.environment, {
              variable: "OLEAFLY_TEX_REPOSITORY",
              value: settings.environmentTexRepository,
            })}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {REPOSITORIES.map((choice) => (
            <ChoiceCard
              key={choice}
              selected={!repositoryLocked && repository === choice}
              saved={!repositoryLocked && (settings.texRepository ? "custom" : "automatic") === choice}
              disabled={repositoryLocked || saving !== null}
              icon={choice === "automatic" ? Globe : Package}
              name={t(($) => $.settings.downloads.sources.repository.choices[choice].name)}
              detail={t(($) => $.settings.downloads.sources.repository.choices[choice].detail, {
                host: automaticRepositoryHost,
              })}
              testId={`download-repository-${choice}`}
              onSelect={() => chooseRepository(choice)}
            >
              {choice === "custom" && repository === "custom" && !repositoryLocked && (
                <AddressForm
                  value={repositoryDraft}
                  placeholder={t(($) => $.settings.downloads.sources.repository.addressPlaceholder)}
                  label={t(($) => $.settings.downloads.sources.repository.addressLabel)}
                  saveLabel={t(($) => $.settings.downloads.sources.save)}
                  busy={saving === "repository"}
                  disabled={saving !== null}
                  error={error?.field === "repository" ? error.message : null}
                  testId="download-repository"
                  onChange={setRepositoryDraft}
                  onSave={() => void save("repository", { texRepository: repositoryDraft })}
                />
              )}
            </ChoiceCard>
          ))}
        </div>
        {error?.field === "repository" && repository !== "custom" && (
          <p role="alert" className="select-text text-xs text-destructive">
            {error.message}
          </p>
        )}
        <p className="text-[0.6875rem] text-muted-foreground">
          {t(($) => $.settings.downloads.sources.repository.miktex)}
        </p>
      </section>
    </div>
  );
}
