import type { ReactNode, SVGProps } from "react";

export type FileTypeIconKind =
  | "zip"
  | "pdf"
  | "png"
  | "docx"
  | "html"
  | "markdown"
  | "typst"
  | "latex"
  | "txt";

const GLYPHS: Readonly<Record<FileTypeIconKind, ReactNode>> = {
  zip: (
    <>
      <path d="M10 4h2" />
      <path d="M12 6.5h2" />
      <path d="M10 9h2" />
      <rect x="10" y="12" width="4" height="5.5" rx="1" />
      <path d="M12 14.5v1" />
    </>
  ),
  pdf: (
    <path d="M8.5 18.5c1.6-2.6 2.8-5.3 2.8-7 0-.9-.4-1.3-.8-1.3s-.9.4-.9 1.3c0 2.4 2.9 5.1 5.6 5.9.8.2 1.3 0 1.3-.5s-.5-.9-1.4-.9c-2.4 0-5.6 1.3-6.6 2.5z" />
  ),
  png: (
    <>
      <circle cx="10" cy="12.5" r="1.5" />
      <path d="m18 18.5-3-3-6 5" />
    </>
  ),
  docx: <path d="m7.5 12.5 1.6 6 2.9-4.6 2.9 4.6 1.6-6" />,
  html: (
    <>
      <path d="m9.5 13-2.5 2.5 2.5 2.5" />
      <path d="m14.5 13 2.5 2.5-2.5 2.5" />
      <path d="m12.8 12.5-1.6 6" />
    </>
  ),
  markdown: (
    <>
      <path d="M7 18.5v-5.5l2.5 3 2.5-3v5.5" />
      <path d="M15.5 13v5.5" />
      <path d="m13.5 16.5 2 2 2-2" />
    </>
  ),
  typst: (
    <>
      <path d="M11.5 11v5.5a2 2 0 0 0 2 2H15" />
      <path d="M9 13.5h5" />
    </>
  ),
  latex: (
    <>
      <path d="m8 12 2.5 6.5" />
      <path d="M15.5 12c-1 0-1.5.5-1.5 1.25v1.25c0 .6-.4 1-1 1 .6 0 1 .4 1 1v1.25c0 .75.5 1.25 1.5 1.25" />
    </>
  ),
  txt: (
    <>
      <path d="M8 13h8" />
      <path d="M8 16h8" />
      <path d="M8 19h5" />
    </>
  ),
};

export function FileTypeIcon({
  kind,
  className,
  ...props
}: SVGProps<SVGSVGElement> & Readonly<{ kind: FileTypeIconKind }>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-file-type={kind}
      className={className}
      {...props}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <g strokeWidth={1.75}>{GLYPHS[kind]}</g>
    </svg>
  );
}

const TARGET_KINDS: Readonly<Record<string, FileTypeIconKind>> = {
  docx: "docx",
  html: "html",
  markdown: "markdown",
  md: "markdown",
  typst: "typst",
  latex: "latex",
  tex: "latex",
  txt: "txt",
  pdf: "pdf",
  image: "png",
  png: "png",
  zip: "zip",
};

export function fileTypeIconKind(target: string): FileTypeIconKind {
  return TARGET_KINDS[target] ?? "txt";
}
