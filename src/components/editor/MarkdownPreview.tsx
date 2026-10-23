import { useDeferredValue, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { markdownComponents } from "@/components/ui/markdown-renderer";
import { useActiveContent, useFilesStore } from "@/store/files";
import { loadAssetThumbnail } from "./cm/hover-asset";
import { appUrlProjectPath, projectFileForHref } from "@/lib/file-links";
import { openLinkedProjectFile } from "@/features/file-links";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

// react-markdown blanks URLs with schemes it does not know, which hid links
// saved with the app's own `tauri://localhost` address before PreviewLink
// could map them to their file.
function urlTransform(url: string): string {
  return appUrlProjectPath(url) ? url : defaultUrlTransform(url);
}

function PreviewImage({ projectId, path, src, alt, title }: Readonly<{
  projectId: string | null;
  path: string;
  src?: string;
  alt?: string;
  title?: string;
}>) {
  const key = `${projectId}\0${path}\0${src}`;
  // A project image, also when its path was saved with the app's own address.
  const target = projectFileForHref(path, src)?.path ?? null;
  const external = !target && src && /^https?:\/\//iu.test(src) ? src : null;
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!projectId || !target) return;
    let cancelled = false;
    void loadAssetThumbnail(projectId, target).then((url) => {
      if (!cancelled) setLoaded({ key, url });
    });
    return () => { cancelled = true; };
  }, [projectId, target, key]);
  const url = external ?? (loaded?.key === key ? loaded.url : null);
  return url ? <img src={url} alt={alt ?? ""} title={title} className="max-w-full" />
    : <span className="text-muted-foreground">{alt}</span>;
}

// A project link keeps its exact project path, so a copied link maps back to
// the right file. Links saved with the app's own address, as 0.4.7 did, open
// their file too instead of a dead page in the browser.
function PreviewLink({ path, href, children }: Readonly<{ path: string; href?: string; children?: ReactNode }>) {
  const target = projectFileForHref(path, href);
  const Anchor = markdownComponents.a as (props: { href?: string; children?: ReactNode }) => ReactNode;
  if (!target) return <Anchor href={href}>{children}</Anchor>;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    openLinkedProjectFile(target.path);
  };
  return <a href={`/${target.path.split("/").map(encodeURIComponent).join("/")}${target.fragment}`} onClick={open}
    className="text-primary underline underline-offset-2 dark:text-primary">{children}</a>;
}

export function MarkdownPreview() {
  const { t } = useTranslation(["editor"]);
  const content = useDeferredValue(useActiveContent());
  const projectId = useFilesStore((state) => state.projectId);
  const path = useFilesStore((state) => state.activePath) ?? "";
  const components = useMemo<Components>(() => ({
    ...markdownComponents,
    img: ({ src, alt, title }) => <PreviewImage projectId={projectId} path={path}
      src={typeof src === "string" ? src : undefined} alt={alt} title={title} />,
    a: ({ href, children }) => <PreviewLink path={path} href={href}>{children}</PreviewLink>,
  }), [projectId, path]);
  return <section data-testid="markdown-preview" aria-label={t(($) => $.editor.preview.markdown)}
    className="h-full min-w-0 overflow-auto px-6 py-5 text-sm text-foreground [overflow-wrap:anywhere] [scrollbar-width:thin] [&_h1]:mb-3 [&_h1]:text-2xl [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h3]:mt-4 [&_h3]:text-lg [&_.katex-display]:overflow-x-auto">
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components} urlTransform={urlTransform}>
      {content}
    </ReactMarkdown>
  </section>;
}
