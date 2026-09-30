import { markdownLines, type FenceRole } from "@/lib/markdown-fences";
import type { AgentTodo } from "@/store/agent-todos";

// Same limits the update_todos tool applies (packages/ai-tools/src/tools.ts).
const MAX_PLAN_ITEMS = 30;
const MAX_PLAN_ITEM_LENGTH = 240;

// A numbered item: indent, one or two digits, "." or ")", then text.
const NUMBERED_ITEM = /^(\s*)(\d{1,2})([.)])[ \t]+(\S.*)$/;
// A line that starts its own block, so it never goes on with the text above:
// a heading, a blockquote, a bullet, or a thematic break.
const BLOCK_START = /^(?:#{1,6}(?:\s|$)|>|[-*+](?:\s|$)|(?:[-*_][ \t]*){3,}$)/;
// The bullet or number in front of a nested line.
const NESTED_MARKER = /^(?:[-*+]|\d{1,9}[.)])\s+/;
const ENDS_SENTENCE = /[.:;!?]$/;

interface NumberedList {
  start: number;
  delimiter: string;
  indent: number;
  last: number;
  /** Each item's lines: its own text, then the description lines under it. */
  items: string[][];
}

function cleanItem(body: string): string {
  return body
    .replaceAll(/\*\*(.+?)\*\*/g, "$1")
    .replaceAll("**", "")
    .replaceAll(/(^|[\s(])__(\S(?:.*?\S)?)__(?=[\s).,:;!?]|$)/g, "$1$2")
    .replaceAll(/(^|[\s(])\*(\S(?:[^*]*\S)?)\*(?=[\s).,:;!?]|$)/g, "$1$2")
    .replaceAll(/(^|[\s(])_(\S(?:[^_]*\S)?)_(?=[\s).,:;!?]|$)/g, "$1$2")
    .replaceAll(/`([^`]+)`/g, "$1")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** "main.tex", "Rename the intro", "Cut the abstract" give "main.tex: Rename the intro; Cut the abstract". */
function foldItem(lines: readonly string[]): string {
  const [title = "", ...details] = lines.map(cleanItem).filter((line) => line !== "");
  let folded = title;
  for (const [index, detail] of details.entries()) {
    const punctuation = index === 0 ? ":" : ";";
    folded += `${ENDS_SENTENCE.test(folded) ? "" : punctuation} ${detail}`;
  }
  return folded;
}

/**
 * Reads the top-level numbered lists in a reply one line at a time, the way
 * the chat bubble shows them:
 *
 * - Lines indented under an item, and text straight under it with no blank
 *   line, belong to the item.
 * - A list goes on across blank lines. After a paragraph, heading, or code
 *   block it goes on only at the next number, so "1." and "2." with a
 *   description paragraph under each stay one list.
 * - As in Markdown, only "1." can start a list straight after a line of text.
 */
class ListReader {
  readonly lists: NumberedList[] = [];
  private open: NumberedList | null = null;
  // Top-level text came after the open list's last item.
  private paused = false;
  // The line before was top-level paragraph text.
  private afterParagraph = false;

  blank(): void {
    this.afterParagraph = false;
  }

  /** A non-blank line outside code, tabs expanded. */
  line(line: string, fence: FenceRole | null, afterBlank: boolean): void {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    const open = this.paused ? null : this.open;
    if (open !== null && indent >= open.indent + 2) {
      // Indented under the item: a description, a sub-step, or code.
      if (fence === null) open.items.at(-1)?.push(trimmed.replace(NESTED_MARKER, ""));
      this.afterParagraph = false;
      return;
    }
    const item = fence === null ? NUMBERED_ITEM.exec(line) : null;
    if (item !== null && this.item(item, indent)) return;
    const blockStart = fence !== null || BLOCK_START.test(trimmed);
    if (open !== null && !afterBlank && !blockStart) {
      // Straight under the item, Markdown shows the line inside it.
      open.items.at(-1)?.push(trimmed);
      return;
    }
    this.paused = this.open !== null;
    this.afterParagraph = !blockStart;
  }

  /** Adds a numbered line to the open list or starts a list with it. */
  private item([, , digits, delimiter, body]: RegExpExecArray, indent: number): boolean {
    const number = Number(digits);
    const open = this.open;
    // After text, only the next number goes on with the list.
    const goesOn =
      open !== null &&
      delimiter === open.delimiter &&
      (!this.paused || (number === open.last + 1 && !this.afterParagraph));
    if (goesOn) {
      open.items.push([body]);
      open.last = number;
    } else if (indent <= 3 && (!this.afterParagraph || number === 1)) {
      this.open = { start: number, delimiter, indent, last: number, items: [[body]] };
      this.lists.push(this.open);
    } else {
      return false;
    }
    this.paused = false;
    this.afterParagraph = false;
    return true;
  }
}

/** The reply's top-level numbered lists, with code fences found as the bubble finds them. */
function numberedLists(text: string): NumberedList[] {
  const reader = new ListReader();
  let blankBefore = false;
  for (const { text: raw, fence } of markdownLines(text)) {
    if (fence === "code" || fence === "close") continue;
    const line = raw.replaceAll("\t", "    ");
    if (line.trim() === "") {
      blankBefore = true;
      reader.blank();
      continue;
    }
    reader.line(line, fence, blankBefore);
    blankBefore = false;
  }
  return reader.lists;
}

/**
 * The steps of the last numbered list in a reply, for a plan the user picks
 * with "Use this as the plan". Lists are read as ListReader describes.
 * Each step is the item's text with the description lines under it folded
 * in, and bold, italic, and code marks removed. A list that starts past 1 is
 * only part of a plan, and items that end in "?" are questions, so a list
 * with nothing else is skipped.
 */
export function lastNumberedList(text: string): string[] {
  const lists = numberedLists(text);
  for (let index = lists.length - 1; index >= 0; index--) {
    const list = lists[index];
    if (list.start !== 1) continue;
    const steps = list.items
      .filter((lines) => !cleanItem(lines[0]).endsWith("?"))
      .map(foldItem)
      .filter((step) => step !== "");
    if (steps.length > 0) return steps;
  }
  return [];
}

/** Pending plan items for `steps`, within the limits update_todos applies. */
export function planTodos(steps: readonly string[]): AgentTodo[] {
  return steps.slice(0, MAX_PLAN_ITEMS).map((content, position) => ({
    id: `plan-${position + 1}`,
    content: content.slice(0, MAX_PLAN_ITEM_LENGTH),
    status: "pending",
  }));
}

/** True when the last line of the reply asks the user something. */
export function replyEndsWithQuestion(text: string): boolean {
  const last = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .at(-1);
  return /\?[*_)"'\s]*$/.test(last?.trim() ?? "");
}
