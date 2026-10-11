import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ArrowRight, ChevronLeft, ChevronRight, Download, ExternalLink, X } from "lucide-react";
import { CheckBadge } from "@/components/ui/check-badge";
import { ModalShell } from "@/components/ui/modal-shell";
import { Spinner } from "@/components/ui/spinner";
import { currentLocale } from "@/i18n";
import { formatDownloadSize } from "@/lib/download-size";
import { formatNumber, formatList } from "@/lib/intl";
import { logError } from "@/lib/log";
import type { PackInfo, PackTemplateInfo } from "@/lib/tauri";
import { capitalized, displayName, engineLabel } from "@/lib/template-pack-browser";
import { cn } from "@/lib/utils";
import {
  installPack,
  installTemplate,
  openTemplateInNewProject,
  packBusyKey,
  templateBusyKey,
  useTemplatePacksStore,
} from "@/store/template-packs";
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from "./PackList";
import { LazyImage, PAGE_ASPECT, PagePlaceholder } from "./pack-images";

const TYPING_TARGETS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function PreviewImage({ template, alt }: Readonly<{ template: PackTemplateInfo; alt: string }>) {
  const [loaded, setLoaded] = useState(false);
  const thumb = template.thumb_url;
  const large = template.preview_url;
  const thumbImage = thumb ? <LazyImage src={thumb} alt={alt} fallback={<PagePlaceholder />} /> : <PagePlaceholder />;
  return (
    <span
      data-testid="template-preview-page"
      className={cn(
        "relative block w-full max-w-[min(26rem,calc((88vh_-_3rem)/1.294))] overflow-hidden rounded-md border bg-background shadow-sm",
        PAGE_ASPECT,
      )}
    >
      {thumb && large && !loaded ? (
        <img
          src={thumb}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 size-full scale-105 object-contain blur-md"
        />
      ) : null}
      {large ? (
        <LazyImage src={large} alt={alt} onLoad={() => setLoaded(true)} fallback={thumbImage} />
      ) : (
        thumbImage
      )}
    </span>
  );
}

function Detail({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </>
  );
}

