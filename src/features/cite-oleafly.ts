import { bibliographyTargetForProject } from "@/features/citation";
import { isReadOnlyLink } from "@/lib/project-paths";
import { appVersion } from "@/lib/tauri";
import { bibtexHasOleaflyEntry, OLEAFLY_CITATION_KEY, oleaflyBibtex } from "@/lib/cite-oleafly";
import { notifyError, toast } from "@/lib/toast";
import { i18n } from "@/i18n";
import { useCiteOleaflyStore } from "@/store/cite-oleafly";
import { useFilesStore } from "@/store/files";
import { projectFolderIsReadOnly, readOnlyFolderMessage } from "@/store/folder-access";

export type CiteOleaflyOutcome =
  | { kind: "added"; path: string; undo: () => Promise<void> }
  | { kind: "present"; path: string }
  | { kind: "read-only"; path: string }
  | { kind: "read-only-folder" }
  | { kind: "no-bibliography" }
  | { kind: "no-project" };

let pendingRun: Promise<void> | null = null;

function linkedBibliographyMessage(path: string): string {
  return i18n.t(($) => $.core.citation.linkedBibliography, { path });
}

async function writeBibliography(projectId: string, path: string, content: string): Promise<void> {
  const files = useFilesStore.getState();
  if (files.projectId === projectId && files.files[path] !== undefined) {
    if (!files.setContent(path, content)) throw new Error(linkedBibliographyMessage(path));
    await useFilesStore.getState().saveFile(path);
    return;
  }
  await files.writeProjectFile(projectId, path, content);
}

function citationMarkup(): string {
  const profile = useFilesStore.getState().engine.capabilities.formatting_profile;
  if (profile === "typst") return `@${OLEAFLY_CITATION_KEY}`;
  if (profile === "markdown") return `[@${OLEAFLY_CITATION_KEY}]`;
  return String.raw`\cite{${OLEAFLY_CITATION_KEY}}`;
}

export async function citeOleafly(options: { path?: string } = {}): Promise<CiteOleaflyOutcome> {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return { kind: "no-project" };
  let path: string;
  let content: string;
  let readOnly: boolean;
  if (options.path) {
    path = options.path;
    content = files.files[path]?.content ?? (await bibliographyTargetForProject())?.content ?? "";
    readOnly = isReadOnlyLink(path, files.tree);
  } else {
    const target = await bibliographyTargetForProject();
    if (!target?.exists) return { kind: "no-bibliography" };
    path = target.path;
    content = target.content;
    readOnly = target.readOnly;
  }
  if (bibtexHasOleaflyEntry(content)) return { kind: "present", path };
  if (projectFolderIsReadOnly(projectId)) return { kind: "read-only-folder" };
  if (readOnly) return { kind: "read-only", path };
  const version = await appVersion().catch(() => "");
  const entry = oleaflyBibtex(version);
  const trimmed = content.trimEnd();
  const next = trimmed ? `${trimmed}\n\n${entry}\n` : `${entry}\n`;
  await writeBibliography(projectId, path, next);
  return {
    kind: "added",
    path,
    undo: async () => {
      if (useFilesStore.getState().projectId !== projectId) return;
      await writeBibliography(projectId, path, content);
    },
  };
}

export function runCiteOleaflyAction(options: { path?: string } = {}): Promise<void> {
  if (pendingRun) return pendingRun;
  const run = reportCiteOleafly(options).finally(() => {
    pendingRun = null;
  });
  pendingRun = run;
  return run;
}

async function reportCiteOleafly(options: { path?: string }): Promise<void> {
  try {
    const outcome = await citeOleafly(options);
    switch (outcome.kind) {
      case "added": {
        const markup = citationMarkup();
        toast.success(i18n.t(($) => $.core.citeOleafly.added, { path: outcome.path, markup }), {
          label: i18n.t(($) => $.core.citeOleafly.undo),
          onClick: () => {
            void outcome.undo().catch((error) => notifyError("undo Oleafly citation", error));
          },
        });
        return;
      }
      case "present":
        toast.info(
          i18n.t(($) => $.core.citeOleafly.present, {
            path: outcome.path,
            markup: citationMarkup(),
          }),
        );
        return;
      case "read-only":
        toast.error(linkedBibliographyMessage(outcome.path));
        return;
      case "read-only-folder":
        toast.error(readOnlyFolderMessage());
        return;
      case "no-bibliography":
      case "no-project":
        useCiteOleaflyStore.getState().setOpen(true);
        return;
    }
  } catch (error) {
    notifyError("cite Oleafly", error, i18n.t(($) => $.core.citeOleafly.failed));
  }
}
