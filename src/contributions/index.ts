import { registerRailTabs } from "@/contributions/tabs";
import { registerOmnibarCommands, registerPaletteCommands } from "@/contributions/commands";
import { registerAiToolsets } from "@/contributions/ai-toolsets";

let registered = false;

/** Register every built-in contribution. Idempotent; called once at startup,
 *  before the app shell mounts (see main.tsx). */
export function registerContributions() {
  if (registered) return;
  registered = true;
  registerRailTabs();
  registerOmnibarCommands();
  registerPaletteCommands();
  registerAiToolsets();
}
