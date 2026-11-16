import { type LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { Compartment, type Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { latexLanguage } from "./latex";
import { typstLanguage } from "./typst";
import { bibtexLanguage } from "./bibtex";
import { markdownLanguage, quartoLanguage } from "./markdown";
import { codeChunkLanguage } from "./code-chunks";

export function languageForPath(path: string): LanguageSupport | null {
  const p = path.toLowerCase();
  const base = p.slice(p.lastIndexOf("/") + 1);

  if (/\.(tex|latex|sty|cls|ltx)$/.test(p)) return latexLanguage();
  if (p.endsWith(".typ")) return typstLanguage();
  if (p.endsWith(".bib")) return bibtexLanguage();
  if (/\.(json|ipynb)$/.test(p)) return json();
  if (/\.(md|markdown)$/.test(p)) return markdownLanguage();
  if (/\.(qmd|rmd)$/.test(p)) return quartoLanguage();
  if (/\.(css|scss)$/.test(p)) return css();
  if (/\.html?$/.test(p)) return html();
  if (/\.[cm]?jsx?$/.test(p)) return javascript({ jsx: p.endsWith("x") });
  if (/\.tsx?$/.test(p)) return javascript({ typescript: true, jsx: p.endsWith("x") });
  if (base === ".gitignore" || base.endsWith(".gitignore") || p.endsWith(".env"))
    return new LanguageSupport(StreamLanguage.define(properties));
  if (/\.(ya?ml)$/.test(p)) return new LanguageSupport(StreamLanguage.define(yaml));
  if (p.endsWith(".toml")) return new LanguageSupport(StreamLanguage.define(toml));
  if (base === "dockerfile" || p.endsWith(".dockerfile"))
    return new LanguageSupport(StreamLanguage.define(dockerFile));
  if (/\.(sh|bash)$/.test(p)) return new LanguageSupport(StreamLanguage.define(shell));

  return null;
}

function lazyLanguageForPath(path: string): LanguageDescription | null {
  const extension = /\.(py|r|jl)$/iu.exec(path)?.[1];
  return extension ? codeChunkLanguage(extension) : null;
}

function loadWhenShown(description: LanguageDescription): Extension {
  if (description.support) return description.support;
  const slot = new Compartment();
  return [
    slot.of([]),
    ViewPlugin.define((view) => {
      let shown = true;
      description
        .load()
        .then((support) => {
          if (shown) view.dispatch({ effects: slot.reconfigure(support) });
        })
        .catch(() => undefined);
      return {
        destroy() {
          shown = false;
        },
      };
    }),
  ];
}

export function editorLanguageForPath(path: string): Extension {
  const ready = languageForPath(path);
  if (ready) return ready;
  const lazy = lazyLanguageForPath(path);
  return lazy ? loadWhenShown(lazy) : [];
}
