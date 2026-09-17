import { InlineWidget } from "./base";
import { buildTexLogo } from "./tex-logo";

export class LatexLogoWidget extends InlineWidget {
  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-tex";
    buildTexLogo(element, true);
    return element;
  }

  eq(): boolean {
    return true;
  }
}
