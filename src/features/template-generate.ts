import { generateText } from "ai";
import { buildModel, hasConfiguredProvider, resolveActiveModel } from "@/lib/ai-providers";
import { pdfPageToPng } from "@/lib/pdf-image";
import {
  compileIsolated,
  deleteCustomTemplate,
  getConfig,
  getOrCreateScratchProject,
  readIsolatedPdf,
  saveCustomTemplate,
} from "@/lib/tauri";

const SYSTEM = [
  "You create document templates for a LaTeX/Typst/Markdown editor.",
  'Return ONLY one JSON object, no markdown fences, with exactly these fields:',
  '{"slug": string, "name": string, "description": string, "category": string,',
  '"tags": string[], "engine": "xetex" | "typst" | "markdown", "main_doc": string, "source": string}.',
  "tags is 2 to 4 short lowercase layout features, e.g. [\"two column\", \"abstract\"].",
  "slug is lowercase kebab-case. main_doc matches the engine (main.tex, main.typ, main.md).",
  "source is a COMPLETE compilable document with placeholder content a user edits.",
  "For LaTeX it must compile under Tectonic without shell escape. Never use em dashes.",
  "LaTeX safety rules: if you use any color expression (e.g. blue!50!black) you MUST load xcolor",
  "before it is referenced; prefer no colors at all. Stick to widely available packages",
  "(geometry, graphicx, hyperref, xcolor, booktabs, enumitem, titlesec, caption, microtype,",
  "amsmath, lipsum). Every environment and command you reference must be defined.",
].join(" ");

export interface ParsedTemplate {
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
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
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string").slice(0, 4)
      : [],
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

export async function generateTemplateSource(
  description: string,
  override?: { providerId: string; modelId: string },
): Promise<ParsedTemplate> {
  const cfg = await getConfig();
  let model: ReturnType<typeof buildModel>;
  if (override) {
    const credential = cfg.ai_keys?.[override.providerId] ?? "";
    const customBaseURL = cfg.ai_custom_providers?.find(
      (c) => c.id === override.providerId,
    )?.baseURL;
    model = buildModel(override.providerId, override.modelId, credential, customBaseURL);
  } else {
    model = resolveActiveModel(cfg).model;
  }
  const { text } = await generateText({
    model,
    system: SYSTEM,
    prompt: `Create a template for: ${description}`,
    abortSignal: AbortSignal.timeout(45_000),
  });
  return parseGeneratedTemplate(text);
}

export async function compileGeneratedTemplate(
  parsed: ParsedTemplate,
): Promise<{ png: string | null; log: string }> {
  if (parsed.engine !== "xetex") {
    return { png: null, log: "" };
  }
  const scratchId = await getOrCreateScratchProject();
  const res = await compileIsolated(scratchId, parsed.source);
  const log = (res.log ?? "").slice(-2000);
  if (!res.has_pdf) return { png: null, log };
  const bytes = new Uint8Array(await readIsolatedPdf(scratchId));
  const png = await pdfPageToPng(bytes, 1, 1.5, "#ffffff");
  return { png, log };
}

export async function saveGeneratedTemplate(
  parsed: ParsedTemplate,
  previewPng?: string | null,
): Promise<void> {
  const manifest = {
    id: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    category: "AI Generated",
    engine: parsed.engine,
    main_doc: parsed.mainDoc,
    license: { spdx: "CC0-1.0", author: "AI generated", url: "" },
  };
  const files: { name: string; content: string; content_base64?: string }[] = [
    { name: parsed.mainDoc, content: parsed.source },
  ];
  const b64 = previewPng?.startsWith("data:image/png;base64,")
    ? previewPng.slice("data:image/png;base64,".length)
    : null;
  if (b64) files.push({ name: "preview.png", content: "", content_base64: b64 });
  await saveCustomTemplate(parsed.slug, JSON.stringify(manifest, null, 2), files);
}

export async function deleteGeneratedTemplate(slug: string): Promise<void> {
  await deleteCustomTemplate(slug);
}
