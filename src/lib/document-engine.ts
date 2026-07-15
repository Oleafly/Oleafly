import type { DocumentEngineDescriptor, EngineCapabilities } from "@/lib/tauri";

export const LATEX_ENGINE: DocumentEngineDescriptor = {
  id: "latex",
  label: "LaTeX",
  source_format: "latex",
  main_document: "main.tex",
  source_extensions: ["tex", "ltx", "latex"],
  capabilities: {
    produces_pdf: true,
    supports_synctex: true,
    supports_offline: true,
    supports_isolated_compile: true,
    formatting_profile: "latex",
    source_preflight_profile: "latex",
    features: ["citations", "document_index"],
    conversion_exports: ["docx", "html", "md", "txt", "pptx", "epub"],
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
    notice: `${engine.label} does not expose an offline compiler mode. Compiling normally.`,
  };
}

export const isLatexEngine = (engine: DocumentEngineDescriptor) =>
  engine.capabilities.formatting_profile === "latex";

export const pathUsesEngineSource = (
  engine: DocumentEngineDescriptor,
  path: string | null,
) => {
  const extension = path?.split(".").pop()?.toLowerCase();
  return !!extension && engine.source_extensions.includes(extension);
};

export const canUseFigureMode = (engine: DocumentEngineDescriptor, engineLoaded = true) =>
  engineLoaded &&
  engine.capabilities.formatting_profile === "latex" &&
  engine.capabilities.supports_isolated_compile;

export type EngineFormattingAction = "bold" | "italic" | "section" | "list";
export type EngineFormatting =
  | { kind: "wrap"; before: string; after: string }
  | { kind: "insert"; text: string };

export function formattingForEngine(
  engine: DocumentEngineDescriptor,
  engineLoaded: boolean,
  action: EngineFormattingAction,
): EngineFormatting | null {
  if (!engineLoaded || engine.capabilities.formatting_profile === "none") return null;
  const typst = engine.capabilities.formatting_profile === "typst";
  const markdown = engine.capabilities.formatting_profile === "markdown";
  switch (action) {
    case "bold":
      return { kind: "wrap", before: typst ? "*" : markdown ? "**" : "\\textbf{", after: typst ? "*" : markdown ? "**" : "}" };
    case "italic":
      return { kind: "wrap", before: typst ? "_" : markdown ? "*" : "\\textit{", after: typst ? "_" : markdown ? "*" : "}" };
    case "section":
      return { kind: "insert", text: typst ? "= Heading\n" : markdown ? "# Heading\n" : "\\section{}\n" };
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
