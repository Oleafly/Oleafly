import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { artifactIcon, NoteIcon } from "./note-icons";
import { artifactsForNote } from "./note-artifacts";
import { useNotesData } from "./notes-data";

export interface ProjectSeed {
  noteId: string;
  artifactId: string | null;
}

export type ProjectFormat = "latex" | "typst" | "markdown";

const FORMATS: readonly { id: ProjectFormat; label: string }[] = [
  { id: "latex", label: "LaTeX" },
  { id: "typst", label: "Typst" },
  { id: "markdown", label: "Markdown" },
];

interface NewProjectDialogProps {
  seed: ProjectSeed;
  onClose: () => void;
  onCreate?: (request: { name: string; format: ProjectFormat; files: readonly string[] }) => void;
}

export function NewProjectDialog({ seed, onClose, onCreate }: Readonly<NewProjectDialogProps>) {
  const { t } = useTranslation(["notes", "common"]);
  const data = useNotesData();
  const note = data.notes.find((candidate) => candidate.id === seed.noteId);
  const artifacts = artifactsForNote(data.artifacts, note);
  const [name, setName] = useState(note?.title ?? t(($) => $.notes.newProject.defaultName));
  const [format, setFormat] = useState<ProjectFormat>("latex");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(seed.artifactId ? [seed.artifactId] : [seed.noteId, ...artifacts.map((artifact) => artifact.id)]),
  );

  const formId = useId();
  const fieldId = (id: string) => `${formId}-${id}`;
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (!next.delete(id)) next.add(id);
    setChosen(next);
  };

  const row = (id: string, icon: ReactNode, title: string) => (
    <div key={id} className="flex items-center gap-2 py-0.5 text-sm">
      <Checkbox id={fieldId(`file-${id}`)} checked={chosen.has(id)} onCheckedChange={() => toggle(id)} />
      {icon}
      <label htmlFor={fieldId(`file-${id}`)} className="truncate">
        {title}
      </label>
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(($) => $.notes.newProject.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.notes.newProject.description)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1 text-sm">
          <label htmlFor={fieldId("name")} className="block text-xs font-medium text-muted-foreground">
            {t(($) => $.notes.newProject.name)}
          </label>
          <Input id={fieldId("name")} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-muted-foreground">{t(($) => $.notes.newProject.format)}</span>
          <RadioGroup
            value={format}
            onValueChange={(value) => setFormat(FORMATS.find((entry) => entry.id === value)?.id ?? "latex")}
            className="flex gap-4"
          >
            {FORMATS.map((entry) => (
              <label key={entry.id} htmlFor={fieldId(`format-${entry.id}`)} className="flex items-center gap-1.5">
                <RadioGroupItem id={fieldId(`format-${entry.id}`)} value={entry.id} />
                {entry.label}
              </label>
            ))}
          </RadioGroup>
        </div>
        <div className="space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">{t(($) => $.notes.newProject.files)}</span>
          <div className="max-h-48 overflow-y-auto rounded-md border p-2">
            {note && row(note.id, <NoteIcon icon={note.icon} />, note.title)}
            {artifacts.map((artifact) => row(artifact.id, artifactIcon(artifact.kind), artifact.title))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t(($) => $.common.actions.cancel)}
          </Button>
          <Button
            disabled={!onCreate || chosen.size === 0 || !name.trim()}
            onClick={() => onCreate?.({ name: name.trim(), format, files: [...chosen] })}
          >
            {t(($) => $.notes.newProject.create)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
