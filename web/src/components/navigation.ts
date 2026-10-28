import { useSyncExternalStore } from "react";

const EVENT = "oleafly-web:navigate";

export function projectFromLocation(search: string = window.location.search): string | null {
  const value = new URLSearchParams(search).get("project");
  return value && value.trim() !== "" ? value : null;
}

export function projectHref(projectId: string | null): string {
  const url = new URL(window.location.href);
  url.hash = "";
  if (projectId) url.searchParams.set("project", projectId);
  else url.searchParams.delete("project");
  return `${url.pathname}${url.search}`;
}

export function navigate(projectId: string | null): void {
  window.history.pushState(null, "", projectHref(projectId));
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(EVENT, listener);
  };
}

export function useProjectParam(): string | null {
  return useSyncExternalStore(subscribe, () => projectFromLocation(), () => null);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false),
    () => false,
  );
}
