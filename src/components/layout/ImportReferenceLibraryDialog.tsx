import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Download, Settings2, Upload } from "lucide-react";
import { ZoteroBrandIcon } from "@/components/settings/IntegrationBrandIcons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addCitations,
  parseCitationFile,
  type BatchImportResult,
} from "@/features/citation";
import type { ParsedBib } from "@/lib/citation/types";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { zoteroLibraryBibtex, type ZoteroLibraryExport } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { i18n } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useZoteroConnectorStore } from "@/store/zotero-connector";
import { Spinner } from "@/components/ui/spinner";

const ZOTERO_LIBRARY_FILE = "zotero-library.bib";

function ZoteroLogo() {
  return (
    <span data-testid="zotero-logo" className="flex">
      <ZoteroBrandIcon className="size-4 text-[#CC2936]" />
    </span>
  );
}

const ENDNOTE_WORDMARK = "en";

function EndNoteLogo() {
  return (
    <svg
      data-testid="endnote-logo"
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
    >
      <rect x="2" y="2" width="20" height="20" rx="4.5" fill="#c82035" />
      <text
        x="4.15"
        y="16.1"
        fill="white"
        fontFamily="Arial, sans-serif"
        fontSize="12.5"
        fontWeight="700"
        letterSpacing="-0.8"
      >
        {ENDNOTE_WORDMARK}
      </text>
    </svg>
  );
}

function summarize(result: BatchImportResult): string {
  const target = result.bibPath || i18n.t(($) => $.references.import.defaultTarget);
  if (!result.imported) {
    if (result.duplicates) {
      return i18n.t(($) => $.references.import.allDuplicates, {
        count: result.duplicates,
        target,
      });
    }
    return i18n.t(($) => $.references.import.nothingNew, { target });
  }
  return result.duplicates
    ? i18n.t(($) => $.references.import.addedWithDuplicates, {
        count: result.imported,
        duplicates: result.duplicates,
        target,
      })
    : i18n.t(($) => $.references.import.added, { count: result.imported, target });
}

type ReadOutcome = { entries: ParsedBib[] } | { error: string };

function parseEntries(name: string, text: string, emptyMessage: string): ReadOutcome {
  let entries: ParsedBib[] | null;
  try {
    entries = parseCitationFile(name, text);
  } catch (error) {
    void logError("import references", error);
    return { error: i18n.t(($) => $.references.import.readFailed) };
  }
  if (!entries) {
    return { error: i18n.t(($) => $.references.import.unrecognized, { name }) };
  }
  if (!entries.length) return { error: emptyMessage };
  return { entries };
}

async function readEntries(file: File): Promise<ReadOutcome> {
  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    void logError("import references", error);
    return { error: i18n.t(($) => $.references.import.readFailed) };
  }
  return parseEntries(file.name, text, i18n.t(($) => $.references.import.empty));
}

function describeErrors(errors: readonly string[]): string {
  const sentences = errors
    .map((error) => error.trim())
    .filter(Boolean)
    .map((error) => (/[.!?]$/.test(error) ? error : `${error}.`));
  if (sentences.length <= 1) {
    return sentences[0] ?? i18n.t(($) => $.references.import.failed);
  }
  return i18n.t(($) => $.references.import.problems, {
    count: sentences.length,
    details: sentences.join(" "),
  });
}

interface FilePickerButtonProps {
  accept: string;
  label: string;
  onFile: (file: File) => Promise<void>;
  busy: boolean;
}

function FilePickerButton({ accept, label, onFile, busy }: Readonly<FilePickerButtonProps>) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-3.5" />
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onFile(file);
        }}
      />
    </>
  );
}

interface SourceCardProps {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  children: ReactNode;
  testId?: string;
}

