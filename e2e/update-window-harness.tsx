import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { UpdateDialog, type UpdatePhase } from "/src/components/layout/UpdateDialog";
import { ChangelogView } from "/src/components/layout/ChangelogDialog";
import { releaseEntriesFrom, useReleaseHistory, type ReleasePageFetcher } from "/src/lib/release-history";
import { applyTheme } from "/src/lib/theme";
import { ACCENTS } from "/src/store/settings";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

const NOTES = {
  real: `## What's new in 0.4.3

### Fixed

- The Windows installer carries the Oleafly icon. The downloaded
  \`-setup.exe\` used to show the generic installer icon in Explorer, in the
  browser download list and on the permission prompt.
- \`%novalidate\` now quiets the project diagnostics as well as the LaTeX
  checks. In 0.4.2 an environment opened inside a \`%begin novalidate\`
  region was still reported as unclosed a moment after the editor had
  accepted it.
- The end of an assistant reply no longer goes missing.
- Opening Settings > Skills no longer freezes the app for a few seconds on
  Windows.
- A biblatex bibliography no longer makes the first compile wait for Biber
  to unpack itself again. It now unpacks once into Oleafly's data folder and
  reuses it.
- Update checks and downloads use the proxy set in Windows or macOS settings,
  so updates work on networks that require one.
`,
  rich: `## What's new in 0.4.3

### Added

- **Quieter notifications.** Background work such as outline refreshes and
  bibliography checks no longer shows toasts, and a repeated message now
  updates the one already on screen. See the [architecture notes](https://github.com/Oleafly/Oleafly/blob/main/docs/architecture.md).
- Compile errors caused by a damaged image name the file, for example
  \`figures/decay.png\`, and say how to fix it.

### Changed

- The update window shows what changed at a glance.

  | Area | Before | Now |
  | --- | --- | --- |
  | Notes | Plain text | Sections, links and code |
  | Retry | Close and reopen | Try again |

> Downloads resume from the start if the connection drops.

### Fixed

- Resizable panels keep their sizes after the upgrade.
  - The sidebar remembers whether it was open.
  - Split views keep their ratio.
- Mail us at [support@oleafly.com](mailto:support@oleafly.com) if anything looks off.

### Security

- Links in release notes open only in your browser, and only for web and mail addresses.

\`\`\`bash
oleafly --version
\`\`\`
`,
  none: "",
} as const;

type NotesKey = keyof typeof NOTES;

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const LATEST_DATE = new Date(NOW - 1 * DAY_MS).toISOString();

const OLDER_VERSIONS = ["0.4.2", "0.4.1", "0.4.0", "0.3.13", "0.3.12", "0.3.11", "0.3.10", "0.3.9", "0.3.8", "0.3.7", "0.3.6", "0.3.5", "0.3.4", "0.3.3", "0.3.2"];

function fakeReleaseBody(version: string, index: number): string {
  const sections = [
    `### Added\n\n- A new tool in the sidebar for ${version}, with \`inline code\` and a [link](https://github.com/Oleafly/Oleafly/releases/tag/v${version}).\n- Faster project open on large folders.`,
    `### Fixed\n\n- A crash when a compile finished while the preview was closing.\n- Citations with accents sort correctly again.\n- The outline keeps its scroll position after an edit.`,
    `### Changed\n\n- Settings group related options together.\n\n\`\`\`bash\noleafly doctor --json\n\`\`\``,
  ];
  const body = sections.slice(0, 1 + (index % 3)).join("\n\n");
  return `## What's new in ${version}\n\n${body}\n`;
}

const FAKE_RELEASES = [
  { tag_name: "v0.4.3", draft: false, prerelease: false, body: NOTES.real, published_at: LATEST_DATE, html_url: "https://github.com/Oleafly/Oleafly/releases/tag/v0.4.3" },
  { tag_name: "cli-v0.1.0", draft: false, prerelease: false, body: "CLI release", published_at: LATEST_DATE },
  { tag_name: "v0.4.3-rc.1", draft: false, prerelease: true, body: "Preview", published_at: LATEST_DATE },
  ...OLDER_VERSIONS.map((version, index) => ({
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    body: fakeReleaseBody(version, index),
    published_at: new Date(NOW - (4 + index * 9) * DAY_MS).toISOString(),
    html_url: `https://github.com/Oleafly/Oleafly/releases/tag/v${version}`,
  })),
];

