import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Command, defaultFilter } from "cmdk";
import { useTranslation } from "react-i18next";
import {
  commandGroup,
  commandHint,
  commandKeywords,
  commandLabel,
  commandsFor,
  type AppContext,
} from "@oleafly/registry";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useTheme } from "@/lib/theme";
import { commandAliasSearchText } from "@/lib/command-search";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { useTourStore } from "@/store/tours";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { useModalLayer } from "@/components/ui/use-modal-accessibility";
import { useScrollTopOnChange } from "@/hooks/use-scroll-top-on-change";
import { COMMAND_GROUP, COMMAND_ITEM, CommandDialogShell } from "@/components/ui/command-dialog";

export function CommandPalette() {
  const open = useSettingsStore((s) => s.paletteOpen);
  useModalLayer(open);
  const setPaletteOpen = useSettingsStore((s) => s.setPaletteOpen);
  const latexTools = useSettingsStore((s) => s.latexTools);
  const [query, setQuery] = useState("");
  const listRef = useScrollTopOnChange(query);
  const [selectedValue, setSelectedValue] = useState("");
  const projectId = useFilesStore((s) => s.projectId);
  const projectKind = useFilesStore((s) => s.projectKind);
  const engine = useFilesStore((s) => s.engine);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const activePath = useFilesStore((s) => s.activePath);
  const { theme } = useTheme();
  const { t } = useTranslation(["common", "shell"]);

  const close = () => setPaletteOpen(false);
  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId) return;
      if (matchesShortcut(e, useShortcutStore.getState().bindings.commandPalette)) {
        e.preventDefault();
        setPaletteOpen(!useSettingsStore.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!E2E_HOOKS || !open) return;
    const setE2eQuery = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string") {
        return;
      }
      setQuery(event.detail);
    };
    window.addEventListener("oleafly:e2e-command-query", setE2eQuery);
    return () =>
      window.removeEventListener("oleafly:e2e-command-query", setE2eQuery);
  }, [open]);

  const ctx = useMemo<AppContext>(
    () => ({
      projectId,
      projectKind,
      theme,
      documentEngineId: engine.id,
      documentEngineLoaded: engineLoaded,
      activeDocumentPath: activePath,
      latexToolsEnabled: latexTools,
    }),
    [
      activePath,
      engine.id,
      engineLoaded,
      latexTools,
      projectId,
      projectKind,
      theme,
    ],
  );

  const groups = useMemo(() => {
    const cmds = commandsFor("palette", ctx);
    const search = query.trim();
    const visibleCommands = search
      ? cmds
          .map((command) => {
            const label = commandLabel(command, ctx);
            const searchValue =
              `${label} ${commandKeywords(command, ctx)} ${commandAliasSearchText(command.slash)}`;
            return {
              command,
              score: defaultFilter(searchValue, search),
            };
          })
          .filter(({ score }) => score > 0)
          .sort((left, right) => right.score - left.score)
          .map(({ command }) => command)
      : cmds;
    const byGroup = new Map<string, typeof cmds>();
    for (const c of visibleCommands) {
      const g = commandGroup(c, ctx) ?? t(($) => $.shell.commandGroups.commands);
      const list = byGroup.get(g);
      if (list) list.push(c);
      else byGroup.set(g, [c]);
    }
    return [...byGroup.entries()];
  }, [ctx, query, t]);

  const bestMatchValue = useMemo(() => {
    const command = groups[0]?.[1][0];
    if (!command) return "";
    return `${commandLabel(command, ctx)} ${commandKeywords(command, ctx)} ${commandAliasSearchText(command.slash)}`;
  }, [ctx, groups]);

  useEffect(() => {
    setSelectedValue(bestMatchValue);
  }, [bestMatchValue]);

  return (
    <CommandDialogShell
      open={open}
      onOpenChange={setPaletteOpen}
      label={t(($) => $.shell.commandPalette.label)}
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setSelectedValue}
      query={query}
      onQueryChange={setQuery}
      placeholder={t(($) => $.shell.commandPalette.placeholder)}
      listRef={listRef}
    >
      <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
        {t(($) => $.shell.commandPalette.empty)}
      </Command.Empty>

      {groups.map(([heading, cmds]) => (
        <Command.Group
          key={heading}
          heading={heading}
          className={COMMAND_GROUP}
        >
          {cmds.map((c) => (
            <PaletteItem
              key={c.id}
              icon={c.icon?.(ctx)}
              label={commandLabel(c, ctx)}
              hint={commandHint(c, ctx)}
              searchValue={`${commandLabel(c, ctx)} ${commandKeywords(c, ctx)} ${commandAliasSearchText(c.slash)}`}
              onSelect={run(() => c.run(ctx))}
            />
          ))}
        </Command.Group>
      ))}
    </CommandDialogShell>
  );
}

function PaletteItem({
  icon,
  label,
  hint,
  searchValue,
  onSelect,
}: Readonly<{
  icon: ReactNode;
  label: string;
  hint?: string;
  searchValue: string;
  onSelect: () => void;
}>) {
  return (
    <Command.Item
      value={searchValue}
      onSelect={onSelect}
      className={COMMAND_ITEM}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
      {hint && (
        <span className="ml-auto text-xs text-muted-foreground">{hint}</span>
      )}
    </Command.Item>
  );
}
