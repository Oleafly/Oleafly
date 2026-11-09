import { type HomePage, useHomeViewStore } from "@/store/home-view";

const COVERING_PAGES: ReadonlySet<HomePage> = new Set<HomePage>(["notes", "diagram-composer", "generators", "symbols"]);

export function coversProject(page: HomePage): boolean {
  return COVERING_PAGES.has(page);
}

export function projectCovered(): boolean {
  return coversProject(useHomeViewStore.getState().page);
}
