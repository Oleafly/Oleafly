export interface MdToken {
  type: string;
  tag: string;
  nesting: number;
  level: number;
  content: string;
  markup: string;
  block: boolean;
  hidden: boolean;
  map: [number, number] | null;
  children: MdToken[] | null;
  attrSet(name: string, value: string): void;
  attrGet(name: string): string | null;
}

export type MdTokenConstructor = new (type: string, tag: string, nesting: number) => MdToken;

export interface MdCoreState {
  tokens: MdToken[];
  Token: MdTokenConstructor;
}

export interface MdInlineState {
  src: string;
  pos: number;
  posMax: number;
  md: MarkdownIt;
  push(type: string, tag: string, nesting: number): MdToken;
}

type CoreRule = (state: MdCoreState) => boolean;
type InlineRule = (state: MdInlineState, silent: boolean) => boolean;

export interface MarkdownIt {
  core: { ruler: { after(name: string, rule: string, fn: CoreRule): void } };
  inline: {
    ruler: { before(name: string, rule: string, fn: InlineRule): void };
    tokenize(state: MdInlineState): void;
  };
}

const prepared = new WeakMap<MarkdownIt, Set<string>>();

export function onceFor(md: MarkdownIt, name: string, setup: () => void): void {
  let done = prepared.get(md);
  if (!done) {
    done = new Set();
    prepared.set(md, done);
  }
  if (done.has(name)) return;
  done.add(name);
  setup();
}
