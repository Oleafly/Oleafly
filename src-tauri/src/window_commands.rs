//! Which app commands each window may call.
//!
//! The main window's own webview may call every command. The other windows get
//! only the commands their view uses, and a child webview or a window this list
//! doesn't know gets none, so a script running in a secondary window can't reach
//! the file, terminal, agent or settings commands. Tauri checks plugin commands
//! against the capabilities, and app commands from a remote origin are already
//! refused, so this gate only sees app commands from the app's own pages.

use tauri::ipc::Invoke;
use tauri::Runtime;

const MAIN_WINDOW: &str = "main";
const ADMIN_CONSOLE_PREFIX: &str = "admin-console-";

const EVERY_WINDOW: &[&str] = &[
    "append_app_log",
    "app_version",
    "display_homes",
    "read_app_log",
];

const UPDATE: &[&str] = &[
    "download_update",
    "install_update",
    "release_notes_page",
    "updater_self_installable",
];

const PREVIEW: &[&str] = &[
    "grant_test_save_path",
    "open_compiled_html",
    "pick_save_path",
    "read_compiled_pdf",
    "save_file_base64",
    "typst_toolchain_status",
    "write_bytes_file",
];

const PRESENTATION: &[&str] = &[
    "read_compiled_pdf",
    "read_file",
    "read_project_bytes",
    "typst_slide_notes",
];

const ADMIN_CONSOLE: &[&str] = &[
    "collab_admin_add_allowlist",
    "collab_admin_add_domain_rule",
    "collab_admin_allowlist",
    "collab_admin_archive_project",
    "collab_admin_domain_rules",
    "collab_admin_email_status",
    "collab_admin_email_test",
    "collab_admin_guest_approve",
    "collab_admin_guest_decline",
    "collab_admin_guest_invitations",
    "collab_admin_guest_revoke",
    "collab_admin_member_devices",
    "collab_admin_members",
    "collab_admin_overview",
    "collab_admin_patch_member",
    "collab_admin_patch_settings",
    "collab_admin_projects",
    "collab_admin_remove_allowlist",
    "collab_admin_remove_domain_rule",
    "collab_admin_remove_member",
    "collab_admin_security_log",
    "collab_admin_settings",
    "collab_admin_sign_out_device",
    "collab_admin_unarchive_project",
    "collab_server_refresh",
    "collab_server_test",
    "collab_servers_list",
];

fn window_commands(window: &str) -> Option<&'static [&'static str]> {
    match window {
        "update" => Some(UPDATE),
        "preview" => Some(PREVIEW),
        "presentation" | "presenter" => Some(PRESENTATION),
        _ if window.starts_with(ADMIN_CONSOLE_PREFIX) => Some(ADMIN_CONSOLE),
        _ => None,
    }
}

pub(crate) fn allowed(window: &str, webview: &str, command: &str) -> bool {
    if webview != window {
        return false;
    }
    if window == MAIN_WINDOW {
        return true;
    }
    window_commands(window)
        .is_some_and(|own| EVERY_WINDOW.contains(&command) || own.contains(&command))
}

