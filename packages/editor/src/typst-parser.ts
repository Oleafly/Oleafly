import {
  type Input,
  Parser,
  type PartialParse,
  Tree,
  type TreeFragment,
} from "@lezer/common";
import { isNewline } from "./typst-lexer";
import { K, typstNodeSet } from "./typst-nodes";
import { TypstParserCore } from "./typst-parser-core";
import { typstPlainText } from "./typst-structure";

const MIN_CHUNK = 512;
const ADVANCE_CHARS = 4096;
const BRANCH = 16;

interface Chunk {
  readonly tree: Tree;
  readonly from: number;
  readonly to: number;
  readonly reach: number;
  readonly prevEnd: number;
  readonly errorAtEnd: boolean;
}

const chunkIndex = new WeakMap<Tree, readonly Chunk[]>();

function chunkStartingAt(chunks: readonly Chunk[], pos: number): Chunk | null {
  let low = 0;
  let high = chunks.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const chunk = chunks[middle];
    if (chunk.from === pos) return chunk;
    if (chunk.from < pos) low = middle + 1;
    else high = middle - 1;
  }
  return null;
}

function balance(trees: Tree[], positions: number[]): { trees: Tree[]; positions: number[] } {
  let level = trees;
  let offsets = positions;
  const group = typstNodeSet.types[K.Chunk];
  while (level.length > BRANCH) {
    const nextTrees: Tree[] = [];
    const nextOffsets: number[] = [];
    for (let start = 0; start < level.length; start += BRANCH) {
      const end = Math.min(start + BRANCH, level.length);
      const base = offsets[start];
      const children = level.slice(start, end);
      const relative = offsets.slice(start, end).map((offset) => offset - base);
      const length = offsets[end - 1] + level[end - 1].length - base;
      nextTrees.push(new Tree(group, children, relative, length));
      nextOffsets.push(base);
    }
    level = nextTrees;
    offsets = nextOffsets;
  }
  return { trees: level, positions: offsets };
}

class TypstParse implements PartialParse {
  parsedPos: number;
  stoppedAt: number | null = null;
  private readonly core: TypstParserCore;
  private readonly chunks: Chunk[] = [];
  private readonly from: number;
  private readonly to: number;
  private chunkStart: number;
  private fragmentIndex = 0;
  private started = false;

  constructor(
    input: Input,
    private readonly fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ) {
    this.from = ranges[0].from;
    this.to = ranges[ranges.length - 1].to;
    this.core = new TypstParserCore(input.read(0, this.to), this.from, this.to);
    this.parsedPos = this.from;
    this.chunkStart = this.from;
  }

  advance(): Tree | null {
    const core = this.core;
    const budget = this.parsedPos + ADVANCE_CHARS;
    for (;;) {
      if (core.kind === K.End) return this.finish(this.to);
      const boundary = this.boundary();
      if (boundary >= 0) {
        if (this.stoppedAt !== null && boundary >= this.stoppedAt) return this.finish(boundary);
        if (this.reuse(boundary)) continue;
        if (boundary - this.chunkStart >= MIN_CHUNK) this.closeChunk(boundary);
        if (boundary >= budget) {
          this.parsedPos = boundary;
          return null;
        }
      }
      this.started = true;
      core.topLevelStep();
    }
  }

  stopAt(pos: number): void {
    this.stoppedAt = pos;
  }

  private boundary(): number {
    if (!this.started) return this.from;
    const token = this.core.tok;
    return this.core.nesting === 0 && token.newline ? token.start : -1;
  }

  private lineStart(pos: number): number {
    const text = this.core.text;
    let cursor = pos;
    while (cursor > this.from && !isNewline(text.charCodeAt(cursor - 1))) cursor -= 1;
    return cursor;
  }

  private reuse(pos: number): boolean {
    const fragments = this.fragments;
    while (this.fragmentIndex < fragments.length && fragments[this.fragmentIndex].to <= pos) {
      this.fragmentIndex += 1;
    }
    const fragment = fragments[this.fragmentIndex];
    if (!fragment || fragment.from > pos) return false;
    const lineStart = this.lineStart(pos);
    const dependsFrom = lineStart === this.from ? lineStart : lineStart - 1;
    if (fragment.from > dependsFrom) return false;
    const chunks = chunkIndex.get(fragment.tree);
    if (!chunks) return false;
    const shift = fragment.offset;
    const chunk = chunkStartingAt(chunks, pos + shift);
    if (!chunk) return false;
    const end = chunk.to - shift;
    const reach = chunk.reach - shift;
    if (end <= pos || end > fragment.to) return false;
    if (fragment.openEnd && reach > fragment.to) return false;
    if (pos > this.chunkStart) this.closeChunk(pos);
    this.chunks.push({
      tree: chunk.tree,
      from: pos,
      to: end,
      reach,
      prevEnd: chunk.prevEnd - shift,
      errorAtEnd: chunk.errorAtEnd,
    });
    this.chunkStart = end;
    this.started = true;
    const lexer = this.core.lexer;
    lexer.reach = Math.max(lexer.reach, reach);
    this.core.resetAt(end, chunk.prevEnd - shift, chunk.errorAtEnd);
    this.parsedPos = end;
    return true;
  }

  private closeChunk(end: number): void {
    const core = this.core;
    const entries = core.takeBuffer();
    const tree = Tree.build({
      buffer: entries,
      nodeSet: typstNodeSet,
      topID: K.Chunk,
      start: this.chunkStart,
      length: end - this.chunkStart,
    });
    this.chunks.push({
      tree,
      from: this.chunkStart,
      to: end,
      reach: core.lexer.reach,
      prevEnd: core.tok.prevEnd,
      errorAtEnd: core.errorBefore,
    });
    this.chunkStart = end;
  }

  private finish(pos: number): Tree {
    if (pos > this.chunkStart || this.core.buf.length > 0) this.closeChunk(pos);
    const { trees, positions } = balance(
      this.chunks.map((chunk) => chunk.tree),
      this.chunks.map((chunk) => chunk.from - this.from),
    );
    const root = new Tree(typstNodeSet.types[K.Source], trees, positions, pos - this.from);
    chunkIndex.set(root, this.chunks);
    this.parsedPos = pos;
    return root;
  }
}

class TypstTreeParser extends Parser {
  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    return new TypstParse(input, fragments, ranges);
  }
}

export const typstParser: Parser = new TypstTreeParser();

export function parseTypst(text: string): Tree {
  return typstParser.parse(text);
}

const titleCache = new Map<string, string>();

export function typstPlainTitle(source: string): string {
  const cached = titleCache.get(source);
  if (cached !== undefined) return cached;
  const text = `= ${source}`;
  const title = typstPlainText(parseTypst(text).topNode, text);
  if (titleCache.size >= 2_000) titleCache.clear();
  titleCache.set(source, title);
  return title;
}
