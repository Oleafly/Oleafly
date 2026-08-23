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
      for (const activeId of activeMarkedContent) {
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
  if (tag === "h1") {
    element.className =
      "mb-4 mt-10 text-2xl font-semibold tracking-tight first:mt-0";
  } else if (tag === "h2") {
    element.className =
      "mb-3 mt-9 text-xl font-semibold tracking-tight first:mt-0";
  } else if (/^h[3-6]$/u.test(tag)) {
    element.className =
      "mb-2 mt-7 text-base font-semibold tracking-tight first:mt-0";
  } else if (tag === "p") {
    element.className = "my-3 leading-6 text-foreground/90";
  } else if (tag === "ul") {
    element.className = "my-4 list-disc space-y-2 pl-5 text-foreground/90";
  } else if (tag === "table") {
    element.className = "my-5 w-full border-separate border-spacing-0 text-left";
  } else if (tag === "th" || tag === "td") {
    element.className = "border border-border/70 bg-background/35 p-2.5 align-top";
  } else if (tag === "blockquote") {
    element.className =
      "my-5 border-l border-foreground/20 pl-4 italic text-muted-foreground";
  } else if (tag === "code") {
    element.className =
      "rounded-md border border-white/10 bg-background/45 px-1.5 py-0.5 font-mono text-[0.9em]";
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
    "pdf-screen-reader-layer relative z-10 min-h-full w-full rounded-[inherit] bg-background/90 text-foreground outline-none backdrop-blur-2xl backdrop-saturate-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring supports-[not(backdrop-filter:blur(0))]:bg-background";
  layer.setAttribute("aria-label", `Screen reader view, page ${pageNumber} of ${totalPages}`);
  layer.tabIndex = 0;

  const header = document.createElement("header");
  header.className = pageNumber === 1
    ? "sticky top-3 z-10 mx-3 flex min-h-11 items-center justify-between rounded-xl border border-white/25 bg-white/12 px-4 py-2.5 shadow-[0_4px_14px_-10px_rgba(15,23,42,0.18),inset_0_1px_0_0_rgba(255,255,255,0.45)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-white/8 dark:shadow-[0_10px_32px_-12px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.08)]"
    : "sticky top-3 z-10 flex justify-end px-3";
  const title = document.createElement("span");
  title.className = "text-sm font-semibold tracking-[-0.01em]";
  title.textContent = "Screen reader mode";
  const pageLabel = document.createElement("span");
  pageLabel.className =
    "rounded-full border border-white/20 bg-background/35 px-2.5 py-1 text-[11px] font-medium tabular-nums text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16)] dark:border-white/10";
  pageLabel.textContent = `Page ${pageNumber} of ${totalPages}`;
  if (pageNumber === 1) header.append(title);
  header.append(pageLabel);

  const content = document.createElement("article");
  content.className =
    "w-full px-[clamp(1.25rem,2vw,2rem)] pb-16 pt-10 text-[clamp(0.8125rem,0.78rem+0.1vw,0.9375rem)] leading-6";
  if (structureTree) {
    for (const child of structureTree.children) {
      appendStructureNode(content, child, extracted.byMarkedContent);
    }
  }
  if (!content.textContent?.trim() && extracted.plainText) {
    const element = document.createElement("p");
    element.className = "leading-6 text-foreground/90";
    element.textContent = extracted.plainText.replace(/\s+/gu, " ").trim();
    content.appendChild(element);
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