function fakeFetcher(failing: () => boolean): ReleasePageFetcher {
  return (page) =>
    new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (failing()) {
          reject(new Error("GitHub releases request failed with status 403"));
          return;
        }
        const raw = FAKE_RELEASES.slice((page - 1) * 5, page * 5);
        (window as unknown as { __releasePages?: number[] }).__releasePages = [
          ...((window as unknown as { __releasePages?: number[] }).__releasePages ?? []),
          page,
        ];
        resolve({ entries: releaseEntriesFrom(raw), more: raw.length > 0 });
      }, 450);
    });
}

const PHASES: UpdatePhase[] = ["checking", "available", "downloading", "error", "upToDate"];

const params = new URLSearchParams(window.location.search);
const initialPhase = (PHASES as string[]).includes(params.get("state") ?? "")
  ? (params.get("state") as UpdatePhase)
  : "available";
const initialNotes: NotesKey = params.get("notes") === "rich" || params.get("notes") === "none"
  ? (params.get("notes") as NotesKey)
  : "real";

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: 24,
  boxSizing: "border-box",
};
const controlsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  maxWidth: 600,
  margin: "0 auto 16px",
  fontSize: 12,
};
const changelogFrameStyle: CSSProperties = {
  width: 672,
  height: 620,
  margin: "0 auto",
  borderRadius: 12,
  boxShadow: "0 24px 60px rgb(0 0 0 / 0.28)",
};
const frameStyle: CSSProperties = {
  width: 600,
  height: 520,
  margin: "0 auto",
  borderRadius: 12,
  boxShadow: "0 24px 60px rgb(0 0 0 / 0.28)",
};