function SourceCard({ icon, title, description, children, testId }: Readonly<SourceCardProps>) {
  return (
    <div data-testid={testId} className="rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function ImportReferenceLibraryDialog({
  open,
  onOpenChange,
  onImported,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}>) {
  const { t } = useTranslation(["references"]);
  const [busy, setBusy] = useState(false);
  const [zoteroBusy, setZoteroBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoteroConnected = useZoteroConnectorStore((state) => state.connected);
  const refreshZotero = useZoteroConnectorStore((state) => state.refresh);

  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  useEffect(() => {
    if (open) void refreshZotero();
  }, [open, refreshZotero]);

  const importEntries = async (entries: ParsedBib[], note?: string) => {
    try {
      const result = await addCitations(entries);
      if (result.errors.length) {
        setError(describeErrors(result.errors));
        return;
      }
      const summary = summarize(result);
      toast.success(note ? `${summary} ${note}` : summary);
      onImported?.();
      onOpenChange(false);
    } catch (error_) {
      void logError("import references", error_);
      setError(i18n.t(($) => $.references.import.failed));
    }
  };

  const handleUpload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await readEntries(file);
      if ("error" in outcome) {
        setError(outcome.error);
        return;
      }
      await importEntries(outcome.entries);
    } finally {
      setBusy(false);
    }
  };

  const handleZoteroLibrary = async () => {
    setBusy(true);
    setZoteroBusy(true);
    setError(null);
    try {
      let library: ZoteroLibraryExport;
      try {
        library = await zoteroLibraryBibtex();
      } catch (error_) {
        void logError("import Zotero library", error_);
        setError(describeError(error_));
        return;
      }
      const outcome = parseEntries(
        ZOTERO_LIBRARY_FILE,
        library.bibtex,
        i18n.t(($) => $.references.import.zotero.empty),
      );
      if ("error" in outcome) {
        setError(outcome.error);
        return;
      }
      const note =
        library.total > library.count
          ? i18n.t(($) => $.references.import.zotero.limited, {
              fetched: library.count,
              total: library.total,
            })
          : undefined;
      await importEntries(outcome.entries, note);
    } finally {
      setZoteroBusy(false);
      setBusy(false);
    }
  };

  const openZoteroSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("integrations");
    settings.setSettingsScrollTarget("zotero");
    onOpenChange(false);
    settings.setSettingsOpen(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(($) => $.references.import.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.references.import.description)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <SourceCard
            testId="zotero-import-card"
            icon={<ZoteroLogo />}
            title={t(($) => $.references.import.zotero.title)}
            description={
              zoteroConnected
                ? t(($) => $.references.import.zotero.connectedDescription)
                : t(($) => $.references.import.zotero.description)
            }
          >
            {zoteroConnected ? (
              <Button size="sm" disabled={busy} onClick={() => void handleZoteroLibrary()}>
                {zoteroBusy ? (
                  <Spinner size="sm" />
                ) : (
                  <Download aria-hidden className="size-3.5" />
                )}
                {t(($) => $.references.import.zotero.importLibrary)}
              </Button>
            ) : null}
            <FilePickerButton
              accept=".rdf"
              label={t(($) => $.references.import.zotero.button)}
              onFile={handleUpload}
              busy={busy}
            />
            {zoteroConnected ? null : (
              <Button size="sm" variant="ghostPrimary" disabled={busy} onClick={openZoteroSettings}>
                <Settings2 aria-hidden className="size-3.5" />
                {t(($) => $.references.import.zotero.connect)}
              </Button>
            )}
          </SourceCard>
          <SourceCard
            icon={<EndNoteLogo />}
            title={t(($) => $.references.import.endnote.title)}
            description={t(($) => $.references.import.endnote.description)}
          >
            <FilePickerButton
              accept=".xml,.ris,.bib"
              label={t(($) => $.references.import.endnote.button)}
              onFile={handleUpload}
              busy={busy}
            />
          </SourceCard>
        </div>
        {error ? (
          <div
            role="alert"
            className="flex select-text items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <p className="text-center text-xs text-muted-foreground">
          {t(($) => $.references.import.duplicateNote)}
        </p>
      </DialogContent>
    </Dialog>
  );
}
