import { InlineWidget } from "./base";

const FULL_WIDTH = /\\(?:textwidth|linewidth|columnwidth|hsize)\b/u;
const LENGTH = /^\s*(-?\d*\.?\d+)\s*(pt|cm|mm|in|em|ex|px)\s*$/u;

function cssLength(argument: string | undefined, fallback: string): string {
  if (!argument) return fallback;
  if (FULL_WIDTH.test(argument)) return "100%";
  const match = LENGTH.exec(argument);
  return match ? `${match[1]}${match[2]}` : fallback;
}

export class RuleWidget extends InlineWidget {
  constructor(
    readonly width: string,
    readonly height: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-rule";
    this.applyStyle(element);
    return element;
  }

  eq(other: RuleWidget): boolean {
    return other.width === this.width && other.height === this.height;
  }

  updateDOM(element: HTMLElement): boolean {
    this.applyStyle(element);
    return true;
  }

  private applyStyle(element: HTMLElement): void {
    element.style.width = this.width;
    element.style.borderTopWidth = this.height;
  }
}

export function ruleWidgetFor(command: string, args: readonly string[]): RuleWidget {
  const stripped = args.map((argument) => argument.replace(/^\{|\}$/gu, ""));
  if (command === "\\rule") return new RuleWidget(cssLength(stripped[0], "2em"), cssLength(stripped[1], "1px"));
  return new RuleWidget("100%", "0.4pt");
}
