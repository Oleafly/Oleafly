import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { AppConfig } from "/packages/backend-port/src/index";

/** Native boundaries needed by the ordinary Notes browser regression harness. */
export function installNotesIpcMock() {
  const state = { unhandled: [] as string[], logs: [] as string[] };
  let config: AppConfig = {
    github_token: "", github_user: "", github_connected: false,
    checkpoints_enabled: false, checkpoint_notifications: false, git_auto_init: false,
  };
  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    get_config: () => config,
    set_config: (args) => { config = args.config as AppConfig; return null; },
    list_files: () => [],
    note_tags: () => [],
    note_facts: () => [],
    note_video_frame_origin: () => Promise.reject(new Error("The video page server does not run in the Notes harness")),
    append_app_log: (args) => { state.logs.push(String(args.message)); return null; },
    log_frontend_error: (args) => { state.logs.push(String(args.message)); return null; },
    "plugin:window|is_fullscreen": () => false,
    "plugin:window|is_maximized": () => false,
  };
  mockWindows("main");
  mockIPC((command, args) => {
    const handler = handlers[command];
    if (handler) return handler((args ?? {}) as Record<string, unknown>);
    state.unhandled.push(command);
    return Promise.reject(new Error(`${command} is not available in the Notes harness`));
  }, { shouldMockEvents: true });
  return state;
}
