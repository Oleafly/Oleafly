import { useEffect, useRef, useState } from "react";
import {
  BookMarked,
  BookOpen,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Github,
  Globe,
  Keyboard,
  LifeBuoy,
  Loader2,
  Palette,
  RefreshCw,
  RotateCcw,
  Scale,
  ScrollText,
  Settings,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { reportCrashToGithub } from "@/lib/crash-report";
import { isTauri } from "@tauri-apps/api/core";
import { platform as osPlatform, arch as osArch, version as osVersion } from "@tauri-apps/plugin-os";
import { Button } from "@/components/ui/button";
import { UpdateChecker } from "@/components/layout/UpdateChecker";
import { EngineSection } from "@/components/settings/EngineSection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore, ACCENTS } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useDictionary } from "@/lib/dictionary";
import { useTheme } from "@/lib/theme";
import { useGithubStore } from "@/store/github";
import {
  appVersion,
  getConfig,
  setConfig,
  gitCurrentBranch,
  gitGetRemote,
  gitPull,
  gitPush,
  gitRemoveRemote,
  gitSetRemote,
  libraryRoot,
  type AppConfig,
} from "@/lib/tauri";
import {
  GITHUB_OAUTH_CLIENT_ID,
  checkDeviceToken,
  githubCreateRepo,
  requestDeviceCode,
  type DeviceCode,
} from "@/lib/github";
import {
  PROVIDERS,
  credentialMeta,
  defaultModel,
  getProvider,
} from "@/lib/ai-providers";
import { listOllamaModels, DEFAULT_OLLAMA_HOST } from "@/lib/ollama";
import { cn } from "@/lib/utils";

type Section =
  | "appearance"
  | "general"
  | "dictionary"
  | "data"
  | "ai"
  | "engine"
  | "github"
  | "help";

const NAV: { id: Section; label: string; icon: typeof Palette }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "general", label: "General", icon: Settings },
  { id: "dictionary", label: "Dictionary", icon: BookMarked },
  { id: "data", label: "Data Storage", icon: Database },
  { id: "ai", label: "AI Assistant", icon: Sparkles },
  { id: "engine", label: "LaTeX Engine", icon: Cpu },
  { id: "github", label: "GitHub", icon: Github },
  { id: "help", label: "Help & About", icon: LifeBuoy },
];

function Switch({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-zinc-300 dark:bg-zinc-600"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-1"
        )}
      />
    </span>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border bg-background p-3 hover:bg-accent"
    >
      <div>
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-xs text-muted-foreground">{desc}</div>}
      </div>
      <Switch checked={checked} />
    </div>
  );
}

