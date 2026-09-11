import { useRef, useState } from "react";
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
        en
      </text>
    </svg>
  );
}

function summarize(result: BatchImportResult): string {
  const target = result.bibPath || "the bibliography";
  if (!result.imported) {
    if (result.duplicates === 1) return `That reference is already in ${target}.`;
    if (result.duplicates) {
      return `Those ${result.duplicates} references are already in ${target}.`;
    }
    return `Nothing new to add to ${target}.`;
  }
  const added = `${result.imported} reference${result.imported === 1 ? "" : "s"} added to ${target}`;
  return result.duplicates
    ? `${added}, ${result.duplicates} already there.`
    : `${added}.`;
}

function describeErrors(errors: readonly string[]): string {
  const sentences = errors
    .map((error) => error.trim())
    .filter(Boolean)
    .map((error) => (/[.!?]$/.test(error) ? error : `${error}.`));
  if (sentences.length <= 1) return sentences[0] ?? "Could not import those references.";
  return `${sentences.length} problems during import. ${sentences.join(" ")}`;
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
  const [busy, setBusy] = useState(false);

  const handleUpload = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const entries = parseCitationFile(file.name, text);
      if (!entries) {
        toast.error(`Unrecognized file type: ${file.name}`);
        return;
      }
      if (!entries.length) {
        toast.error("No references found in that file.");
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
      notifyError("import references", error, "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import reference library</DialogTitle>
          <DialogDescription>
            Add references from a citation manager or bibliography file to
            this project.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <UploadCard
            icon={<ZoteroLogo />}
            title="Zotero"
            description="In Zotero, select File → Export Library → Zotero RDF. Then choose the exported file."
            accept=".rdf"
            buttonLabel="Choose Zotero RDF file"
            onFile={handleUpload}
            busy={busy}
          />
          <UploadCard
            icon={<EndNoteLogo />}
            title="EndNote, RIS, or BibTeX"
            description="Choose an EndNote XML, RIS, or BibTeX file. Oleafly adds the references to the project bibliography."
            accept=".xml,.ris,.bib"
            buttonLabel="Choose XML, RIS, or BibTeX file"
            onFile={handleUpload}
            busy={busy}
          />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          References with a DOI that already exists in the bibliography are
          skipped.
        </p>
      </DialogContent>
    </Dialog>
  );
}
