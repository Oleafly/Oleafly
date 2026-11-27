import type { SnippetLanguage } from "@oleafly/snippets";
import { completionSyntaxForPath } from "@/lib/document-engine";

export function snippetLanguageForPath(path: string | null): SnippetLanguage | null {
  const syntax = completionSyntaxForPath(path, "unknown");
  return syntax === "generic" ? null : syntax;
}
