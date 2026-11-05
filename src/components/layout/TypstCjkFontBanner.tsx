import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert, X } from "lucide-react";
import { Languages } from "@/components/icons/pack";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { formatDownloadSize } from "@/lib/download-size";
import { readString, writeString } from "@/lib/local-storage";
import { logError } from "@/lib/log";
import type { CompileError } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { CJK_FONT_PACK_ID, cjkCharacters, isTypstGlyphWarning } from "@/lib/typst-font-packs";
import { typstGlyphCoverage } from "@/lib/typst-options";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useFontPacksStore } from "@/store/font-packs";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";

const hiddenKey = (projectId: string) => `oleafly.typstCjkFonts.${projectId}`;
const glyphHiddenKey = (projectId: string, notice: CompileError) =>
  `oleafly.typstGlyphNotice.${projectId}.${notice.code}.${notice.params?.sample ?? ""}`;

async function downloadAndCompile(packId: string, failure: string): Promise<void> {
  if (await useFontPacksStore.getState().install(packId)) {
    await useFilesStore.getState().refreshEngine();
    void useCompileStore.getState().recompile();
  } else {
    toast.error(failure);
  }
}

const checks = new Map<string, { readonly characters: string; readonly missing: Promise<boolean> }>();

function cjkFontsMissing(projectId: string, characters: string): Promise<boolean> {
  const known = checks.get(projectId);
  if (known?.characters === characters) return known.missing;
  const missing = typstGlyphCoverage(projectId, characters).then(
    (coverage) => coverage.packsApply && coverage.uncovered.length > 0,
    (error: unknown) => {
      if (checks.get(projectId)?.missing === missing) checks.delete(projectId);
      void logError("check Typst CJK fonts", error);
      return false;
    },
  );
  checks.set(projectId, { characters, missing });
  return missing;
}

function GlyphNotice({ notice, onClose }: Readonly<{ notice: CompileError; onClose: () => void }>) {
  const { t } = useTranslation(["shell", "editor", "common"]);
  const packId = notice.params?.pack;
  const pack = useFontPacksStore((state) => state.packs.find((entry) => entry.id === packId));
  const packsStatus = useFontPacksStore((state) => state.status);
  const installing = useFontPacksStore((state) => state.installing);

  useEffect(() => {
    if (packId && packsStatus === "idle") void useFontPacksStore.getState().load();
  }, [packId, packsStatus]);

  const size = pack ? formatDownloadSize(pack.approx_bytes) : null;
  const label = () => {
    if (installing === packId) return t(($) => $.shell.typstCjkFonts.downloading);
    if (size) return t(($) => $.shell.typstCjkFonts.downloadSize, { size });
    return t(($) => $.shell.typstCjkFonts.download);
  };

  return (
    <WorkspaceBanner tone="warning" role="status" data-testid="typst-glyph-banner">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">{notice.explanation ?? notice.message}</p>
      <span className="flex shrink-0 items-center gap-1">
        {pack && !pack.installed && (
          <WorkspaceBannerButton
            tone="warning"
            disabled={installing !== null}
            onClick={() => void downloadAndCompile(pack.id, t(($) => $.editor.log.fontPackFailed))}
          >
            {installing === pack.id ? <Spinner size="xs" /> : null}
            {label()}
          </WorkspaceBannerButton>
        )}
        <WorkspaceBannerButton
          tone="warning"
          onClick={() => useTypstDocumentPanelStore.getState().openPanel("settings")}
        >
          {t(($) => $.editor.typstSettings.title)}
        </WorkspaceBannerButton>
        <Tooltip label={t(($) => $.common.actions.close)}>
          <WorkspaceBannerButton
            tone="warning"
            aria-label={t(($) => $.common.actions.close)}
            className="px-1"
            onClick={onClose}
          >
            <X aria-hidden className="size-3.5" />
          </WorkspaceBannerButton>
        </Tooltip>
      </span>
    </WorkspaceBanner>
  );
}

