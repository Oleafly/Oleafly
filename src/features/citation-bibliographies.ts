import { readFileContent } from "@/lib/tauri";
import {
  declaredBibliographyFiles,
  preferredBibliography,
  rememberedBibliography,
} from "@/lib/citation/bibliography-choices";
import { isHayagrivaPath } from "@/lib/citation/hayagriva";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useFilesStore } from "@/store/files";

export async function citationBibliographyChoices(): Promise<string[]> {
  const files = useFilesStore.getState();
  const id = files.projectId;
  const profile = files.engine.capabilities.formatting_profile;
  if (!id || (profile !== "typst" && profile !== "latex")) return [];
  const mainDoc = profile === "latex" ? resolveEffectiveMainDoc().mainDoc : files.mainDoc;
  const main = files.files[mainDoc]?.content ?? (await readFileContent(id, mainDoc, true).catch(() => ""));
  if (useFilesStore.getState().projectId !== id) return [];
  const sourcePattern = profile === "typst" ? /\.typ$/i : /\.(?:tex|ltx)$/i;
  const others = Object.entries(files.files)
    .filter(([path]) => path !== mainDoc && sourcePattern.test(path))
    .map(([path, file]) => ({ file: path, content: file.content }));
  const writable = files.tree.filter((entry) => !entry.is_dir && !entry.read_only);
  return declaredBibliographyFiles(
    profile,
    [{ file: mainDoc, content: main }, ...others],
    writable.filter((entry) => entry.path.endsWith(".bib")).map((entry) => entry.path),
    profile === "typst" ? writable.filter((entry) => isHayagrivaPath(entry.path)).map((entry) => entry.path) : [],
  );
}

export async function preferredCitationBibliography(): Promise<string | null> {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) return null;
  const choices = await citationBibliographyChoices();
  if (choices.length < 2 || useFilesStore.getState().projectId !== projectId) return null;
  return preferredBibliography(choices, rememberedBibliography(projectId));
}
