import { FileCode2, ListChecks, MonitorPlay, Presentation } from "lucide-react";
import { registerCommand } from "@oleafly/registry";
import { i18n } from "@/i18n";
import { present } from "@/features/presentation/launch";
import { useFilesStore } from "@/store/files";
import { useTypstMigrationStore } from "@/store/typst-migration";

type PaletteCommand = Omit<Parameters<typeof registerCommand>[0], "surfaces">;

const PDF_FILE = /\.pdf$/iu;

function presentProject(mode: "start" | "presenter"): void {
  const files = useFilesStore.getState();
  const activePdf = files.activePath && PDF_FILE.test(files.activePath) ? files.activePath : null;
  void present({
    projectId: files.projectId,
    mode,
    page: 1,
    mainDoc: files.mainDoc || null,
    typst: files.engine.source_format === "typst",
    ...(activePdf ? { source: { kind: "file" as const, path: activePdf } } : {}),
  });
}

function latexProjectOpen(): boolean {
  const files = useFilesStore.getState();
  return Boolean(files.projectId) && files.engineLoaded && files.engine.capabilities.formatting_profile === "latex";
}

export function registerPresentationCommands(): void {
  const palette = (command: PaletteCommand) => registerCommand({ ...command, surfaces: ["palette"] });
  palette({
    id: "palette.present",
    group: () => i18n.t(($) => $.shell.commandGroups.compile),
    label: () => i18n.t(($) => $.shell.commands.present.label),
    keywords: () => i18n.t(($) => $.shell.commands.present.keywords),
    icon: () => <Presentation className="size-4" />,
    order: 232,
    when: (context) => Boolean(context.projectId),
    run: () => presentProject("start"),
  });
  palette({
    id: "palette.present-with-presenter",
    group: () => i18n.t(($) => $.shell.commandGroups.compile),
    label: () => i18n.t(($) => $.shell.commands.presentWithPresenter.label),
    keywords: () => i18n.t(($) => $.shell.commands.presentWithPresenter.keywords),
    icon: () => <MonitorPlay className="size-4" />,
    order: 233,
    when: (context) => Boolean(context.projectId),
    run: () => presentProject("presenter"),
  });
  registerCommand({
    id: "palette.migrate-to-typst",
    surfaces: ["omnibar", "palette"],
    group: () => i18n.t(($) => $.shell.commandGroups.project),
    label: () => i18n.t(($) => $.shell.commands.migrateToTypst.label),
    keywords: () => i18n.t(($) => $.shell.commands.migrateToTypst.keywords),
    icon: () => <FileCode2 className="size-4" />,
    order: 125,
    when: latexProjectOpen,
    run: () => useTypstMigrationStore.getState().openDialog(),
  });
  palette({
    id: "palette.typst-migration-report",
    group: () => i18n.t(($) => $.shell.commandGroups.project),
    label: () => i18n.t(($) => $.shell.commands.typstMigrationReport.label),
    keywords: () => i18n.t(($) => $.shell.commands.typstMigrationReport.keywords),
    icon: () => <ListChecks className="size-4" />,
    order: 126,
    when: () => useTypstMigrationStore.getState().report !== null,
    run: () => useTypstMigrationStore.getState().showReport(),
  });
}
