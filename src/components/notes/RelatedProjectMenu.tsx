import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { notifyError } from "@/lib/toast";
import { useNotesData } from "./notes-data";
import { ProjectDot, useProjectColor } from "./project-color";
import type { NoteItem } from "./types";

export function RelatedProjectMenu({ note }: Readonly<{ note: NoteItem }>) {
  const { t } = useTranslation(["notes"]);
  const { projects, setRelatedProject } = useNotesData();
  const colorOf = useProjectColor();
  const label = note.relatedProjectId ? note.project : t(($) => $.notes.workspace.chooseProject);
  const color = colorOf(note.relatedProjectId);
  if (!projects || !setRelatedProject) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <ProjectDot color={color} />
        <span className="truncate">{note.project}</span>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t(($) => $.notes.workspace.projectMenu, { project: label })}
          className="flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent data-[state=open]:bg-accent"
        >
          <ProjectDot color={color} />
          <span className="truncate">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>{t(($) => $.notes.workspace.project)}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={note.relatedProjectId ?? ""}
          onValueChange={(value) => {
            if (value === (note.relatedProjectId ?? "")) return;
            void setRelatedProject(note.id, value === "" ? null : value).catch((error: unknown) =>
              notifyError("set the note's project", error, t(($) => $.notes.failures.linkNote, { name: note.title })),
            );
          }}
        >
          <DropdownMenuRadioItem value="">
            <ProjectDot color={null} />
            {t(($) => $.notes.workspace.noProject)}
          </DropdownMenuRadioItem>
          {projects.map((project) => (
            <DropdownMenuRadioItem key={project.id} value={project.id}>
              <ProjectDot color={colorOf(project.id)} />
              <span className="truncate">{project.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
