import { describeError } from "@/lib/app-error";
import type { TerminalCommand } from "@/lib/desktop-apps";
import { toast } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";

/**
 * Opens a project terminal that runs `command`. The confirmation the terminal
 * shows appears over Settings, so Settings stays open until the user has
 * agreed (a no leaves it as it was) and closes then, so the new tab is in
 * view. Failures become a toast.
 */
export async function runInTerminal(title: string, command: TerminalCommand, confirmText?: string): Promise<void> {
  const { openTerminalWith, TerminalLaunchError } = await import("@/lib/terminal-launch");
  try {
    await openTerminalWith({ title, command: command.program, args: command.args, confirmText });
    useSettingsStore.getState().setSettingsOpen(false);
  } catch (error) {
    if (error instanceof TerminalLaunchError) {
      // A no needs no message, and the launcher already announced the tab limit.
      if (error.reason !== "cancelled" && error.reason !== "tab-limit") toast.error(error.message);
      return;
    }
    toast.error(describeError(error));
  }
}
