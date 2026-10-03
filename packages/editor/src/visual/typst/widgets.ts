import { InlineWidget } from "../widgets/base";

export class TypstTextWidget extends InlineWidget {
  constructor(
    readonly text: string,
    readonly className = "ofl-visual-typst-text",
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = this.className;
    element.textContent = this.text;
    return element;
  }

  eq(other: TypstTextWidget): boolean {
    return other.text === this.text && other.className === this.className;
  }

  updateDOM(element: HTMLElement): boolean {
    element.className = this.className;
    element.textContent = this.text;
    return true;
  }
}

export class RawLanguageWidget extends InlineWidget {
  constructor(readonly language: string) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-typst-raw-language";
    element.textContent = this.language;
    return element;
  }

  eq(other: RawLanguageWidget): boolean {
    return other.language === this.language;
  }

  updateDOM(element: HTMLElement): boolean {
    element.textContent = this.language;
    return true;
  }
}
