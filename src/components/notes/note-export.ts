import { zipSync } from "fflate";
import { i18n } from "@/i18n";
import { base64ToBytes, bytesToBase64, textToBase64 } from "@/lib/base64";
import { frontMatterBody } from "@/lib/front-matter";
import { pickSavePath } from "@/lib/native-file-dialog";
import { basename, exportFileStem } from "@/lib/path-utils";
import { type AdHocConversionResult, readProjectBytes, revealInDir, writeBytesFile } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { citationGroups, referenceLine } from "./note-citations";
import { notePaperText, type PaperFormat, type PaperText } from "./note-to-paper";
import { usepackageLine } from "@/lib/latex-package-index";
import type { LatexPackage } from "./tikz-source";
import type { CitationItem } from "./types";

export type NoteExportFormat = "docx" | "html" | "latex" | "typst";

interface ExportTarget {
  readonly extension: string;
  readonly kind: string;
  readonly syntax: PaperFormat;
  readonly inline: boolean;
  readonly raster: boolean;
  readonly rawLatex?: boolean;
}

const TARGETS: Readonly<Record<NoteExportFormat, ExportTarget>> = {
  docx: { extension: "docx", kind: "Word", syntax: "markdown", inline: true, raster: true },
  html: { extension: "html", kind: "HTML", syntax: "markdown", inline: true, raster: false },
  latex: { extension: "tex", kind: "LaTeX", syntax: "markdown", inline: false, raster: true, rawLatex: true },
  typst: { extension: "typ", kind: "Typst", syntax: "typst", inline: false, raster: false },
};

const EXPORT_TOAST_KEY = "note-export";

interface NoteExportSource {
  readonly noteId: string;
  readonly shared?: boolean;
  readonly title: string;
  readonly text: string;
  readonly citations: readonly CitationItem[];
}

function escapedMarkdown(text: string): string {
  return text.replaceAll(/[\\[\]*_`<>@#]/gu, (character) => `\\${character}`);
}

function referencesSection(body: string, entries: ReadonlyMap<string, CitationItem>): string {
  const cited = [...new Set(citationGroups(body).flatMap((group) => group.items.map((item) => item.key)))].flatMap((key) => {
    const entry = entries.get(key);
    return entry ? [entry] : [];
  });
  if (cited.length === 0) return "";
  const lines = cited.map((entry) => `- ${escapedMarkdown(referenceLine(entry))}`);
  return `\n\n## ${i18n.t(($) => $.notes.citations.references)}\n\n${lines.join("\n")}\n`;
}

function headerIncludes(packages: readonly LatexPackage[]): string {
  if (packages.length === 0) return "";
  const lines = packages.map((entry) => `    ${usepackageLine(entry.name, entry.options)}`).join("\n");
  return `header-includes:\n  - |\n    \`\`\`{=latex}\n${lines}\n    \`\`\`\n`;
}

interface PreparedNote {
  readonly stem: string;
  readonly document: string;
  readonly text: string;
  readonly files: PaperText["files"];
}

export async function prepareNote(source: NoteExportSource, format: NoteExportFormat): Promise<PreparedNote> {
  const target = TARGETS[format];
  const stem = exportFileStem(source.title, "note");
  const document = `${stem}.${target.extension}`;
  const entries = new Map(source.citations.map((entry) => [entry.key, entry]));
  const body = frontMatterBody(source.text);
  const read = async (path: string) => new Uint8Array(await readProjectBytes(source.noteId, path));
  const prepared = await notePaperText(body, read, {
    format: target.syntax,
    folder: "figures",
    from: document,
    taken: () => false,
    inline: target.inline,
    raster: target.raster,
    rawLatex: target.rawLatex,
    shared: source.shared,
    citations: { kind: "labels", entries },
  });
  const text = `---\ntitle: ${JSON.stringify(source.title)}\n${headerIncludes(prepared.packages)}---\n\n${prepared.text}${referencesSection(body, entries)}`;
  return { stem, document, text, files: prepared.files };
}

export async function convertNote(text: string, format: NoteExportFormat): Promise<AdHocConversionResult> {
  const { pandocConvert } = await import("@/features/tools-ai/pandoc-text");
  return pandocConvert({ source: "markdown-note", target: format, text });
}

export async function exportNote(source: NoteExportSource, format: NoteExportFormat): Promise<string | null> {
  const target = TARGETS[format];
  const { stem, document, text, files } = await prepareNote(source, format);
  const bundled = files.length > 0;
  const extension = bundled ? "zip" : target.extension;
  const destination = await pickSavePath({
    defaultPath: `${stem}.${extension}`,
    filters: [{ name: bundled ? "ZIP" : target.kind, extensions: [extension] }],
  });
  if (!destination) return null;
  const converted = await convertNote(text, format);
  const output = converted.dataBase64 ?? textToBase64(converted.text ?? "");
  const data = bundled
    ? bytesToBase64(
        zipSync({
          [document]: base64ToBytes(output),
          ...Object.fromEntries(files.map((file) => [file.path, base64ToBytes(file.dataBase64)])),
        }),
      )
    : output;
  await writeBytesFile(destination, data);
  toast.successUnique(
    EXPORT_TOAST_KEY,
    i18n.t(($) => $.core.export.saved, { kind: target.kind, fileName: basename(destination) }),
    { label: i18n.t(($) => $.core.export.showInFolder), onClick: () => void revealInDir(destination).catch(() => toast.info(i18n.t(($) => $.core.export.revealFailed))) },
    true,
  );
  return destination;
}
