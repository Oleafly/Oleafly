import { renderMathSource } from "@oleafly/editor/math-render";
import type { AnyExtension } from "@tiptap/core";
import { Node as TiptapNode } from "@tiptap/core";
import { buttonVariants } from "@/components/ui/button";
import { renderDiagram } from "@/components/ui/mermaid-diagram";
import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { paintChart } from "./chart-block";

function currentTheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function message(preview: HTMLElement, text: string): void {
  const paragraph = document.createElement("p");
  paragraph.className = "note-drawn-empty";
  paragraph.textContent = text;
  preview.replaceChildren(paragraph);
}

function paintMermaid(preview: HTMLElement, source: string): void {
  renderDiagram(source, currentTheme()).then(
    (svg) => preview.replaceChildren(svg.cloneNode(true)),
    () => message(preview, i18n.t(($) => $.notes.blocks.diagramError)),
  );
}

function paintLatex(preview: HTMLElement, source: string): void {
  const result = renderMathSource(source, true);
  if (result.status === "ready") preview.innerHTML = result.html;
  else message(preview, i18n.t(($) => $.notes.blocks.noPreview));
}

function paintTypst(preview: HTMLElement): void {
  message(preview, i18n.t(($) => $.notes.blocks.noPreview));
}

interface BlockKind {
  label: () => string;
  paint: (preview: HTMLElement, source: string) => void;
}

const KINDS: Record<string, BlockKind> = {
  chart: { label: () => i18n.t(($) => $.notes.blocks.chart), paint: paintChart },
  latex: { label: () => "LaTeX", paint: paintLatex },
  mermaid: { label: () => "Mermaid", paint: paintMermaid },
  typst: { label: () => "Typst", paint: paintTypst },
};

export function blockKindOf(info: string): keyof typeof KINDS | undefined {
  const name = info.trim().replace(/^\{=(.+)\}$/u, "$1");
  return Object.hasOwn(KINDS, name) ? name : undefined;
}

function toggleLabel(showingSource: boolean): string {
  return showingSource
    ? i18n.t(($) => $.notes.blocks.preview)
    : i18n.t(($) => $.notes.blocks.source);
}

export function withBlockViews(extension: AnyExtension): AnyExtension {
  if (!(extension instanceof TiptapNode) || extension.name !== "codeBlock") return extension;
  return extension.extend({
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("div");
        dom.className = "note-code";
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        pre.append(code);
        const language = String(node.attrs.language ?? "");
        const name = blockKindOf(language);
        if (!name) {
          dom.append(pre);
          return { dom, contentDOM: code };
        }
        const kind = KINDS[name];
        dom.classList.add("note-drawn");
        dom.dataset.block = name;
        const preview = document.createElement("div");
        preview.className = "note-drawn-preview";
        preview.contentEditable = "false";
        const label = document.createElement("span");
        label.className = "note-drawn-label";
        label.contentEditable = "false";
        label.textContent = kind.label();
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = cn(buttonVariants({ variant: "ghost", size: "xs" }), "note-drawn-toggle");
        toggle.contentEditable = "false";
        toggle.textContent = toggleLabel(false);
        toggle.setAttribute("aria-pressed", "false");
        toggle.addEventListener("mousedown", (event) => event.preventDefault());
        toggle.addEventListener("click", () => {
          const showingSource = dom.classList.toggle("note-drawn-source");
          toggle.textContent = toggleLabel(showingSource);
          toggle.setAttribute("aria-pressed", String(showingSource));
        });
        dom.append(label, toggle, preview, pre);
        kind.paint(preview, node.textContent);
        let painted = node.textContent;
        return {
          dom,
          contentDOM: code,
          update(next) {
            if (next.type !== node.type || next.attrs.language !== language) return false;
            if (next.textContent !== painted) {
              painted = next.textContent;
              kind.paint(preview, painted);
            }
            return true;
          },
          ignoreMutation: (mutation) => !code.contains(mutation.target),
        };
      };
    },
  });
}
