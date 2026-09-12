import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
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
import { notifyError, toast } from "@/lib/toast";
import { i18n } from "@/i18n";

function ZoteroLogo() {
  return (
    <svg
      data-testid="zotero-logo"
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
    >
      <path
        fill="#cc2936"
        d="M4 3.75h16v3.1L9.15 17H20v3.25H4v-3.1L14.85 7H4z"
      />
    </svg>
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

interface UploadCardProps {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  accept: string;
  buttonLabel: string;
  onFile: (file: File) => Promise<void>;
  busy: boolean;
}

function UploadCard({
  icon,
  title,
  description,
  accept,
  buttonLabel,
  onFile,
  busy,
}: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {buttonLabel}
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
        </div>
      </div>
    </div>
  );
}

export function ImportReferenceLibraryDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}) {
  const { t } = useTranslation(["references"]);
  const [busy, setBusy] = useState(false);

  const handleUpload = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const entries = parseCitationFile(file.name, text);
      if (!entries) {
        toast.error(i18n.t(($) => $.references.import.unrecognized, { name: file.name }));
        return;
      }
      if (!entries.length) {
        toast.error(i18n.t(($) => $.references.import.empty));
        return;
      }
      const result = await addCitations(entries);
      if (result.errors.length) {
        toast.error(describeErrors(result.errors));
        return;
      }
      toast.success(summarize(result));
      onImported?.();
      onOpenChange(false);
    } catch (error) {
      notifyError("import references", error, i18n.t(($) => $.references.import.readFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(($) => $.references.import.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.references.import.description)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <UploadCard
            icon={<ZoteroLogo />}
            title={t(($) => $.references.import.zotero.title)}
            description={t(($) => $.references.import.zotero.description)}
            accept=".rdf"
            buttonLabel={t(($) => $.references.import.zotero.button)}
            onFile={handleUpload}
            busy={busy}
          />
          <UploadCard
            icon={<EndNoteLogo />}
            title={t(($) => $.references.import.endnote.title)}
            description={t(($) => $.references.import.endnote.description)}
            accept=".xml,.ris,.bib"
            buttonLabel={t(($) => $.references.import.endnote.button)}
            onFile={handleUpload}
            busy={busy}
          />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {t(($) => $.references.import.duplicateNote)}
        </p>
      </DialogContent>
    </Dialog>
  );
}
