import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { markdownComponents } from "@/components/ui/markdown-renderer";
import { resolveProjectPath } from "@/lib/project-intelligence/source";
import { useActiveContent, useFilesStore } from "@/store/files";
import { loadAssetThumbnail } from "./cm/hover-asset";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

function PreviewImage({ projectId, path, src, alt, title }: Readonly<{
  projectId: string | null;
  path: string;
  src?: string;
  alt?: string;
  title?: string;
}>) {
  const key = `${projectId}\0${path}\0${src}`;
  const external = src && /^https?:\/\//iu.test(src) ? src : null;
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!projectId || !src || external) return;
    let decoded: string;
    try { decoded = decodeURIComponent(src); } catch { return; }
    const target = resolveProjectPath(path, decoded);
    if (!target) return;
    let cancelled = false;
    void loadAssetThumbnail(projectId, target).then((url) => {
      if (!cancelled) setLoaded({ key, url });
    });
    return () => { cancelled = true; };
  }, [projectId, path, src, key, external]);
  const url = external ?? (loaded?.key === key ? loaded.url : null);
  return url ? <img src={url} alt={alt ?? ""} title={title} className="max-w-full" />
    : <span className="text-muted-foreground">{alt}</span>;
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
  }), [projectId, path]);
  return <section data-testid="markdown-preview" aria-label={t(($) => $.editor.preview.markdown)}
    className="h-full min-w-0 overflow-auto px-6 py-5 text-sm text-foreground [overflow-wrap:anywhere] [scrollbar-width:thin] [&_h1]:mb-3 [&_h1]:text-2xl [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h3]:mt-4 [&_h3]:text-lg [&_.katex-display]:overflow-x-auto">
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
      {content}
    </ReactMarkdown>
  </section>;
}
