import { QueryClientProvider } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { NotesDataProvider } from "/src/components/notes/notes-data";
import { NotesWorkspace } from "/src/components/notes/NotesWorkspace";
import { createStarterNote } from "/src/components/notes/starter-note";
import { NoteLinkIndexProvider } from "/src/components/notes/use-note-links";
import { createAppQueryClient } from "/src/lib/query";
import { i18n, loadNamespace } from "/src/i18n";
import { useSettingsStore } from "/src/store/settings";
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
const exits = { count: 0 };
Object.assign(window, { __notes: fixture, __exits: exits, __settings: useSettingsStore });
const onExit = params.has("exit")
  ? () => {
      exits.count += 1;
    }
  : undefined;

const queryClient = createAppQueryClient();

function Harness() {
  const data = useSyncExternalStore(fixture.subscribe, fixture.snapshot);
  return (
    <div className="h-screen">
      <QueryClientProvider client={queryClient}>
        <NotesDataProvider value={data}>
          <NoteLinkIndexProvider>
            <NotesWorkspace onExit={onExit} onNewNote={() => (data.createNote ? data.createNote() : Promise.resolve(null))} />
          </NoteLinkIndexProvider>
        </NotesDataProvider>
      </QueryClientProvider>
    </div>
  );
}

function openStarterTwice(): Promise<unknown> {
  let taken = false;
  const claim = async () => {
    const first = !taken;
    taken = true;
    return first;
  };
  const t = i18n.getFixedT(null, ["notes"]);
  const open = () => createStarterNote({ createNoteFrom: fixture.snapshot().createNoteFrom, t, notes: () => fixture.snapshot().notes, claim });
  return Promise.all([open(), open()]);
}

await prepareHarnessI18n((params.get("lang") ?? "en") as Parameters<typeof prepareHarnessI18n>[0]);
await loadNamespace("notes");
if (params.has("starter")) await openStarterTwice();
createRoot(root).render(<Harness />);
document.body.dataset.fixtureState = "mounted";