pub fn gated<R, F>(handler: F) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static
where
    R: Runtime,
    F: Fn(Invoke<R>) -> bool + Send + Sync + 'static,
{
    move |invoke| {
        let webview = invoke.message.webview_ref();
        let window = webview.window_ref().label().to_owned();
        let webview_label = webview.label().to_owned();
        let command = invoke.message.command();
        if allowed(&window, &webview_label, command) {
            return handler(invoke);
        }
        let refusal = format!("{command} isn't available in the {webview_label} window.");
        let line =
            format!("Refused command {command} from webview {webview_label} in window {window}");
        tauri::async_runtime::spawn_blocking(move || {
            let _ = crate::project::append_app_log(line);
        });
        invoke.resolver.reject(refusal);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_main_window_reaches_every_command() {
        assert!(allowed("main", "main", "term_open"));
        assert!(allowed("main", "main", "write_bytes_file"));
        assert!(allowed("main", "main", "a_command_added_later"));
    }

    #[test]
    fn a_child_webview_reaches_nothing_even_in_the_main_window() {
        assert!(!allowed("main", "oleafly-browser-pane", "term_open"));
        assert!(!allowed("main", "oleafly-browser-pane", "append_app_log"));
        assert!(!allowed("preview", "preview-child", "read_compiled_pdf"));
    }

    #[test]
    fn secondary_windows_reach_only_their_own_commands() {
        assert!(allowed("preview", "preview", "read_compiled_pdf"));
        assert!(allowed("preview", "preview", "write_bytes_file"));
        assert!(allowed("preview", "preview", "open_compiled_html"));
        assert!(!allowed("preview", "preview", "term_open"));
        assert!(!allowed("preview", "preview", "get_connector_key"));
        assert!(allowed("update", "update", "install_update"));
        assert!(!allowed("update", "update", "read_file"));
        assert!(allowed("presenter", "presenter", "typst_slide_notes"));
        assert!(allowed(
            "presentation",
            "presentation",
            "read_project_bytes"
        ));
        assert!(!allowed("presentation", "presentation", "write_bytes_file"));
        assert!(allowed(
            "admin-console-7",
            "admin-console-7",
            "collab_admin_members"
        ));
        assert!(!allowed(
            "admin-console-7",
            "admin-console-7",
            "collab_server_sign_in"
        ));
        assert!(!allowed("admin-console-7", "admin-console-7", "agent_exec"));
    }

    #[test]
    fn every_window_can_log_and_read_its_version() {
        for window in [
            "update",
            "preview",
            "presentation",
            "presenter",
            "admin-console-1",
        ] {
            assert!(allowed(window, window, "append_app_log"), "{window}");
            assert!(allowed(window, window, "app_version"), "{window}");
        }
    }

    #[test]
    fn an_unknown_window_reaches_nothing() {
        assert!(!allowed(
            "overleaf-sign-in-1",
            "overleaf-sign-in-1",
            "read_file"
        ));
        assert!(!allowed("mainx", "mainx", "term_open"));
        assert!(!allowed("anything", "anything", "app_version"));
    }

    #[test]
    fn the_lists_name_registered_commands_only() {
        let registered = include_str!("lib.rs");
        for command in EVERY_WINDOW
            .iter()
            .chain(UPDATE)
            .chain(PREVIEW)
            .chain(PRESENTATION)
            .chain(ADMIN_CONSOLE)
        {
            let pattern = format!("::{command},");
            assert!(
                registered.contains(&pattern) || registered.contains(&format!("::{command}\n")),
                "{command} is not in generate_handler!"
            );
        }
    }

    #[tauri::command]
    fn a_main_window_command() -> &'static str {
        "ran"
    }

    #[test]
    fn a_refused_call_is_rejected_with_the_window_named() {
        let app = tauri::test::mock_builder()
            .invoke_handler(gated(tauri::generate_handler![a_main_window_command]))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let call = |label: &str| {
            let window = tauri::WebviewWindowBuilder::new(&app, label, Default::default())
                .build()
                .unwrap();
            tauri::test::get_ipc_response(
                &window,
                tauri::webview::InvokeRequest {
                    cmd: "a_main_window_command".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: if cfg!(windows) {
                        "http://tauri.localhost"
                    } else {
                        "tauri://localhost"
                    }
                    .parse()
                    .unwrap(),
                    body: Default::default(),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            )
            .map(|body| body.deserialize::<String>().unwrap())
        };
        assert_eq!(call(MAIN_WINDOW), Ok("ran".to_string()));
        assert_eq!(
            call("preview"),
            Err(serde_json::json!(
                "a_main_window_command isn't available in the preview window."
            ))
        );
    }
}
