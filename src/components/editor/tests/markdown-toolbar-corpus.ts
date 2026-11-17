import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { Editor, type JSONContent } from "@tiptap/core";
import type { Node as ModelNode, Schema } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { WYSIWYG_EXTENSIONS, createMarkdownSourceSnapshot, markdownUnits, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { type MarkdownTarget, visualTarget } from "@/components/editor/markdown-model";
import { wordsOf } from "@/components/editor/markdown-typing";
import { markdownMathRanges } from "@/components/editor/wysiwyg/markdown-source";

export type Act = (target: MarkdownTarget) => void;

export const TOOLBAR_ACTIONS: readonly (readonly [string, Act])[] = [
  ["bold", (target) => target.bold()],
  ["italic", (target) => target.italic()],
  ["strike", (target) => target.strike()],
  ["code", (target) => target.code()],
  ["underline", (target) => target.underline()],
  ["highlight", (target) => target.highlight()],
  ["sup", (target) => target.superscript()],
  ["sub", (target) => target.subscript()],
  ["h1", (target) => target.heading(1)],
  ["h2", (target) => target.heading(2)],
  ["h6", (target) => target.heading(6)],
  ["paragraph", (target) => target.paragraph()],
  ["codeBlock", (target) => target.codeBlock()],
  ["bullet", (target) => target.bullet()],
  ["ordered", (target) => target.ordered()],
  ["quote", (target) => target.quote()],
  ["left", (target) => target.align("left")],
  ["center", (target) => target.align("center")],
  ["right", (target) => target.align("right")],
  ["clear", (target) => target.clear()],
  ["teal", (target) => target.color("teal")],
  ["nocolor", (target) => target.color(null)],
  ["emoji", (target) => target.emoji("🎉")],
  ["link", (target) => target.link("https://c.example/d")],
  ["unlink", (target) => target.unlink()],
  ["image", (target) => target.image("fig/new.png")],
  ["table", (target) => target.table()],
];

export const SHAPE_CORPUS: readonly (readonly [string, string])[] = [
  ["readme", "# Tool\n\nInstall it with the [installer][inst] and read the [guide][g].\n\n## Use\n\nRun it.\n\n[inst]: https://i.example\n[g]: https://g.example\n"],
  ["definitions", "[a]: https://first.example\n\nSee [x][a] word.\n\n[^n1]: A note.\n\n[r3]: https://first.example/v\n[r3]: https://ex.com/w\n[r2]: https://ex.com/z\n"],
  ["centred", "Intro para.\n\n::: {.center}\n## Title here\n:::\n\n::: right\nRight text.\n:::\n\nAfter para.\n"],
  ["fences", "Text.\n\n```js\nconst a = 1;\n```\n\n~~~\nraw\n~~~\n\n    indented code\n\nEnd.\n"],
  ["rules", "Intro.\n\n---\n\nBetween rules.\n\n---\n\nTitle\n-----\n\nBody word.\n\n***\n\nLast.\n"],
  ["lists", "- one\n- two **b**\n  - nested\n\n1. first\n2. second\n\n- [ ] task word\n- [x] done\n\n* star\n* star two\n"],
  ["quotes", "> quoted line\n> - item in quote\n\n> [!NOTE]\n> callout body\n"],
  ["table", "| a | b |\n|---|---|\n| c | d^e^ |\n\nAfter.\n"],
  ["html", "Above.\n\n<!-- a long html comment here -->\n\n<div align=\"center\">\nCentred html\n</div>\n\nBelow <u>u</u> <mark>m</mark> x<sup>2</sup>.\n"],
  ["math", "Inline $x^2$ and $$y$$ here.\n\n$$\nx + y = z\n$$\n\nAfter math.\n"],
  ["links", "See [inline](https://a.b/c) and <https://zqz.example> and ![alt](fig/a.png) end.\n\nText.^[An inline note] more.\n"],
  ["front matter", "---\ntitle: T\nauthor: Me\n---\n\n# Heading\n\nBody word.\n"],
  ["front matter only", "---\ntitle: T\n---\n\n"],
  ["mixed", "🎉 Party 中文 é\ttab  \nnext line.\n\nPandoc [u]{.underline} and [m]{.mark} with x^2^ and H~2~O.\n"],
  ["html table", "Intro.\n\n<table>\n<tr>\n<th>Identifier</th>\n<th>Description</th>\n</tr>\n\n\n<tr>\n<td>\n\n`code`\n\n</td>\n</tr>\n</table>\n\nAfter.\n"],
  ["list joins", "Para zrja text.\n\n- zrka one\n- zrla two\n\nGap one.\n\n- ![alt](fig/a.png)\n- zimb next\n\nGap two.\n\n1. ![alt](fig/c.png)\n2. zbav next\n\nGap three.\n\n- [ ] ![a](fig/e.png)\n- [ ] zbal\n\nGap four.\n\n- zbap\n  - ![a](fig/g.png)\n- zbaq\n"],
  ["callouts", "> [!NOTE] zahae callout zahaf\n\n> [!WARNING]\n> Warning zahag body.\n\n> ![alt](fig/c.png)\n> zbaj next\n\n> zrga text\n>\n> ![alt](a.png)\n\n> ```\n> zqf code\n> ```\n> zqn after\n"],
  ["setext", "Title zbat\n------------\n\nIntro zhaa.\n\nSecond title\n===\n\n> zqwa title\n> ---\n> zqxa after\n\n> zraa one\n>\n> ---\n>\n> zrba two\n"],
  ["divs", "::: {.center}\nAlpha zctq zcuq.\n:::\n\n::: {.right}\nzarc zard\n\n::: {.center}\nzare zarf\n:::\n:::\n\n::: {.center}\nzqa one\n\n---\n\nzqb two\n:::\n\n::: {.center}\n![alt](a.png)\n\nzqe text\n:::\n\n::: {.callout-note}\nNote zqc body.\n:::\n\n- ::: {.center}\n  zqua centred\n  :::\n- zqva next\n"],
  ["footnotes", "Text zqd[^n1] and zqg[^n2] end.\n\n[^n1]: First zqh note.\n[^n2]: Second zqi note.\n\n[^n742]: zber zbes.\n[^n746]: zbev zbew.\n"],
  ["math labels", "Text $x^2 + y$ more.\n\n$$\nx + y = z + w + v + u\n$$\n\nSee [$x$][m] and [$y$] word.\n\n[$x$]: https://m.example\n[$y$]: https://n.example\n"],
  ["front matter rule", "---\ntitle: T\n---\n\n---\n\n::: {.center}\n## zaaq zabq\n:::\n\nBody zacq.\n"],
  ["nested blocks", "- zqra item\n\n  ```\n  zqsa code\n  ```\n- zqta next\n\n- zqya one\n\n  ***\n\n  zqza two\n\n- zrca [x][r] word\n\n  [r]: https://a.example\n- zrda next\n"],
  ["cells", "| zsac | zsad |\n|---|---|\n| zsae | zsaf^[a \\| b] |\n| [l](https://l.example/very/long/path) | `c` |\n\nAfter zsag.\n"],
  ["comments", "Above zhta.\n\n<!-- a long html comment here -->\n\n::: {.center}\n<!-- inside -->\n:::\n\n<details>\n<summary>zaaq</summary>\n\nzabq zacq.\n\n</details>\n\nBelow <u>zhtd</u> end.\n"],
  ["breaks", "Line zsan trailing  \nzsao next\n\ntrailing\\\nnext zsap\n\n***zanac*** and __strong__ and bra*vo* word\n\n\\*zaaq\\* zabq &amp; zacq <span data-text-color=\"red\" style=\"color: rgb(217, 0, 0);\">zlsa</span> b\n"],
];

const HAND_FUZZ: readonly (readonly [string, string])[] = [
  ["hr-sandwich", "Intro zaaq zabq.\n\n---\n\nBetween zacq zadq.\n\n---\n\nBelow zaeq.\n"],
  ["slides", '---\ntitle: "S"\nformat: revealjs\n---\n\n## Slide zafq\n\nzagq zahq.\n\n---\n\n## Slide zaiq\n\n- zajq\n- zakq\n\n---\n\nzalq zamq zanq.\n'],
  [
    "kitchen",
    '---\ntitle: "Doc"\nbibliography: refs.bib\n---\n\n# zaoq\n\nzapq with a cite [@a] and a note[^n] and [zaqq][k].\n\n- zarq one\n- zasq **zatq**\n\n> zauq\n\n| x | y |\n|---|---|\n| zavq | 2 |\n\n```python\nprint("zawq")\n```\n\n[^n]: The zaxq.\n\n[k]: https://k.example\n',
  ],
  ["fm-only", "---\ntitle: T\n---\n"],
  [
    "readme",
    '# zayq\n\n<p align="center">\n  <img src="logo.png" width="80">\n</p>\n\nInstall it with the [zbaq][inst] and read the [zbbq][g].\n\n## zbcq\n\n```bash\nnpm i zbdq\n```\n\n* zbeq star item\n* zbfq second\n\n[inst]: https://i.example\n[g]: https://g.example\n',
  ],
  [
    "changelog",
    "# Changelog\n\n## [0.4.12] - 2026-01-01\n\n### Fixed\n\n- zbgq zbhq in the [zbiq](https://ex.com/a) view.\n- zbjq zbkq\n\n## [0.4.11]\n\n- zblq **zbmq**\n\n[0.4.12]: https://ex.com/compare/a...b\n[0.4.11]: https://ex.com/compare/c...d\n",
  ],
  ["emoji-cjk-tabs", "🎉 zbnq 中文 zboq\tzbpq  \nzbqq zbrq.\n\n- 🎊 zbsq\n\n> 中文 zbtq é zbuq\n"],
  [
    "labels",
    "[r1]: https://first.example\n\nzbvq [zbwq][r1] zbxq.\n\n> [q1]: https://q.example\n\nzbyq [zcaq][q1] and [zcbq][a\\]b] zccq.\n\n- [l1]: https://l.example\n\n[zcdq][l1] zceq.\n\n[r1]: https://second.example\n[a\\]b]: https://esc.example\n",
  ],
  ["math-cite", "Intro $x^2$ zcfq [@smith2020] zcgq.\n\n$$\na = b\n$$\n\nSee [@doe; @roe, p. 3] zchq zciq.\n"],
  ["setext-hr", "zcjq zckq\n===\n\nzclq zcmq.\n\nzcnq zcoq\n---\n\n***\n\nzcpq zcqq.\n"],
];

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = "abcdefghijklmnoprstuvwxy";

interface Writer {
  w: () => string;
  v: () => string;
  note: (text: string) => string;
  ref: () => string;
}

const BLOCKS: readonly ((at: Writer) => string)[] = [
  ({ w }) => `${w()} **${w()}** _${w()}_ ${w()}.`,
  ({ w }) => `\`${w()}\` [${w()}]{.mark} <sup>${w()}</sup> <sub>${w()}</sub> __${w()}__ 🎉.`,
  ({ w }) => `## ${w()} ~~${w()}~~`,
  ({ w }) => `### ${w()} \`${w()}\``,
  ({ w }) => `*${w()}* **${w()}**\n===`,
  ({ w }) => `${w()} ${w()}\n---`,
  ({ w }) => `- ${w()} ${w()}\n- **${w()}** ${w()}\n  - ${w()} nested ${w()}`,
  ({ w, v }) => `1. ${w()} _${w()}_\n2. ${w()} ![${w()}](fig/${v()}.png)`,
  ({ w }) => `- [ ] ${w()} ${w()}\n- [x] ${w()} ${w()}`,
  ({ w, v }) => `- ![${w()}](fig/${v()}.png)\n- ${w()} next`,
  ({ w }) => `> ${w()} ${w()}\n>\n> - ${w()} item\n> - ${w()} item`,
  ({ w }) => `> [!NOTE] ${w()} callout ${w()}`,
  ({ w }) => `> [!TIP]\n> ${w()} body ${w()}.`,
  ({ w }) => `::: {.callout-note}\n<sub>${w()}</sub> H~2~O ${w()}.\n:::`,
  ({ w }) => `::: {.center}\n## ${w()} ${w()}\n:::`,
  ({ w }) => `::: {.right}\n${w()} ${w()}\n:::`,
  ({ w }) => `::: {.right}\n${w()} ${w()}\n\n::: {.center}\n${w()} ${w()}\n:::\n:::`,
  ({ w }) => `::: {.center}\n${w()} one\n\n---\n\n${w()} two\n:::`,
  ({ w }) => `- ::: {.center}\n  ${w()} centred\n  :::\n- ${w()} next`,
  ({ w }) => `\`\`\`js\nconst ${w()} = ${w()};\n\`\`\``,
  ({ w }) => `- ${w()} item\n\n  \`\`\`\n  ${w()} code\n  \`\`\`\n- ${w()} next`,
  ({ w }) => `> \`\`\`\n> ${w()} code\n> \`\`\`\n> ${w()} after`,
  ({ w }) => `    ${w()} ${w()}\n    ${w()}`,
  ({ w }) => `| ${w()} | ${w()} |\n| --- | --- |\n| ${w()} | **${w()}** |`,
  ({ w }) => `<table>\n<tr>\n<th>${w()}</th>\n<th>${w()}</th>\n</tr>\n\n\n<tr>\n<td>\n\n\`${w()}\`\n\n</td>\n</tr>\n</table>`,
  ({ v }) => `<!-- ${v()} ${v()} -->`,
  ({ w }) => `<div align="center">\n${w()} html\n</div>`,
  ({ w }) => `<details>\n<summary>${w()}</summary>\n\n${w()} ${w()}.\n\n</details>`,
  () => "$$\nx = y + z\n$$",
  ({ w }) => `${w()} $a+b$ ${w()} $$c$$ ${w()}.`,
  ({ w, note }) => `${w()}${note(`${w()} ${w()}.`)} ${w()}.`,
  ({ w }) => `${w()}.^[${w()} note] ${w()}.`,
  ({ w, ref }) => `${w()} [${w()}][${ref()}] ${w()}.`,
  ({ w, v }) => `[${w()}](https://ex.com/${v()}) <https://${v()}.example/${v()}> ${w()}.`,
  () => "***",
  () => "---",
  ({ w }) => `${w()} ${w()}  \n${w()} ${w()}.`,
  ({ w }) => `🎉 ${w()} 中文 ${w()}\t${w()}`,
  ({ w }) => `<span data-text-color="red!85!black" style="color: rgb(217, 0, 0);">${w()}</span> ${w()}`,
  ({ w }) => `\\*${w()}\\* ${w()} &amp; ${w()}`,
  ({ w }) => `[${w()}]{.underline} x^2^ ${w()} <u>${w()}</u>`,
  ({ w, v }) => `See [$x$][${v()}] ${w()}.`,
  ({ w }) => `| ${w()} | ${w()}^[a \\| b] |\n| --- | --- |\n| ${w()} | ${w()} |`,
  ({ w }) => `${w()} [@smith2020] ${w()}.`,
];

function generated(index: number): string {
  const random = seeded(0x5eed0000 + index);
  const below = (count: number) => Math.floor(random() * count);
  let words = 0;
  let tokens = 0;
  const definitions: string[] = [];
  const name = (count: number) => `${LETTERS[Math.floor(count / LETTERS.length) % LETTERS.length]}${LETTERS[count % LETTERS.length]}`;
  const writer: Writer = {
    w: () => `z${name(words++)}q`,
    v: () => `v${name(tokens++)}k`,
    note: (text) => {
      const label = `n${definitions.length + 1}`;
      definitions.push(`[^${label}]: ${text}`);
      return `[^${label}]`;
    },
    ref: () => {
      const label = `r${definitions.length + 1}`;
      definitions.push(`[${label}]: https://ex.com/${writer.v()}`);
      return label;
    },
  };
  const blocks: string[] = [];
  if (random() < 0.3) blocks.push(`---\ntitle: "${writer.v()}"\nauthor: ${writer.v()}\n---`);
  const count = 5 + below(4);
  for (let at = 0; at < count; at += 1) {
    blocks.push(BLOCKS[below(BLOCKS.length)](writer));
    if (definitions.length > 0 && random() < 0.3) blocks.push(definitions.splice(0).join("\n"));
  }
  if (definitions.length > 0) blocks.push(definitions.join("\n"));
  return `${blocks.join("\n\n")}\n`;
}

export const FUZZ_CORPUS: readonly (readonly [string, string])[] = [
  ...HAND_FUZZ,
  ...Array.from({ length: 30 }, (_, index) => [`gen-${index + 1}`, generated(index + 1)] as const),
];

let parsingShares = 0;
let nativeParse: DOMParser["parseFromString"] | null = null;

// jsdom keeps every DOMParser document that a selector has queried alive, so thousands of parses grow the heap and slow the run; reusing one document keeps it flat.
export function shareParsingDocument(): () => void {
  if (parsingShares === 0) {
    const original = window.DOMParser.prototype.parseFromString;
    const shared = document.implementation.createHTMLDocument("");
    nativeParse = original;
    window.DOMParser.prototype.parseFromString = function parseFromString(this: DOMParser, text: string, type: DOMParserSupportedType) {
      if (type !== "text/html") return original.call(this, text, type);
      shared.documentElement.innerHTML = text;
      return shared;
    } as DOMParser["parseFromString"];
  }
  parsingShares += 1;
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    parsingShares -= 1;
    if (parsingShares === 0 && nativeParse) {
      window.DOMParser.prototype.parseFromString = nativeParse;
      nativeParse = null;
    }
  };
}

