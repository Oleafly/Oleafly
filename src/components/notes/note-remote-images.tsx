import { DOMSerializer, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { ChevronDown } from "lucide-react";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RemoteImageNotice } from "@/components/ui/remote-image-notice";
import { Tooltip } from "@/components/ui/tooltip";
import { i18n } from "@/i18n";
import { readJson, writeJson } from "@/lib/local-storage";
import { remoteImageHost } from "@/lib/remote-image";

export interface RemoteImage {
  url: string;
  host: string;
}

export interface MountedNotice {
  dom: HTMLElement;
  destroy: () => void;
}

interface Notice {
  remote: RemoteImage;
  destroy: () => void;
}

export const REMOTE_IMAGE_HOSTS_KEY = "oleafly.notes.remoteImageHosts";
const NOTICE_CLASS = "note-remote-image";

const allowed = new Set<string>();
const listeners = new Set<() => void>();
const mounted = new WeakMap<Element, Notice>();
let trusted: Set<string> | null = null;
let trustedList: readonly string[] | null = null;

function trustedHosts(): Set<string> {
  if (!trusted) {
    const saved = readJson<unknown>(REMOTE_IMAGE_HOSTS_KEY, []);
    trusted = new Set(Array.isArray(saved) ? saved.filter((host): host is string => typeof host === "string") : []);
  }
  return trusted;
}

export function trustedRemoteImageHosts(): readonly string[] {
  trustedList ??= [...trustedHosts()];
  return trustedList;
}

export function useTrustedRemoteImageHosts(): readonly string[] {
  return useSyncExternalStore(subscribeRemoteImages, trustedRemoteImageHosts);
}

function notify(): void {
  for (const listener of [...listeners]) {
    if (listeners.has(listener)) listener();
  }
}

export function remoteImage(src: string): RemoteImage | null {
  const host = remoteImageHost(src);
  return host ? { url: src.trim(), host } : null;
}

export function remoteImageAllowed(url: string): boolean {
  if (allowed.has(url)) return true;
  const host = remoteImageHost(url);
  return host !== null && trustedHosts().has(host);
}

export function heldRemoteImage(src: string): RemoteImage | null {
  const remote = remoteImage(src);
  return remote && !remoteImageAllowed(remote.url) ? remote : null;
}

export function allowRemoteImages(urls: readonly string[]): void {
  const fresh = urls.filter((url) => !allowed.has(url));
  if (fresh.length === 0) return;
  for (const url of fresh) allowed.add(url);
  notify();
}

export function allowRemoteImage(url: string): void {
  allowRemoteImages([url]);
}

function saveTrustedHosts(hosts: Set<string>): void {
  trustedList = null;
  writeJson(REMOTE_IMAGE_HOSTS_KEY, [...hosts]);
  notify();
}

export function trustRemoteImageHost(host: string): void {
  const hosts = trustedHosts();
  if (hosts.has(host)) return;
  hosts.add(host);
  saveTrustedHosts(hosts);
}

export function untrustRemoteImageHost(host: string): void {
  const hosts = trustedHosts();
  if (!hosts.delete(host)) return;
  saveTrustedHosts(hosts);
}

export function subscribeRemoteImages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetRemoteImagesForTest(): void {
  allowed.clear();
  trusted = null;
  trustedList = null;
}

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
  const root = createRoot(dom);
  const load = () => {
    if (mounted.has(dom)) onLoad();
  };
  const stopWatching = subscribeRemoteImages(() => {
    if (remoteImageAllowed(remote.url)) load();
  });
  root.render(
    <I18nextProvider i18n={i18n}>
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
      </RemoteImageNotice>
    </I18nextProvider>,
  );
  const destroy = () => {
    if (!mounted.delete(dom)) return;
    stopWatching();
    dom.remove();
    queueMicrotask(() => root.unmount());
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
