import { InlineWidget } from "./base";
import { createIcon, type VisualIcon } from "./icons";

export class IconBraceWidget extends InlineWidget {
  constructor(
    readonly icon: VisualIcon,
    readonly content = "",
    readonly title = "",
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-brace ofl-visual-icon-brace";
    this.fill(element);
    return element;
  }

  eq(other: IconBraceWidget): boolean {
    return other.icon === this.icon && other.content === this.content && other.title === this.title;
  }

  updateDOM(element: HTMLElement): boolean {
    this.fill(element);
    return true;
  }

  private fill(element: HTMLElement): void {
    element.replaceChildren(createIcon(this.icon, "ofl-visual-icon"), document.createTextNode(this.content));
    if (this.title) element.title = this.title;
    else element.removeAttribute("title");
  }
}
