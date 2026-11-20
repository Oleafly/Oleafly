interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const PLAIN_TAG = /^<(u|mark|sup|sub|strong|em|del)>$/u;
const COLOR_SPAN = /^<span data-text-color="[^"<>]*"(?: style="color: ?([^";<>]+);?")?>$/u;
const SAFE_COLOR = /^(?:#[\da-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)|[a-z]{3,20})$/iu;
const FENCE_LINE = /^ {0,3}:{3,}([^:\r\n]+)(?::+[ \t]*)?(?:\r?\n|$)/u;
const FENCE_NAME = /^[ \t]*(?:\{[ \t]*\.([a-z]+)[ \t]*\}|([a-z]+))[ \t]*$/u;
const CLOSE_FENCE = /(?:^|\n):{3,}[ \t]*$/u;
const FLOW_PARENTS = new Set(["root", "blockquote", "listItem", "footnoteDefinition", "alignedBlocks"]);
const TEXT_BLOCKS = new Set(["paragraph", "heading"]);
const ALIGN_CLASS: Readonly<Record<string, string>> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
  justify: "text-justify",
};

export function alignFenceOpen(text: string): { align: string; length: number } | null {
  const fence = FENCE_LINE.exec(text);
  const name = fence ? FENCE_NAME.exec(fence[1]) : null;
  const align = name?.[1] ?? name?.[2];
  if (!fence || align === undefined || !Object.hasOwn(ALIGN_CLASS, align)) return null;
  return { align, length: fence[0].length };
}

function openingTag(node: MarkdownNode): { name: string; properties: Record<string, unknown> } | null {
  if (node.type !== "html" || !node.value) return null;
  const plain = PLAIN_TAG.exec(node.value);
  if (plain) return { name: plain[1], properties: {} };
  const span = COLOR_SPAN.exec(node.value);
  if (!span) return null;
  const color = span[1]?.trim();
  if (color === undefined) return { name: "span", properties: {} };
  return SAFE_COLOR.test(color) ? { name: "span", properties: { style: `color: ${color}` } } : null;
}

function closingIndex(children: readonly MarkdownNode[], from: number, name: string): number {
  let depth = 0;
  for (let index = from + 1; index < children.length; index++) {
    const node = children[index];
    if (node.type !== "html") continue;
    if (node.value === `</${name}>`) {
      if (depth === 0) return index;
      depth--;
    } else if (openingTag(node)?.name === name) depth++;
  }
  return -1;
}

function wrapTags(children: readonly MarkdownNode[]): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  for (let index = 0; index < children.length; index++) {
    const tag = openingTag(children[index]);
    const close = tag ? closingIndex(children, index, tag.name) : -1;
    if (!tag || close < 0) {
      out.push(children[index]);
      continue;
    }
    out.push({ type: "toolbarMark", data: { hName: tag.name, hProperties: tag.properties }, children: children.slice(index + 1, close) });
    index = close;
  }
  return out;
}

function withText(node: MarkdownNode, at: number, value: string): MarkdownNode | null {
  const children = [...(node.children ?? [])];
  if (value === "") children.splice(at, 1);
  else children[at] = { ...children[at], value };
  return children.length > 0 ? { ...node, children } : null;
}

function opening(node: MarkdownNode): { align: string; rest: MarkdownNode | null } | null {
  const first = node.type === "paragraph" ? node.children?.[0] : undefined;
  const fence = first?.type === "text" ? alignFenceOpen(first.value ?? "") : null;
  if (!first || !fence) return null;
  return { align: fence.align, rest: withText(node, 0, (first.value ?? "").slice(fence.length)) };
}

function closing(node: MarkdownNode): { before: MarkdownNode | null } | null {
  const children = node.type === "paragraph" ? (node.children ?? []) : [];
  const at = children.length - 1;
  const last = children[at];
  const fence = last?.type === "text" ? CLOSE_FENCE.exec(last.value ?? "") : null;
  if (!last || !fence || (fence.index === 0 && !fence[0].startsWith("\n") && at > 0)) return null;
  return { before: withText(node, at, (last.value ?? "").slice(0, fence.index)) };
}

function alignedRun(children: readonly MarkdownNode[], index: number, rest: MarkdownNode | null): { blocks: MarkdownNode[]; end: number } | null {
  const blocks: MarkdownNode[] = [];
  for (let at = index; at < children.length; at++) {
    const block = at === index ? rest : children[at];
    if (!block) continue;
    if (opening(block)) return null;
    const close = closing(block);
    if (close) {
      if (close.before) blocks.push(close.before);
      return blocks.length > 0 ? { blocks, end: at } : null;
    }
    if (!TEXT_BLOCKS.has(block.type)) return null;
    blocks.push(block);
  }
  return null;
}

function alignBlocks(children: readonly MarkdownNode[]): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  for (let index = 0; index < children.length; index++) {
    const open = opening(children[index]);
    const run = open && alignedRun(children, index, open.rest);
    if (!open || !run) {
      out.push(children[index]);
      continue;
    }
    out.push({ type: "alignedBlocks", data: { hName: "div", hProperties: { className: [ALIGN_CLASS[open.align]] } }, children: run.blocks });
    index = run.end;
  }
  return out;
}

function transform(node: MarkdownNode) {
  if (!node.children) return;
  node.children = FLOW_PARENTS.has(node.type) ? alignBlocks(node.children) : wrapTags(node.children);
  for (const child of node.children) transform(child);
}

export function remarkToolbarMarkup() {
  return transform;
}
