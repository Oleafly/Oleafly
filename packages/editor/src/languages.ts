import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { latexLanguage } from "./latex";

export function languageForPath(path: string): LanguageSupport | null {
  const p = path.toLowerCase();
  const base = p.slice(p.lastIndexOf("/") + 1);

  if (/\.(tex|sty|cls|ltx|bst)$/.test(p)) return latexLanguage();
  if (p.endsWith(".bib")) return new LanguageSupport(StreamLanguage.define(stex));
  if (p.endsWith(".json")) return json();
  if (/\.(md|markdown)$/.test(p)) return markdown();
  if (p.endsWith(".css")) return css();
  if (base === ".gitignore" || base.endsWith(".gitignore") || p.endsWith(".env"))
    return new LanguageSupport(StreamLanguage.define(properties));
  if (/\.(ya?ml)$/.test(p)) return new LanguageSupport(StreamLanguage.define(yaml));
  if (p.endsWith(".toml")) return new LanguageSupport(StreamLanguage.define(toml));
  if (/\.(sh|bash)$/.test(p) || base === "dockerfile" || p.endsWith(".dockerfile"))
    return base.startsWith("dockerfile")
      ? new LanguageSupport(StreamLanguage.define(dockerFile))
      : new LanguageSupport(StreamLanguage.define(shell));

  return null;
}
