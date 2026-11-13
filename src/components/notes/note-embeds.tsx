import { Node as TiptapNode, type AnyExtension, type NodeViewRenderer, type NodeViewRendererProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { TFunction } from "i18next";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { BLOCK_MESSAGE, BLOCK_SURFACE } from "@/components/ui/block-frame";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useNearViewport } from "@/hooks/use-near-viewport";
import { heldRemoteImage, remoteImageAllowed, subscribeRemoteImages } from "@/lib/remote-image";
import { cn } from "@/lib/utils";
import { isSelectionModifier } from "@/store/library-selection";
import { frontMatterBody } from "@/lib/front-matter";
import { blockOfFragment, shortText, stripBlockIdMarkers } from "./note-block-ids";
import { noteBlock, noteBlockSource } from "./note-block-links";
import { NoteChip } from "./note-icons";
import { noteHeadings, noteSection, parseNoteLink, type NoteLinkTarget } from "./note-link-format";
import type { LinkableNote, OpenNoteOptions } from "./note-links";
import { NoteMarkdown } from "./note-preview";
import { type MountedNotice, mountRemoteImageNotice } from "./note-remote-images";
import { nodeRoot } from "./node-root";

export interface EmbedOptions {
  getNotes: () => readonly LinkableNote[] | null;
  currentNoteId: () => string | null | undefined;
  loadText: (projectId: string) => Promise<string>;
  version: (projectId: string) => number;
  resolveAsset?: (projectId: string, path: string) => Promise<string | null>;
  onOpen: (noteId: string, options: OpenNoteOptions) => void;
  subscribe?: (listener: () => void) => () => void;
}

export function embedTarget(node: ProseMirrorNode): NoteLinkTarget | null {
  const target = parseNoteLink(String(node.attrs.src ?? ""));
  return target?.kind === "note" ? target : null;
}

type Loaded = { key: string; text: string } | { key: string; failed: true };

export function embedSource(text: string, heading: string | undefined): string | null {
  const block = blockOfFragment(heading);
  if (block) return noteBlockSource(text, block);
  const body = frontMatterBody(text);
  const source = heading ? noteSection(body, heading) : body.trim();
  return source === null ? null : stripBlockIdMarkers(source);
}

export function fragmentLabel(text: string, fragment: string): string | undefined {
  const block = blockOfFragment(fragment);
  if (!block) return noteHeadings(frontMatterBody(text)).find((heading) => heading.slug === fragment)?.text;
  const found = noteBlock(text, block);
  return found ? shortText(found.text) || fragment : undefined;
}

interface CardProps {
  target: NoteLinkTarget;
  alt: string;
  options: EmbedOptions;
}

function Message({ children }: Readonly<{ children: string }>) {
  return <p className={BLOCK_MESSAGE}>{children}</p>;
}

interface EmbedView {
  state: string;
  body: ReactNode;
}

interface EmbedViewInput {
  t: TFunction<["notes"]>;
  target: NoteLinkTarget;
  notes: readonly LinkableNote[] | null;
  note: LinkableNote | null;
  self: boolean;
  loaded: Loaded | null;
  text: string | null;
  resolveAsset: EmbedOptions["resolveAsset"];
}

function embedSourceView({ t, target, note, text, resolveAsset }: EmbedViewInput & { note: LinkableNote; text: string }): EmbedView {
  const source = embedSource(text, target.heading);
  if (source === null) {
    const missing = blockOfFragment(target.heading) ? t(($) => $.notes.linksSearch.blocks.missingBlock) : t(($) => $.notes.kb.embeds.missingHeading);
    return { state: "missing", body: <Message>{missing}</Message> };
  }
  if (source === "") return { state: "ready", body: <Message>{t(($) => $.notes.kb.embeds.empty)}</Message> };
  return {
    state: "ready",
    body: <NoteMarkdown noteId={note.projectId} source={source} color={note.color} resolveAsset={resolveAsset} full className="note-embed-content" />,
  };
}

function embedView(input: EmbedViewInput): EmbedView {
  const { t, notes, note, self, loaded, text } = input;
  if (!notes) return { state: "loading", body: null };
  if (!note) return { state: "missing", body: <Message>{t(($) => $.notes.kb.embeds.missing)}</Message> };
  if (self) return { state: "self", body: <Message>{t(($) => $.notes.kb.embeds.self)}</Message> };
  if (loaded && "failed" in loaded) return { state: "failed", body: <Message>{t(($) => $.notes.kb.embeds.failed)}</Message> };
  if (text === null) return { state: "loading", body: null };
  return embedSourceView({ ...input, note, text });
}

function embedKey(note: LinkableNote | null, options: EmbedOptions): string {
  return note ? `${note.projectId}:${options.version(note.projectId)}` : "";
}

function loadedText(loaded: Loaded | null): string | null {
  return loaded && "text" in loaded ? loaded.text : null;
}

function EmbedTitle({ title, heading, headingText }: Readonly<{ title: string; heading: string | undefined; headingText: string | undefined }>) {
  return (
    <span className="min-w-0 flex-1 truncate">
      <span className="font-medium">{title}</span>
      {heading && <span className="text-muted-foreground before:mx-1.5 before:content-['›']">{headingText ?? heading}</span>}
    </span>
  );
}

