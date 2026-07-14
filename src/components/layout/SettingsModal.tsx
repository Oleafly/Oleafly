import { useEffect, useState } from "react";
import {
  BookMarked,
  BookOpen,
  Bug,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Github,
  Globe,
  HardDriveDownload,
  Keyboard,
  LifeBuoy,
  Palette,
  Plug,
  RotateCcw,
  Scale,
  ScrollText,
  Settings,
  Sparkles,
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
import { DownloadsSection } from "@/components/settings/DownloadsSection";
import { AISection } from "@/components/settings/AISection";
import { GitHubSection } from "@/components/settings/GitHubSection";
import { McpSection } from "@/components/settings/McpSection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore, ACCENTS, APP_FONTS, EDITOR_FONTS } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useDictionary } from "@/lib/dictionary";
import { useTheme } from "@/lib/theme";
import { appVersion, libraryRoot } from "@/lib/tauri";
import { cn, shortcut } from "@/lib/utils";

type Section =
  | "appearance"
  | "general"
  | "dictionary"
  | "data"
  | "ai"
  | "engine"
  | "downloads"
  | "github"
  | "mcp"
  | "help";

const NAV: { id: Section; label: string; icon: typeof Palette }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "general", label: "General", icon: Settings },
  { id: "dictionary", label: "Dictionary", icon: BookMarked },
  { id: "data", label: "Data Storage", icon: Database },
  { id: "ai", label: "AI Assistant", icon: Sparkles },
  { id: "engine", label: "LaTeX Engine", icon: Cpu },
  { id: "downloads", label: "Offline & Downloads", icon: HardDriveDownload },
  { id: "github", label: "GitHub", icon: Github },
  { id: "mcp", label: "MCP", icon: Plug },
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
      role="switch"
      aria-checked={checked}
      aria-label={label}
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
  const appFontSize = useSettingsStore((s) => s.appFontSize);
  const setAppFontSize = useSettingsStore((s) => s.setAppFontSize);
  const appFontFamily = useSettingsStore((s) => s.appFontFamily);
  const setAppFontFamily = useSettingsStore((s) => s.setAppFontFamily);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const setEditorFontFamily = useSettingsStore((s) => s.setEditorFontFamily);
  const defaultView = useSettingsStore((s) => s.defaultView);
  const setDefaultView = useSettingsStore((s) => s.setDefaultView);
  const openInTree = useSettingsStore((s) => s.openInTree);
  const hoverPreview = useSettingsStore((s) => s.hoverPreview);
  const setHoverPreview = useSettingsStore((s) => s.setHoverPreview);
  const setOpenInTree = useSettingsStore((s) => s.setOpenInTree);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);

  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const refreshTree = useFilesStore((s) => s.refreshTree);

  const [section, setSection] = useState<Section>("appearance");
  const [libRoot, setLibRoot] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const ADVANCED: Section[] = ["dictionary", "engine", "downloads", "data"];
  const [showAdvanced, setShowAdvanced] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem("ol-settings-advanced") === "1",
  );
  const setAdvanced = (v: boolean) => {
    setShowAdvanced(v);
    try { localStorage.setItem("ol-settings-advanced", v ? "1" : "0"); } catch { /* ignore */ }
    if (!v && ADVANCED.includes(section)) setSection("appearance");
  };
  const settingsInitialSection = useSettingsStore((s) => s.settingsInitialSection);

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
    const next = settingsInitialSection as Section;
    setSection(next);
    // Deep-links into advanced sections must surface them in the nav.
    if (ADVANCED.includes(next) && !showAdvanced) setAdvanced(true);
    void libraryRoot().then(setLibRoot).catch(() => {});
    // Both deps matter: re-applies the section if a flow (GitHub gate, AI
    // onboarding) retargets an already-open modal.
  }, [open, settingsInitialSection]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex h-[min(620px,86vh)] w-[min(820px,94vw)] overflow-hidden rounded-xl border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <nav aria-label="Settings sections" className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-3">
          <div className="mb-2 px-2 text-sm font-semibold">Settings</div>
          {NAV.filter(({ id }) => showAdvanced || !ADVANCED.includes(id)).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              data-testid={`settings-section-${id}`}
              onClick={() => setSection(id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                section === id
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
          <button
            type="button"
            data-testid="settings-toggle-advanced"
            onClick={() => setAdvanced(!showAdvanced)}
            className="mt-auto flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
          >
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </button>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col bg-muted/30">
          <div className="flex h-12 shrink-0 items-center justify-between border-b px-5">
            <h2 className="text-sm font-semibold">
              {NAV.find((n) => n.id === section)?.label}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Close settings"
              onClick={() => setOpen(false)}
            >
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

                <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
                  <div>
                    <div className="text-sm font-medium">App font size</div>
                    <div className="text-xs text-muted-foreground">
                      Scales the whole interface (menus, panels, and buttons).
                    </div>
                  </div>
                  <Select value={String(appFontSize)} onValueChange={(v) => setAppFontSize(Number(v))}>
                    <SelectTrigger className="w-[88px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {[13, 14, 15, 16, 17, 18, 20].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}px
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
                  <div>
                    <div className="text-sm font-medium">App font</div>
                    <div className="text-xs text-muted-foreground">
                      The interface font. Falls back if a font is not installed.
                    </div>
                  </div>
                  <Select
                    value={appFontFamily || "__default__"}
                    onValueChange={(v) => setAppFontFamily(v === "__default__" ? "" : v)}
                  >
                    <SelectTrigger className="w-[168px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {APP_FONTS.map((f) => (
                        <SelectItem key={f.name} value={f.value || "__default__"}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
                  <div>
                    <div className="text-sm font-medium">Editor font</div>
                    <div className="text-xs text-muted-foreground">
                      The monospace font used in the code editor.
                    </div>
                  </div>
                  <Select
                    value={editorFontFamily || "__default__"}
                    onValueChange={(v) => setEditorFontFamily(v === "__default__" ? "" : v)}
                  >
                    <SelectTrigger className="w-[168px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {EDITOR_FONTS.map((f) => (
                        <SelectItem key={f.name} value={f.value || "__default__"}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
                  <div>
                    <div className="text-sm font-medium">Open projects in</div>
                    <div className="text-xs text-muted-foreground">
                      The layout a project lands in when you open it.
                    </div>
                  </div>
                  <Select value={defaultView} onValueChange={(v) => setDefaultView(v as typeof defaultView)}>
                    <SelectTrigger className="w-[128px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      <SelectItem value="split">Split view</SelectItem>
                      <SelectItem value="editor">Editor only</SelectItem>
                      <SelectItem value="pdf">PDF only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <ToggleRow
                  label="Show file tree on open"
                  desc="Reveal the source-file tree whenever you open a project."
                  checked={openInTree}
                  onChange={() => setOpenInTree(!openInTree)}
                />

                <ToggleRow
                  label="Preview PDF on hover"
                  desc="Slide the last compiled page over a project card when you hover it in the library."
                  checked={hoverPreview}
                  onChange={setHoverPreview}
                />

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
                    Shortcuts: <kbd>{shortcut("⌘K")}</kbd> command palette ·{" "}
                    <kbd>{shortcut("⌘↵")}</kbd> recompile · <kbd>{shortcut("⌘B")}</kbd>/
                    <kbd>{shortcut("⌘I")}</kbd> bold/italic · see all
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
            {section === "downloads" && <DownloadsSection />}

            {section === "github" && (
              <GitHubSection
                projectId={projectId}
                projectName={projectName}
                onRemoteChanged={() => void refreshTree()}
              />
            )}

            {section === "mcp" && <McpSection />}

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



const REPO_URL = "https://github.com/prajwal-svm/OpenLeaf";
const AUTHOR_URL = "http://prajwal.me";
const DOCS_URL = "https://prajwal-svm.github.io/OpenLeaf/";
const ISSUES_URL = `${REPO_URL}/issues/new`;
const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

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
    { icon: Scale, label: "License", onClick: ext(LICENSE_URL), external: true },
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