export function codeStates(source: string, extensions: Extension = []): (anchor: number, head: number) => EditorState {
  const base = EditorState.create({ doc: source, extensions });
  return (anchor, head) => base.update({ selection: EditorSelection.single(anchor, head) }).state;
}

function mathRanges(source: string) {
  return { preservedInlineRanges: markdownMathRanges(source) };
}

export function unitsOf(source: string): { from: number; to: number }[] {
  return markdownUnits(source, mathRanges(source)).spans;
}

export function touchedRegion(units: readonly { from: number; to: number }[], source: string, from: number, to: number): { from: number; to: number } {
  const holding = (offset: number) => units.find((unit) => unit.from <= offset && offset <= unit.to);
  const above = (offset: number) => units.filter((unit) => unit.to <= offset).at(-1);
  const below = (offset: number) => units.find((unit) => unit.from >= offset);
  const first = holding(from) ?? above(from) ?? below(from);
  const last = holding(to) ?? above(to) ?? below(to);
  const end = !last || last === units.at(-1) ? source.length : last.to;
  return { from: first?.from ?? 0, to: Math.max(end, first?.to ?? 0) };
}

function editOf(before: string, after: string): string {
  const short = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < short && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < short - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const end = before.length - suffix;
  const lineStart = before.lastIndexOf("\n", prefix - 1) + 1;
  const lineEnd = before.indexOf("\n", end);
  return JSON.stringify([before.slice(lineStart, prefix), before.slice(prefix, end), after.slice(prefix, after.length - suffix), before.slice(end, lineEnd < 0 ? before.length : lineEnd)]);
}

