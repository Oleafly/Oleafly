import { parseSnippetFile } from "../file";
import { buildLibrary, type LibraryInput, type SnippetLibrary } from "../library";
import type { LayerId, ParsedSnippetFile } from "../types";

export function snippetFile(collection: string, layer: LayerId, entries: Record<string, unknown>): ParsedSnippetFile {
  const file = parseSnippetFile(JSON.stringify(entries), collection, layer);
  const errors = file.problems.filter((problem) => problem.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((problem) => problem.message).join("\n"));
  return file;
}

export function library(files: ParsedSnippetFile[], options: Partial<Omit<LibraryInput, "files">> = {}): SnippetLibrary {
  return buildLibrary({
    files,
    disabledCollections: options.disabledCollections ?? new Set(),
    overrides: options.overrides ?? [],
    disabledRegex: options.disabledRegex ?? new Set(),
  });
}
