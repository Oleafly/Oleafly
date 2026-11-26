import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, CheckCheck, Crosshair, PencilLine, RotateCcw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { FloatingSidePanel } from "@/components/ui/floating-side-panel";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Spinner } from "@/components/ui/spinner";
import { TONES } from "@/components/ui/tones";
import { Tooltip } from "@/components/ui/tooltip";
import { CommentBody } from "@/components/ui/comments/comment-body";
import { CommentComposer } from "@/components/ui/comments/comment-composer";
import { lineSpan } from "@/features/pdf-annotations/model";
import { readJson, writeJson } from "@/lib/local-storage";
import type { PdfAnnotation } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { confirmAction } from "@/store/confirm-dialog";
import { usePdfAnnotationsStore } from "@/store/pdf-annotations";
import { AnnotationCommentKit } from "./annotation-comment-kit";

type Group = "placing" | "drafts" | "assistant" | "resolved";
type Folded = Readonly<Record<string, Readonly<Partial<Record<Group, boolean>>>>>;

const GROUPS: readonly Group[] = ["placing", "drafts", "assistant", "resolved"];
const FOLDED_KEY = "oleafly.pdfAnnotations.folded";
const NO_MEMBERS: never[] = [];
const REMOVED = "break-words rounded-sm bg-diff-delete px-1 line-through decoration-destructive/70";
const ADDED = "bg-diff-insert hover:bg-diff-insert-strong focus-visible:bg-diff-insert-strong";

function groupOf(item: PdfAnnotation): Group {
  if (item.status === "resolved") return "resolved";
  if (item.placement === "needsPlacing") return "placing";
  return item.status === "draft" ? "drafts" : "assistant";
}

function readFolded(value: unknown): Folded {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Folded) : {};
}

function useGroupsOpen(projectId: string | null) {
  const [folded, setFolded] = useState(() => readJson<Folded>(FOLDED_KEY, {}, readFolded));
  const key = projectId ?? "";
  const mine = folded[key] ?? {};
  const isOpen = (group: Group) => !(mine[group] ?? group === "resolved");
  const setOpen = (group: Group, open: boolean) => {
    const next = { ...folded, [key]: { ...mine, [group]: !open } };
    setFolded(next);
    writeJson(FOLDED_KEY, next);
  };
  return { isOpen, setOpen };
}

function sourceLabel(annotation: PdfAnnotation): string | null {
  const source = annotation.source;
  return source ? `${source.path}:${lineSpan(source)}` : null;
}

function AnnotationText({
  item,
  added = false,
  onEdit,
}: Readonly<{ item: PdfAnnotation; added?: boolean; onEdit: () => void }>) {
  const { t } = useTranslation(["annotations"]);
  return (
    <Tooltip label={t(($) => $.annotations.panel.editComment, { number: item.number })} className={added ? undefined : "flex w-full"}>
      <button
        type="button"
        className={cn(
          "min-w-0 rounded-sm px-1 py-0.5 text-left",
          added ? ADDED : "-mx-1 w-[calc(100%+0.5rem)] hover:bg-accent focus-visible:bg-accent",
          !item.comment && "italic text-muted-foreground",
        )}
        onClick={onEdit}
      >
        {item.comment ? (
          <CommentBody body={item.comment} members={NO_MEMBERS} className="mt-0 text-[0.8125rem]" />
        ) : (
          t(($) => $.annotations.panel.addComment)
        )}
      </button>
    </Tooltip>
  );
}

function AnnotationChange({
  item,
  editing,
  onEdit,
  onDone,
}: Readonly<{ item: PdfAnnotation; editing: boolean; onEdit: () => void; onDone: () => void }>) {
  const { t } = useTranslation(["annotations"]);
  const quote = item.quote.text;
  const store = usePdfAnnotationsStore.getState;
  const editor = editing ? (
    <AnnotationCommentKit>
      <CommentComposer
        label={t(($) => $.annotations.panel.editComment, { number: item.number })}
        submitLabel={t(($) => $.annotations.composer.save)}
        initial={item.comment}
        autoFocus
        compact
        onSubmit={async (comment) => {
          if (!(await store().update([{ id: item.id, comment }]))) throw new Error(store().error ?? "");
          onDone();
        }}
        onCancel={onDone}
      />
    </AnnotationCommentKit>
  ) : null;
  const added = editing ? null : <AnnotationText item={item} added onEdit={onEdit} />;
  const plain = editor ?? <AnnotationText item={item} onEdit={onEdit} />;
  if (item.kind === "replace" && quote) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-1">
          <span className={REMOVED}>{quote}</span>
          <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          {added}
        </div>
        {editor}
      </>
    );
  }
  if (item.kind === "insert" && quote) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-1">
          <span className="min-w-0 break-words text-muted-foreground">
            {t(($) => $.annotations.panel.insertAfter, { quote })}
          </span>
          {added}
        </div>
        {editor}
      </>
    );
  }
  return (
    <>
      {item.kind === "delete" && quote ? <p><span className={REMOVED}>{quote}</span></p> : null}
      {item.kind === "comment" && quote ? (
        <p className="line-clamp-2 break-words text-muted-foreground">{t(($) => $.annotations.panel.quoted, { quote })}</p>
      ) : null}
      {plain}
    </>
  );
}

