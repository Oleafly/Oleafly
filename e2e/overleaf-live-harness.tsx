import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { loadNamespace } from "/src/i18n";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

const params = new URLSearchParams(window.location.search);
const SERVER = "https://www.overleaf.com";
const REMOTE = "6af963ebc9037022065bb53f";
const calls: { command: string; args: unknown }[] = [];

const linked = params.get("linked") === "1";
const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  overleaf_sync_status: () => ({
    linked,
    server: SERVER,
    remoteId: linked ? REMOTE : null,
    auto: true,
    lastSyncAt: linked ? Math.floor(Date.now() / 1000) - 600 : null,
    tokenSaved: params.get("token") === "1",
    importedFrom: { server: SERVER, projectId: REMOTE },
  }),
};

mockWindows("main");
mockIPC(
  (command, args) => {
    calls.push({ command, args });
    const handler = handlers[command];
    return handler ? handler((args ?? {}) as Record<string, unknown>) : null;
  },
  { shouldMockEvents: true },
);
Object.assign(window, { __calls: calls });

await prepareHarnessI18n();
await loadNamespace("collab");
const [
  { createRoot },
  { OverleafSyncButton },
  { OverleafLiveSetting },
  { applyTheme },
  files,
  react,
  bridge,
  liveStore,
  settings,
  { OverleafBanners },
  { useOverleafNotices },
] = await Promise.all([
  import("react-dom/client"),
  import("/src/components/layout/overleaf-sync/OverleafSyncButton"),
  import("/src/components/layout/overleaf-sync/OverleafLiveSetting"),
  import("/src/lib/theme"),
  import("/src/store/files"),
  import("react"),
  import("/src/lib/collab-live-bridge"),
  import("/src/features/collab/live/live-store"),
  import("/src/store/settings"),
  import("/src/features/collab/live/OverleafBanners"),
  import("/src/features/collab/live/overleaf-notices"),
]);
applyTheme(params.get("theme") === "dark" ? "dark" : "light");
files.useFilesStore.setState({ projectId: "project-1" });

const live = params.get("live");
if (live) {
  const paused = live === "paused" || live === "gitpaused";
  const overleaf = { server: SERVER, remoteId: REMOTE, signedIn: live !== "signedout", paused };
  const statuses: Record<string, unknown> = {
    online: { state: "online" },
    sending: { state: "online" },
    connecting: { state: "connecting" },
    offline: { state: "offline", retry_in_ms: 4000 },
    reconnecting: { state: "offline", retry_in_ms: 4000 },
    maintenance: { state: "offline", retry_in_ms: 45_000 },
    idle: { state: "idle" },
    signedout: null,
    paused: null,
    gitpaused: null,
  };
  const going = !paused && live !== "signedout";
  liveStore.useCollabLiveStore.setState({
    projectId: "project-1",
    backend: going ? "overleaf" : null,
    overleaf,
    role: "editor",
    status: statuses[live] as never,
    pending: live === "offline" || live === "sending" ? 3 : 0,
  });
  bridge.useLiveBackend.setState({ projectId: "project-1", backend: going ? "overleaf" : null, overleaf });
  bridge.installOverleafLiveActions({
    pause: async () => ({ paused: false, unsent: ["main.tex", "sections/intro.tex"] }),
    resume: async () => undefined,
    unlink: async () => undefined,
  });
}
const notices = new Set(params.getAll("notice"));
const RESULTS = "\\section{Results}\nThe model converges after 40 epochs.\nAccuracy on the held-out set is 91.2\\%.\n";
useOverleafNotices.setState({
  projectId: "project-1",
  maintenance: notices.has("maintenance")
    ? { message: "The server is restarting for an update.", until: Date.now() + 45_000 }
    : null,
  reviews: notices.has("review")
    ? [
        {
          path: "sections/results.tex",
          mine: RESULTS,
          theirs: "\\section{Results}\nThe model converges after 55 epochs.\nAccuracy on the held-out set is 91.2\\%.\n",
        },
      ]
    : [],
  merged: notices.has("merged")
    ? [{ path: "main.tex", before: RESULTS, after: `${RESULTS}We report the mean of five runs.\n` }]
    : [],
  unsteady: notices.has("unsteady") ? ["refs.bib"] : [],
  slowAck: params.get("slow") === "1",
  failed: params.get("failed") === "1" ? "sections/results.tex" : null,
});
settings.useSettingsStore.getState().setOverleafLive(params.get("on") === "1");
const toolbar = react.createElement(
  "div",
  { "data-testid": "harness-toolbar", className: "flex h-10 items-center justify-end gap-1 border-b bg-background px-3" },
  react.createElement(OverleafSyncButton),
);
createRoot(document.getElementById("root") as HTMLElement).render(
  params.get("view") === "card"
    ? react.createElement("div", { className: "max-w-2xl space-y-2 p-6" }, react.createElement(OverleafLiveSetting))
    : react.createElement("div", { className: "flex flex-col" }, toolbar, react.createElement(OverleafBanners)),
);
document.body.dataset.fixtureState = "mounted";