export function EmbedCard({ target, alt, options }: Readonly<CardProps>) {
  const { t } = useTranslation(["notes"]);
  const [gate, visible] = useNearViewport<HTMLDivElement>();
  const [folded, setFolded] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const notes = options.getNotes();
  const note = notes?.find((candidate) => candidate.noteId === target.id) ?? null;
  const self = target.id === options.currentNoteId();
  const key = embedKey(note, options);
  const wanted = Boolean(note) && !self && visible && !folded;

  useEffect(() => {
    if (!wanted || !note || loaded?.key === key) return;
    let live = true;
    options.loadText(note.projectId).then(
      (text) => {
        if (live) setLoaded({ key, text });
      },
      () => {
        if (live) setLoaded({ key, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [key, loaded?.key, note, options, wanted]);

  const text = loadedText(loaded);
  const headingText = target.heading && text ? fragmentLabel(text, target.heading) : undefined;
  const open = (event: MouseEvent) => {
    if (!note) return;
    const opened: OpenNoteOptions = { newTab: isSelectionModifier(event), projectId: note.projectId };
    if (target.heading) opened.heading = target.heading;
    options.onOpen(target.id, opened);
  };

  const { state, body } = embedView({ t, target, notes, note, self, loaded, text, resolveAsset: options.resolveAsset });

  const title = note?.title || alt || t(($) => $.notes.kb.embeds.untitled);
  const foldLabel = folded ? t(($) => $.notes.kb.embeds.unfold) : t(($) => $.notes.kb.embeds.fold);
  return (
    <div
      ref={gate}
      data-state={state}
      data-folded={folded || undefined}
      className={cn(
        BLOCK_SURFACE,
        "overflow-hidden transition-colors in-[.ProseMirror-selectednode]:border-primary motion-reduce:transition-none",
      )}
    >
      <div className={cn("note-embed-head flex select-none items-center gap-2 py-1.5 pr-2 pl-3 text-[0.8125rem]", !folded && "border-b")}>
        {note ? <NoteChip icon={note.icon} color={note.color} className="size-5 rounded" /> : null}
        <EmbedTitle title={title} heading={target.heading} headingText={headingText} />
        {note && !self && (
          <Tooltip label={t(($) => $.notes.kb.embeds.open)}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t(($) => $.notes.kb.embeds.openNamed, { title })}
              onClick={open}
              className="size-7 text-muted-foreground"
            >
              <ArrowUpRight aria-hidden />
            </Button>
          </Tooltip>
        )}
        <Tooltip label={foldLabel}>
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={!folded}
            aria-label={foldLabel}
            onClick={() => setFolded((current) => !current)}
            className="size-7 text-muted-foreground"
          >
            <ChevronDown aria-hidden className={cn("transition-transform motion-reduce:transition-none", folded && "-rotate-90")} />
          </Button>
        </Tooltip>
      </div>
      {!folded && <div className={cn("max-h-[32rem] overflow-auto px-4 py-2", state === "loading" && "min-h-10")}>{body}</div>}
    </div>
  );
}

export function embedNodeView(options: EmbedOptions, mount?: (host: HTMLElement) => Root) {
  return ({ node }: Pick<NodeViewRendererProps, "node">) => {
    const dom = document.createElement("div");
    dom.className = "note-embed my-4 rounded-md";
    dom.contentEditable = "false";
    const root = nodeRoot(dom, mount);
    let current = node;
    const paint = () => {
      const target = embedTarget(current);
      if (!target) return;
      root.render(<EmbedCard target={target} alt={String(current.attrs.alt ?? "")} options={options} />);
    };
    paint();
    const stop = options.subscribe?.(paint);
    return {
      dom,
      update(next: ProseMirrorNode) {
        if (next.type !== current.type || !embedTarget(next)) return false;
        current = next;
        paint();
        return true;
      },
      stopEvent(event: Event) {
        return event.target instanceof Element && event.target.closest("button, a, input") !== null;
      },
      ignoreMutation() {
        return true;
      },
      destroy() {
        stop?.();
        root.unmount();
      },
    };
  };
}

type ImageView = ReturnType<NodeViewRenderer>;

export function plainImageView(node: ProseMirrorNode): ImageView {
  const dom = document.createElement("span");
  dom.className = "note-plain-image";
  const image = document.createElement("img");
  dom.append(image);
  let current = node;
  let held: MountedNotice | null = null;
  let stopWatching: (() => void) | null = null;
  const release = () => {
    held?.destroy();
    held = null;
    stopWatching?.();
    stopWatching = null;
    image.hidden = false;
  };
  const paint = () => {
    release();
    const src = String(current.attrs.src ?? "");
    image.alt = String(current.attrs.alt ?? "");
    const remote = heldRemoteImage(src);
    if (!remote) {
      image.src = src;
      return;
    }
    image.removeAttribute("src");
    image.hidden = true;
    held = mountRemoteImageNotice(remote, image.alt, paint);
    dom.append(held.dom);
    stopWatching = subscribeRemoteImages(() => {
      if (remoteImageAllowed(remote.url)) paint();
    });
  };
  paint();
  return {
    dom,
    update(next: ProseMirrorNode) {
      if (next.type !== current.type) return false;
      current = next;
      paint();
      return true;
    },
    stopEvent: (event: Event) => event.target instanceof Node && held?.dom.contains(event.target) === true,
    destroy: release,
  };
}

export function withNoteEmbeds(extension: AnyExtension, options: EmbedOptions): AnyExtension {
  if (!(extension instanceof TiptapNode) || extension.name !== "image") return extension;
  return extension.extend({
    addNodeView() {
      const parent = this.parent?.() ?? null;
      const embed = embedNodeView(options);
      return (props) => {
        if (embedTarget(props.node)) return embed(props);
        const view = parent ? parent(props) : plainImageView(props.node);
        const update = view.update?.bind(view);
        view.update = (next, ...rest) => (embedTarget(next) ? false : (update?.(next, ...rest) ?? false));
        return view;
      };
    },
  });
}
