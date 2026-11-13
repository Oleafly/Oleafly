import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

const params = new URLSearchParams(window.location.search);
const HOUR = 60 * 60 * 1000;
const now = Date.now();
const calls: { command: string; args: unknown }[] = [];
let settings = { auto: true, everyHours: 24, keep: 30, includeProjects: false };
let lastOkMs: number | null = params.get("empty") === "1" ? null : now - 2 * HOUR;
const missing = new Set(["field-trip", "reading-list"]);

const backups =
  params.get("empty") === "1"
    ? []
    : [
        { id: `${String(now - 2 * HOUR).padStart(13, "0")}-0000abcd`, device: "dev-a", deviceName: "Laptop", thisDevice: true, createdMs: now - 2 * HOUR, scheduled: true, notes: 24, projects: 0, bytes: 3_250_000 },
        { id: `${String(now - 26 * HOUR).padStart(13, "0")}-0000abce`, device: "dev-a", deviceName: "Laptop", thisDevice: true, createdMs: now - 26 * HOUR, scheduled: false, notes: 23, projects: 0, bytes: 3_120_000 },
        { id: `${String(now - 50 * HOUR).padStart(13, "0")}-0000abcf`, device: "dev-b", deviceName: "Office desktop", thisDevice: false, createdMs: now - 50 * HOUR, scheduled: true, notes: 21, projects: 2, bytes: 48_000_000 },
      ];

const entries = [
  { id: "masking", kind: "note", name: "Masking strategy report", files: 4, bytes: 210_000 },
  { id: "field-trip", kind: "note", name: "Field trip, day 2", files: 3, bytes: 1_400_000 },
  { id: "reading-list", kind: "note", name: "Reading list", files: 1, bytes: 4_200 },
  { id: "abstract", kind: "note", name: "Abstract draft", files: 1, bytes: 3_100 },
];

function backupState() {
  return {
    settings,
    lastRunMs: lastOkMs,
    lastOkMs,
    lastError: params.get("failed") === "1" ? JSON.stringify({ code: "cloud.network", params: {} }) : null,
    last: lastOkMs ? { notes: 24, projects: settings.includeProjects ? 3 : 0, bytes: 3_250_000 } : null,
    running: false,
    due: false,
  };
}

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  cloud_state: () => ({
    status: "connected",
    provider: "dropbox",
    email: "ana@example.com",
    displayName: "Ana",
    deviceName: "Laptop",
    enabled: true,
    lastEmail: "ana@example.com",
    lastProvider: "dropbox",
    lastSyncedMs: now - 5 * 60 * 1000,
    lastError: null,
    quotaFull: false,
    linkedCount: 0,
    projects: [],
  }),
  cloud_providers: () => [
    { kind: "dropbox", auth: "oauth", available: true, pasteCode: true, quota: true },
    { kind: "google_drive", auth: "oauth", available: true, pasteCode: false, quota: true },
    { kind: "s3", auth: "credentials", available: true, pasteCode: false, quota: false },
  ],
  cloud_details: () => ({ space: { used: 1_200_000_000, allocated: 2_147_483_648 }, remote: [], error: null }),
  cloud_wait_for_changes: () => new Promise(() => {}),
  cloud_backup_state: () => backupState(),
  cloud_backup_set_settings: (args) => {
    settings = args.settings as typeof settings;
    return backupState();
  },
  cloud_backup_run: async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    lastOkMs = Date.now();
    return { ran: true, outcome: null, error: null };
  },
  cloud_backup_list: () => backups,
  cloud_backup_entries: () => entries.map((entry) => ({ ...entry, here: !missing.has(entry.id) })),
  cloud_backup_restore: async (args) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const wanted = (args.items as string[] | null) ?? entries.filter((entry) => missing.has(entry.id)).map((entry) => entry.id);
    const restored = wanted.map((id) => {
      const entry = entries.find((candidate) => candidate.id === id);
      const copy = !missing.has(id);
      missing.delete(id);
      return { from: id, to: `restored-${id}`, name: copy ? `${entry?.name} ${args.copyLabel}` : (entry?.name ?? id), copy };
    });
    return { restored, here: [], failed: [] };
  },
  list_projects: () => [],
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
const [{ createRoot }, { loadNamespace }, { CloudTab }, { applyTheme }, files, settingsStore, react] = await Promise.all([
  import("react-dom/client"),
  import("/src/i18n"),
  import("/src/components/settings/cloud/CloudTab"),
  import("/src/lib/theme"),
  import("/src/store/files"),
  import("/src/store/settings"),
  import("react"),
]);
await loadNamespace("cloud");
applyTheme(params.get("theme") === "dark" ? "dark" : "light");
files.useFilesStore.setState({ refreshProjects: async () => {} });
settingsStore.useSettingsStore.setState({ notes: params.get("notes") !== "0" });
createRoot(document.getElementById("root") as HTMLElement).render(
  react.createElement("div", { className: "mx-auto max-w-3xl p-6" }, react.createElement(CloudTab)),
);
document.body.dataset.fixtureState = "mounted";
