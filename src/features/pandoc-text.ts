import { ensurePandoc } from "@/features/pandoc";
import { i18n } from "@/i18n";
import { convertAdHoc, type AdHocConversionRequest, type AdHocConversionResult } from "@/lib/tauri";

export async function pandocConvert(request: AdHocConversionRequest): Promise<AdHocConversionResult> {
  if (!(await ensurePandoc({ notify: true }))) {
    throw new Error(i18n.t(($) => $.researchTools.converterErrors.pandocNotReady));
  }
  return convertAdHoc(request);
}

function displayMathBody(text: string): string {
  if (text.length < 2 || !text.startsWith("$") || !text.endsWith("$")) return "";
  return text.slice(1, -1).trim();
}

async function pandocLatexMathToTypst(latex: string): Promise<string> {
  const converted = await pandocConvert({ source: "equation", target: "typst", text: String.raw`\[ ${latex} \]` });
  const body = displayMathBody((converted.text ?? "").trim());
  if (!body) {
    throw new Error(i18n.t(($) => $.researchTools.converterErrors.equationToTypst));
  }
  return body;
}

export async function latexMathToTypst(
  latex: string,
  typstVersion: string | null | undefined,
): Promise<string> {
  const { convertLatexMath } = await import("@oleafly/editor/latex-to-typst-math");
  const translated = convertLatexMath(latex, { typstVersion });
  if (translated.typst && translated.unsupported.length === 0) return translated.typst;
  return pandocLatexMathToTypst(latex);
}
