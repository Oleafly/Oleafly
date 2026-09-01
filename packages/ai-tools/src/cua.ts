export type CuaActionType =
  | "navigate"
  | "read"
  | "screenshot"
  | "scroll"
  | "click"
  | "type"
  | "submit"
  | "wait";

export interface CuaAction {
  type: CuaActionType;
  /** CSS selector for click/type/submit. */
  selector?: string;
  /** Text for type; URL for navigate. */
  text?: string;
  /** Scroll delta in pixels (scroll); milliseconds (wait). */
  amount?: number;
}

export type CuaRisk = "auto" | "confirm";

// Read-only observation runs without a prompt; anything that mutates page
// state or navigates is confirmed.
export function cuaActionRisk(type: CuaActionType): CuaRisk {
  switch (type) {
    case "read":
    case "screenshot":
    case "scroll":
    case "wait":
      return "auto";
    default:
      return "confirm";
  }
}

export interface CuaElement {
  ref: number;
  tag: string;
  role: string | null;
  name: string;
}

export interface CuaObservation {
  url: string;
  title: string;
  text: string;
  elements: CuaElement[];
}

export interface CuaSurface {
  readonly document: Document;
  /** Current URL of the sandbox surface. */
  url(): string;
  /** Point the sandbox at a new (validated) URL. */
  navigate(url: string): Promise<void> | void;
}

const INTERACTIVE = "a,button,input,textarea,select,[role=button],[role=link]";

function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  if (text) return text.slice(0, 80);
  const placeholder = el.getAttribute("placeholder");
  return placeholder ? placeholder.trim() : "";
}

export function observe(surface: CuaSurface): CuaObservation {
  let url = "";
  let title = "";
  try {
    url = surface.url();
  } catch {}
  try {
    const doc = surface.document;
    title = doc.title;
    const elements: CuaElement[] = [];
    doc.querySelectorAll(INTERACTIVE).forEach((el, index) => {
      elements.push({
        ref: index,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        name: accessibleName(el),
      });
    });
    return {
      url,
      title,
      text: (doc.body?.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 4000),
      elements,
    };
  } catch {
    return { url, title, text: "", elements: [] };
  }
}

export interface CuaResult {
  ok: boolean;
  message: string;
  observation?: CuaObservation;
}

function isHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function minimalObservation(surface: CuaSurface): CuaObservation {
  let url = "";
  try {
    url = surface.url();
  } catch {}
  return { url, title: "", text: "", elements: [] };
}

function surfaceDocument(surface: CuaSurface): Document | null {
  try {
    return surface.document;
  } catch {
    return null;
  }
}

function unavailable(surface: CuaSurface): CuaResult {
  return {
    ok: false,
    message: "This page does not allow scripted actions.",
    observation: minimalObservation(surface),
  };
}

// Executes a single validated action against the sandbox surface. The caller
// is responsible for having obtained approval for confirm-risk actions before
// calling this.
export async function runCuaAction(
  surface: CuaSurface,
  action: CuaAction,
): Promise<CuaResult> {
  switch (action.type) {
    case "navigate": {
      const url = action.text ? isHttpUrl(action.text) : null;
      if (!url) return { ok: false, message: "navigate needs a valid http(s) URL" };
      await surface.navigate(url);
      return {
        ok: true,
        message: `Navigated to ${url}`,
        observation: minimalObservation(surface),
      };
    }
    case "read":
    case "screenshot": {
      // Reading or capturing needs a scriptable document. A non-scriptable
      // surface (the separate browser window) cannot honor these, so report
      // failure rather than a success with an empty observation.
      const doc = surfaceDocument(surface);
      if (!doc) return unavailable(surface);
      return {
        ok: true,
        message: action.type === "read" ? "Read the page" : "Captured the page",
        observation: observe(surface),
      };
    }
    case "scroll": {
      const doc = surfaceDocument(surface);
      if (!doc) return unavailable(surface);
      const target = doc.defaultView;
      if (target) target.scrollBy?.(0, action.amount ?? 400);
      return { ok: true, message: "Scrolled", observation: observe(surface) };
    }
    case "wait":
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(5000, Math.max(0, action.amount ?? 500))),
      );
      return { ok: true, message: "Waited" };
    case "click": {
      const doc = surfaceDocument(surface);
      if (!doc) return unavailable(surface);
      const el = action.selector
        ? doc.querySelector<HTMLElement>(action.selector)
        : null;
      if (!el) return { ok: false, message: `No element matches ${action.selector}` };
      el.click();
      return { ok: true, message: `Clicked ${action.selector}`, observation: observe(surface) };
    }
    case "type": {
      const doc = surfaceDocument(surface);
      if (!doc) return unavailable(surface);
      const el = action.selector
        ? doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(action.selector)
        : null;
      if (!el) return { ok: false, message: `No field matches ${action.selector}` };
      el.value = action.text ?? "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, message: `Typed into ${action.selector}` };
    }
    case "submit": {
      const doc = surfaceDocument(surface);
      if (!doc) return unavailable(surface);
      const el = action.selector
        ? doc.querySelector<HTMLFormElement>(action.selector)
        : null;
      const form = el ?? doc.querySelector<HTMLFormElement>("form");
      if (!form) return { ok: false, message: "No form to submit" };
      form.requestSubmit?.();
      return { ok: true, message: "Submitted the form", observation: observe(surface) };
    }
    default:
      return { ok: false, message: `Unknown action ${(action as CuaAction).type}` };
  }
}
