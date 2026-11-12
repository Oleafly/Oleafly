import { createRoot } from "react-dom/client";
import { type CaptureBridge, QuickCaptureWindow } from "/src/components/notes/QuickCaptureWindow";
import type { CaptureRequest } from "/src/components/notes/quick-capture";
import { loadNamespace } from "/src/i18n";
import { applyTheme } from "/src/lib/theme";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

const params = new URLSearchParams(window.location.search);
const captures: CaptureRequest[] = [];
const harness = window as typeof window & {
  __captures?: CaptureRequest[];
  __hidden?: number;
  __openedNotes?: number;
  __windowButtons?: boolean[];
  __show?: () => void;
};
harness.__captures = captures;
harness.__hidden = 0;
harness.__openedNotes = 0;
harness.__windowButtons = [];

const bridge: CaptureBridge = {
  submit: async (request) => {
    captures.push(request);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return params.get("fail") === "1" ? { id: request.id, error: "disk full" } : { id: request.id, noteId: "note-1" };
  },
  hide: () => {
    harness.__hidden = (harness.__hidden ?? 0) + 1;
  },
  onShown: (shown) => {
    harness.__show = shown;
    return () => {};
  },
  openNotes: () => {
    harness.__openedNotes = (harness.__openedNotes ?? 0) + 1;
  },
  windowButtons: (shown) => {
    harness.__windowButtons?.push(shown);
  },
};

await prepareHarnessI18n();
await Promise.all([loadNamespace("notes"), loadNamespace("editor")]);
applyTheme(params.get("theme") === "dark" ? "dark" : "light");
createRoot(document.getElementById("root") as HTMLElement).render(<QuickCaptureWindow bridge={bridge} />);
document.body.dataset.fixtureState = "mounted";
