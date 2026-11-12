import { FlaskConical } from "lucide-react";
import { i18n } from "@/i18n";
import { BLOCK_MESSAGE, BLOCK_SURFACE } from "@/components/ui/block-frame";
import {
  blockMessage,
  currentTheme,
  type Dispose,
  element,
  type NoteBlockKind,
  type PaintContext,
  paintAsync,
} from "./note-blocks";

export interface SmilesEntry {
  name: string | null;
  smiles: string;
}

export interface SmilesList {
  entries: SmilesEntry[];
  more: boolean;
}

export const SMILES_LIMIT = 24;
export const SMILES_STILL_LIMIT = 4;
const DRAW_SIZE = 300;
const NAMED = /^(.*?):\s+(\S.*)$/u;

type SmilesDrawer = typeof import("smiles-drawer").default;
type StructureDrawer = InstanceType<SmilesDrawer["SvgDrawer"]>;

export function parseSmilesLine(line: string): SmilesEntry | null {
  const text = line.trim();
  if (!text || text.startsWith("#")) return null;
  const named = NAMED.exec(text);
  if (named?.[1].trim()) {
    return { name: named[1].trim(), smiles: named[2].split(/\s+/u)[0] };
  }
  const [smiles, ...rest] = text.split(/\s+/u);
  return { name: rest.join(" ") || null, smiles };
}

export function parseSmilesSource(source: string): SmilesList {
  const entries: SmilesEntry[] = [];
  for (const line of source.split(/\r?\n/u)) {
    const entry = parseSmilesLine(line);
    if (entry) entries.push(entry);
  }
  return { entries: entries.slice(0, SMILES_LIMIT), more: entries.length > SMILES_LIMIT };
}

export function structureMarkup(
  library: SmilesDrawer,
  drawer: StructureDrawer,
  smiles: string,
  theme: "dark" | "light",
): string {
  const svg = drawer.draw(library.Parser.parse(smiles), null, theme);
  svg.setAttribute("width", String(DRAW_SIZE));
  svg.setAttribute("height", String(DRAW_SIZE));
  return new XMLSerializer().serializeToString(svg);
}

interface StructureCell {
  entry: SmilesEntry;
  figure: HTMLElement;
  frame: HTMLElement;
}

function structureCell(entry: SmilesEntry): StructureCell {
  const figure = element("figure", `note-smiles-item m-0 flex min-w-0 flex-col items-center gap-1 p-2 ${BLOCK_SURFACE}`);
  figure.setAttribute("role", "listitem");
  const frame = element("div", "note-smiles-frame flex aspect-square w-full items-center justify-center");
  const caption = element("figcaption", "w-full min-w-0 text-center");
  caption.append(element("span", "block truncate text-xs font-medium", entry.name ?? entry.smiles));
  if (entry.name) {
    caption.append(element("span", "block break-all font-mono text-[0.625rem] text-muted-foreground", entry.smiles));
  }
  figure.append(frame, caption);
  return { entry, figure, frame };
}

function drawCell(cell: StructureCell, library: SmilesDrawer, drawer: StructureDrawer, theme: "dark" | "light"): void {
  let markup: string;
  try {
    markup = structureMarkup(library, drawer, cell.entry.smiles, theme);
  } catch {
    cell.frame.replaceChildren(
      element("p", `${BLOCK_MESSAGE} px-1 text-center`, i18n.t(($) => $.notes.blocks.smiles.invalid)),
    );
    cell.figure.dataset.invalid = "true";
    return;
  }
  const image = element("img", "note-smiles-image h-full w-full object-contain");
  image.alt = i18n.t(($) => $.notes.blocks.smiles.alt, { name: cell.entry.name ?? cell.entry.smiles });
  image.draggable = false;
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  cell.frame.replaceChildren(image);
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function drawOnePerTask(
  cells: readonly StructureCell[],
  alive: () => boolean,
  draw: (cell: StructureCell) => void,
  from = 0,
): Promise<void> {
  if (from >= cells.length || !alive()) return;
  draw(cells[from]);
  if (from === cells.length - 1) return;
  await nextTask();
  await drawOnePerTask(cells, alive, draw, from + 1);
}

export function paintSmiles(preview: HTMLElement, source: string, context: PaintContext): Dispose | undefined {
  const { entries, more } = parseSmilesSource(source);
  if (entries.length === 0) {
    blockMessage(preview, i18n.t(($) => $.notes.blocks.smiles.empty));
    return undefined;
  }
  const shown = context.still ? entries.slice(0, SMILES_STILL_LIMIT) : entries;
  const wrapper = element("div", "note-smiles w-full min-w-0");
  const grid = element("div", "grid w-full grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3");
  grid.setAttribute("role", "list");
  grid.setAttribute("aria-label", i18n.t(($) => $.notes.blocks.smiles.structures));
  const cells = shown.map(structureCell);
  grid.append(...cells.map((cell) => cell.figure));
  wrapper.append(grid);
  if (more && !context.still) {
    wrapper.append(
      element("p", "mt-2 text-[0.6875rem] text-muted-foreground", i18n.t(($) => $.notes.blocks.smiles.more, { limit: SMILES_LIMIT })),
    );
  }
  preview.replaceChildren(wrapper);
  return paintAsync(preview, {
    load: () => import("smiles-drawer"),
    show: async ({ default: library }, alive) => {
      const drawer = new library.SvgDrawer({ width: DRAW_SIZE, height: DRAW_SIZE });
      const theme = currentTheme();
      await drawOnePerTask(cells, alive, (cell) => drawCell(cell, library, drawer, theme));
    },
    error: () => i18n.t(($) => $.notes.blocks.smiles.loadError),
  });
}

function templateSource(): string {
  return [
    `${i18n.t(($) => $.notes.blocks.smiles.template.caffeine)}: CN1C=NC2=C1C(=O)N(C(=O)N2C)C`,
    `${i18n.t(($) => $.notes.blocks.smiles.template.aspirin)}: CC(=O)OC1=CC=CC=C1C(=O)O`,
  ].join("\n");
}

export const smilesBlock: NoteBlockKind = {
  name: "smiles",
  label: () => i18n.t(($) => $.notes.blocks.smiles.label),
  icon: FlaskConical,
  paint: paintSmiles,
  still: (preview, source, context) => paintSmiles(preview, source, { ...context, still: true }),
  template: () => ({ info: "smiles", source: templateSource() }),
};
