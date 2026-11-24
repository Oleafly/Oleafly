import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { loadNamespace } from "/src/i18n";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

const params = new URLSearchParams(window.location.search);
const SERVER = "https://www.overleaf.com";
const ALICE = { userId: "64f1c2a3b4c5d6e7f8091a2b", email: "alice@uni.edu" };
const BOB = { userId: "64f1c2a3b4c5d6e7f8091a2c", email: "bob@lab.org" };
const calls: { command: string; args: unknown }[] = [];
const opened: string[] = [];

const project = (id: string, name: string) => ({
  id,
  name,
  ownerName: "Olivia Park",
  owned: false,
  access: "readAndWrite",
  lastUpdated: new Date(Date.now() - 3_600_000).toISOString(),
  lastUpdatedBy: null,
  archived: false,
  importedAs: null,
});
const THESIS = project("6af963ebc9037022065bb53f", "Thesis");
const INVITED = project("6af963ebc9037022065bb5aa", "Grant proposal");
const SHARED = project("6af963ebc9037022065bb5bb", "Reading group");
const CREATED = "6af963ebc9037022065bb5cc";
const INVITE = {
  id: "6b04e5f6c0ffee0000000001",
  projectId: INVITED.id,
  projectName: INVITED.name,
  inviter: "Olivia Park",
  expires: null,
};

let accounts = params.get("accounts") === "2" ? [ALICE, BOB] : [ALICE];
let current: { userId: string; email: string } | null = accounts[0];
let projects = [THESIS];
let invites = [INVITE];

const appError = (code: string) => `@oleafly/error:${JSON.stringify({ code, params: {}, detail: null })}`;
const status = () => ({
  server: SERVER,
  signedIn: current !== null,
  email: current?.email ?? null,
  userId: current?.userId ?? null,
  accounts,
});

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  overleaf_status: status,
  overleaf_list_projects: () => ({ status: status(), projects, invites }),
  overleaf_open_live: (args) => {
    if (params.get("open") === "refused") throw appError("overleaf.project_unavailable");
    return { projectId: `local-${String(args.remoteId)}`, reused: false };
  },
  overleaf_invite_accept: (args) => {
    invites = invites.filter((invite) => invite.id !== args.invite);
    projects = [...projects, INVITED];
    return { server: SERVER, projectId: INVITED.id };
  },
  overleaf_link_preview: (args) => {
    const link = String(args.link);
    if (link.includes("gone")) throw appError("overleaf.link_unavailable");
    const grants = link.includes("/read/") ? "view" : "edit";
    return { server: SERVER, projectName: SHARED.name, grants, projectId: null };
  },
  overleaf_link_join: () => {
    projects = [...projects, SHARED];
    return { server: SERVER, projectId: SHARED.id };
  },
  overleaf_create_from_local: (args) => {
    if (params.get("create") === "refused") throw appError("overleaf.create_one_folder");
    return { server: SERVER, remoteId: CREATED, name: String(args.name ?? "") };
  },
  overleaf_use_account: (args) => {
    current = accounts.find((account) => account.userId === args.account) ?? current;
    return status();
  },
  overleaf_sign_out: (args) => {
    accounts = accounts.filter((account) => account.userId !== args.account);
    if (current && current.userId === args.account) current = accounts[0] ?? null;
    return status();
  },
  overleaf_sign_in_browsers: () => [],
  overleaf_git_token_status: () => false,
  detect_browser_cookie_sources: () => [],
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
Object.assign(window, { __calls: calls, __opened: opened });

await prepareHarnessI18n();
await Promise.all([loadNamespace("library"), loadNamespace("settings"), loadNamespace("errors")]);
const [{ createRoot }, react, { applyTheme }, settings, imports] = await Promise.all([
  import("react-dom/client"),
  import("react"),
  import("/src/lib/theme"),
  import("/src/store/settings"),
  import("/src/store/overleaf-import"),
]);
applyTheme(params.get("theme") === "dark" ? "dark" : "light");
settings.useSettingsStore.getState().setOverleafLive(params.get("live") !== "0");
imports.useOverleafImportStore.setState({ server: SERVER });

async function importView() {
  const { OverleafImportView } = await import("/src/components/library/overleaf/OverleafImportView");
  return react.createElement(
    "div",
    { className: "flex h-screen flex-col p-4" },
    react.createElement(OverleafImportView, {
      onOpenProject: (projectId: string) => opened.push(projectId),
      onDone: () => undefined,
    }),
  );
}

async function putView() {
  const { PutOnOverleafDialog } = await import("/src/components/library/overleaf/PutOnOverleafDialog");
  const local = { id: "local-paper", name: "Conference paper" };
  return react.createElement(PutOnOverleafDialog, {
    project: local as never,
    onClose: () => opened.push("closed"),
    onDone: (projectId: string) => opened.push(projectId),
  });
}

async function accountsView() {
  const { OverleafSection } = await import("/src/components/settings/OverleafSection");
  return react.createElement("div", { className: "max-w-2xl p-6" }, react.createElement(OverleafSection));
}

const views = new Map<string, () => Promise<ReturnType<typeof react.createElement>>>([
  ["import", importView],
  ["put", putView],
  ["accounts", accountsView],
]);
const view = await (views.get(params.get("view") ?? "import") ?? importView)();
createRoot(document.getElementById("root") as HTMLElement).render(view);
document.body.dataset.fixtureState = "mounted";
