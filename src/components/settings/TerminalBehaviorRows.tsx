import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { formatNumber } from "@/lib/intl";
import { termShells, type TerminalShellOption } from "@/lib/terminal-ipc";
import { terminalPlatform } from "@/lib/terminal-keys";
import {
  TERMINAL_SCROLLBACK_OPTIONS,
  TERMINAL_SHELL_PATH_MAX_LENGTH,
  type TerminalShellId,
  type TerminalShiftEnter,
  useSettingsStore,
} from "@/store/settings";

const SHELL_RANK: Partial<Record<TerminalShellId, number>> = { auto: 0, custom: 2 };

type ShellProblem = "windowsOnly" | "notFound";

function shellProblem(
  option: TerminalShellOption,
  platform: ReturnType<typeof terminalPlatform>,
  listKnown: boolean,
): ShellProblem | null {
  if (option.id === "auto" || option.id === "custom") return null;
  if (platform !== "windows") return "windowsOnly";
  return listKnown && !option.available ? "notFound" : null;
}

const FALLBACK_SHELLS: readonly TerminalShellOption[] = [
  { id: "auto", resolved: "auto", name: null, path: null, available: true },
  { id: "custom", resolved: "custom", name: null, path: null, available: true },
];

function useShellOptions(selected: TerminalShellId): {
  options: readonly TerminalShellOption[];
  known: boolean;
} {
  const [loaded, setLoaded] = useState<readonly TerminalShellOption[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    termShells()
      .then((list) => {
        if (!cancelled) setLoaded(list);
      })
      .catch(() => {
        if (!cancelled) setLoaded([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const listed = (loaded ?? []).filter((option) => option.available || option.id === selected);
  const byId = new Map(listed.map((option) => [option.id, option]));
  for (const fallback of FALLBACK_SHELLS) {
    if (!byId.has(fallback.id)) byId.set(fallback.id, fallback);
  }
  if (!byId.has(selected)) {
    byId.set(selected, { id: selected, resolved: selected, name: null, path: null, available: false });
  }
  const rank = (id: TerminalShellId) => SHELL_RANK[id] ?? 1;
  return {
    options: [...byId.values()].sort((a, b) => rank(a.id) - rank(b.id)),
    known: (loaded ?? []).length > 0,
  };
}

export function TerminalBehaviorRows() {
  const { t } = useTranslation(["settings"]);
  const terminalShell = useSettingsStore((state) => state.terminalShell);
  const setTerminalShell = useSettingsStore((state) => state.setTerminalShell);
  const terminalShellPath = useSettingsStore((state) => state.terminalShellPath);
  const setTerminalShellPath = useSettingsStore((state) => state.setTerminalShellPath);
  const terminalShiftEnter = useSettingsStore((state) => state.terminalShiftEnter);
  const setTerminalShiftEnter = useSettingsStore((state) => state.setTerminalShiftEnter);
  const terminalCopyOnSelect = useSettingsStore((state) => state.terminalCopyOnSelect);
  const setTerminalCopyOnSelect = useSettingsStore((state) => state.setTerminalCopyOnSelect);
  const terminalOptionIsMeta = useSettingsStore((state) => state.terminalOptionIsMeta);
  const setTerminalOptionIsMeta = useSettingsStore((state) => state.setTerminalOptionIsMeta);
  const terminalScrollback = useSettingsStore((state) => state.terminalScrollback);
  const setTerminalScrollback = useSettingsStore((state) => state.setTerminalScrollback);
  const terminalConfirmClose = useSettingsStore((state) => state.terminalConfirmClose);
  const setTerminalConfirmClose = useSettingsStore((state) => state.setTerminalConfirmClose);
  const { options: shells, known: shellListKnown } = useShellOptions(terminalShell);
  const [pathDraft, setPathDraft] = useState(terminalShellPath);
  const platform = terminalPlatform();
  const mac = platform === "mac";

  useEffect(() => {
    setPathDraft(terminalShellPath);
  }, [terminalShellPath]);

  const baseShellLabel = (option: TerminalShellOption): string => {
    if (option.id !== "auto") return t(($) => $.settings.appearance.terminal.shell.options[option.id]);
    const name =
      option.resolved === "auto"
        ? option.name
        : t(($) => $.settings.appearance.terminal.shell.options[option.resolved]);
    return name
      ? t(($) => $.settings.appearance.terminal.shell.options.auto, { name })
      : t(($) => $.settings.appearance.terminal.shell.options.defaultShell);
  };
  const shellLabel = (option: TerminalShellOption): string => {
    const name = baseShellLabel(option);
    switch (shellProblem(option, platform, shellListKnown)) {
      case "windowsOnly":
        return t(($) => $.settings.appearance.terminal.shell.windowsOnly, { name });
      case "notFound":
        return t(($) => $.settings.appearance.terminal.shell.notFound, { name });
      default:
        return name;
    }
  };
  const savePath = () => setTerminalShellPath(pathDraft);
  const selectedShell = shells.find((option) => option.id === terminalShell);
  const selectedProblem = selectedShell ? shellProblem(selectedShell, platform, shellListKnown) : null;
  const defaultShellName = shells.find((option) => option.id === "auto")?.name ?? null;
  let shellNote: string | null = null;
  if (selectedShell && selectedProblem === "notFound") {
    shellNote = t(($) => $.settings.appearance.terminal.shell.notFoundNote, { name: baseShellLabel(selectedShell) });
  } else if (selectedShell && selectedProblem === "windowsOnly") {
    const name = baseShellLabel(selectedShell);
    shellNote = defaultShellName
      ? t(($) => $.settings.appearance.terminal.shell.windowsOnlyNote, { name, fallback: defaultShellName })
      : t(($) => $.settings.appearance.terminal.shell.windowsOnlyNoteDefault, { name });
  }

  return (
    <>
      <SettingsRow
        label={t(($) => $.settings.appearance.terminal.shell.label)}
        description={t(($) => $.settings.appearance.terminal.shell.description)}
        control={
          <Select value={terminalShell} onValueChange={(value) => setTerminalShell(value as TerminalShellId)}>
            <SelectTrigger
              className="w-[200px]"
              aria-label={t(($) => $.settings.appearance.terminal.shell.ariaLabel)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              {shells.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {shellLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {shellNote && <SettingsNote testId="terminal-shell-note">{shellNote}</SettingsNote>}

      {terminalShell === "custom" && (
        <SettingsRow
          label={t(($) => $.settings.appearance.terminal.shell.path.label)}
          description={t(($) => $.settings.appearance.terminal.shell.path.description)}
          control={
            <Input
              aria-label={t(($) => $.settings.appearance.terminal.shell.path.ariaLabel)}
              value={pathDraft}
              maxLength={TERMINAL_SHELL_PATH_MAX_LENGTH}
              spellCheck={false}
              onChange={(event) => setPathDraft(event.target.value)}
              onBlur={savePath}
              onKeyDown={(event) => {
                if (event.key === "Enter") savePath();
              }}
              className="w-[260px] font-mono text-xs"
            />
          }
        />
      )}

      {terminalShell === "custom" && terminalShellPath.trim() === "" && (
        <SettingsNote testId="terminal-shell-path-note">
          {t(($) => $.settings.appearance.terminal.shell.path.missing)}
        </SettingsNote>
      )}

      <SettingsRow
        label={t(($) => $.settings.appearance.terminal.shiftEnter.label)}
        description={t(($) => $.settings.appearance.terminal.shiftEnter.description)}
        control={
          <Select
            value={terminalShiftEnter}
            onValueChange={(value) => setTerminalShiftEnter(value as TerminalShiftEnter)}
          >
            <SelectTrigger
              className="w-[200px]"
              aria-label={t(($) => $.settings.appearance.terminal.shiftEnter.ariaLabel)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              <SelectItem value="newline">
                {t(($) => $.settings.appearance.terminal.shiftEnter.newline)}
              </SelectItem>
              <SelectItem value="enter">
                {t(($) => $.settings.appearance.terminal.shiftEnter.enter)}
              </SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <SettingsToggleRow
        label={t(($) => $.settings.appearance.terminal.copyOnSelect.label)}
        description={t(($) => $.settings.appearance.terminal.copyOnSelect.description)}
        checked={terminalCopyOnSelect}
        onChange={setTerminalCopyOnSelect}
      />

      {mac && (
        <SettingsToggleRow
          label={t(($) => $.settings.appearance.terminal.optionIsMeta.label)}
          description={t(($) => $.settings.appearance.terminal.optionIsMeta.description)}
          checked={terminalOptionIsMeta}
          onChange={setTerminalOptionIsMeta}
        />
      )}

      <SettingsRow
        label={t(($) => $.settings.appearance.terminal.scrollback.label)}
        description={t(($) => $.settings.appearance.terminal.scrollback.description)}
        control={
          <Select
            value={String(terminalScrollback)}
            onValueChange={(value) => setTerminalScrollback(Number(value))}
          >
            <SelectTrigger
              className="w-[140px]"
              aria-label={t(($) => $.settings.appearance.terminal.scrollback.ariaLabel)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              {TERMINAL_SCROLLBACK_OPTIONS.map((count) => (
                <SelectItem key={count} value={String(count)}>
                  {t(($) => $.settings.appearance.terminal.scrollback.lines, {
                    count,
                    value: formatNumber(count),
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <SettingsToggleRow
        label={t(($) => $.settings.appearance.terminal.confirmClose.label)}
        description={t(($) => $.settings.appearance.terminal.confirmClose.description)}
        checked={terminalConfirmClose}
        onChange={setTerminalConfirmClose}
      />
    </>
  );
}
