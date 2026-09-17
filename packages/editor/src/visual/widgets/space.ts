import { InlineWidget } from "./base";

const THIN = "calc(3em / 18)";
const MEDIUM = "calc(4em / 18)";
const THICK = "calc(5em / 18)";

const WIDTHS: Record<string, string> = {
  thinspace: THIN,
  ",": THIN,
  negthinspace: `calc(-1 * ${THIN})`,
  "!": `calc(-1 * ${THIN})`,
  medspace: MEDIUM,
  ":": MEDIUM,
  ">": MEDIUM,
  thickspace: THICK,
  ";": THICK,
  negthickspace: `calc(-1 * ${THICK})`,
  enspace: "0.5em",
  enskip: "0.5em",
  quad: "1em",
  qquad: "2em",
};

function widthKey(command: string): string {
  return command.startsWith("\\") ? command.slice(1) : command;
}

export function spaceWidthFor(command: string): string | undefined {
  return WIDTHS[widthKey(command)];
}

export function hasSpaceSubstitution(command: string): boolean {
  return spaceWidthFor(command) !== undefined;
}

export class SpaceWidget extends InlineWidget {
  constructor(readonly width: string) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-space";
    element.style.width = this.width;
    return element;
  }

  eq(other: SpaceWidget): boolean {
    return other.width === this.width;
  }

  updateDOM(element: HTMLElement): boolean {
    element.style.width = this.width;
    return true;
  }
}

export function createSpaceWidget(command: string): SpaceWidget | null {
  const width = spaceWidthFor(command);
  return width === undefined ? null : new SpaceWidget(width);
}
