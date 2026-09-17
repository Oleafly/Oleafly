import type { ListEnvironmentName } from "../../latex-tree";
import { InlineWidget } from "./base";

const BULLET_STYLES = ["disc", "circle", "square"];
const NUMBER_STYLES = ["decimal", "lower-alpha", "lower-roman", "upper-alpha"];

export class ItemWidget extends InlineWidget {
  readonly listStyle: string;
  readonly suffix: string;

  constructor(
    readonly environment: ListEnvironmentName,
    readonly ordinal: number,
    readonly depth: number,
  ) {
    super();
    const ordered = environment !== "itemize";
    const styles = ordered ? NUMBER_STYLES : BULLET_STYLES;
    this.listStyle = styles[(Math.max(depth, 1) - 1) % styles.length];
    this.suffix = ordered ? "'. '" : "' '";
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-item";
    element.textContent = " ";
    this.applyProperties(element);
    return element;
  }

  eq(other: ItemWidget): boolean {
    return (
      other.environment === this.environment && other.ordinal === this.ordinal && other.depth === this.depth
    );
  }

  updateDOM(element: HTMLElement): boolean {
    this.applyProperties(element);
    return true;
  }

  private applyProperties(element: HTMLElement): void {
    element.style.setProperty("--ofl-list-depth", String(this.depth));
    element.style.setProperty("--ofl-list-ordinal", String(this.ordinal));
    element.style.setProperty("--ofl-list-style", this.listStyle);
    element.style.setProperty("--ofl-list-suffix", this.suffix);
  }
}