export function acceptsOutsideEdit(source: string, after: string, visual: { baseline: string; acted: string } | null): boolean {
  if (visual === null) return false;
  if (visual.acted === after) return true;
  return visual.baseline !== source && editOf(source, after) === editOf(visual.baseline, visual.acted);
}

/**
 * The typed key is local when it changes nothing outside its span, or when the words stay what plain typing
 * gives and only markup around them moved (a delimiter mended, the key inside the mark at the caret).
 */
export function typedLocally(acted: string, typed: string, selection: { from: number; to: number }, key: string): boolean {
  if (editedOutside(acted, typed, selection) === null) return true;
  if (wordsOf(typed) === wordsOf(acted.slice(0, selection.from) + key + acted.slice(selection.to))) return true;
  let at = 0;
  while (at < acted.length && acted[at] === typed[at]) at += 1;
  if (typed.length !== acted.length + key.length || typed.slice(at, at + key.length) !== key || typed.slice(at + key.length) !== acted.slice(at)) return false;
  const region = touchedRegion(unitsOf(acted), acted, selection.from, selection.to);
  return region.from <= at && at <= region.to;
}

export function typedClass(acted: { code: string; visual: string }, typed: { code: string; visual: string }, selection: { from: number; to: number }, visualFaithful: boolean, key = "X"): string {
  if (acted.code !== acted.visual) return "typed:after-differing-action";
  if (!typedLocally(acted.code, typed.visual, selection, key)) return "typed:visual-rewrites";
  if (!typedLocally(acted.code, typed.code, selection, key)) return "typed:code-rewrites";
  if (typed.code === typed.visual) return "typed:equal";
  if (!visualFaithful) return "typed:differ-visual-lossy";
  return sameReading(typed.code, typed.visual) ? "typed:same-reading" : "typed:differ";
}

