import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { loadNamespace } from "/src/i18n";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

const params = new URLSearchParams(window.location.search);
const SERVER = "https://www.overleaf.com";
const ALICE = { userId: "64f1c2a3b4c5d6e7f8091a2b", email: "alice@uni.edu" };
const BOB = { userId: "64f1c2a3b4c5d6e7f8091a2c", email: "bob@lab.org" };
const CAROL = { userId: "64f1c2a3b4c5d6e7f8091a2d", email: "carol@lab.org" };
const LAB = "https://latex.lab.org";
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
let current: { userId: string; email: string } | null = params.get("signedIn") === "0" ? null : accounts[0];
let elsewhere = params.get("elsewhere") === "1" ? [CAROL] : [];
let asked = false;
if (current === null) accounts = [];
let projects = [THESIS];
let invites = [INVITE];

const badge = (color: string) =>
  `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="${color}"/></svg>`)}`;
const BROWSER_ICONS = { brave: badge("#f1562b"), chrome: badge("#4285f4"), firefox: badge("#8a3ffc") };
const signInBrowser = (key: string, product: string, packaging: string | null = null) => ({
  key,
  name: packaging ? `${product} (${packaging})` : product,
  product,
  packaging,
});
const SIGN_IN_BROWSERS = [
  signInBrowser("brave", "Brave"),
  signInBrowser("chrome", "Google Chrome"),
  signInBrowser("firefox", "Firefox"),
  signInBrowser("edge", "Microsoft Edge"),
  signInBrowser("chromium-snap", "Chromium", "Snap"),
  signInBrowser("firefox-flatpak", "Firefox", "Flatpak"),
];
const profile = (browser: string, browserName: string, folder: string, profileName: string, status = "available") => ({
  browser,
  browserName,
  profile: folder,
  profileName,
  status,
});
const BROWSER_PROFILES = [
  profile("chrome", "Google Chrome", "Default", "Person 1"),
  profile("brave", "Brave", "Default", "General"),
  profile("brave", "Brave", "Profile 1", "The Hustle"),
  profile("brave", "Brave", "Profile 2", "The Final Grind", "no_cookie_store"),
  profile("brave", "Brave", "Profile 3", "RNerd"),
  profile("firefox", "Firefox", "wlg1oyhc.default-release", "default-release"),
];

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
    if (args.server === LAB) {
      if (params.get("unsent") === "1" && !asked) {
        asked = true;
        const left = { server: LAB, signedIn: true, email: CAROL.email, userId: CAROL.userId, accounts: elsewhere };
        return { ...left, unsent: [{ project_id: "p1", name: "Lab report", paths: ["main.tex"] }] };
      }
      elsewhere = elsewhere.filter((account) => account.userId !== args.account);
      return { server: LAB, signedIn: false, email: null, userId: null, accounts: elsewhere };
    }
    accounts = accounts.filter((account) => account.userId !== args.account);
    if (current && current.userId === args.account) current = accounts[0] ?? null;
    return status();
  },
  overleaf_sign_ins: () => [
    ...accounts.map((account, index) => ({
      server: SERVER,
      ...account,
      current: account.userId === current?.userId,
      signedInAt: Math.floor(Date.now() / 1000) - index * 7_200,
    })),
    ...elsewhere.map((account) => ({ server: LAB, ...account, current: true, signedInAt: null })),
  ],
  overleaf_browser_icons: () => BROWSER_ICONS,
  overleaf_sign_in_browsers: () => SIGN_IN_BROWSERS.slice(0, Number(params.get("tiles") ?? 0)),
  overleaf_sign_in_with_browser: (args) => {
    if (args.browser === "firefox") throw appError("overleaf.browser_unavailable");
    return new Promise(() => undefined);
  },
  overleaf_git_token_status: () => false,
  detect_browser_cookie_sources: () => (params.get("browsers") === "1" ? BROWSER_PROFILES : []),
  import_browser_cookies: () => ({ imported: 3, browserName: "Brave", profileName: "General", domain: "www.overleaf.com" }),
  overleaf_sign_in_with_app_cookies: () => {
    current = params.get("copied") === "bob" ? BOB : ALICE;
    accounts = [current, ...accounts.filter((account) => account.userId !== current?.userId)];
    return status();
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

async function shownView() {
  switch (params.get("view")) {
    case "put":
      return putView();
    case "accounts":
      return accountsView();
    default:
      return importView();
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(await shownView());
document.body.dataset.fixtureState = "mounted";
