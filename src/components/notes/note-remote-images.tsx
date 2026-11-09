import { DOMSerializer, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { RemoteImageNotice } from "@/components/ui/remote-image-notice";
import { i18n } from "@/i18n";
import { remoteImageHost } from "@/lib/remote-image";

export interface RemoteImage {
  url: string;
  host: string;
}

export interface MountedNotice {
  dom: HTMLElement;
  destroy: () => void;
}

const allowed = new Set<string>();
const listeners = new Set<() => void>();
const mounted = new WeakMap<Element, () => void>();

export function remoteImage(src: string): RemoteImage | null {
  const host = remoteImageHost(src);
  return host ? { url: src.trim(), host } : null;
}

export function heldRemoteImage(src: string): RemoteImage | null {
  const remote = remoteImage(src);
  return remote && !allowed.has(remote.url) ? remote : null;
}

export function remoteImageAllowed(url: string): boolean {
  return allowed.has(url);
}

export function allowRemoteImage(url: string): void {
  if (allowed.has(url)) return;
  allowed.add(url);
  for (const listener of [...listeners]) listener();
}

export function subscribeRemoteImages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function forgetRemoteImages(): void {
  allowed.clear();
}

export function mountRemoteImageNotice(remote: RemoteImage, alt: string, onLoad: () => void): MountedNotice {
  const dom = document.createElement("span");
  dom.className = "note-remote-image";
  dom.contentEditable = "false";
  const root = createRoot(dom);
  root.render(
    <I18nextProvider i18n={i18n}>
      <RemoteImageNotice
        host={remote.host}
        alt={alt}
        onLoad={() => {
          allowRemoteImage(remote.url);
          onLoad();
        }}
      />
    </I18nextProvider>,
  );
  const destroy = () => {
    if (!mounted.delete(dom)) return;
    dom.remove();
    queueMicrotask(() => root.unmount());
  };
  mounted.set(dom, destroy);
  return { dom, destroy };
}

export function destroyRemoteImageNotices(root: Node): void {
  if (!(root instanceof Element)) return;
  for (const notice of root.querySelectorAll(".note-remote-image")) mounted.get(notice)?.();
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
