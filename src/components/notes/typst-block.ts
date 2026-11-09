import { SquareRadical } from "lucide-react";
import { whenNearViewport } from "@/hooks/use-near-viewport";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { notesRenderTypst } from "@/lib/tauri";
import { blockMessage, type NoteBlockKind, paintBlockCard } from "./note-blocks";
import { svgDataUrl } from "./svg-block";

export const TYPST_DELAY_MS = 350;
export const MAX_TYPST_RENDERS = 2;
const CACHE_ENTRIES = 64;
const ERROR_CHARS = 240;

const rendered = new Map<string, string>();

interface RenderJob {
  consumers: number;
  promise: Promise<string>;
  start: () => void;
  drop: () => void;
}

const jobs = new Map<string, RenderJob>();
const queue: RenderJob[] = [];
let running = 0;

function pump(): void {
  while (running < MAX_TYPST_RENDERS && queue.length > 0) {
    const job = queue.shift() as RenderJob;
    if (job.consumers === 0) {
      job.drop();
      continue;
    }
    running += 1;
    job.start();
  }
}

function createJob(text: string): RenderJob {
  let resolve!: (svg: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  promise.catch(() => undefined);
  const settle = () => {
    running -= 1;
    jobs.delete(text);
    pump();
  };
  return {
    consumers: 0,
    promise,
    start: () => {
      notesRenderTypst(text).then(
        (svg) => {
          remember(text, svg);
          resolve(svg);
          settle();
        },
        (error: unknown) => {
          reject(error);
          settle();
        },
      );
    },
    drop: () => {
      jobs.delete(text);
      reject(new Error("No block is waiting for this render."));
    },
  };
}

function requestTypst(text: string): { promise: Promise<string>; release: () => void } {
  let job = jobs.get(text);
  if (!job) {
    job = createJob(text);
    jobs.set(text, job);
    queue.push(job);
  }
  const current = job;
  current.consumers += 1;
  pump();
  let released = false;
  return {
    promise: current.promise,
    release: () => {
      if (released) return;
      released = true;
      current.consumers -= 1;
    },
  };
}

function remember(source: string, svg: string): void {
  rendered.delete(source);
  rendered.set(source, svg);
  if (rendered.size > CACHE_ENTRIES) {
    const oldest = rendered.keys().next().value;
    if (oldest !== undefined) rendered.delete(oldest);
  }
}

export function clearTypstCache(): void {
  rendered.clear();
  jobs.clear();
  queue.length = 0;
  running = 0;
}

function desktop(): boolean {
  return Boolean((globalThis as { isTauri?: unknown }).isTauri);
}

function draw(preview: HTMLElement, svg: string): void {
  const image = document.createElement("img");
  image.className = "note-typst";
  image.draggable = false;
  image.alt = i18n.t(($) => $.notes.blocks.typst.alt);
  image.src = svgDataUrl(svg);
  preview.replaceChildren(image);
}

export function typstError(error: unknown): string {
  const text = describeError(error).trim();
  return text.length > ERROR_CHARS ? `${text.slice(0, ERROR_CHARS).trimEnd()}…` : text;
}

export function paintTypst(preview: HTMLElement, source: string): (() => void) | undefined {
  const text = source.trim();
  if (!text) {
    blockMessage(preview, i18n.t(($) => $.notes.blocks.typst.empty));
    return undefined;
  }
  const cached = rendered.get(text);
  if (cached) {
    draw(preview, cached);
    return undefined;
  }
  if (!desktop()) {
    blockMessage(preview, i18n.t(($) => $.notes.blocks.typst.desktopOnly));
    return undefined;
  }
  if (!preview.querySelector("img.note-typst")) blockMessage(preview, i18n.t(($) => $.notes.blocks.typst.rendering));
  let live = true;
  let timer: number | undefined;
  let release: (() => void) | undefined;
  const render = () => {
    const request = requestTypst(text);
    release = request.release;
    request.promise.then(
      (svg) => {
        if (live) draw(preview, svg);
      },
      (error: unknown) => {
        if (live) blockMessage(preview, i18n.t(($) => $.notes.blocks.typst.error, { error: typstError(error) }));
      },
    );
  };
  const schedule = () => {
    timer = window.setTimeout(render, TYPST_DELAY_MS);
  };
  const stop = whenNearViewport(preview, schedule);
  return () => {
    live = false;
    window.clearTimeout(timer);
    stop();
    release?.();
  };
}

export function paintTypstStill(preview: HTMLElement, source: string): undefined {
  const cached = rendered.get(source.trim());
  if (cached) draw(preview, cached);
  else paintBlockCard(preview, "Typst", source);
  return undefined;
}

export const TYPST_TEMPLATE = "$ integral_0^infinity e^(-x^2) dif x = sqrt(pi) / 2 $";

export const typstBlock: NoteBlockKind = {
  name: "typst",
  label: () => "Typst",
  icon: SquareRadical,
  paint: (preview, source) => paintTypst(preview, source),
  still: (preview, source) => paintTypstStill(preview, source),
  template: () => ({ info: "{=typst}", source: TYPST_TEMPLATE }),
};