function Harness() {
  const [phase, setPhase] = useState<UpdatePhase>(initialPhase);
  const [notes, setNotes] = useState<NotesKey>(initialNotes);
  const [dark, setDark] = useState(params.get("theme") === "dark");
  const [accent, setAccent] = useState(params.get("accent") ?? ACCENTS[0].id);
  const [packageInstall, setPackageInstall] = useState(params.get("package") === "1");
  const [percent, setPercent] = useState(phase === "downloading" ? 42 : 0);
  const [events, setEvents] = useState<string[]>([]);
  const [installed, setInstalled] = useState(params.get("installed") ?? "0.4.2");
  const [view, setView] = useState(params.get("view") === "changelog" ? "changelog" : "updater");
  const [historyFails, setHistoryFails] = useState(params.get("history") === "fail");
  const failingRef = useRef(historyFails);
  failingRef.current = historyFails;
  const timer = useRef<number | undefined>(undefined);
  const fetchPage = useCallback<ReleasePageFetcher>((page) => fakeFetcher(() => failingRef.current)(page), []);
  const history = useReleaseHistory({
    newerThan: installed,
    olderThan: "0.4.3",
    fetchPage,
    enabled: phase === "available" || phase === "downloading",
  });

  const changelog = useReleaseHistory({ fetchPage, enabled: view === "changelog" });

  useEffect(() => {
    const color = ACCENTS.find((option) => option.id === accent)?.color ?? ACCENTS[0].color;
    window.localStorage.setItem("oleafly.accent", color);
    applyTheme(dark ? "dark" : "light");
    document.body.style.background = dark ? "#0b0b0b" : "#e5e5e5";
  }, [accent, dark]);

  useEffect(() => () => window.clearInterval(timer.current), []);

  const record = (event: string) => setEvents((current) => [...current, event]);

  const startDownload = () => {
    record("install");
    window.clearInterval(timer.current);
    setPercent(0);
    setPhase("downloading");
    timer.current = window.setInterval(() => {
      setPercent((value) => {
        const next = Math.min(100, value + 10);
        if (next === 100) window.clearInterval(timer.current);
        return next;
      });
    }, 120);
  };

  const button = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid rgb(0 0 0 / 0.15)",
        background: active ? (dark ? "#f5f5f5" : "#171717") : dark ? "#1f1f1f" : "#fff",
        color: active ? (dark ? "#171717" : "#fff") : dark ? "#e5e5e5" : "#111",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={pageStyle}>
      <div data-testid="harness-controls" style={controlsStyle}>
        {button("updater", view === "updater", () => setView("updater"))}
        {button("changelog", view === "changelog", () => setView("changelog"))}
        {PHASES.map((value) => button(value, phase === value, () => {
          window.clearInterval(timer.current);
          setPercent(value === "downloading" ? 42 : 0);
          setPhase(value);
        }))}
        {(["real", "rich", "none"] as NotesKey[]).map((value) => button(`notes: ${value}`, notes === value, () => setNotes(value)))}
        {button(dark ? "dark" : "light", dark, () => setDark((value) => !value))}
        {button("package install", packageInstall, () => setPackageInstall((value) => !value))}
        {button("installed 0.4.3", installed === "0.4.3", () => setInstalled("0.4.3"))}
        {button("installed 0.4.2", installed === "0.4.2", () => setInstalled("0.4.2"))}
        {button("installed 0.3.1", installed === "0.3.1", () => setInstalled("0.3.1"))}
        {button("history fails", historyFails, () => setHistoryFails((value) => !value))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
          {ACCENTS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-label={`accent ${option.id}`}
              title={option.id}
              onClick={() => setAccent(option.id)}
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: option.color,
                border: accent === option.id ? "2px solid #fff" : "2px solid transparent",
                boxShadow: accent === option.id ? `0 0 0 2px ${option.color}` : "none",
                cursor: "pointer",
              }}
            />
          ))}
        </span>
      </div>
      {view === "changelog" ? (
        <div className="harness-frame" style={changelogFrameStyle}>
          <ChangelogView
            installedVersion={installed}
            history={{
              entries: changelog.entries,
              status: changelog.status,
              onLoadMore: changelog.loadMore,
              onRetry: changelog.retry,
            }}
            onOpenLink={(url) => record(`link ${url}`)}
            onUpdate={() => record("update")}
            onClose={() => record("close")}
          />
        </div>
      ) : (
      <div className="harness-frame" style={frameStyle}>
        <UpdateDialog
          phase={phase}
          nextVersion="0.4.3"
          currentVersion={installed}
          releaseDate={LATEST_DATE}
          notes={NOTES[notes]}
          percent={percent}
          errorMessage={phase === "error" ? "Error: failed to download update: connection reset by peer (os error 54)" : ""}
          selfInstallable={!packageInstall}
          installedVersion="0.4.3"
          onClose={() => record("close")}
          onInstall={startDownload}
          onRetry={() => {
            record("retry");
            setPhase("checking");
            window.setTimeout(() => setPhase("available"), 600);
          }}
          onOpenRelease={() => record("release")}
          onOpenLink={(url) => record(`link ${url}`)}
          history={{
            entries: history.entries,
            status: history.status,
            onLoadMore: history.loadMore,
            onRetry: history.retry,
          }}
        />
      </div>
      )}
      <output data-testid="harness-events" style={{ display: "block", maxWidth: 600, margin: "12px auto 0", fontSize: 11, whiteSpace: "pre-wrap", color: dark ? "#aaa" : "#555" }}>
        {events.join("\n")}
      </output>
    </div>
  );
}

await prepareHarnessI18n();
document.body.dataset.fixtureState = "mounted";
const container = document.getElementById("root") as HTMLElement & { __harnessRoot?: ReturnType<typeof createRoot> };
container.__harnessRoot ??= createRoot(container);
container.__harnessRoot.render(<Harness />);
