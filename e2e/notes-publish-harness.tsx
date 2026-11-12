import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { useShareDialog } from "/src/components/collab/share-dialog";
import { loadNamespace } from "/src/i18n";
import { PublishedNotesSection } from "/src/features/collab/console/PublishedNotesSection";
import { PublishedNotesList } from "/src/features/collab/PublishedNotesList";
import { RuntimeSettingsTab } from "/src/features/collab/RuntimeSettingsTab";
import { ShareDialog } from "/src/features/collab/sharing/ShareDialog";
import { useFilesStore } from "/src/store/files";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

const SERVER_ID = "0192a0b0-0000-7000-8000-0000000000a1";
const NOTE = {
  id: "note-1",
  name: "Coral survey notes",
  main_doc: "note.md",
  kind: "note",
  created_at: 1_762_000_000,
  updated_at: 1_762_000_000,
  has_preview: false,
  exports: [],
  forked_from: null,
  recovery_pending: false,
  related_project: null,
};

await prepareHarnessI18n();
await loadNamespace("collab");
const view = new URLSearchParams(location.search).get("view");
useFilesStore.setState({ projectId: null, projects: [NOTE] });
useShareDialog.setState({ projectId: NOTE.id, fromCopy: false });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    {view === "console" ? (
      <main className="mx-auto max-w-3xl p-6">
        <PublishedNotesSection serverId={SERVER_ID} now={1_762_000_600_000} />
      </main>
    ) : null}
    {view === "settings" ? (
      <main className="mx-auto max-w-xl space-y-6 p-6">
        <PublishedNotesList serverId={SERVER_ID} />
        <RuntimeSettingsTab serverId={SERVER_ID} actor="admin" />
      </main>
    ) : null}
    {view === null ? <ShareDialog projectId={NOTE.id} /> : null}
  </QueryClientProvider>,
);
