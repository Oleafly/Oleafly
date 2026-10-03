import { vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;

export const presentationHarness = {
  handlers: new Map<string, Set<Handler>>(),
  emitted: [] as { event: string; payload: unknown }[],
  close: vi.fn(() => Promise.resolve()),
  render: vi.fn(() => Promise.resolve(true)),
  destroy: vi.fn(),
  numPages: 3,
  failLoad: false,
  notes: new Map<number, string>(),
  reset() {
    this.handlers.clear();
    this.emitted.length = 0;
    this.close.mockClear();
    this.render.mockClear();
    this.destroy.mockClear();
    this.numPages = 3;
    this.failLoad = false;
    this.notes = new Map();
  },
  deliver(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler({ payload });
  },
};

export const eventModule = {
  listen: (event: string, handler: Handler) => {
    const set = presentationHarness.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    presentationHarness.handlers.set(event, set);
    return Promise.resolve(() => set.delete(handler));
  },
  emit: (event: string, payload: unknown) => {
    presentationHarness.emitted.push({ event, payload });
    presentationHarness.deliver(event, payload);
    return Promise.resolve();
  },
};

export const windowModule = {
  getCurrentWindow: () => ({
    close: presentationHarness.close,
    onCloseRequested: () => Promise.resolve(() => {}),
  }),
};

export const loadModule = {
  loadPresentationPdf: () => {
    if (presentationHarness.failLoad) return Promise.reject(new Error("no compiled PDF"));
    return Promise.resolve(new Uint8Array([37, 80, 68, 70]));
  },
  loadPresentationNotes: () => Promise.resolve(presentationHarness.notes),
};

export const slidesModule = {
  openSlideDocument: () =>
    Promise.resolve({
      numPages: presentationHarness.numPages,
      render: presentationHarness.render,
      destroy: presentationHarness.destroy,
    }),
};

export function presentationUrl(view: "present" | "presenter", extra = ""): void {
  window.history.replaceState(
    {},
    "",
    `/?view=${view}&session=s1&project=deck&source=compiled&start=2&presenter=1&typst=1&main=main.typ${extra}`,
  );
}
