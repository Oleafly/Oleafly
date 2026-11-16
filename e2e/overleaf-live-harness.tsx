import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
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
const [{ createRoot }, { OverleafSyncButton }, { OverleafLiveSetting }, { applyTheme }, files, react, bridge, liveStore, settings] = await Promise.all([
  import("react-dom/client"),
  import("/src/components/layout/overleaf-sync/OverleafSyncButton"),
  import("/src/components/layout/overleaf-sync/OverleafLiveSetting"),
  import("/src/lib/theme"),
  import("/src/store/files"),
  import("react"),
  import("/src/lib/collab-live-bridge"),
  import("/src/features/collab/live/live-store"),
  import("/src/store/settings"),
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
settings.useSettingsStore.getState().setOverleafLive(params.get("on") === "1");
createRoot(document.getElementById("root") as HTMLElement).render(
  params.get("view") === "card"
    ? react.createElement("div", { className: "max-w-2xl space-y-2 p-6" }, react.createElement(OverleafLiveSetting))
    : react.createElement(
        "div",
        { "data-testid": "harness-toolbar", className: "flex h-10 items-center justify-end gap-1 border-b bg-background px-3" },
        react.createElement(OverleafSyncButton),
      ),
);
document.body.dataset.fixtureState = "mounted";
