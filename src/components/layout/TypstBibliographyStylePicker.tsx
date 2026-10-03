import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookMarked } from "lucide-react";
import { typstBibliographyStyles } from "@oleafly/editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setTypstBibliographyStyle, typstBibliographyStyleValue } from "@/lib/citation/typst-bibliography-style";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";
import { isReadOnlyLink } from "@/lib/project-paths";
import { notifyError } from "@/lib/toast";
import { readFileContent } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { projectFolderIsReadOnly } from "@/store/folder-access";
import { useIndexStore } from "@/store/project-index";

const TYPST_DEFAULT_STYLE = "ieee";

function declaringFile(snapshot: ProjectIntelligenceSnapshot | null, mainDoc: string): string | null {
  const edge = snapshot?.hierarchy.edges.find(
    (candidate) => candidate.kind === "bibliography" && candidate.fromFile.toLowerCase().endsWith(".typ"),
  );
  if (edge) return edge.fromFile;
  return mainDoc.toLowerCase().endsWith(".typ") ? mainDoc : null;
}

async function currentSource(projectId: string, path: string): Promise<string> {
  const loaded = useFilesStore.getState().files[path]?.content;
  if (loaded !== undefined) return loaded;
  const indexed = useIndexStore.getState().texts[path];
  if (indexed !== undefined) return indexed;
  return readFileContent(projectId, path);
}

async function writeSource(projectId: string, path: string, content: string): Promise<void> {
  const files = useFilesStore.getState();
  if (files.projectId === projectId && files.files[path] !== undefined) {
    if (!files.setContent(path, content)) throw new Error(`${path} is read-only`);
    await useFilesStore.getState().saveFile(path);
    return;
  }
  await files.writeProjectFile(projectId, path, content);
}

export function TypstBibliographyStylePicker({
  snapshot,
}: Readonly<{ snapshot: ProjectIntelligenceSnapshot | null }>) {
  const { t } = useTranslation(["references"]);
  const projectId = useFilesStore((state) => state.projectId);
  const mainDoc = useFilesStore((state) => state.mainDoc);
  const tree = useFilesStore((state) => state.tree);
  const version = useFilesStore((state) => state.engine.typst_resolved?.version ?? null);
  const path = declaringFile(snapshot, mainDoc);
  const loaded = useFilesStore((state) => (path ? state.files[path]?.content : undefined));
  const indexed = useIndexStore((state) => (path ? state.texts[path] : undefined));
  const [busy, setBusy] = useState(false);
  const source = loaded ?? indexed;
  const value = source === undefined ? undefined : typstBibliographyStyleValue(source);
  const styles = useMemo(() => typstBibliographyStyles(version, "bibliography"), [version]);

  if (!projectId || !path || value === undefined) return null;
  const current = value ?? TYPST_DEFAULT_STYLE;
  const readOnly = isReadOnlyLink(path, tree) || projectFolderIsReadOnly(projectId);
  const names = styles.map((style) => style.name);
  const options = names.includes(current) ? names : [current, ...names];

  const apply = async (style: string) => {
    if (style === current || busy) return;
    setBusy(true);
    try {
      const next = setTypstBibliographyStyle(await currentSource(projectId, path), style);
      if (next === null || useFilesStore.getState().projectId !== projectId) return;
      await writeSource(projectId, path, next);
    } catch (error) {
      notifyError("change Typst citation style", error, t(($) => $.references.bibliographyStyle.failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1" data-testid="typst-style-picker">
      <BookMarked aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {t(($) => $.references.bibliographyStyle.label)}
      </span>
      <Select value={current} onValueChange={(style) => void apply(style)} disabled={busy || readOnly}>
        <SelectTrigger
          aria-label={t(($) => $.references.bibliographyStyle.ariaLabel, { path })}
          className="h-7 min-w-0 flex-1 px-2 text-[11px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((name) => (
            <SelectItem key={name} value={name} className="text-xs">
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
