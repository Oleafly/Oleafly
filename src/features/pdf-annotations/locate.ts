import type { SynctexRect } from "@oleafly/preview";
import type { CompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import type { PdfAnnotationSource } from "@/lib/tauri";
import { sourceExcerpt } from "./model";

interface PagePoint {
  page: number;
  x: number;
  y: number;
}

type LineAt = (
  page: number,
  x: number,
  y: number,
  checkpoint: CompileSuccessCheckpoint | null,
) => Promise<{ path: string | null; line: number } | null>;

type TextOf = (path: string) => string | null;

async function defaultLineAt(...args: Parameters<LineAt>): ReturnType<LineAt> {
  const { sourceLineAt } = await import("@/features/synctex");
  return sourceLineAt(...args);
}

async function defaultTextOf(path: string): Promise<string | null> {
  const { sourceText } = await import("@/features/synctex");
  return sourceText(path);
}

export function regionProbePoints(rect: SynctexRect): [PagePoint, PagePoint] {
  const x = rect.x + rect.width / 2;
  const inset = Math.min(2, rect.height / 4);
  return [
    { page: rect.page, x, y: rect.y + inset },
    { page: rect.page, x, y: rect.y + rect.height - inset },
  ];
}

export async function locateSource(
  start: PagePoint,
  end: PagePoint,
  checkpoint: CompileSuccessCheckpoint | null,
  lineAt: LineAt = defaultLineAt,
  textOf: TextOf | ((path: string) => Promise<string | null>) = defaultTextOf,
): Promise<PdfAnnotationSource | null> {
  const [first, last] = await Promise.all([
    lineAt(start.page, start.x, start.y, checkpoint),
    lineAt(end.page, end.x, end.y, checkpoint),
  ]);
  const anchor = first ?? last;
  if (!anchor?.path) return null;
  const sameFile = first && last && first.path === last.path;
  const startLine = sameFile ? Math.min(first.line, last.line) : anchor.line;
  const endLine = sameFile ? Math.max(first.line, last.line) : anchor.line;
  const text = await textOf(anchor.path);
  return {
    path: anchor.path,
    startLine,
    endLine,
    excerpt: text ? sourceExcerpt(text, startLine, endLine) : "",
  };
}
