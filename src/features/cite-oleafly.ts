import { bibliographyTargetForProject } from "@/features/citation";
import { appVersion } from "@/lib/tauri";
import { bibtexHasOleaflyEntry, OLEAFLY_CITATION_KEY, oleaflyBibtex } from "@/lib/cite-oleafly";
import { notifyError, toast } from "@/lib/toast";
import { i18n } from "@/i18n";
import { useCiteOleaflyStore } from "@/store/cite-oleafly";
import { useFilesStore } from "@/store/files";

export type CiteOleaflyOutcome =
  | { kind: "added"; path: string; undo: () => Promise<void> }
  | { kind: "present"; path: string }
  | { kind: "no-bibliography" }
  | { kind: "no-project" };

function citationMarkup(): string {
  const profile = useFilesStore.getState().engine.capabilities.formatting_profile;
  if (profile === "typst") return `@${OLEAFLY_CITATION_KEY}`;
  if (profile === "markdown") return `[@${OLEAFLY_CITATION_KEY}]`;
  return `\\cite{${OLEAFLY_CITATION_KEY}}`;
}

export async function citeOleafly(options: { path?: string } = {}): Promise<CiteOleaflyOutcome> {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return { kind: "no-project" };
  let path: string;
  let content: string;
  if (options.path) {
    path = options.path;
    content = files.files[path]?.content ?? (await bibliographyTargetForProject())?.content ?? "";
  } else {
    const target = await bibliographyTargetForProject();
    if (!target?.exists) return { kind: "no-bibliography" };
    path = target.path;
    content = target.content;
  }
  if (bibtexHasOleaflyEntry(content)) return { kind: "present", path };
  const version = await appVersion().catch(() => "");
  const entry = oleaflyBibtex(version);
  const trimmed = content.trimEnd();
  const next = trimmed ? `${trimmed}\n\n${entry}\n` : `${entry}\n`;
  await useFilesStore.getState().writeProjectFile(projectId, path, next);
  return {
    kind: "added",
    path,
    undo: async () => {
      if (useFilesStore.getState().projectId !== projectId) return;
      await useFilesStore.getState().writeProjectFile(projectId, path, content);
    },
  };
}

export async function runCiteOleaflyAction(options: { path?: string } = {}): Promise<void> {
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
      case "no-bibliography":
      case "no-project":
        useCiteOleaflyStore.getState().setOpen(true);
        return;
    }
  } catch (error) {
    notifyError("cite Oleafly", error, i18n.t(($) => $.core.citeOleafly.failed));
  }
}
