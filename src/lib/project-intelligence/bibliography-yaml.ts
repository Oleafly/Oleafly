import { bibliographyCandidatePaths } from "@oleafly/latex";
import { isHayagrivaPath, looksLikeHayagriva } from "@/lib/citation/hayagriva";
import { typstBibliographySources } from "@/lib/citation/typst-bibliography";

export const MAX_BIBLIOGRAPHY_YAML_CHARACTERS = 1_000_000;

export function referencedBibliographyYaml(texts: Readonly<Record<string, string>>): Set<string> {
  const referenced = new Set<string>();
  for (const [file, text] of Object.entries(texts)) {
    if (!file.toLowerCase().endsWith(".typ")) continue;
    for (const raw of typstBibliographySources(text)) {
      if (!isHayagrivaPath(raw)) continue;
      for (const candidate of bibliographyCandidatePaths(raw, file, "typst")) referenced.add(candidate);
    }
  }
  return referenced;
}

export function acceptsBibliographyYaml(text: string, referenced: () => boolean): boolean {
  return text.length <= MAX_BIBLIOGRAPHY_YAML_CHARACTERS && (looksLikeHayagriva(text) || referenced());
}
