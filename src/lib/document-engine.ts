import type { CompletionSyntax } from "@oleafly/editor";
import { i18n } from "@/i18n";
import type { DocumentEngineDescriptor, EngineCapabilities } from "@/lib/tauri";

export const LATEX_ENGINE: DocumentEngineDescriptor = {
  id: "latex",
  label: "LaTeX",
  source_format: "latex",
  main_document: "main.tex",
  source_extensions: ["tex", "ltx", "latex"],
  allow_shell_escape: false,
  capabilities: {
    produces_pdf: true,
    supports_synctex: true,
    supports_offline: true,
    supports_isolated_compile: true,
    formatting_profile: "latex",
    source_preflight_profile: "latex",
    features: ["citations", "document_index"],
    conversion_exports: ["docx", "html", "md", "txt", "pptx", "epub", "typst"],
    template_kinds: ["document", "image"],
    compiler_prerequisite: null,
  },
};

export const UNKNOWN_ENGINE: DocumentEngineDescriptor = {
  id: "unknown",
  label: "Unknown",
  source_format: "unknown",
  main_document: "",
  source_extensions: [],
  allow_shell_escape: false,
  capabilities: {
    produces_pdf: false,
    supports_synctex: false,
    supports_offline: false,
    supports_isolated_compile: false,
    formatting_profile: "none",
    source_preflight_profile: "none",
    features: [],
    conversion_exports: [],
    template_kinds: [],
    compiler_prerequisite: null,
  },
};

export function compileOfflineForEngine(
  engine: DocumentEngineDescriptor,
  requestedOffline: boolean,
): { offline: boolean; notice: string | null } {
  if (!requestedOffline || engine.capabilities.supports_offline) {
    return { offline: requestedOffline, notice: null };
  }
  return {
    offline: false,
    notice: i18n.t(($) => $.core.compile.noOfflineMode, { engine: engine.label }),
  };
}

export const isLatexEngine = (engine: DocumentEngineDescriptor) =>
  engine.capabilities.formatting_profile === "latex";

export interface EngineCompileSettings {
  readonly syntaxCheck: boolean;
  readonly draftMode: boolean;
  readonly stopOnFirstError: boolean;
}

export const compileSettingsForEngine = (
  engine: DocumentEngineDescriptor,
): EngineCompileSettings => ({
  syntaxCheck: isLatexEngine(engine),
  draftMode: engine.id === "latex",
  stopOnFirstError: isLatexEngine(engine),
});

export const pathUsesEngineSource = (
  engine: DocumentEngineDescriptor,
  path: string | null,
) => {
  const extension = path?.split(".").pop()?.toLowerCase();
  return !!extension && engine.source_extensions.includes(extension);
};

export const engineSyncsPath = (
  engine: DocumentEngineDescriptor,
  path: string | null,
) => engine.capabilities.supports_synctex && (path === null || pathUsesEngineSource(engine, path));

export type FigureToolEngine = "latex" | "typst";

export function figureToolEngine(
  engine: DocumentEngineDescriptor,
  engineLoaded = true,
): FigureToolEngine | null {
  if (!engineLoaded) return null;
  const profile = engine.capabilities.formatting_profile;
  if (profile === "latex") return engine.capabilities.supports_isolated_compile ? "latex" : null;
  return profile === "typst" ? "typst" : null;
}

export const supportsFigureTools = (engine: DocumentEngineDescriptor, engineLoaded = true) =>
  figureToolEngine(engine, engineLoaded) !== null;

export type EngineFormattingAction = "bold" | "italic" | "section" | "list";
export type EngineFormatting =
  | { kind: "wrap"; before: string; after: string }
  | { kind: "insert"; text: string };

export type FormattingProfile = EngineCapabilities["formatting_profile"];
export type SourceLanguage = Exclude<FormattingProfile, "none">;

const SOURCE_LANGUAGE_BY_EXTENSION: ReadonlyMap<string, SourceLanguage> = new Map([
  ["typ", "typst"],
  ["tex", "latex"],
  ["ltx", "latex"],
  ["latex", "latex"],
  ["md", "markdown"],
  ["markdown", "markdown"],
]);

export function sourceLanguageForPath(path: string | null): SourceLanguage | null {
  const name = path?.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return SOURCE_LANGUAGE_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? null;
}

export function completionSyntaxForPath(
  path: string | null,
  sourceFormat: DocumentEngineDescriptor["source_format"],
): CompletionSyntax {
  if (path && /\.bib$/iu.test(path)) return "bibtex";
  if (path && /\.(?:sty|cls)$/iu.test(path)) return "latex";
  const language = sourceLanguageForPath(path);
  if (language) return language;
  return sourceFormat === "latex" || sourceFormat === "markdown" || sourceFormat === "typst"
    ? sourceFormat
    : "generic";
}

export function formattingProfileForPath(
  engine: DocumentEngineDescriptor,
  engineLoaded: boolean,
  path: string | null,
): FormattingProfile {
  const language = sourceLanguageForPath(path);
  if (language) return language;
  return engineLoaded && pathUsesEngineSource(engine, path)
    ? engine.capabilities.formatting_profile
    : "none";
}

export function formattingForPath(
  engine: DocumentEngineDescriptor,
  engineLoaded: boolean,
  path: string | null,
  action: EngineFormattingAction,
): EngineFormatting | null {
  return formattingForProfile(formattingProfileForPath(engine, engineLoaded, path), action);
}

export function formattingForEngine(
  engine: DocumentEngineDescriptor,
  engineLoaded: boolean,
  action: EngineFormattingAction,
): EngineFormatting | null {
  if (!engineLoaded) return null;
  return formattingForProfile(engine.capabilities.formatting_profile, action);
}

function formattingForProfile(
  profile: FormattingProfile,
  action: EngineFormattingAction,
): EngineFormatting | null {
  if (profile === "none") return null;
  const typst = profile === "typst";
  const markdown = profile === "markdown";
  const byProfile = (typstText: string, markdownText: string, latexText: string): string => {
    if (typst) return typstText;
    if (markdown) return markdownText;
    return latexText;
  };
  switch (action) {
    case "bold":
      return { kind: "wrap", before: byProfile("*", "**", String.raw`\textbf{`), after: byProfile("*", "**", "}") };
    case "italic":
      return { kind: "wrap", before: byProfile("_", "*", String.raw`\textit{`), after: byProfile("_", "*", "}") };
    case "section":
      return { kind: "insert", text: byProfile("= Heading\n", "# Heading\n", "\\section{}\n") };
    case "list":
      return {
        kind: "insert",
        text: typst || markdown ? "- Item\n" : "\\begin{itemize}\n  \\item \n\\end{itemize}\n",
      };
  }
}

export const hasEngineFeature = (
  engine: DocumentEngineDescriptor,
  feature: EngineCapabilities["features"][number],
) => engine.capabilities.features.includes(feature);

export const engineExports = (engine: DocumentEngineDescriptor) =>
  engine.capabilities.conversion_exports;