export function SettingsModal() {
  const open = useSettingsStore((s) => s.settingsOpen);
  const setOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setHotkeysOpen = useSettingsStore((s) => s.setHotkeysOpen);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);
  const { theme, setTheme, toggleTheme } = useTheme();
  const vim = useSettingsStore((s) => s.vim);
  const toggleVim = useSettingsStore((s) => s.toggleVim);
  const spellcheck = useSettingsStore((s) => s.spellcheck);
  const toggleSpellcheck = useSettingsStore((s) => s.toggleSpellcheck);
  const harper = useSettingsStore((s) => s.harper);
  const setHarper = useSettingsStore((s) => s.setHarper);
  const showRegionalism = useSettingsStore((s) => s.showRegionalism);
  const setShowRegionalism = useSettingsStore((s) => s.setShowRegionalism);
  const showWordChoice = useSettingsStore((s) => s.showWordChoice);
  const setShowWordChoice = useSettingsStore((s) => s.setShowWordChoice);
  const offline = useSettingsStore((s) => s.offline);
  const setOffline = useSettingsStore((s) => s.setOffline);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const setEditorFontSize = useSettingsStore((s) => s.setEditorFontSize);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);

  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const refreshTree = useFilesStore((s) => s.refreshTree);

  const [section, setSection] = useState<Section>("appearance");
  const [libRoot, setLibRoot] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const settingsInitialSection = useSettingsStore((s) => s.settingsInitialSection);

  // Close Settings and pop the full keyboard-shortcuts reference on top.
  const openHotkeys = () => {
    setOpen(false);
    setHotkeysOpen(true);
  };

  const doReset = () => {
    resetToDefaults();
    // Theme lives in a separate store; return it to the OS preference.
    setTheme(
      window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    );
    setConfirmReset(false);
  };

  useEffect(() => {
    if (!open) return;
    setSection(settingsInitialSection as Section);
    void libraryRoot().then(setLibRoot).catch(() => {});
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex h-[min(620px,86vh)] w-[min(820px,94vw)] overflow-hidden rounded-xl border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left nav */}
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-3">
          <div className="mb-2 px-2 text-sm font-semibold">Settings</div>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                section === id
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>

        {/* Right content */}
        <div className="flex min-w-0 flex-1 flex-col bg-muted/30">
          <div className="flex h-12 shrink-0 items-center justify-between border-b px-5">
            <h2 className="text-sm font-semibold">
              {NAV.find((n) => n.id === section)?.label}
            </h2>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-5">
            {section === "appearance" && (
              <div className="space-y-3">
                <ToggleRow
                  label="Dark mode"
                  desc="Switch between light and dark themes."
                  checked={theme === "dark"}
                  onChange={toggleTheme}
                />

                {/* Editor font size */}
                <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
                  <div>
                    <div className="text-sm font-medium">Editor font size</div>
                    <div className="text-xs text-muted-foreground">
                      The code editor's text size.
                    </div>
                  </div>
                  <Select
                    value={String(editorFontSize)}
                    onValueChange={(v) => setEditorFontSize(Number(v))}
                  >
                    <SelectTrigger className="w-[88px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {[11, 12, 13, 14, 15, 16, 18, 20].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}px
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Accent color */}
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-sm font-medium">Accent color</div>
                  <div className="mb-2 text-xs text-muted-foreground">
                    The app's primary highlight color (buttons, selections, cursor).
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {ACCENTS.map((a) => {
                      const active = accentColor === a.color;
                      return (
                        <button
                          key={a.id}
                          title={a.name}
                          onClick={() => setAccentColor(a.color)}
                          className={cn(
                            "flex size-8 items-center justify-center rounded-full border-2 transition-transform hover:scale-110",
                            active
                              ? "border-foreground ring-2 ring-foreground/20"
                              : "border-border"
                          )}
                          style={{ backgroundColor: a.color }}
                        >
                          {active && (
                            <Check className="size-3.5 text-white drop-shadow" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {section === "general" && (
              <div className="space-y-2">
                <ToggleRow
                  label="Vim mode"
                  desc="Enable Vim keybindings in the editor."
                  checked={vim}
                  onChange={toggleVim}
                />
                <ToggleRow
                  label="Spellcheck"
                  desc="Underline misspelled words (English, WASM Hunspell). Used when Grammar & style is off."
                  checked={spellcheck}
                  onChange={toggleSpellcheck}
                />
                <ToggleRow
                  label="Spelling, grammar & style (Harper)"
                  desc="Offline spelling, grammar, and style suggestions on .tex prose (not code or math), with one-click fixes."
                  checked={harper}
                  onChange={setHarper}
                />
                {harper && (
                  <>
                    <ToggleRow
                      label="Regionalism suggestions"
                      desc="Flag British vs. American usage (e.g. suggests “wrench” for “spanner”). Turn off if you use such terms as product or code names."
                      checked={showRegionalism}
                      onChange={setShowRegionalism}
                    />
                    <ToggleRow
                      label="Word-choice suggestions"
                      desc="Suggest alternative words (e.g. “too” vs. “to”). Turn off to keep only spelling and grammar."
                      checked={showWordChoice}
                      onChange={setShowWordChoice}
                    />
                  </>
                )}
                <ToggleRow
                  label="Offline mode"
                  desc="Compile with --only-cached; never fetch packages over the network."
                  checked={offline}
                  onChange={setOffline}
                />
                <button
                  type="button"
                  onClick={openHotkeys}
                  className="flex w-full items-center gap-2 rounded-lg border bg-background p-3 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Keyboard className="size-4 shrink-0" />
                  <span className="flex-1">
                    Shortcuts: <kbd>⌘K</kbd> command palette · <kbd>⌘↵</kbd> recompile ·{" "}
                    <kbd>⌘B</kbd>/<kbd>⌘I</kbd> bold/italic · see all
                  </span>
                  <ChevronRight className="size-4 shrink-0" />
                </button>

                <div className="mt-2 flex items-center justify-between gap-3 border-t pt-4">
                  <div>
                    <p className="text-sm">Reset settings</p>
                    <p className="text-xs text-muted-foreground">
                      Restore Appearance &amp; General preferences to defaults.
                    </p>
                  </div>
                  {confirmReset ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="destructive" size="sm" onClick={doReset}>
                        Reset
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setConfirmReset(true)}
                    >
                      <RotateCcw className="size-3.5" />
                      Reset to defaults
                    </Button>
                  )}
                </div>
              </div>
            )}

            {section === "dictionary" && (
              <DictionarySection projectId={projectId} projectName={projectName} />
            )}

            {section === "data" && (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  OpenLeaf is local-first. All projects live on your disk:
                </p>
                <code className="block break-all rounded-lg border bg-background p-3 text-xs">
                  {libRoot || "~/.openleaf/projects"}
                </code>
                <p className="text-xs text-muted-foreground">
                  Each project is a plain folder with a <code>.git</code> history. Nothing leaves
                  your machine unless you push to GitHub.
                </p>
                <div className="flex items-start gap-2 rounded-lg border border-dashed bg-background p-3 text-xs text-muted-foreground">
                  <Github className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Back up or sync a project across devices: connect GitHub, then use{" "}
                    <strong className="font-medium text-foreground">Push</strong> /{" "}
                    <strong className="font-medium text-foreground">Pull</strong> in Source Control.{" "}
                    <button
                      onClick={() => setSection("github")}
                      className="font-medium text-primary hover:underline"
                    >
                      Set up GitHub →
                    </button>
                  </span>
                </div>
              </div>
            )}

            {section === "ai" && <AISection />}

            {section === "engine" && <EngineSection />}

            {section === "github" && (
              <GitHubSection
                projectId={projectId}
                projectName={projectName}
                onRemoteChanged={() => void refreshTree()}
              />
            )}

            {section === "help" && <HelpSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function IgnoreChips({
  words,
  onRemove,
}: {
  words: string[];
  onRemove: (w: string) => void;
}) {
  if (words.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing ignored yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {words.map((w) => (
        <span
          key={w}
          className="inline-flex items-center gap-1 rounded-md border bg-background py-1 pl-2 pr-1 text-xs"
        >
          <span className="font-mono">{w}</span>
          <button
            onClick={() => onRemove(w)}
            aria-label={`Stop ignoring ${w}`}
            title={`Stop ignoring “${w}”`}
            className="rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function DictionarySection({
  projectId,
  projectName,
}: {
  projectId: string | null;
  projectName: string;
}) {
  const global = useDictionary((s) => s.global);
  const ignored = useDictionary((s) => s.ignored);
  const unignore = useDictionary((s) => s.unignore);
  const unignoreGlobal = useDictionary((s) => s.unignoreGlobal);
  const projectWords = projectId ? ignored[projectId] ?? [] : [];

  return (
    <div className="space-y-5 text-sm">
      <p className="text-muted-foreground">
        Words you told the spell &amp; grammar checker to ignore. Remove one to
        start flagging it again.
      </p>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          This project{projectName ? ` · ${projectName}` : ""}
        </h3>
        <IgnoreChips
          words={projectWords}
          onRemove={(w) => projectId && unignore(projectId, w)}
        />
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          All projects
        </h3>
        <IgnoreChips words={global} onRemove={(w) => unignoreGlobal(w)} />
      </div>
    </div>
  );
}

function OllamaSetup({
  active,
  host,
  onHostChange,
  status,
  models,
  onDetect,
  selectedModel,
  onUse,
  onDisconnect,
}: {
  active: boolean;
  host: string;
  onHostChange: (v: string) => void;
  status: "idle" | "loading" | "ok" | "down";
  models: string[];
  onDetect: () => void;
  selectedModel: string;
  onUse: (model: string) => void;
  onDisconnect?: () => void;
}) {
  const [showHost, setShowHost] = useState(false);
  const shown = host.trim() || DEFAULT_OLLAMA_HOST;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={status === "loading"}
          onClick={onDetect}
        >
          {status === "loading" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {status === "idle" ? "Check for Ollama" : "Re-check"}
        </Button>
        {status === "loading" ? (
          <span className="text-[11px] text-muted-foreground">Checking…</span>
        ) : status === "ok" ? (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-500">
            Running · {models.length} model{models.length === 1 ? "" : "s"}
          </span>
        ) : status === "down" ? (
          <span className="text-[11px] text-amber-600 dark:text-amber-500">
            Not detected
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Not checked yet</span>
        )}
      </div>

      {status === "down" && (
        <div className="space-y-1 rounded-md border border-dashed bg-background p-3 text-[11px] text-muted-foreground">
          <p>
            No Ollama responding at <code>{shown}</code>.
          </p>
          <p>
            1. Install from{" "}
            <button
              onClick={() => void open("https://ollama.com/download")}
              className="font-medium text-primary hover:underline"
            >
              ollama.com <ExternalLink className="inline size-3" />
            </button>{" "}
            · 2. It starts automatically (or run <code>ollama serve</code>) · 3. Pull a
            model, e.g. <code>ollama pull llama3.2</code> · 4. Re-check.
          </p>
        </div>
      )}

      {status === "ok" && models.length === 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          Ollama is running but no models are installed. Run{" "}
          <code>ollama pull llama3.2</code>, then Re-check.
        </p>
      )}

      {status === "ok" && models.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Model</span>
          <Select
            value={active && models.includes(selectedModel) ? selectedModel : ""}
            onValueChange={onUse}
          >
            <SelectTrigger className="h-8 flex-1">
              <SelectValue placeholder="Choose a model to use" />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              {models.map((id) => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {active && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
              <Check className="size-3" /> Active
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowHost((s) => !s)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          {showHost ? "Hide host" : "Change host (advanced)"}
        </button>
        {onDisconnect && (
          <button
            onClick={onDisconnect}
            className="text-[11px] text-muted-foreground hover:text-destructive"
          >
            Disconnect
          </button>
        )}
      </div>
      {showHost && (
        <input
          type="text"
          value={host}
          onChange={(e) => onHostChange(e.target.value)}
          placeholder={DEFAULT_OLLAMA_HOST}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      )}
    </div>
  );
}

function GitHubSection({
  projectId,
  projectName,
  onRemoteChanged,
}: {
  projectId: string | null;
  projectName: string;
  onRemoteChanged: () => void;
}) {
  const ghStatus = useGithubStore((s) => s.status);
  const ghUser = useGithubStore((s) => s.user);
  const ghLoading = useGithubStore((s) => s.loading);
  const connectWithToken = useGithubStore((s) => s.connectWithToken);
  const disconnect = useGithubStore((s) => s.disconnect);
  const refresh = useGithubStore((s) => s.refresh);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Device-flow state.
  const [flow, setFlow] = useState<DeviceCode | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);

  // Advanced PAT disclosure.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pat, setPat] = useState("");

  const [remote, setRemote] = useState("");
  const [branch, setBranch] = useState("");
  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

  const connected = ghStatus === "connected";

  useEffect(() => {
    if (ghStatus === "unknown") void refresh();
  }, [ghStatus, refresh]);

  useEffect(() => {
    if (!projectId) return;
    void gitGetRemote(projectId).then((r) => setRemote(r ?? ""));
    void gitCurrentBranch(projectId).then(setBranch).catch(() => setBranch(""));
  }, [projectId]);

  const note = (ok: boolean, text: string) => setMsg({ ok, text });

  // Lets the user cancel a running device flow. Bumping the generation
  // invalidates any in-flight poll (also guards cancel→reconnect races).
  const flowGenRef = useRef(0);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const connectDeviceFlow = async () => {
    if (!GITHUB_OAUTH_CLIENT_ID) {
      // No OAuth app configured yet - direct the user to the PAT route.
      setShowAdvanced(true);
      return;
    }
    const gen = ++flowGenRef.current;
    const cancelled = () => flowGenRef.current !== gen;
    setFlowError(null);
    setBusy(true);
    setFlow(null);
    try {
      const dc = await requestDeviceCode(GITHUB_OAUTH_CLIENT_ID);
      if (cancelled()) return;
      setFlow(dc);
      void open(dc.verification_uri);

      // Poll loop runs in JS: cancellable, and each Rust call is async + short
      // so it never freezes the webview.
      let wait = Math.max(dc.interval, 5) * 1000;
      const deadline = Date.now() + 16 * 60 * 1000;
      let token: string | null = null;
      while (Date.now() < deadline && !cancelled()) {
        await sleep(wait);
        if (cancelled()) return;
        const res = await checkDeviceToken(GITHUB_OAUTH_CLIENT_ID, dc.device_code);
        if (cancelled()) return;
        if (res.status === "token") {
          token = res.token;
          break;
        }
        if (res.status === "slow_down") wait = res.interval * 1000;
      }
      if (cancelled()) return;

      if (!token) {
        setFlowError("GitHub sign-in timed out. Try again.");
        setFlow(null);
        return;
      }
      await connectWithToken(token);
      if (cancelled()) return;
      setFlow(null);
      note(true, `Connected as @${useGithubStore.getState().user?.login ?? "GitHub"}`);
    } catch (e) {
      if (cancelled()) return;
      setFlowError(String(e));
      setFlow(null);
    } finally {
      if (!cancelled()) setBusy(false);
    }
  };

  const cancelFlow = () => {
    flowGenRef.current++;
    setFlow(null);
    setFlowError(null);
    setBusy(false);
  };

  const copyCode = (code: string) => {
    void navigator.clipboard?.writeText(code).catch(() => {});
  };

  const connectPat = async () => {
    if (!pat.trim()) return;
    setBusy(true);
    setFlowError(null);
    try {
      await connectWithToken(pat.trim());
      setPat("");
      setShowAdvanced(false);
      note(true, `Connected as @${useGithubStore.getState().user?.login ?? "GitHub"}`);
    } catch (e) {
      setFlowError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doDisconnect = async () => {
    await disconnect();
    note(true, "Disconnected.");
  };

  const saveRemote = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await gitSetRemote(projectId, remote.trim());
      onRemoteChanged();
      note(true, "Remote saved.");
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await gitRemoveRemote(projectId);
      setRemote("");
      onRemoteChanged();
      note(true, "Unlinked from GitHub.");
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  const createRepo = async () => {
    if (!connected) return note(false, "Connect GitHub first.");
    const name = (repoName.trim() || projectName || projectId || "openleaf-project")
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    setBusy(true);
    try {
      const repo = await githubCreateRepo(name, isPrivate);
      if (projectId) {
        // Set a CLEAN remote (no embedded token). Auth is supplied at push/pull
        // time by the Rust env-backed credential helper, so the token never
        // touches .git/config on disk.
        await gitSetRemote(projectId, repo.clone_url);
        setRemote(repo.clone_url);
        onRemoteChanged();
      }
      note(true, `Created ${repo.full_name} and linked it.`);
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  const push = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      note(true, await gitPush(projectId));
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  const pull = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      note(true, await gitPull(projectId));
      onRemoteChanged();
    } catch (e) {
      note(false, String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 text-sm">
      {/* Account */}
      <div className="space-y-2">
        <div className="font-medium">GitHub account</div>
        {connected ? (
          <div className="flex items-center gap-3 rounded-lg border bg-background p-3">
            {ghUser?.avatar_url ? (
              <img
                src={ghUser.avatar_url}
                alt=""
                className="size-8 rounded-full object-cover"
              />
            ) : (
              <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-background">
                <Github className="size-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                @{ghUser?.login ?? "GitHub"}
              </div>
              <div className="text-xs text-muted-foreground">
                {ghUser?.name ? ghUser.name : "Connected"}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={ghLoading}
              onClick={() => void doDisconnect()}
              className="hover:bg-destructive/10 hover:text-destructive"
            >
              Disconnect
            </Button>
          </div>
        ) : flow ? (
          <div className="space-y-3 rounded-lg border bg-background p-4">
            <div>
              <div className="text-sm font-semibold">Enter this code on GitHub</div>
              <div className="text-xs text-muted-foreground">
                We opened{" "}
                <button
                  onClick={() => void open(flow.verification_uri)}
                  className="font-medium text-primary hover:underline dark:text-primary"
                >
                  {flow.verification_uri}
                </button>{" "}
                in your browser. Paste the code there to authorize OpenLeaf.
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 rounded-md border bg-muted/40 py-4">
              <code className="select-all font-mono text-2xl font-semibold tracking-[0.25em]">
                {flow.user_code}
              </code>
              <Button
                size="sm"
                variant="ghost"
                className="ml-1"
                onClick={() => copyCode(flow.user_code)}
              >
                Copy
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void open(flow.verification_uri)}>
                Open GitHub
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelFlow}>
                Cancel
              </Button>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Waiting for authorization…
              </span>
            </div>
          </div>
        ) : (
          <>
            <Button
              disabled={busy || ghLoading}
              onClick={() => void connectDeviceFlow()}
            >
              {busy || ghLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Github className="size-4" />
              )}
              Connect GitHub
            </Button>
            {flowError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {flowError}
              </div>
            )}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 pt-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              Advanced: use a personal access token
            </button>
            {showAdvanced && (
              <div className="flex gap-2 pt-1">
                <input
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="ghp_…"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
                <Button
                  size="sm"
                  disabled={busy || !pat.trim()}
                  onClick={() => void connectPat()}
                >
                  Connect
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {GITHUB_OAUTH_CLIENT_ID
                ? "Signs you in with a one-time code in your browser."
                : "OAuth sign-in isn't configured in this build yet - paste a token instead."}
            </p>
          </>
        )}
      </div>

      <hr className="border-border" />

      {/* Current project */}
      <div className="space-y-2">
        <div className="font-medium">
          Repository {projectId ? `· ${projectId}` : ""}
          {branch && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              {branch}
            </span>
          )}
        </div>
        {projectId ? (
          <>
            <div className="flex gap-2">
              <input
                value={remote}
                onChange={(e) => setRemote(e.target.value)}
                placeholder="https://github.com/you/repo.git"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void saveRemote()}>
                Save
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy || !remote || !connected} onClick={() => void push()}>
                <Github className="size-3.5" /> Push
              </Button>
              <Button size="sm" variant="secondary" disabled={busy || !remote} onClick={() => void pull()}>
                Pull
              </Button>
              {remote && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void unlink()}>
                  Unlink
                </Button>
              )}
            </div>

            <div className="pt-2 text-xs text-muted-foreground">
              No repo yet? Create one and link it:
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                placeholder={projectName || "repo-name"}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                Private
              </label>
              <Button
                size="sm"
                disabled={busy || !connected}
                onClick={() => void createRepo()}
              >
                Create &amp; link
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Open a project to configure its remote and push.
          </p>
        )}
      </div>

      {msg && (
        <div
          className={cn(
            "rounded-md border p-2.5 text-xs",
            msg.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          )}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

const AI_TOOLS: { name: string; desc: string }[] = [
  { name: "read_file", desc: "Read a file's contents" },
  { name: "write_file", desc: "Write or overwrite a file" },
  { name: "replace_in_file", desc: "Find & replace within a file" },
  { name: "create_file", desc: "Create a file or folder" },
  { name: "rename_file", desc: "Rename or move a path" },
  { name: "delete_file", desc: "Delete a file or folder" },
  { name: "list_files", desc: "List the project tree" },
  { name: "search_project", desc: "Search text across all projects" },
  { name: "compile", desc: "Compile LaTeX to PDF" },
  { name: "get_log", desc: "Get the last compile log" },
  { name: "get_pdf_text", desc: "Extract text from the PDF" },
  { name: "set_main_doc", desc: "Set the main document" },
  { name: "toggle_theme", desc: "Toggle light/dark mode" },
];

const DEFAULT_CFG: AppConfig = {
  github_token: "",
  github_user: "",
  github_connected: false,
  ai_api_key: "",
  ai_provider: "openai",
  ai_model: "gpt-4o-mini",
  ai_keys: {},
  ai_system_prompt: "",
};

function AISection() {
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CFG);
  // Per-provider editable credentials in the UI.
  const [keys, setKeys] = useState<Record<string, string>>({});
  // Snapshot of what's persisted, to know whether a field is "new/unsaved".
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [toolsOpen, setToolsOpen] = useState(true);
  // Draft of the user's custom system-prompt addition (saved explicitly).
  const [sysPrompt, setSysPrompt] = useState("");
  const [sysPromptSaved, setSysPromptSaved] = useState(false);
  // Explicit expand/collapse per provider card. Unset falls back to "open if
  // active", so the provider in use is expanded and the rest are tucked away.
  const [openProviders, setOpenProviders] = useState<Record<string, boolean>>({});
  // Live Ollama detection: which models are actually installed locally.
  const [ollama, setOllama] = useState<{
    status: "idle" | "loading" | "ok" | "down";
    models: string[];
  }>({ status: "idle", models: [] });

  useEffect(() => {
    void getConfig().then((c) => {
      // Migrate the legacy single key into the per-provider map once.
      const merged: Record<string, string> = { ...(c.ai_keys ?? {}) };
      const legacy = c.ai_provider || "openai";
      if (Object.keys(merged).length === 0 && c.ai_api_key) {
        merged[legacy] = c.ai_api_key;
      }
      const next: AppConfig = { ...DEFAULT_CFG, ...c, ai_keys: merged };
      setCfg(next);
      setSysPrompt(next.ai_system_prompt || "");
      setKeys(merged);
      setSavedKeys(merged);
      if (Object.keys(c.ai_keys ?? {}).length === 0 && c.ai_api_key) {
        void setConfig(next);
      }
    });
  }, []);

  const activeProvider = cfg.ai_provider;

  const refreshOllama = async (host: string) => {
    setOllama((o) => ({ ...o, status: "loading" }));
    try {
      const models = await listOllamaModels(host);
      setOllama({ status: "ok", models });
    } catch {
      setOllama({ status: "down", models: [] });
    }
  };

  // Auto-check for a local Ollama whenever the AI settings open (and after the
  // saved host changes). It's a cheap localhost request that fails fast, so we
  // run it proactively rather than making the user configure a host first.
  const savedOllamaHost = cfg.ai_keys?.ollama ?? "";
  useEffect(() => {
    void refreshOllama(savedOllamaHost || DEFAULT_OLLAMA_HOST);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOllamaHost]);

  // Pick an installed Ollama model: saves the host (default localhost) and makes
  // Ollama the active provider with that model. No separate "Save" step needed.
  const applyOllamaModel = async (model: string) => {
    const host = (keys.ollama || DEFAULT_OLLAMA_HOST).trim();
    const nextKeys = { ...keys, ollama: host };
    setSaving("ollama");
    setMsg(null);
    try {
      await persist({
        ...cfg,
        ai_keys: nextKeys,
        ai_provider: "ollama",
        ai_model: model,
      });
      setKeys(nextKeys);
      setSavedKeys(nextKeys);
      setMsg({ ok: true, text: `Ollama connected · ${model}` });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSaving(null);
    }
  };

  const persist = async (next: AppConfig) => {
    await setConfig(next);
    setCfg(next);
    // Notify live listeners (e.g. the chat panel) that AI config changed.
    window.dispatchEvent(new CustomEvent("openleaf:ai-config-changed"));
  };

  const saveProvider = async (id: string) => {
    const value = (keys[id] ?? "").trim();
    if (!value) return;
    setSaving(id);
    setMsg(null);
    try {
      const nextKeys = { ...keys, [id]: value };
      const sameProvider = cfg.ai_provider === id;
      const next: AppConfig = {
        ...cfg,
        ai_keys: nextKeys,
        ai_provider: id,
        ai_model: sameProvider ? cfg.ai_model : defaultModel(id),
      };
      await persist(next);
      setKeys(nextKeys);
      setSavedKeys(nextKeys);
      setMsg({
        ok: true,
        text: `${getProvider(id)?.name ?? id} connected and now active.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSaving(null);
    }
  };

  const activate = async (id: string) => {
    if (cfg.ai_provider === id) return;
    setSaving(id);
    setMsg(null);
    try {
      await persist({ ...cfg, ai_provider: id, ai_model: defaultModel(id) });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSaving(null);
    }
  };

  const changeModel = async (modelId: string) => {
    try {
      await persist({ ...cfg, ai_model: modelId });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };

  const saveSystemPrompt = async () => {
    try {
      await persist({ ...cfg, ai_system_prompt: sysPrompt });
      setSysPromptSaved(true);
      setTimeout(() => setSysPromptSaved(false), 1500);
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };

  const deleteKey = async (id: string) => {
    setSaving(id);
    setMsg(null);
    try {
      const nextKeys = { ...keys };
      delete nextKeys[id];
      const wasActive = cfg.ai_provider === id;
      const next: AppConfig = {
        ...cfg,
        ai_keys: nextKeys,
        // Removing a key disables AI access: clear the active provider/model
        // when it was the one in use, and wipe the legacy single key too.
        ai_provider: wasActive ? "" : cfg.ai_provider,
        ai_model: wasActive ? "" : cfg.ai_model,
        ai_api_key: wasActive ? "" : cfg.ai_api_key,
      };
      await persist(next);
      setKeys(nextKeys);
      setSavedKeys(nextKeys);
      setMsg({
        ok: true,
        text: wasActive
          ? `${getProvider(id)?.name ?? id} key removed - AI access disabled.`
          : `${getProvider(id)?.name ?? id} key removed.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="overflow-hidden rounded-lg border bg-background">
        <button
          onClick={() => setToolsOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 p-3 text-left text-xs font-semibold hover:bg-accent/40"
          aria-expanded={toolsOpen}
        >
          <Sparkles className="size-3.5 text-primary" />
          The assistant currently supports these tools
          {toolsOpen ? (
            <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
          )}
        </button>
        {toolsOpen && (
          <div className="border-t px-3 pb-3 pt-2">
            <p className="mb-2 text-[11px] text-muted-foreground">
              Ask it things like "fix the LaTeX errors", "add a Publications section", or "recompile
              and check the PDF".
            </p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {AI_TOOLS.map((t) => (
                <div key={t.name} className="flex items-baseline gap-2 text-[11px]">
                  <code className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                    {t.name}
                  </code>
                  <span className="text-muted-foreground">{t.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Connect any providers you use below. Keys are stored locally only. Saving one sets it as the
        default; switch between configured providers and models anytime from the dropdown in the chat
        panel.
      </p>

      <div className="space-y-2.5">
        {PROVIDERS.map((p) => {
          const meta = credentialMeta(p.id);
          const value = keys[p.id] ?? "";
          const saved = savedKeys[p.id] ?? "";
          const dirty = value.trim().length > 0 && value !== saved;
          const isActive = activeProvider === p.id;
          const hasSaved = saved.length > 0;
          const isOpen = openProviders[p.id] ?? isActive;
          return (
            <div
              key={p.id}
              className={cn(
                "rounded-lg border bg-background transition-colors",
                isActive && "border-primary/40 ring-1 ring-primary/20"
              )}
            >
              <div className="flex items-start gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setOpenProviders((m) => ({ ...m, [p.id]: !isOpen }))}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{p.name}</span>
                    {isOpen && <p className="mt-0.5 text-xs text-muted-foreground">{p.blurb}</p>}
                  </div>
                </button>
                {isActive ? (
                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3" /> Active
                  </span>
                ) : hasSaved ? (
                  <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Connected
                  </span>
                ) : null}
                {p.signupUrl && isOpen && (
                  <button
                    onClick={() => void open(p.signupUrl!)}
                    className="flex shrink-0 items-center gap-1 text-[11px] text-primary hover:underline dark:text-primary"
                  >
                    {p.isHost ? "Docs" : "Get key"} <ExternalLink className="size-3" />
                  </button>
                )}
              </div>

              {!isOpen ? null : p.id === "ollama" ? (
                <div className="px-3 pb-3">
                  <OllamaSetup
                    active={isActive}
                    host={value}
                    onHostChange={(v) => setKeys((k) => ({ ...k, ollama: v }))}
                    status={ollama.status}
                    models={ollama.models}
                    onDetect={() => void refreshOllama(value || DEFAULT_OLLAMA_HOST)}
                    selectedModel={cfg.ai_model || ""}
                    onUse={(m) => void applyOllamaModel(m)}
                    onDisconnect={hasSaved ? () => void deleteKey("ollama") : undefined}
                  />
                </div>
              ) : (
                <div className="px-3 pb-3">
                  {isActive && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">Model</span>
                      <Select
                        value={cfg.ai_model || defaultModel(p.id)}
                        onValueChange={(v) => void changeModel(v)}
                      >
                        <SelectTrigger className="h-8 flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[100]">
                          {p.models.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <input
                      type="password"
                      value={value}
                      onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                      placeholder={meta.placeholder}
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                    {dirty ? (
                      <Button
                        size="sm"
                        disabled={saving === p.id}
                        onClick={() => void saveProvider(p.id)}
                      >
                        {saving === p.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        Save
                      </Button>
                    ) : hasSaved && !isActive ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={saving === p.id}
                        onClick={() => void activate(p.id)}
                      >
                        Activate
                      </Button>
                    ) : null}
                    {hasSaved && (
                      <button
                        aria-label={`Delete ${p.name} key`}
                        title="Delete key"
                        disabled={saving === p.id}
                        onClick={() => void deleteKey(p.id)}
                        className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-t pt-4">
        <p className="font-medium">Custom instructions</p>
        <p className="text-xs text-muted-foreground">
          Added to every AI request as your personal style and preferences. The
          assistant follows these on top of its built-in behavior. They can't
          override its tools or safety rules.
        </p>
        <textarea
          value={sysPrompt}
          onChange={(e) => setSysPrompt(e.target.value)}
          rows={5}
          placeholder="e.g. Always write in British English. Keep explanations short. Prefer the enumitem package for lists."
          className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void saveSystemPrompt()}
            disabled={sysPrompt === (cfg.ai_system_prompt || "")}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            Save instructions
          </button>
          {sysPromptSaved && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>
          )}
        </div>
      </div>

      {msg && (
        <div
          className={cn(
            "rounded-md border p-2.5 text-xs",
            msg.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          )}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

const REPO_URL = "https://github.com/prajwal-svm/OpenLeaf";
const AUTHOR_URL = "http://prajwal.me";
const DOCS_URL = `${REPO_URL}/blob/main/docs/getting-started.md`;
const ISSUES_URL = `${REPO_URL}/issues/new`;
const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;
const LICENSES_URL = `${REPO_URL}/blob/main/THIRD_PARTY_LICENSES.md`;

function HelpSection() {
  const [version, setVersion] = useState("");
  const [copied, setCopied] = useState(false);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setHotkeysOpen = useSettingsStore((s) => s.setHotkeysOpen);
  useEffect(() => {
    void appVersion().then(setVersion).catch(() => setVersion(""));
  }, []);
  const ext = (url: string) => () => void open(url);

  // Close Settings first so the keyboard-shortcuts modal isn't hidden behind it.
  const openHotkeys = () => {
    setSettingsOpen(false);
    setHotkeysOpen(true);
  };

  // Copy a one-line diagnostics string people can paste into a bug report.
  const copyDiagnostics = async () => {
    const parts = [`OpenLeaf v${version || "?"}`];
    if (isTauri()) {
      try {
        parts.push(`${osPlatform()} ${osArch()}`, `OS ${osVersion()}`);
      } catch {
        /* os plugin unavailable */
      }
    }
    try {
      await navigator.clipboard.writeText(parts.join(" · "));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const resources: {
    icon: typeof BookOpen;
    label: string;
    onClick: () => void;
    external: boolean;
  }[] = [
    { icon: BookOpen, label: "Documentation", onClick: ext(DOCS_URL), external: true },
    { icon: Keyboard, label: "Keyboard shortcuts", onClick: openHotkeys, external: false },
    { icon: Bug, label: "Report a bug", onClick: ext(ISSUES_URL), external: true },
    {
      icon: TriangleAlert,
      label: "Report a crash (attach logs)",
      onClick: () => void reportCrashToGithub(),
      external: true,
    },
    { icon: ScrollText, label: "What's new", onClick: ext(CHANGELOG_URL), external: true },
    { icon: Scale, label: "Licenses", onClick: ext(LICENSES_URL), external: true },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">About OpenLeaf</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          A local-first, cross-platform LaTeX &amp; resume authoring app.
          {version && <span className="ml-1">· v{version}</span>}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <UpdateChecker />
          <button
            type="button"
            onClick={copyDiagnostics}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy version & system info"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Author</p>
          <button
            onClick={ext(AUTHOR_URL)}
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">Prajwal Murthy</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Project</p>
          <button
            onClick={ext(REPO_URL)}
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <Github className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">GitHub</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Resources</p>
        {resources.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={r.onClick}
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <r.icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{r.label}</span>
            {r.external ? (
              <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
