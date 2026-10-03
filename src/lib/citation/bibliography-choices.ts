import {
  bibliographyDeclarations,
  bibliographyEngineForCommand,
  resolveBibliographyPath,
  type BibliographyEngine,
} from "@oleafly/latex";
import { maskComments } from "@/lib/index/parse-file";
import { readString, writeString } from "@/lib/local-storage";
import { typstBibliographyCalls } from "@/lib/citation/typst-bibliography";

export interface BibliographySourceText {
  readonly file: string;
  readonly content: string;
}

interface Declaration {
  readonly raw: string;
  readonly file: string;
  readonly engine: BibliographyEngine;
}

const STORAGE_PREFIX = "oleafly.citation.bibliography.";

function declarations(profile: string, source: BibliographySourceText): Declaration[] {
  if (profile === "typst") {
    return typstBibliographyCalls(source.content).flatMap((call) =>
      call.sources.map((item) => ({ raw: item.path, file: source.file, engine: "typst" as const })),
    );
  }
  if (profile === "latex") {
    return bibliographyDeclarations(maskComments(source.content)).map((declaration) => ({
      raw: declaration.raw,
      file: source.file,
      engine: bibliographyEngineForCommand(declaration.command),
    }));
  }
  return [];
}

export function declaredBibliographyFiles(
  profile: string,
  sources: readonly BibliographySourceText[],
  bibPaths: readonly string[],
  hayagrivaPaths: readonly string[] = [],
): string[] {
  const known = profile === "typst" ? [...bibPaths, ...hayagrivaPaths] : [...bibPaths];
  const found: string[] = [];
  for (const source of sources) {
    for (const declaration of declarations(profile, source)) {
      const path = resolveBibliographyPath(declaration.raw, declaration.file, known, declaration.engine);
      if (path && !found.includes(path)) found.push(path);
    }
  }
  return found;
}

export function rememberedBibliography(projectId: string): string | null {
  return readString(`${STORAGE_PREFIX}${projectId}`);
}

export function rememberBibliography(projectId: string, path: string): void {
  writeString(`${STORAGE_PREFIX}${projectId}`, path);
}

export function preferredBibliography(choices: readonly string[], remembered: string | null): string | null {
  if (remembered && choices.includes(remembered)) return remembered;
  return choices[0] ?? null;
}
