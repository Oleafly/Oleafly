import { toast } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";
import { TERMINAL_LIMIT, terminalLimitMessage, useTerminalsStore } from "@/store/terminals";

export function openNewTerminal(): void {
  const terminals = useTerminalsStore.getState();
  useSettingsStore.getState().setTerminalOpen(true);
  if (terminals.projectId && terminals.tabs.length >= TERMINAL_LIMIT) {
    toast.infoUnique("terminal-limit", terminalLimitMessage());
    return;
  }
  terminals.addTerminal();
}
