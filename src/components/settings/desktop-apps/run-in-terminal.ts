import { describeError } from "@/lib/app-error";
import type { TerminalCommand } from "@/lib/desktop-apps";
import { toast } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";

export async function runInTerminal(title: string, command: TerminalCommand, confirmText?: string): Promise<void> {
  const { openTerminalWith, TerminalLaunchError } = await import("@/lib/terminal-launch");
  try {
    await openTerminalWith({ title, command: command.program, args: command.args, confirmText });
    const settings = useSettingsStore.getState();
    settings.setSettingsOpen(false);
    settings.setSettingsInitialSection("integrations");
    settings.setSettingsScrollTarget("desktop-apps");
  } catch (error) {
    if (error instanceof TerminalLaunchError) {
      if (error.reason !== "cancelled" && error.reason !== "tab-limit") toast.error(error.message);
      return;
    }
    toast.error(describeError(error));
  }
}