export function lineOf(source: string, offset: number): { from: number; to: number } {
  const from = source.lastIndexOf("\n", offset - 1) + 1;
  const end = source.indexOf("\n", offset);
  return { from, to: end < 0 ? source.length : end };
}

export function editedOutside(before: string, after: string, region: { from: number; to: number }): { from: number; to: number } | null {
  if (before === after) return null;
  const short = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < short && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < short && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  if (prefix + suffix >= short) {
    const removed = before.length - short;
    const earliest = short - suffix;
    const fits = Math.max(earliest, region.from) <= Math.min(prefix, region.to - removed);
    return fits ? null : { from: earliest, to: prefix + removed };
  }
  const span = { from: prefix, to: before.length - suffix };
  return span.from >= region.from && span.to <= region.to ? null : span;
}

export function lineColumn(source: string, offset: number): string {
  const lines = source.slice(0, offset).split("\n");
  return `${lines.length}:${(lines.at(-1) ?? "").length}`;
}

function sentinelFor(source: string): string {
  let code = 0xe000;
  while (source.includes(String.fromCharCode(code))) code += 1;
  return String.fromCharCode(code);
}

function canonical(json: JSONContent): string {
  const content = [...(json.content ?? [])];
  while (content.length > 0 && content.at(-1)?.type === "paragraph" && !content.at(-1)?.content?.length) content.pop();
  return JSON.stringify(content);
}

