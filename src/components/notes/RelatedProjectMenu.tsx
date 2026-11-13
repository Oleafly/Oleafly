import { useTranslation } from "react-i18next";
import { BreadcrumbLink } from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorDot } from "@/components/ui/color-swatch";
import { notifyError } from "@/lib/toast";
import { useNotesData } from "./notes-data";
import { useProjectColor } from "./project-color";
import type { NoteItem } from "./types";

export function RelatedProjectMenu({ note }: Readonly<{ note: NoteItem }>) {
  const { t } = useTranslation(["notes"]);
  const { projects, setRelatedProject } = useNotesData();
  const colorOf = useProjectColor();
  const label = note.relatedProjectId ? note.project : t(($) => $.notes.workspace.chooseProject);
  const color = colorOf(note.relatedProjectId);
  const dot = color && <ColorDot color={color} size="xs" />;
  if (!projects || !setRelatedProject) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 px-1">
        {dot}
        <span className="truncate">{note.project}</span>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <BreadcrumbLink asChild className="max-w-[16rem]">
          <button type="button" aria-label={t(($) => $.notes.workspace.projectMenu, { project: label })}>
            {dot}
            <span className="truncate">{label}</span>
          </button>
        </BreadcrumbLink>
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
            <ColorDot color="transparent" size="xs" />
            {t(($) => $.notes.workspace.noProject)}
          </DropdownMenuRadioItem>
          {projects.map((project) => (
            <DropdownMenuRadioItem key={project.id} value={project.id}>
              <ColorDot color={colorOf(project.id) ?? "transparent"} size="xs" />
              <span className="truncate">{project.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
