import type { Extension } from "@codemirror/state";
import { CodeMirrorEditor, type EditorHost } from "@oleafly/editor/CodeMirrorEditor";
import { Crosshair, FileQuestion, FileX, Lock, MessageSquarePlus, PenLine } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, shortcut } from "@/lib/utils";
import type { WebApi } from "../api";
import { shownHasSyncTex } from "../compile/outputs";
import { webEditorKeymap } from "../editor/extensions";
import type { CollabEditMode, WebFile } from "../protocol";
import { abilitiesFor, effectiveMode } from "../roles";
import { useWeb } from "../store";
import { useActions } from "./context";
import { isImagePath } from "./FileTree";

export function ModeSwitch() {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const role = useWeb((state) => state.role);
  const features = useWeb((state) => state.features);
  const chosen = useWeb((state) => state.chosenMode);
  const abilities = abilitiesFor(role, features);
  if (abilities.chooseMode) {
    return (
      <Tabs value={effectiveMode(role, chosen, features)} onValueChange={(value) => actions.setMode(value as CollabEditMode)}>
        <TabsList size="sm" aria-label={t(($) => $.web.source.modeLabel)}>
          <TabsTrigger value="editing">{t(($) => $.web.source.editing)}</TabsTrigger>
          <TabsTrigger value="suggesting">{t(($) => $.web.source.suggesting)}</TabsTrigger>
        </TabsList>
      </Tabs>
    );
  }
  if (abilities.alwaysSuggest && abilities.edit) {
    return (
      <Tooltip label={t(($) => $.web.source.suggestingHint)} wide>
        <Badge variant="primaryGhost" className="gap-1" data-testid="mode-locked">
          <PenLine aria-hidden className="size-3" />
          {t(($) => $.web.source.suggesting)}
        </Badge>
      </Tooltip>
    );
  }
  if (abilities.edit) return null;
  return (
    <Tooltip label={t(($) => $.web.source.readOnlyHint)} wide>
      <Badge variant="muted" className="gap-1" data-testid="read-only">
        <Lock aria-hidden className="size-3" />
        {t(($) => $.web.source.readOnly)}
      </Badge>
    </Tooltip>
  );
}

export function SourceToolbar({ file, loaded }: Readonly<{ file: WebFile | null; loaded: boolean }>) {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const role = useWeb((state) => state.role);
  const features = useWeb((state) => state.features);
  const selection = useWeb((state) => state.selection);
  const synced = useWeb(shownHasSyncTex);
  const abilities = abilitiesFor(role, features);
  const text = file?.kind === "text";
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 border-b px-2 py-1">
      <p className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted-foreground" title={file?.path}>
        {file?.path}
      </p>
      {text ? <ModeSwitch /> : null}
      {text && synced ? (
        <Tooltip label={t(($) => $.web.compile.showInPdfHint, { shortcut: shortcut("⌘⇧J") })}>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="show-in-pdf"
            disabled={!loaded}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void actions.showInPdf()}
          >
            <Crosshair aria-hidden />
            {t(($) => $.web.compile.showInPdf)}
          </Button>
        </Tooltip>
      ) : null}
      {text && abilities.comment ? (
        <Tooltip label={t(($) => $.web.source.commentHint)}>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!selection || !loaded}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => actions.startComment()}
          >
            <MessageSquarePlus aria-hidden />
            {t(($) => $.web.source.comment)}
          </Button>
        </Tooltip>
      ) : null}
    </div>
  );
}

function BlobPreview({ api, projectId, file }: Readonly<{ api: WebApi; projectId: string; file: WebFile }>) {
  const { t } = useTranslation(["web"]);
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  const image = isImagePath(file.path) && file.blob !== null;
  useEffect(() => {
    if (!image || !file.blob) return;
    let url: string | null = null;
    let cancelled = false;
    setState({ url: null, failed: false });
    api.blob(projectId, file.blob).then(
      (blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ url, failed: false });
      },
      () => {
        if (!cancelled) setState({ url: null, failed: true });
      },
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, projectId, file.blob, image]);
  if (!image) {
    return (
      <EmptyState
        className="flex-1 px-6 py-10"
        icon={<FileQuestion aria-hidden className="size-8 text-muted-foreground" />}
        description={t(($) => $.web.source.binary)}
      />
    );
  }
  if (state.failed) return <ErrorState className="m-4" message={t(($) => $.web.source.blobFailed)} />;
  if (!state.url) return <LoadingState className="m-4" label={t(($) => $.web.app.loading)} />;
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-sidebar p-4">
      <img src={state.url} alt={file.path} className="max-w-full rounded border bg-background" />
    </div>
  );
}

export function SourcePane({
  host,
  extensions,
  api,
  visible = true,
}: Readonly<{ host: EditorHost; extensions: Extension[]; api: WebApi; visible?: boolean }>) {
  const { t } = useTranslation(["web"]);
  const projectId = useWeb((state) => state.projectId ?? "");
  const activeFileId = useWeb((state) => state.activeFileId);
  const file = useWeb((state) => state.files.find((entry) => entry.fileId === state.activeFileId) ?? null);
  const loaded = useWeb((state) => (state.activeFileId ? state.loaded[state.activeFileId] === true : false));
  const removedPath = useWeb((state) => state.removedPath);
  const text = file?.kind === "text";
  const actions = useActions();
  const keymap = useMemo(() => webEditorKeymap(actions), [actions]);

  let placeholder: ReactNode = null;
  if (!file) {
    placeholder = removedPath ? (
      <EmptyState
        className="flex-1 px-6 py-10"
        icon={<FileX aria-hidden className="size-8 text-muted-foreground" />}
        description={t(($) => $.web.source.removed, { path: removedPath })}
      />
    ) : (
      <EmptyState
        className="flex-1 px-6 py-10"
        title={t(($) => $.web.source.noFileTitle)}
        description={t(($) => $.web.source.noFileDescription)}
      />
    );
  } else if (!text) {
    placeholder = <BlobPreview key={file.fileId} api={api} projectId={projectId} file={file} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SourceToolbar file={file} loaded={loaded} />
      {placeholder}
      <div className={cn("relative min-h-0 flex-1", text ? "flex flex-col" : "hidden")} data-active-file={activeFileId ?? ""}>
        <CodeMirrorEditor active={text && visible} host={host} extraExtensions={extensions} extraKeymap={keymap} />
        {text && !loaded ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <LoadingState label={t(($) => $.web.source.opening, { path: file?.path ?? "" })} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
