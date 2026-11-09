import { QueryClientProvider } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { NotesDataProvider } from "/src/components/notes/notes-data";
import { NotesWorkspace } from "/src/components/notes/NotesWorkspace";
import { createAppQueryClient } from "/src/lib/query";
import { loadNamespace } from "/src/i18n";
import { prepareHarnessI18n } from "./harness-i18n";
import { installNotesAgentMock } from "./notes-agent-mock";
import { createNotesFixture } from "./notes-fixtures";
import "/src/styles/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Notes fixture root is missing");

const params = new URLSearchParams(window.location.search);
const agent = installNotesAgentMock({
  configured: params.get("ai") !== "none",
  delayMs: Number(params.get("delay") ?? 0),
});
Object.assign(window, { __agent: agent });
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");
document.documentElement.style.setProperty("--primary", params.get("accent") ?? "#2563eb");
document.documentElement.style.setProperty("--primary-foreground", "#ffffff");

const fixture = createNotesFixture(Date.now());
Object.assign(window, { __notes: fixture });

const queryClient = createAppQueryClient();

function Harness() {
  const data = useSyncExternalStore(fixture.subscribe, fixture.snapshot);
  return (
    <div className="h-screen">
      <QueryClientProvider client={queryClient}>
        <NotesDataProvider value={data}>
          <NotesWorkspace onNewNote={() => (data.createNote ? data.createNote() : Promise.resolve(null))} />
        </NotesDataProvider>
      </QueryClientProvider>
    </div>
  );
}

await prepareHarnessI18n();
await loadNamespace("notes");
createRoot(root).render(<Harness />);
document.body.dataset.fixtureState = "mounted";
