import type {
  StructTreeContent,
  StructTreeNode,
  TextContent,
  TextItem,
  TextMarkedContent,
} from "pdfjs-dist/types/src/display/api";

interface ScreenReaderText {
  byMarkedContent: Map<string, string>;
  plainText: string;
}

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return "str" in item;
}

function appendText(current: string, value: string, endOfLine = false): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return endOfLine && current ? `${current}\n` : current;
  const separator =
    !current || /[\s\n]$/u.test(current) || /^[,.;:!?%)}\]]/u.test(normalized)
      ? ""
      : " ";
  return `${current}${separator}${normalized}${endOfLine ? "\n" : ""}`;
}

export function extractPdfScreenReaderText(textContent: TextContent): ScreenReaderText {
  const byMarkedContent = new Map<string, string>();
  const activeMarkedContent: string[] = [];
  let plainText = "";

  for (const item of textContent.items) {
    if (isTextItem(item)) {
      plainText = appendText(plainText, item.str, item.hasEOL);
      const activeId = activeMarkedContent.at(-1);
      if (activeId) {
        byMarkedContent.set(
          activeId,
          appendText(byMarkedContent.get(activeId) ?? "", item.str, item.hasEOL),
        );
      }
      continue;
    }
    if (item.type === "endMarkedContent") {
      activeMarkedContent.pop();
    } else {
      activeMarkedContent.push(item.id);
    }
  }

  return {
    byMarkedContent,
    plainText: plainText.trim(),
  };
}

function elementForRole(role: string): HTMLElement {
  const normalizedRole = role.toUpperCase();
  const tag =
    /^H[1-6]$/u.test(normalizedRole)
      ? normalizedRole.toLowerCase()
      : ({
          P: "p",
          L: "ul",
          LI: "li",
          TABLE: "table",
          TR: "tr",
          TH: "th",
          TD: "td",
          BLOCKQUOTE: "blockquote",
          CODE: "code",
        } as Record<string, keyof HTMLElementTagNameMap>)[normalizedRole] ?? "div";
  const element = document.createElement(tag);
  if (/^h[1-6]$/u.test(tag)) {
    element.className = "mb-2 mt-5 text-base font-semibold first:mt-0";
  } else if (tag === "p") {
    element.className = "my-2 leading-6";
  } else if (tag === "ul") {
    element.className = "my-2 list-disc space-y-1 pl-5";
  } else if (tag === "table") {
    element.className = "my-3 w-full border-collapse text-left";
  } else if (tag === "th" || tag === "td") {
    element.className = "border p-2 align-top";
  } else if (tag === "blockquote") {
    element.className = "my-3 border-l-2 pl-3 text-muted-foreground";
  }
  return element;
}

function appendStructureNode(
  parent: HTMLElement,
  node: StructTreeNode | StructTreeContent,
  text: Map<string, string>,
): void {
  if (!("role" in node)) {
    const value = text.get(node.id)?.trim();
    if (value) parent.append(document.createTextNode(value));
    return;
  }
  const element = elementForRole(node.role);
  for (const child of node.children) appendStructureNode(element, child, text);
  if (element.textContent?.trim() || element.children.length) parent.appendChild(element);
}

export function createPdfScreenReaderLayer({
  pageNumber,
  totalPages,
  textContent,
  structureTree,
}: {
  pageNumber: number;
  totalPages: number;
  textContent: TextContent;
  structureTree?: StructTreeNode | null;
}): HTMLElement {
  const extracted = extractPdfScreenReaderText(textContent);
  const layer = document.createElement("section");
  layer.className =
    "pdf-screen-reader-layer absolute inset-0 z-10 overflow-auto bg-background text-foreground";
  layer.setAttribute("aria-label", `Screen reader view, page ${pageNumber} of ${totalPages}`);
  layer.tabIndex = 0;

  const header = document.createElement("header");
  header.className =
    "sticky top-0 z-10 flex items-center justify-between border-b bg-muted px-4 py-3 text-xs";
  const title = document.createElement("span");
  title.className = "font-medium";
  title.textContent = "Screen reader mode";
  const pageLabel = document.createElement("span");
  pageLabel.className = "text-muted-foreground";
  pageLabel.textContent = `Page ${pageNumber} of ${totalPages}`;
  header.append(title, pageLabel);

  const content = document.createElement("article");
  content.className = "p-5 text-sm leading-6";
  if (structureTree) {
    for (const child of structureTree.children) {
      appendStructureNode(content, child, extracted.byMarkedContent);
    }
  }
  if (!content.textContent?.trim() && extracted.plainText) {
    for (const paragraph of extracted.plainText.split(/\n+/u)) {
      const value = paragraph.trim();
      if (!value) continue;
      const element = document.createElement("p");
      element.className = "my-2 leading-6 first:mt-0";
      element.textContent = value;
      content.appendChild(element);
    }
  }
  if (!content.textContent?.trim()) {
    const empty = document.createElement("p");
    empty.className = "text-muted-foreground";
    empty.textContent = "No readable text was found on this page.";
    content.appendChild(empty);
  }

  layer.append(header, content);
  return layer;
}