function textPositions(doc: ModelNode, needle: string): number[] {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (let at = node.text.indexOf(needle); at >= 0; at = node.text.indexOf(needle, at + 1)) found.push(pos + at);
  });
  return found;
}

export interface VisualRun {
  acted: string;
  typed: string | null;
  faithful: boolean;
  typedFaithful: boolean;
}

export class VisualDocument {
  readonly editor: Editor;
  readonly source: string;
  readonly baseline: string;
  private readonly parsed: ReturnType<typeof parseMarkdownBody>;
  private readonly cleanJson: string;

  constructor(source: string) {
    this.source = source;
    this.parsed = parseMarkdownBody(source, mathRanges(source));
    this.editor = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: this.parsed.doc });
    this.cleanJson = JSON.stringify(this.editor.state.doc.toJSON());
    this.baseline = this.save(createMarkdownSourceSnapshot(this.parsed.layout, this.editor.getJSON()));
  }

  get schema(): Schema {
    return this.editor.schema;
  }

  destroy(): void {
    this.editor.destroy();
  }

  positionAt(offset: number): number | null {
    const mark = sentinelFor(this.source);
    const marked = `${this.source.slice(0, offset)}${mark}${this.source.slice(offset)}`;
    const parsed = parseMarkdownBody(marked, mathRanges(marked));
    if (parsed.frontmatter !== this.parsed.frontmatter) return null;
    const doc = this.schema.nodeFromJSON(parsed.doc);
    const found = textPositions(doc, mark);
    if (found.length !== 1) return null;
    const percent = encodeURIComponent(mark);
    const json = [mark, percent, percent.toLowerCase()].reduce((text, form) => text.replaceAll(form, ""), JSON.stringify(doc.toJSON()));
    return json === this.cleanJson ? found[0] : null;
  }

  nearestPosition(offset: number, range: { from: number; to: number }): number | null {
    for (let step = 0; step <= range.to - range.from; step += 1) {
      for (const at of step === 0 ? [offset] : [offset - step, offset + step]) {
        if (at < range.from || at > range.to) continue;
        const position = this.positionAt(at);
        if (position !== null) return position;
      }
    }
    return null;
  }

  caretFor(offset: number, units: readonly { from: number; to: number }[]): number | null {
    const line = lineOf(this.source, offset);
    const unit = units.find((each) => each.from <= offset && offset <= each.to);
    if (this.source.slice(line.from, line.to).trim() !== "") return this.nearestPosition(offset, line) ?? (unit ? this.nearestPosition(offset, unit) : null);
    const above = units.filter((each) => each.to <= offset).at(-1);
    if (above) return this.nearestPosition(above.to, above);
    const below = units.find((each) => each.from >= offset);
    return below ? this.nearestPosition(below.from, below) : null;
  }

  wordPositions(word: string): number[] {
    return textPositions(this.editor.state.doc, word);
  }

  docText(from: number, to: number): string {
    return this.editor.state.doc.textBetween(from, to, "\n", "\n");
  }

  run(anchor: number, head: number, act: Act | null, typed: string | null): VisualRun {
    const { editor } = this;
    editor.chain().setMeta("addToHistory", false).setContent(this.parsed.doc, { emitUpdate: false }).run();
    const snapshot = createMarkdownSourceSnapshot(this.parsed.layout, editor.getJSON());
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)));
    if (act) act(visualTarget(editor));
    const acted = this.save(snapshot);
    const faithful = this.reads(acted);
    if (typed === null) return { acted, typed: null, faithful, typedFaithful: faithful };
    editor.view.dispatch(editor.state.tr.insertText(typed));
    const after = this.save(snapshot);
    return { acted, typed: after, faithful, typedFaithful: this.reads(after) };
  }

  private reads(text: string): boolean {
    return canonical(parseMarkdownBody(text, mathRanges(text)).doc) === canonical(this.editor.getJSON());
  }

  private save(snapshot: ReturnType<typeof createMarkdownSourceSnapshot>): string {
    const body = serializeMarkdownBody(this.editor.getJSON(), snapshot);
    return this.parsed.frontmatter ? `${this.parsed.frontmatter}\n\n${body}` : body;
  }
}

export function sameReading(left: string, right: string): boolean {
  if (left === right) return true;
  const read = (text: string) => {
    const parsed = parseMarkdownBody(text, mathRanges(text));
    return `${parsed.frontmatter}\u0000${canonical(parsed.doc)}`;
  };
  return read(left) === read(right);
}
