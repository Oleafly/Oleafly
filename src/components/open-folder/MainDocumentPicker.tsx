import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileIcon } from "@/components/files/fileIcon";
import type { DetectionCandidate } from "@/lib/folder-detection";
import { candidateReasonLine, documentKindLabel } from "@/lib/main-document";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { chooseMainDocument } from "@/store/main-document";
import { useOpenFolderStore } from "@/store/open-folder";

const EMPTY: DetectionCandidate[] = [];

function takeFocus(event: MouseEvent<HTMLInputElement>) {
  event.currentTarget.focus({ preventScroll: true });
}

function CandidateRow({
  id,
  name,
  candidate,
  selected,
  tabbable,
  badge,
  onSelect,
  onOpen,
  onKeyDown,
}: Readonly<{
  id: string;
  name: string;
  candidate: DetectionCandidate;
  selected: boolean;
  tabbable: boolean;
  badge: string | null;
  onSelect: () => void;
  onOpen: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}>) {
  const reason = candidateReasonLine(candidate);
  return (
    <label
      id={id}
      data-path={candidate.path}
      className={cn(
        "relative flex w-full cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/10"
          : "border-transparent hover:bg-accent",
      )}
    >
      <input
        type="radio"
        name={name}
        value={candidate.path}
        checked={selected}
        tabIndex={tabbable ? 0 : -1}
        onChange={onSelect}
        onClick={takeFocus}
        onKeyDown={onKeyDown}
        onDoubleClick={onOpen}
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
      />
      <FileIcon name={candidate.path} className="mt-0.5 size-4 shrink-0" />
      <span className="block min-w-0 flex-1 space-y-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-mono text-xs text-foreground">
            {candidate.path}
          </span>
          {badge ? (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {badge}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {documentKindLabel(candidate.kind)}
          </span>
        </span>
        {candidate.title ? (
          <span className="block truncate text-xs text-foreground/80">{candidate.title}</span>
        ) : null}
        {reason ? (
          <span className="block truncate text-[11px] text-muted-foreground">{reason}</span>
        ) : null}
      </span>
    </label>
  );
}

export function MainDocumentPicker() {
  const { t } = useTranslation(["shell"]);
  const projectId = useFilesStore((state) => state.projectId);
  const projectLoading = useFilesStore((state) => state.loading);
  const opened = useOpenFolderStore((state) => state.opened);
  const dismiss = useOpenFolderStore((state) => state.dismiss);
  const asking =
    opened?.detection.decision === "ask" && opened.project_id === projectId && !projectLoading;
  const detection = asking ? opened?.detection : undefined;
  const candidates = detection?.candidates ?? EMPTY;
  const preferred = detection?.main ?? candidates[0]?.path ?? null;
  const selectionKey = `${projectId ?? ""}:${preferred ?? ""}`;
  const [choice, setChoice] = useState<{ key: string; path: string | null }>({
    key: "",
    path: null,
  });
  const kept =
    choice.key === selectionKey && candidates.some((candidate) => candidate.path === choice.path);
  const selected = kept ? choice.path : preferred;
  const setSelected = (path: string | null) => setChoice({ key: selectionKey, path });
  const [pendingIn, setPendingIn] = useState<string | null>(null);
  const busy = pendingIn !== null && pendingIn === projectId;
  const listRef = useRef<HTMLFieldSetElement | null>(null);
  const focusListWhenShown = useRef(false);
  const baseId = useId();
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const selectedIndex = candidates.findIndex((candidate) => candidate.path === selected);
  const selectedOptionId = selectedIndex >= 0 ? optionId(selectedIndex) : null;
  const focusChoice = (index: number) => {
    listRef.current?.querySelectorAll("input")[index]?.focus({ preventScroll: true });
  };
  const tabStop = Math.max(0, selectedIndex);
  const focusList = () => focusChoice(tabStop);
  const attachList = (node: HTMLFieldSetElement | null) => {
    listRef.current = node;
    if (node && focusListWhenShown.current) {
      focusListWhenShown.current = false;
      focusList();
    }
  };

  useEffect(() => {
    if (!selectedOptionId) return;
    const row = document.getElementById(selectedOptionId);
    if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [selectedOptionId]);

  const close = () => {
    if (!busy) dismiss();
  };

  const open = async (path: string | null) => {
    if (!path || busy || !asking || !projectId) return;
    const startedIn = projectId;
    setPendingIn(startedIn);
    try {
      const chosen = await chooseMainDocument(path);
      if (chosen && useOpenFolderStore.getState().opened?.project_id === startedIn) dismiss();
    } catch (error) {
      if (useFilesStore.getState().projectId !== startedIn) {
        void logError("choose the main document", error);
        return;
      }
      notifyError(
        "choose the main document",
        error,
        t(($) => $.shell.openedFolder.picker.openFailed, { path }),
      );
    } finally {
      setPendingIn((pending) => (pending === startedIn ? null : pending));
    }
  };

  const onChoiceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (candidates.length === 0) return;
    const last = candidates.length - 1;
    const from = Math.max(0, selectedIndex);
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = Math.min(last, selectedIndex < 0 ? 0 : from + 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = Math.max(0, from - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Enter") {
      event.preventDefault();
      void open(selected);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setSelected(candidates[next]?.path ?? null);
    focusChoice(next);
  };

  const badgeFor = (candidate: DetectionCandidate): string | null =>
    candidate.path === preferred ? t(($) => $.shell.openedFolder.picker.bestMatch) : null;

  const renderBody = () => {
    if (candidates.length === 0) {
      return (
        <p className="px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground">
          {t(($) => $.shell.openedFolder.picker.empty)}
        </p>
      );
    }
    return (
      <fieldset
        ref={attachList}
        data-testid="main-document-candidates"
        className="min-w-0 rounded-lg border border-border transition-colors has-[:focus-visible]:border-primary/50"
      >
        <legend className="sr-only">{t(($) => $.shell.openedFolder.picker.listLabel)}</legend>
        <div className="max-h-[min(50vh,24rem)] space-y-0.5 overflow-y-auto rounded-[inherit] p-1">
          {candidates.map((candidate, index) => (
            <CandidateRow
              key={candidate.path}
              id={optionId(index)}
              name={`${baseId}-choice`}
              candidate={candidate}
              selected={candidate.path === selected}
              tabbable={index === tabStop}
              badge={badgeFor(candidate)}
              onSelect={() => setSelected(candidate.path)}
              onOpen={() => {
                setSelected(candidate.path);
                void open(candidate.path);
              }}
              onKeyDown={onChoiceKeyDown}
            />
          ))}
        </div>
      </fieldset>
    );
  };

  return (
    <Dialog
      open={asking}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        data-testid="main-document-picker"
        className="top-[12vh] max-w-xl translate-y-0 gap-3 p-5 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 data-[state=open]:slide-in-from-top-2"
        closeDisabled={busy}
        onOpenAutoFocus={(event) => {
          if (!listRef.current) {
            focusListWhenShown.current = true;
            return;
          }
          event.preventDefault();
          focusList();
        }}
        onPointerDownCapture={() => {
          focusListWhenShown.current = false;
        }}
        onKeyDownCapture={() => {
          focusListWhenShown.current = false;
        }}
      >
        <DialogHeader className="pr-6">
          <DialogTitle className="text-sm">{t(($) => $.shell.openedFolder.picker.askTitle)}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t(($) => $.shell.openedFolder.picker.askDescription)}
          </DialogDescription>
        </DialogHeader>
        {renderBody()}
        {detection?.truncated ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t(($) => $.shell.openedFolder.picker.truncated)}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
            {t(($) => $.shell.openedFolder.picker.browse)}
          </Button>
          <Button
            size="sm"
            onClick={() => void open(selected)}
            disabled={busy || selected === null || selectedIndex < 0}
          >
            {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
            {t(($) => $.shell.openedFolder.picker.open)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