function AnnotationRow({
  item,
  active,
  activeRef,
  picked,
  placing,
  editing,
  onPick,
  onShow,
  onPlaceAgain,
  onEdit,
  onDone,
}: Readonly<{
  item: PdfAnnotation;
  active: boolean;
  activeRef: RefObject<HTMLLIElement | null>;
  picked: boolean;
  placing: boolean;
  editing: boolean;
  onPick: () => void;
  onShow: () => void;
  onPlaceAgain: () => void;
  onEdit: () => void;
  onDone: () => void;
}>) {
  const { t } = useTranslation(["annotations"]);
  const store = usePdfAnnotationsStore.getState;
  const location = sourceLabel(item);
  const page = t(($) => $.annotations.panel.page, { page: item.page });
  const resolved = item.status === "resolved";
  const include = t(($) => $.annotations.panel.include, { number: item.number });
  return (
    <li
      ref={active ? activeRef : undefined}
      data-annotation-id={item.id}
      className={cn(
        "group flex gap-2.5 px-3 py-2.5 text-[0.8125rem] transition-colors",
        active ? "bg-primary/10" : "hover:bg-accent/50",
        resolved && "text-muted-foreground",
      )}
    >
      <Tooltip label={include} side="left" className="h-fit shrink-0">
        <button
          type="button"
          aria-pressed={picked}
          aria-label={include}
          onClick={onPick}
          className={cn(
            "mt-px flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1 text-[0.6875rem] font-medium tabular-nums transition-colors",
            picked && "bg-primary text-primary-foreground hover:bg-primary/85",
            !picked && resolved && cn(TONES.emerald.tint, TONES.emerald.text, TONES.emerald.hover),
            !picked && !resolved && "bg-primary/20 text-primary hover:bg-primary/30",
          )}
        >
          {item.number}
        </button>
      </Tooltip>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-baseline gap-2 rounded-sm text-left focus-visible:bg-accent"
            onClick={onShow}
          >
            <span className={cn("shrink-0 font-medium", !resolved && "text-foreground")}>
              {t(($) => $.annotations.kind[item.kind])}
            </span>
            {item.status === "addressed" ? (
              <span className={cn("shrink-0", TONES.emerald.text)}>{t(($) => $.annotations.status.addressed)}</span>
            ) : null}
            <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
              {location ? `${location} · ${page}` : page}
            </span>
          </button>
          <div className={cn("flex shrink-0 items-center", !active && "invisible group-focus-within:visible group-hover:visible")}>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => void store().update([{ id: item.id, status: resolved ? "draft" : "resolved" }])}
              aria-label={
                resolved
                  ? t(($) => $.annotations.panel.reopen, { number: item.number })
                  : t(($) => $.annotations.panel.resolve, { number: item.number })
              }
            >
              {resolved ? <RotateCcw className="size-3.5" /> : <CheckCheck className="size-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => void store().remove([item.id])}
              aria-label={t(($) => $.annotations.panel.delete, { number: item.number })}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        <AnnotationChange item={item} editing={editing} onEdit={onEdit} onDone={onDone} />
        {item.placement === "needsPlacing" ? (
          <div className="space-y-1.5 pt-0.5">
            <p className="text-xs text-muted-foreground">
              {placing ? t(($) => $.annotations.panel.placing) : t(($) => $.annotations.panel.notFound)}
            </p>
            <Button variant="outline" size="xs" className="gap-1" onClick={onPlaceAgain}>
              <Crosshair className="size-3" />
              {placing ? t(($) => $.annotations.composer.cancel) : t(($) => $.annotations.panel.placeAgain)}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function PdfAnnotationsPanel({
  id,
  open,
  placingId,
  onClose,
  onShow,
  onPlaceAgain,
  onSend,
}: Readonly<{
  id: string;
  open: boolean;
  placingId: string | null;
  onClose: () => void;
  onShow: (annotation: PdfAnnotation) => void;
  onPlaceAgain: (annotation: PdfAnnotation | null) => void;
  onSend: (annotations: PdfAnnotation[]) => void;
}>) {
  const { t } = useTranslation(["annotations"]);
  const projectId = usePdfAnnotationsStore((state) => state.projectId);
  const items = usePdfAnnotationsStore((state) => state.items);
  const activeId = usePdfAnnotationsStore((state) => state.activeId);
  const error = usePdfAnnotationsStore((state) => state.error);
  const loaded = usePdfAnnotationsStore((state) => state.loaded);
  const readOnly = usePdfAnnotationsStore((state) => state.readOnly);
  const setAside = usePdfAnnotationsStore((state) => state.setAside);
  const [picked, setPicked] = useState<Readonly<Record<string, boolean>>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const groups = useGroupsOpen(projectId);
  const activeRef = useRef<HTMLLIElement>(null);
  const isPicked = (item: PdfAnnotation) => picked[item.id] ?? item.status === "draft";
  const included = items.filter(isPicked);
  const activeItem = items.find((item) => item.id === activeId);
  const activeFolded = activeItem !== undefined && !groups.isOpen(groupOf(activeItem));

  useEffect(() => {
    if (activeFolded && activeItem) groups.setOpen(groupOf(activeItem), true);
  });

  useEffect(() => {
    const item = activeRef.current;
    const body = item?.closest<HTMLElement>("[data-side-panel-body]");
    if (!open || !activeId || activeFolded || !item || !body) return;
    const shown = body.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    if (box.top < shown.top) body.scrollTop -= shown.top - box.top;
    else if (box.bottom > shown.bottom) body.scrollTop += box.bottom - shown.bottom;
  }, [open, activeId, activeFolded]);

  const clearAll = async () => {
    const confirmed = await confirmAction({
      message: t(($) => $.annotations.panel.clearConfirm),
      confirmLabel: t(($) => $.annotations.panel.clear),
      destructive: true,
    });
    if (confirmed) await usePdfAnnotationsStore.getState().remove(items.map((item) => item.id));
  };

  const groupTitle = (group: Group) => {
    if (group === "placing") return t(($) => $.annotations.status.needsPlacing);
    if (group === "drafts") return t(($) => $.annotations.panel.groups.drafts);
    if (group === "assistant") return t(($) => $.annotations.panel.groups.assistant);
    return t(($) => $.annotations.status.resolved);
  };

  const sections = GROUPS.map((group) => ({ group, members: items.filter((item) => groupOf(item) === group) })).filter(
    ({ members }) => members.length > 0,
  );

  return (
    <FloatingSidePanel
      id={id}
      open={open}
      side="right"
      width="20rem"
      title={t(($) => $.annotations.panel.title)}
      icon={<PencilLine />}
      closeLabel={t(($) => $.annotations.panel.close)}
      onClose={onClose}
      solid
      bodyClassName="px-0 pb-2 pt-0"
      footer={
        items.length > 0 ? (
          <>
            <Button variant="ghost" size="xs" onClick={() => void clearAll()}>
              {t(($) => $.annotations.panel.clear)}
            </Button>
            <Button size="xs" className="gap-1.5" disabled={included.length === 0} onClick={() => onSend(included)}>
              <Send className="size-3.5" />
              {t(($) => $.annotations.panel.send, { n: included.length })}
            </Button>
          </>
        ) : null
      }
    >
      {error ? (
        <div className="mb-2">
          <InlineAlert>{t(($) => $.annotations.panel.failed, { error })}</InlineAlert>
        </div>
      ) : null}
      {readOnly ? (
        <div className="mb-2">
          <InlineAlert>{t(($) => $.annotations.panel.readOnly)}</InlineAlert>
        </div>
      ) : null}
      {setAside ? (
        <div className="mb-2">
          <InlineAlert>{t(($) => $.annotations.panel.setAside)}</InlineAlert>
        </div>
      ) : null}
      {!loaded && !error ? (
        <div className="flex justify-center py-4">
          <Spinner size="sm" />
        </div>
      ) : items.length === 0 ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">{t(($) => $.annotations.panel.empty)}</p>
      ) : (
        <div className="divide-y divide-border">
          {sections.map(({ group, members }) => {
            const placingGroup = group === "placing";
            return (
              <CollapsibleSection
                key={group}
                id={`${id}-${group}`}
                variant="group"
                open={groups.isOpen(group)}
                onOpenChange={(next) => groups.setOpen(group, next)}
                leading={placingGroup ? <AlertTriangle aria-hidden className={cn("size-3.5 shrink-0", TONES.amber.icon)} /> : undefined}
                title={
                  <span className={cn("tabular-nums", placingGroup && TONES.amber.text)}>
                    {`${groupTitle(group)} · ${members.length}`}
                  </span>
                }
              >
                <ul className="pb-1">
                  {members.map((item) => (
                    <AnnotationRow
                      key={item.id}
                      item={item}
                      active={item.id === activeId}
                      activeRef={activeRef}
                      picked={isPicked(item)}
                      placing={placingId === item.id}
                      editing={editingId === item.id}
                      onPick={() => setPicked((current) => ({ ...current, [item.id]: !isPicked(item) }))}
                      onShow={() => onShow(item)}
                      onPlaceAgain={() => onPlaceAgain(placingId === item.id ? null : item)}
                      onEdit={() => setEditingId(item.id)}
                      onDone={() => setEditingId(null)}
                    />
                  ))}
                </ul>
              </CollapsibleSection>
            );
          })}
        </div>
      )}
    </FloatingSidePanel>
  );
}
