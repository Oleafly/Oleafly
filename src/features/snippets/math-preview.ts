import { loadedMathRender, loadMathRender, type MathRenderModule } from "@oleafly/editor/math-render-loader";
import type { SnippetLanguage } from "@oleafly/snippets";

function paintMath(element: HTMLElement, source: string, language: SnippetLanguage, render: MathRenderModule): void {
  if (language === "typst") {
    render.paintTypstMath(element, source, render.typstMathTheme(element));
    return;
  }
  const result = render.renderMathSource(source, true);
  if (result.status === "ready") element.innerHTML = result.html;
  else element.remove();
}

export function renderSnippetMath(source: string, language: SnippetLanguage): HTMLElement | null {
  if (!source.trim()) return null;
  const element = document.createElement("div");
  element.className = "overflow-x-auto";
  const loaded = loadedMathRender();
  if (loaded) paintMath(element, source, language, loaded);
  else
    loadMathRender().then(
      (render) => paintMath(element, source, language, render),
      () => element.remove(),
    );
  return element;
}
