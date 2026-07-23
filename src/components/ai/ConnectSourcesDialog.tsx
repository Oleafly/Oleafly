import { useRef, useState } from "react";
import { BookMarked, Library, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addCitations, parseCitationFile, type BatchImportResult } from "@/features/citation";
import { toast, notifyError } from "@/lib/toast";

function summarize(result: BatchImportResult): string {
  const parts = [`${result.imported} reference${result.imported === 1 ? "" : "s"} imported`];
  if (result.duplicates) parts.push(`${result.duplicates} already in your library`);
  return parts.join(", ");
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

function UploadCard({ icon, title, description, accept, buttonLabel, onFile, busy }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent">{icon}</span>
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
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void onFile(file);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function ConnectSourcesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
        toast.error(result.errors[0]);
        return;
      }
      toast.success(summarize(result));
      if (result.imported) onOpenChange(false);
    } catch (e) {
      notifyError("import references", e, "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect sources</DialogTitle>
          <DialogDescription>Import your reference library so Oleafly AI can cite from it</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <UploadCard
            icon={<Library className="size-4 text-muted-foreground" />}
            title="Zotero"
            description={
              <>
                In Zotero, choose File → Export Library → Zotero RDF, then upload the file here.
              </>
            }
            accept=".rdf"
            buttonLabel="Upload Zotero RDF export"
            onFile={handleUpload}
            busy={busy}
          />
          <UploadCard
            icon={<BookMarked className="size-4 text-muted-foreground" />}
            title="EndNote, RIS or BibTeX"
            description="Upload an EndNote XML, RIS, or .bib export and the references go straight into your bibliography."
            accept=".xml,.ris,.bib"
            buttonLabel="Upload .xml, .ris or .bib file"
            onFile={handleUpload}
            busy={busy}
          />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          After importing, ask Oleafly AI things like "cite the Smith 2023 paper from my library".
        </p>
      </DialogContent>
    </Dialog>
  );
}
