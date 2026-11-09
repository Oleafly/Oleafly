import { Node as TiptapNode, type AnyExtension, type NodeViewRenderer, type NodeViewRendererProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { useNearViewport } from "@/hooks/use-near-viewport";
import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { isSelectionModifier } from "@/store/library-selection";
import { noteBody } from "./note-file";
import { NoteChip } from "./note-icons";
import { noteHeadings, noteSection, parseNoteLink, type NoteLinkTarget } from "./note-link-format";
import type { LinkableNote, OpenNoteOptions } from "./note-links";
import { NoteMarkdown } from "./note-preview";
import {
  heldRemoteImage,
  type MountedNotice,
  mountRemoteImageNotice,
  remoteImageAllowed,
  subscribeRemoteImages,
} from "./note-remote-images";

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
  const body = noteBody(text);
  return heading ? noteSection(body, heading) : body.trim();
}

interface CardProps {
  target: NoteLinkTarget;
  alt: string;
  options: EmbedOptions;
}

function Message({ children }: Readonly<{ children: string }>) {
  return <p className="note-embed-message">{children}</p>;
}

export function EmbedCard({ target, alt, options }: Readonly<CardProps>) {
  const { t } = useTranslation(["notes"]);
  const [gate, visible] = useNearViewport<HTMLDivElement>();
  const [folded, setFolded] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const notes = options.getNotes();
  const note = notes?.find((candidate) => candidate.noteId === target.id) ?? null;
  const self = target.id === options.currentNoteId();
  const version = note ? options.version(note.projectId) : 0;
  const key = note ? `${note.projectId}:${version}` : "";
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

  const text = loaded && "text" in loaded ? loaded.text : null;
  const headingText = target.heading && text ? noteHeadings(noteBody(text)).find((heading) => heading.slug === target.heading)?.text : undefined;
  const open = (event: MouseEvent) => {
    if (!note) return;
    const opened: OpenNoteOptions = { newTab: isSelectionModifier(event), projectId: note.projectId };
    if (target.heading) opened.heading = target.heading;
    options.onOpen(target.id, opened);
  };

  let state = "ready";
  let body: ReactNode = null;
  if (!notes) {
    state = "loading";
  } else if (!note) {
    state = "missing";
    body = <Message>{t(($) => $.notes.kb.embeds.missing)}</Message>;
  } else if (self) {
    state = "self";
    body = <Message>{t(($) => $.notes.kb.embeds.self)}</Message>;
  } else if (loaded && "failed" in loaded) {
    state = "failed";
    body = <Message>{t(($) => $.notes.kb.embeds.failed)}</Message>;
  } else if (text !== null) {
    const source = embedSource(text, target.heading);
    if (source === null) {
      state = "missing";
      body = <Message>{t(($) => $.notes.kb.embeds.missingHeading)}</Message>;
    } else if (source === "") {
      body = <Message>{t(($) => $.notes.kb.embeds.empty)}</Message>;
    } else {
      body = <NoteMarkdown noteId={note.projectId} source={source} resolveAsset={options.resolveAsset} full className="note-embed-content" />;
    }
  } else {
    state = "loading";
  }

  const title = note?.title || alt || t(($) => $.notes.kb.embeds.untitled);
  return (
    <div ref={gate} className="note-embed-card" data-state={state} data-folded={folded || undefined}>
      <div className="note-embed-head">
        {note ? <NoteChip icon={note.icon} color={note.color} className="size-5 rounded" /> : null}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{title}</span>
          {target.heading && <span className="note-embed-crumb">{headingText ?? target.heading}</span>}
        </span>
        {note && !self && (
          <Tooltip label={t(($) => $.notes.kb.embeds.open)}>
            <button type="button" aria-label={t(($) => $.notes.kb.embeds.openNamed, { title })} onClick={open} className="note-embed-button">
              <ArrowUpRight aria-hidden className="size-4" />
            </button>
          </Tooltip>
        )}
        <Tooltip label={folded ? t(($) => $.notes.kb.embeds.unfold) : t(($) => $.notes.kb.embeds.fold)}>
          <button
            type="button"
            aria-expanded={!folded}
            aria-label={folded ? t(($) => $.notes.kb.embeds.unfold) : t(($) => $.notes.kb.embeds.fold)}
            onClick={() => setFolded((current) => !current)}
            className="note-embed-button"
          >
            <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", folded && "-rotate-90")} />
          </button>
        </Tooltip>
      </div>
      {!folded && <div className="note-embed-body">{body}</div>}
    </div>
  );
}

export function embedNodeView(options: EmbedOptions, mount: (host: HTMLElement) => Root = createRoot) {
  return ({ node }: Pick<NodeViewRendererProps, "node">) => {
    const dom = document.createElement("div");
    dom.className = "note-embed";
    dom.contentEditable = "false";
    const root = mount(dom);
    let current = node;
    const paint = () => {
      const target = embedTarget(current);
      if (!target) return;
      root.render(
        <I18nextProvider i18n={i18n}>
          <EmbedCard target={target} alt={String(current.attrs.alt ?? "")} options={options} />
        </I18nextProvider>,
      );
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
        queueMicrotask(() => root.unmount());
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
    stopEvent: (event: Event) => event.target instanceof Node && held !== null && held.dom.contains(event.target),
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