export function TypstCjkFontBanner() {
  const { t } = useTranslation(["shell", "editor", "common"]);
  const projectId = useFilesStore((state) => state.projectId);
  const typst = useFilesStore((state) => state.engine.source_format === "typst");
  const sources = useCompileStore((state) => state.compiledSources);
  const notice = useCompileStore((state) => (typst ? state.errors.find(isTypstGlyphWarning) : undefined));
  const pack = useFontPacksStore((state) => state.packs.find((entry) => entry.id === CJK_FONT_PACK_ID));
  const packsStatus = useFontPacksStore((state) => state.status);
  const installing = useFontPacksStore((state) => state.installing);
  const [missingFor, setMissingFor] = useState<string | null>(null);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const [closedNotice, setClosedNotice] = useState<string | null>(null);
  const hidden = projectId !== null && (hiddenFor === projectId || readString(hiddenKey(projectId)) !== null);
  const noticeKey = projectId && notice ? glyphHiddenKey(projectId, notice) : null;
  const noticeHidden =
    noticeKey !== null &&
    (closedNotice === noticeKey ||
      readString(noticeKey) !== null ||
      (hidden && notice?.params?.pack === CJK_FONT_PACK_ID));
  const characters = useMemo(
    () => (typst && sources ? cjkCharacters(Object.values(sources.texts)) : ""),
    [typst, sources],
  );
  const wanted = Boolean(projectId && characters && !hidden);

  useEffect(() => {
    if (wanted && packsStatus === "idle") void useFontPacksStore.getState().load();
  }, [wanted, packsStatus]);

  const checkable = wanted && pack !== undefined && !pack.installed;
  useEffect(() => {
    if (!checkable || !projectId) return;
    let current = true;
    void cjkFontsMissing(projectId, characters).then((missing) => {
      if (current) setMissingFor(missing ? projectId : null);
    });
    return () => {
      current = false;
    };
  }, [checkable, projectId, characters]);

  if (!projectId) return null;

  const hide = () => {
    writeString(hiddenKey(projectId), "hidden");
    setHiddenFor(projectId);
  };
  if (!checkable || missingFor !== projectId || !pack) {
    if (!notice || !noticeKey || noticeHidden) return null;
    const hideNotice = () => {
      writeString(noticeKey, "hidden");
      setClosedNotice(noticeKey);
    };
    return <GlyphNotice notice={notice} onClose={hideNotice} />;
  }

  const busy = installing === CJK_FONT_PACK_ID;
  const size = formatDownloadSize(pack.approx_bytes);
  const label = () => {
    if (busy) return t(($) => $.shell.typstCjkFonts.downloading);
    if (size) return t(($) => $.shell.typstCjkFonts.downloadSize, { size });
    return t(($) => $.shell.typstCjkFonts.download);
  };

  return (
    <WorkspaceBanner tone="primary" role="status" data-testid="typst-cjk-font-banner">
      <Languages aria-hidden className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">{t(($) => $.shell.typstCjkFonts.message)}</p>
      <span className="flex shrink-0 items-center gap-1">
        <WorkspaceBannerButton
          tone="primary"
          className="text-primary"
          disabled={installing !== null}
          onClick={() => void downloadAndCompile(CJK_FONT_PACK_ID, t(($) => $.editor.log.fontPackFailed))}
        >
          {busy ? <Spinner size="xs" /> : null}
          {label()}
        </WorkspaceBannerButton>
        <Tooltip label={t(($) => $.common.actions.close)}>
          <WorkspaceBannerButton
            tone="primary"
            aria-label={t(($) => $.common.actions.close)}
            className="px-1 text-muted-foreground hover:text-foreground"
            onClick={hide}
          >
            <X aria-hidden className="size-3.5" />
          </WorkspaceBannerButton>
        </Tooltip>
      </span>
    </WorkspaceBanner>
  );
}
