import { registerRailTabs } from "@/contributions/tabs";
import { registerOmnibarCommands, registerPaletteCommands } from "@/contributions/commands";
import { registerAiToolsets } from "@/contributions/ai-toolsets";
import { registerContextProviders } from "@/contributions/context-providers";

let registered = false;

// Idempotent; called once at startup, before the app shell mounts (see main.tsx).
export function registerContributions() {
  if (registered) return;
  registered = true;
  registerRailTabs();
  registerOmnibarCommands();
  registerPaletteCommands();
  registerAiToolsets();
  registerContextProviders();
}
