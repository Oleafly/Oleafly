import type { AppConfig } from "@/lib/tauri";

export function gitAutoInitEnabled(config: AppConfig | null): boolean {
  return config ? config.git_auto_init !== false : true;
}
