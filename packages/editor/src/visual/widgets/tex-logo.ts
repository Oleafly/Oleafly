import { InlineWidget } from "./base";

function letter(text: string, tag: "sup" | "sub" | null): Node {
  if (!tag) return document.createTextNode(text);
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

export function buildTexLogo(element: HTMLElement, withLa: boolean): void {
  const parts: Node[] = withLa ? [letter("L", null), letter("a", "sup")] : [];
  parts.push(letter("T", null), letter("e", "sub"), letter("X", null));
  element.replaceChildren(...parts);
}

export class TexLogoWidget extends InlineWidget {
  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-tex";
    buildTexLogo(element, false);
    return element;
  }

  eq(): boolean {
    return true;
  }
}
