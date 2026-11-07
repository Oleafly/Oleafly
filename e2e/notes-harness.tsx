import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { NotesDataProvider } from "/src/components/notes/notes-data";
import { NotesWorkspace } from "/src/components/notes/NotesWorkspace";
import { loadNamespace } from "/src/i18n";
import { prepareHarnessI18n } from "./harness-i18n";
import { createNotesFixture } from "./notes-fixtures";
import "/src/styles/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Notes fixture root is missing");

const params = new URLSearchParams(window.location.search);
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");
document.documentElement.style.setProperty("--primary", params.get("accent") ?? "#2563eb");
document.documentElement.style.setProperty("--primary-foreground", "#ffffff");

const fixture = createNotesFixture(Date.now(), Number(params.get("delay") ?? 400));
Object.assign(window, { __notes: fixture });

function Harness() {
  const data = useSyncExternalStore(fixture.subscribe, fixture.snapshot);
  return (
    <div className="h-screen">
      <NotesDataProvider value={data}>
        <NotesWorkspace onNewNote={() => (data.createNote ? data.createNote() : Promise.resolve(null))} />
      </NotesDataProvider>
    </div>
  );
}

await prepareHarnessI18n();
await loadNamespace("notes");
createRoot(root).render(<Harness />);
document.body.dataset.fixtureState = "mounted";