export function TemplatePreviewDialog({
  pack,
  templates,
  allTemplates,
  templateId,
  onNavigate,
  onClose,
}: Readonly<{
  pack: PackInfo;
  templates: readonly PackTemplateInfo[];
  allTemplates: readonly PackTemplateInfo[];
  templateId: string;
  onNavigate: (templateId: string) => void;
  onClose: () => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const titleId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const busy = useTemplatePacksStore((s) => s.busy);
  const progress = useTemplatePacksStore((s) => s.progress);
  const position = templates.findIndex((candidate) => candidate.id === templateId);
  const template =
    position >= 0 ? templates[position] : allTemplates.find((candidate) => candidate.id === templateId);
  const previous = position > 0 ? templates[position - 1] : null;
  const next = position >= 0 && position < templates.length - 1 ? templates[position + 1] : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || TYPING_TARGETS.has(target.tagName))) {
        return;
      }
      const dialog = anchorRef.current?.closest('[aria-modal="true"]');
      if (target instanceof Node && target !== document.body && dialog && !dialog.contains(target)) return;
      const destination = event.key === "ArrowLeft" ? previous : next;
      if (!destination) return;
      event.preventDefault();
      onNavigate(destination.id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [previous, next, onNavigate]);

  if (!template) return null;

  const templateBusy = busy === templateBusyKey(pack.id, template.id);
  const packBusy = busy === packBusyKey(pack.id);
  const locale = currentLocale();
  const languages = template.languages.map((code) => displayName(code, "language", locale));
  const engine = engineLabel(template.engine);

  return (
    <ModalShell
      open
      onClose={onClose}
      closeLabel={t(($) => $.common.actions.close)}
      layer="nested"
      labelledBy={titleId}
      testId="template-preview"
      className="flex max-h-[88vh] w-[min(56rem,94vw)] flex-col overflow-hidden md:flex-row"
    >
      <span ref={anchorRef} hidden />
      <div className="relative flex min-h-0 shrink-0 items-center justify-center bg-muted/60 px-12 py-6 md:w-[55%]">
        <PreviewImage
          key={template.id}
          template={template}
          alt={t(($) => $.settings.downloads.packs.preview.image, { name: template.name })}
        />
        <button
          type="button"
          data-testid="template-preview-previous"
          aria-label={t(($) => $.settings.downloads.packs.preview.previous)}
          onClick={() => previous && onNavigate(previous.id)}
          disabled={!previous}
          className="absolute left-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full border bg-background/90 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:bg-accent disabled:opacity-0"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          data-testid="template-preview-next"
          aria-label={t(($) => $.settings.downloads.packs.preview.next)}
          onClick={() => next && onNavigate(next.id)}
          disabled={!next}
          className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full border bg-background/90 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:bg-accent disabled:opacity-0"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {pack.label}
              {template.bytes > 0 ? ` · ${formatDownloadSize(template.bytes)}` : ""}
              {position >= 0
                ? ` · ${t(($) => $.settings.downloads.packProgress, {
                    index: formatNumber(position + 1),
                    total: formatNumber(templates.length),
                  })}`
                : ""}
            </p>
            <h2 id={titleId} className="mt-1 flex items-center gap-2 text-base font-semibold leading-snug">
              <span className="min-w-0 break-words">{template.name}</span>
              {template.installed && <CheckBadge tone="success" />}
            </h2>
          </div>
          <button
            type="button"
            aria-label={t(($) => $.common.actions.close)}
            onClick={onClose}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>

        {template.description ? (
          <p className="select-text text-xs leading-relaxed text-muted-foreground">{template.description}</p>
        ) : null}

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
          {engine ? <Detail label={t(($) => $.settings.downloads.packs.preview.engine)}>{engine}</Detail> : null}
          <Detail label={t(($) => $.settings.downloads.packs.preview.license)}>{template.license.label}</Detail>
          {template.kind ? (
            <Detail label={t(($) => $.settings.downloads.packs.preview.kind)}>{capitalized(template.kind)}</Detail>
          ) : null}
          {languages.length > 0 ? (
            <Detail label={t(($) => $.settings.downloads.packs.preview.languages)}>{formatList(languages)}</Detail>
          ) : null}
          {template.country ? (
            <Detail label={t(($) => $.settings.downloads.packs.preview.country)}>
              {displayName(template.country, "region", locale)}
            </Detail>
          ) : null}
          {template.institution ? (
            <Detail label={t(($) => $.settings.downloads.packs.preview.institution)}>{template.institution}</Detail>
          ) : null}
        </dl>

        {template.credit ? (
          <button
            type="button"
            data-testid="template-preview-source"
            title={template.credit.url}
            onClick={() => {
              const url = template.credit?.url;
              if (url) void openExternal(url).catch((error) => logError("open template source", error));
            }}
            className="inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
          >
            <ExternalLink className="size-3" />
            {t(($) => $.settings.downloads.packs.preview.originalSource)}
          </button>
        ) : null}

        <div className="mt-auto flex flex-col gap-2 pt-3">
          {(templateBusy || packBusy) && progress ? (
            <p className="text-[0.6875rem] text-muted-foreground tabular-nums">{progress}</p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!pack.installed && (
              <button
                type="button"
                data-testid="template-preview-download-pack"
                onClick={() => void installPack(pack.id)}
                disabled={busy !== null}
                className={OUTLINE_BUTTON}
              >
                {packBusy ? <Spinner size="sm" /> : <Download className="size-3.5" />}
                {t(($) => $.settings.downloads.packs.downloadPack)}
              </button>
            )}
            {template.installed ? (
              <button
                type="button"
                data-testid="template-preview-use"
                data-modal-initial-focus
                onClick={() => openTemplateInNewProject(template.id)}
                className={PRIMARY_BUTTON}
              >
                {t(($) => $.settings.downloads.packs.preview.useTemplate)}
                <ArrowRight className="size-3.5" />
              </button>
            ) : (
              <button
                type="button"
                data-testid="template-preview-get"
                data-modal-initial-focus
                onClick={() => void installTemplate(pack.id, template.id)}
                disabled={busy !== null}
                className={PRIMARY_BUTTON}
              >
                {templateBusy ? <Spinner size="sm" /> : <Download className="size-3.5" />}
                {t(($) => $.settings.downloads.packs.preview.getTemplate)}
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
