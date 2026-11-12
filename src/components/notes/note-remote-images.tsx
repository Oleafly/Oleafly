import { DOMSerializer, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RemoteImageNotice } from "@/components/ui/remote-image-notice";
import { Tooltip } from "@/components/ui/tooltip";
import {
  allowRemoteImage,
  allowRemoteImages,
  heldRemoteImage,
  type RemoteImage,
  remoteImageAllowed,
  subscribeRemoteImages,
  trustRemoteImageHost,
} from "@/lib/remote-image";
import { nodeRoot } from "./node-root";

export interface MountedNotice {
  dom: HTMLElement;
  destroy: () => void;
}

interface Notice {
  remote: RemoteImage;
  destroy: () => void;
}

const NOTICE_CLASS = "note-remote-image";

const mounted = new WeakMap<Element, Notice>();

function noticesBeside(dom: HTMLElement): string[] {
  const scope = dom.closest(".ProseMirror") ?? dom.parentElement ?? dom;
  return [dom, ...scope.querySelectorAll(`.${NOTICE_CLASS}`)].flatMap((element) => {
    const notice = mounted.get(element);
    return notice ? [notice.remote.url] : [];
  });
}

function RemoteImageMenu({ host, onLoadAll, onTrust }: Readonly<{ host: string; onLoadAll: () => void; onTrust: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const label = t(($) => $.notes.document.remoteImages.more);
  return (
    <DropdownMenu>
      <Tooltip label={label} side="top">
        <DropdownMenuTrigger
          aria-label={label}
          onMouseDown={(event) => event.preventDefault()}
          className="flex size-5 shrink-0 items-center justify-center rounded text-foreground transition-colors hover:bg-accent focus-visible:bg-accent data-[state=open]:bg-accent motion-reduce:transition-none"
        >
          <ChevronDown aria-hidden className="size-3.5" />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={onLoadAll} className="text-xs">
          {t(($) => $.notes.document.remoteImages.loadAll)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onTrust} className="text-xs">
          {t(($) => $.notes.document.remoteImages.trustHost, { host })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function mountRemoteImageNotice(remote: RemoteImage, alt: string, onLoad: () => void): MountedNotice {
  const dom = document.createElement("span");
  dom.className = NOTICE_CLASS;
  dom.contentEditable = "false";
  const root = nodeRoot(dom);
  const load = () => {
    if (mounted.has(dom)) onLoad();
  };
  const stopWatching = subscribeRemoteImages(() => {
    if (remoteImageAllowed(remote.url)) load();
  });
  root.render(
    <RemoteImageNotice
      host={remote.host}
      alt={alt}
      onLoad={() => (remoteImageAllowed(remote.url) ? load() : allowRemoteImage(remote.url))}
    >
      <RemoteImageMenu
        host={remote.host}
        onLoadAll={() => allowRemoteImages(noticesBeside(dom))}
        onTrust={() => trustRemoteImageHost(remote.host)}
      />
    </RemoteImageNotice>,
  );
  const destroy = () => {
    if (!mounted.delete(dom)) return;
    stopWatching();
    dom.remove();
    root.unmount();
  };
  mounted.set(dom, { remote, destroy });
  return { dom, destroy };
}

export function destroyRemoteImageNotices(root: Node): void {
  if (!(root instanceof Element)) return;
  for (const notice of root.querySelectorAll(`.${NOTICE_CLASS}`)) mounted.get(notice)?.destroy();
}

function loadedImage(node: ProseMirrorNode, url: string): HTMLImageElement {
  const image = document.createElement("img");
  image.alt = String(node.attrs.alt ?? "");
  if (node.attrs.title) image.title = String(node.attrs.title);
  image.src = url;
  return image;
}

export function remoteSafeSerializer(schema: Schema): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  const image = base.nodes.image;
  if (!image) return base;
  return new DOMSerializer(
    {
      ...base.nodes,
      image: (node) => {
        const remote = heldRemoteImage(String(node.attrs.src ?? ""));
        if (!remote) return image(node);
        const notice = mountRemoteImageNotice(remote, String(node.attrs.alt ?? ""), () => {
          notice.dom.replaceWith(loadedImage(node, remote.url));
          notice.destroy();
        });
        return notice.dom;
      },
    },
    base.marks,
  );
}
