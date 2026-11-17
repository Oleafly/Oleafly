import { isUrlWithScheme, linkHrefForPath } from "@oleafly/wysiwyg/link-destination";
import { localizedVisualHref } from "@/features/file-links";
import { i18n } from "@/i18n";

interface MarkdownHeadingLevel {
  label: () => string;
  hLabel: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  className: string;
}

export const MARKDOWN_HEADING_LEVELS: MarkdownHeadingLevel[] = [
  {
    label: () => i18n.t(($) => $.editor.headings.title),
    hLabel: "H1",
    level: 1,
    className: "text-base font-bold",
  },
  {
    label: () => i18n.t(($) => $.editor.headings.section),
    hLabel: "H2",
    level: 2,
    className: "text-base font-bold",
  },
  {
    label: () => i18n.t(($) => $.editor.headings.subsection),
    hLabel: "H3",
    level: 3,
    className: "text-sm font-bold",
  },
  {
    label: () => i18n.t(($) => $.editor.headings.subsubsection),
    hLabel: "H4",
    level: 4,
    className: "text-sm font-semibold",
  },
  {
    label: () => i18n.t(($) => $.editor.headings.minor),
    hLabel: "H5",
    level: 5,
    className: "text-xs font-semibold",
  },
  {
    label: () => i18n.t(($) => $.editor.headings.paragraphHeading),
    hLabel: "H6",
    level: 6,
    className: "text-xs font-medium",
  },
];

export function visualLinkHref(typed: string): string {
  const path = /^<(.*)>$/su.exec(typed)?.[1].trim() ?? typed;
  const local = localizedVisualHref(path);
  if (local !== null) return local;
  if (isUrlWithScheme(path)) return path;
  const hash = path.indexOf("#");
  return hash < 0 ? linkHrefForPath(path) : linkHrefForPath(path.slice(0, hash), path.slice(hash));
}
