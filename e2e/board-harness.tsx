import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import { BoardFileView } from "@/components/editor/board/BoardFileView";
import { applyTheme } from "@/lib/theme";
import { useFilesStore } from "@/store/files";
import { prepareHarnessI18n } from "./harness-i18n";

const PATH = "figures/sketch.excalidraw";

const DRAWING = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "https://oleafly.com",
  elements: [
    { id: "note", type: "text", x: 80, y: 80, width: 220, height: 35, text: "Attention", originalText: "Attention", fontSize: 28, fontFamily: 5, version: 1, versionNonce: 1, seed: 1 },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

const writes: string[] = [];

function store(content: string) {
  useFilesStore.setState((state) => ({ files: { ...state.files, [PATH]: { content, dirty: false, edits: (state.files[PATH]?.edits ?? 0) + 1 } } }));
}

Object.assign(window, {
  board: {
    writes,
    replace: store,
    dark: () => applyTheme("dark"),
  },
});

await prepareHarnessI18n();
useFilesStore.setState({
  projectId: "harness",
  activePath: PATH,
  files: { [PATH]: { content: DRAWING, dirty: false, edits: 0 } },
  setContent: (path: string, content: string) => {
    writes.push(content);
    useFilesStore.setState((state) => ({ files: { ...state.files, [path]: { content, dirty: true, edits: 1 } } }));
    return true;
  },
} as never);

const root = document.getElementById("root");
if (!root) throw new Error("Whiteboard fixture root is missing");
createRoot(root).render(<BoardFileView projectId="harness" path={PATH} />);
document.body.dataset.fixtureState = "mounted";
