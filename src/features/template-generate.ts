import { generateText } from "ai";
import type { GeneratedPreview } from "@oleafly/templates";
import { hasConfiguredProvider, resolveActiveModel } from "@/lib/ai-providers";
import { pdfPageToPng } from "@/lib/pdf-image";
import {
  compileIsolated,
  getConfig,
  readIsolatedPdf,
  saveCustomTemplate,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";

const SYSTEM = [
  "You create document templates for a LaTeX/Typst/Markdown editor.",
  'Return ONLY one JSON object, no markdown fences, with exactly these fields:',
  '{"slug": string, "name": string, "description": string, "category": string,',
  '"engine": "xetex" | "typst" | "markdown", "main_doc": string, "source": string}.',
  "slug is lowercase kebab-case. main_doc matches the engine (main.tex, main.typ, main.md).",
  "source is a COMPLETE compilable document with placeholder content a user edits.",
  "For LaTeX it must compile under Tectonic without shell escape. Never use em dashes.",
].join(" ");

export interface ParsedTemplate {
  slug: string;
  name: string;
  description: string;
  category: string;
  engine: "xetex" | "typst" | "markdown";
  mainDoc: string;
  source: string;
}

const ENGINES = new Set(["xetex", "typst", "markdown"]);

export function parseGeneratedTemplate(text: string): ParsedTemplate {
  const stripped = text
    .replace(/^```[a-zA-Z]*\n?/gm, "")
    .replace(/```\s*$/gm, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in response");
  const raw = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
  const engine = String(raw.engine ?? "");
  if (!ENGINES.has(engine)) throw new Error(`unsupported engine: ${engine}`);
  const slug = String(raw.slug ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("missing slug");
  const source = String(raw.source ?? "");
  if (!source.trim()) throw new Error("missing source");
  return {
    slug,
    name: String(raw.name ?? slug),
    description: String(raw.description ?? ""),
    category: String(raw.category ?? "Custom"),
    engine: engine as ParsedTemplate["engine"],
    mainDoc: String(raw.main_doc ?? (engine === "typst" ? "main.typ" : engine === "markdown" ? "main.md" : "main.tex")),
    source,
  };
}

export async function generateTemplateAvailable(): Promise<boolean> {
  try {
    return hasConfiguredProvider(await getConfig());
  } catch {
    return false;
  }
}

export async function generateTemplate(description: string): Promise<GeneratedPreview> {
  const cfg = await getConfig();
  const { model } = resolveActiveModel(cfg);
  const projectId = useFilesStore.getState().projectId;
  let parsed: ParsedTemplate | null = null;
  let log = "";
  let previewPng: string | null = null;
  let prompt = `Create a template for: ${description}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { text } = await generateText({ model, system: SYSTEM, prompt });
    const candidate = parseGeneratedTemplate(text);
    if (candidate.engine !== "xetex" || !projectId) {
      parsed = candidate;
      break;
    }
    const res = await compileIsolated(projectId, candidate.source);
    log = (res.log ?? "").slice(-2000);
    if (res.has_pdf) {
      parsed = candidate;
      try {
        const bytes = new Uint8Array(await readIsolatedPdf(projectId));
        previewPng = await pdfPageToPng(bytes, 1, 1.5, "#ffffff");
      } catch {
        previewPng = null;
      }
      break;
    }
    prompt = [
      `Create a template for: ${description}`,
      "The previous attempt failed to compile. Fix it and return the full JSON again.",
      `COMPILE LOG TAIL:\n${log}`,
      `PREVIOUS SOURCE:\n${candidate.source}`,
    ].join("\n\n");
  }
  if (!parsed) {
    throw new Error(`The generated template did not compile after 3 attempts. ${log}`);
  }
  const final = parsed;
  const manifest = {
    id: final.slug,
    name: final.name,
    description: final.description,
    category: final.category,
    engine: final.engine,
    main_doc: final.mainDoc,
    license: { spdx: "CC0-1.0", author: "AI generated", url: "" },
  };
  return {
    name: final.name,
    previewPng,
    log,
    save: () =>
      saveCustomTemplate(final.slug, JSON.stringify(manifest, null, 2), [
        { name: final.mainDoc, content: final.source },
      ]),
  };
}
