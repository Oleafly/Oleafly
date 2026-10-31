import { scriptValue } from "./script-value";

export type WindowedList = {
  label: string;
  scroller: string;
  scrollParentOf?: boolean;
  alive: string;
  cards: string;
  maxCards: number;
};

export type ScrollDirection = "down" | "up";
export type ScrollAction = ScrollDirection | "top" | "here";

export type ScrollStep = {
  found: boolean;
  alive: boolean;
  cards: number;
  ids: string[];
  texts: string[];
  top: number;
  max: number;
  end: boolean;
};

export const SCROLL_STEPS_PER_EVAL = 8;

export function scrollScript(list: WindowedList, action: ScrollAction): string {
  const target = {
    down: "Math.min(limit, scroller.scrollTop + step)",
    up: "Math.max(0, scroller.scrollTop - step)",
    top: "0",
    here: "scroller.scrollTop",
  }[action];
  const atEnd = action === "down" ? "state.top >= state.max - 1" : "state.top <= 0";
  const batch = action === "down" || action === "up" ? SCROLL_STEPS_PER_EVAL : 1;
  return `(async () => {
    const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0;
    const scrollParent = (element) => {
      for (let parent = element?.parentElement ?? null; parent; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowY;
        if (overflow === "auto" || overflow === "scroll") return parent;
      }
      return null;
    };
    const resolve = () => {
      const anchor = document.querySelector(${scriptValue(list.scroller)});
      return ${list.scrollParentOf ? "scrollParent(anchor)" : "anchor"};
    };
    const settle = () => new Promise((done) => {
      const timer = setTimeout(done, 150);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(timer);
        done();
      }));
    });
    const probe = () => {
      const scroller = resolve();
      const found = scroller instanceof HTMLElement;
      const cards = [...document.querySelectorAll(${scriptValue(list.cards)})];
      return {
        found,
        alive: visible(document.querySelector(${scriptValue(list.alive)})),
        cards: cards.length,
        ids: cards.map((card) => card.getAttribute("data-testid") ?? ""),
        texts: cards.map((card) => card.textContent ?? ""),
        top: found ? scroller.scrollTop : -1,
        max: found ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : -1,
        end: false,
      };
    };
    const steps = [];
    for (let index = 0; index < ${batch}; index++) {
      const scroller = resolve();
      if (!(scroller instanceof HTMLElement)) {
        steps.push(probe());
        break;
      }
      const step = Math.max(1, Math.round(scroller.clientHeight * 0.75));
      const limit = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = ${target};
      await settle();
      const state = probe();
      state.end = state.found && ${atEnd};
      steps.push(state);
      if (!state.found || state.end) break;
    }
    return steps;
  })()`;
}
