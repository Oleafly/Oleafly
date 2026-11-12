import { isTauri } from "@tauri-apps/api/core";
import { BLOCK_MESSAGE } from "@/components/ui/block-frame";
import { buttonVariants } from "@/components/ui/button";
import { RenderCache } from "@/components/ui/render-cache";
import { describeError } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import { blockMessage, element, type PaintContext, paintBlockCard } from "./note-blocks";
import { svgDataUrl } from "./svg-block";

export const NATIVE_RENDER_DELAY_MS = 350;
export const MAX_NATIVE_RENDERS = 2;
const CACHE_ENTRIES = 64;
const CACHE_CHARS = 6_000_000;
const APPROVED_ENTRIES = 256;
const ERROR_CHARS = 240;

interface NativeRenderConfirm {
  needed: (context: PaintContext) => boolean;
  message: () => string;
  action: () => string;
}

interface NativeRenderSpec {
  label: string;
  className: string;
  key?: (text: string) => string;
  render: (input: string) => Promise<string>;
  confirm?: NativeRenderConfirm;
  alt: () => string;
  empty: () => string;
  rendering: () => string;
  desktopOnly: () => string;
  error: (error: unknown) => string;
}

export interface NativeRenderer {
  paint: (preview: HTMLElement, source: string, context?: PaintContext) => (() => void) | undefined;
  still: (preview: HTMLElement, source: string) => undefined;
  svg: (source: string, options?: { cachedOnly?: boolean }) => Promise<string>;
  reset: () => void;
}

interface RenderJob {
  consumers: number;
  promise: Promise<string>;
  start: () => void;
  drop: () => void;
}

export function clipError(message: string): string {
  const text = message.trim();
  return text.length > ERROR_CHARS ? `${text.slice(0, ERROR_CHARS).trimEnd()}…` : text;
}

export function nativeRenderError(error: unknown): string {
  return clipError(describeError(error));
}

export function nativeRenderer(spec: NativeRenderSpec): NativeRenderer {
  const rendered = new RenderCache<string>(CACHE_ENTRIES, CACHE_CHARS);
  const jobs = new Map<string, RenderJob>();
  const queue: RenderJob[] = [];
  const approved = new RenderCache<true>(APPROVED_ENTRIES, APPROVED_ENTRIES);
  const keyOf = (text: string) => spec.key?.(text) ?? text;
  let running = 0;

  const pump = () => {
    while (running < MAX_NATIVE_RENDERS && queue.length > 0) {
      const job = queue.shift() as RenderJob;
      if (job.consumers === 0) {
        job.drop();
        continue;
      }
      running += 1;
      job.start();
    }
  };

  const createJob = (text: string): RenderJob => {
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
        spec.render(text).then(
          (svg) => {
            rendered.set(text, svg, svg.length);
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
  };

  const request = (text: string): { promise: Promise<string>; release: () => void } => {
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
  };

  const draw = (preview: HTMLElement, svg: string) => {
    const image = element("img", `${spec.className} block h-auto max-w-full dark:hue-rotate-180 dark:invert`);
    image.draggable = false;
    image.alt = spec.alt();
    image.src = svgDataUrl(svg);
    preview.replaceChildren(image);
  };

  const showRendering = (preview: HTMLElement) => {
    if (!preview.querySelector(`img.${spec.className}`)) blockMessage(preview, spec.rendering());
  };

  const ask = (preview: HTMLElement, confirm: NativeRenderConfirm, onConfirm: () => void) => {
    const panel = element("div", "flex flex-col items-center gap-2 py-2");
    const button = element("button", cn(buttonVariants({ variant: "outline", size: "xs" }), "select-none"), confirm.action());
    button.type = "button";
    for (const type of ["pointerdown", "mousedown"]) {
      button.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onConfirm();
    });
    panel.append(element("p", BLOCK_MESSAGE, confirm.message()), button);
    const drawn = preview.querySelector(`img.${spec.className}`);
    preview.replaceChildren(...(drawn ? [panel, drawn] : [panel]));
  };

  const paint = (preview: HTMLElement, source: string, context: PaintContext = { still: false }): (() => void) | undefined => {
    const text = source.trim();
    if (!text) {
      blockMessage(preview, spec.empty());
      return undefined;
    }
    const key = keyOf(text);
    const cached = rendered.get(key);
    if (cached) {
      draw(preview, cached);
      return undefined;
    }
    if (!isTauri()) {
      blockMessage(preview, spec.desktopOnly());
      return undefined;
    }
    let live = true;
    let timer: number | undefined;
    let release: (() => void) | undefined;
    const start = () => {
      const pending = request(key);
      release = pending.release;
      pending.promise.then(
        (svg) => {
          if (live) draw(preview, svg);
        },
        (error: unknown) => {
          if (live) blockMessage(preview, spec.error(error));
        },
      );
    };
    if (spec.confirm?.needed(context) && !approved.has(key)) {
      ask(preview, spec.confirm, () => {
        if (!live) return;
        approved.set(key, true);
        showRendering(preview);
        start();
      });
    } else {
      showRendering(preview);
      timer = window.setTimeout(start, NATIVE_RENDER_DELAY_MS);
    }
    return () => {
      live = false;
      window.clearTimeout(timer);
      release?.();
    };
  };

  const still = (preview: HTMLElement, source: string): undefined => {
    const cached = rendered.get(keyOf(source.trim()));
    if (cached) draw(preview, cached);
    else paintBlockCard(preview, spec.label, source);
    return undefined;
  };

  const svg = async (source: string, options: { cachedOnly?: boolean } = {}): Promise<string> => {
    const key = keyOf(source.trim());
    const cached = rendered.get(key);
    if (cached) return cached;
    if (options.cachedOnly) throw new Error("This drawing has not been drawn here yet.");
    const pending = request(key);
    try {
      return await pending.promise;
    } finally {
      pending.release();
    }
  };

  const reset = () => {
    rendered.clear();
    approved.clear();
    jobs.clear();
    queue.length = 0;
    running = 0;
  };

  return { paint, still, svg, reset };
}
