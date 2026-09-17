import { InlineWidget } from "./base";

export type EnvironmentEdge = "begin" | "end";

function environmentClass(environment: string): string {
  return `ofl-visual-environment-${environment.replace(/[^\w-]/gu, "")}`;
}

export class EnvironmentLineWidget extends InlineWidget {
  constructor(
    readonly environment: string,
    readonly edge: EnvironmentEdge,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.classList.add(environmentClass(this.environment), "ofl-visual-environment-edge");
    const line = document.createElement("div");
    line.classList.add("ofl-visual-environment-line", environmentClass(this.environment));
    if (this.edge === "begin") {
      element.classList.add("ofl-visual-environment-top");
      line.classList.add("ofl-visual-environment-first-line");
    } else {
      element.classList.add("ofl-visual-environment-bottom");
      line.classList.add("ofl-visual-environment-last-line");
    }
    element.append(line);
    return element;
  }

  eq(other: EnvironmentLineWidget): boolean {
    return other.environment === this.environment && other.edge === this.edge;
  }
}
