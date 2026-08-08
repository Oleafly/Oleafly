mod agent;
mod assets;
mod biber_toolchain;
mod chats;
mod citation;
mod commands;
mod config;
mod connectors;
mod deadlines;
mod document_engine;
mod fsperm;
mod git;
mod github;
mod language_service;
mod latex_engine;
mod literature;
mod mcp;
#[cfg(not(target_os = "windows"))]
mod menu;
mod ollama;
mod paths;
mod proc;
mod project;
mod sandbox;
mod secrets;
mod state;
mod synctex;
mod template_packs;
mod templates;
mod tex_distro;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // One-time hardening: strip any token baked into a project's `origin` remote
    // by earlier builds (auth now flows through the env credential helper).
    git::scrub_remote_credentials();

    let mut builder = tauri::Builder::default()
        .manage(language_service::LanguageServiceState::default())
        .plugin(language_service::lifecycle_plugin())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(not(target_os = "windows"))]
    {
        builder = builder
            .menu(menu::build)
            .on_menu_event(|app, event| menu::on_event(app, event.id().as_ref()));
    }

    // The updater and process plugins are desktop-only.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    // E2E automation bridge, compiled in only for `--features e2e-testing`
    // builds (real-webview Playwright control; see e2e/README.md).
    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(tauri_plugin_playwright::init());
    }

    builder
        .manage(AppState::default())
        .manage(agent::AgentState::default())
        .manage(mcp::server::McpState::default())
        // Closing the app mid-TinyTeX-install must be a deliberate choice: block
        // the close, let the frontend show a confirm dialog, and only pass a
        // close through after `confirm_quit_during_install`.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if latex_engine::install_in_progress() && !latex_engine::quit_confirmed() {
                    api.prevent_close();
                    use tauri::Emitter;
                    let _ = window.emit("tinytex-quit-blocked", ());
                }
            }
        })
        .setup(|app| {
            if std::env::var("OLEAFLY_E2E_WINDOW").is_err() {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    #[cfg(target_os = "windows")]
                    {
                        let _ = window.set_decorations(false);
                    }
                    let _ = window.maximize();
                }
            }
            // The bridge returns eval results through a plugin command, so grant
            // its permission at runtime here; a static capabilities/ entry would
            // break normal builds, where the plugin (and its permission) doesn't exist.
            #[cfg(feature = "e2e-testing")]
            {
                use tauri::Manager;
                app.add_capability(
                    tauri::ipc::CapabilityBuilder::new("e2e-playwright")
                        .window("main")
                        .permission("playwright:default"),
                )?;
                // CI-parity window sizing: CI runner displays are smaller than
                // developer monitors, which pushes toolbar controls into the
                // overflow menu and exercises entirely different interaction
                // paths. OLEAFLY_E2E_WINDOW=WxH reproduces that locally.
                if let Ok(spec) = std::env::var("OLEAFLY_E2E_WINDOW") {
                    if let Some((w, h)) = spec.split_once('x') {
                        if let (Ok(w), Ok(h)) = (w.parse::<f64>(), h.parse::<f64>()) {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.set_size(tauri::LogicalSize::new(w, h));
                            }
                        }
                    }
                }
            }

            // Start the MCP server on boot when the user has enabled it. Failure to
            // bind must not prevent the app from starting; Settings shows the state.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(cfg) = crate::config::read_config() {
                    if cfg.mcp_enabled {
                        if let Err(e) = crate::mcp::start_configured(handle, cfg.mcp_port).await {
                            eprintln!("mcp: autostart failed: {e}");
                        }
                    } else {
                        crate::mcp::server::remove_discovery_file();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            agent::agent_complete,
            agent::agent_cancel,
            agent::agent_cancel_all,
            agent::agent_stream,
            agent::agent_run,
            agent::agent_tool_result,
            agent::agent_list_models,
            commands::reload_views,
            commands::library_root,
            commands::app_version,
            commands::project_engine,
            language_service::language_service_start,
            language_service::language_service_send,
            language_service::language_service_stop,
            language_service::language_service_status,
            language_service::language_service_install,
            language_service::language_service_install_status,
            commands::updater_self_installable,
            commands::compile_project,
            commands::cancel_compile,
            commands::clear_build_dir,
            commands::read_compiled_pdf,
            commands::compile_isolated,
            commands::read_isolated_pdf,
            commands::read_project_bytes,
            commands::write_project_bytes,
            commands::write_bytes_file,
            github::gh_request_device_code,
            github::gh_check_device_token,
            github::gh_current_user,
            github::gh_set_token,
            github::gh_clear_token,
            github::gh_list_repos,
            github::gh_create_repo,
            ollama::ollama_list_models,
            synctex::synctex_forward,
            synctex::synctex_inverse,
            synctex::synctex_map_line,
            project::list_files,
            project::read_file,
            project::write_file,
            project::create_file,
            project::delete_file,
            project::rename_file,
            project::copy_file,
            project::import_paths_into_project,
            project::save_file_base64,
            project::read_file_base64,
            project::append_app_log,
            project::read_app_log,
            project::has_pandoc,
            project::download_pandoc,
            latex_engine::latex_engine_info,
            latex_engine::tinytex_install_state,
            latex_engine::confirm_quit_during_install,
            tex_distro::tex_distributions,
            latex_engine::has_tagging_engine,
            latex_engine::install_tinytex,
            latex_engine::delete_tinytex,
            latex_engine::tlmgr_installed,
            latex_engine::tlmgr_install,
            latex_engine::tlmgr_remove,
            latex_engine::compile_tagged,
            citation::fetch_doi_bibtex,
            citation::fetch_arxiv,
            citation::crossref_search,
            literature::literature_search,
            literature::literature_arxiv_lookup,
            connectors::get_connector_key,
            connectors::set_connector_key,
            project::set_main_doc,
            project::set_project_engine,
            project::record_project_tex_spec,
            project::project_tex_status,
            project::import_overleaf_project,
            project::set_project_color,
            project::rename_project,
            project::open_devtools,
            project::get_project,
            project::list_projects,
            project::create_project,
            project::create_project_from_pdf_conversion,
            project::create_typst_project,
            project::create_markdown_project,
            project::create_image_project,
            project::create_diagram_project,
            project::get_or_create_scratch_project,
            project::save_figure_to_cache,
            templates::list_templates,
            templates::template_preview,
            project::create_project_from_template,
            project::create_project_from_docx,
            assets::list_font_components,
            assets::install_font_component,
            assets::remove_font_component,
            assets::download_all_fonts,
            assets::template_prerequisites,
            assets::ensure_template_assets,
            template_packs::list_template_packs,
            template_packs::refresh_pack_catalog,
            template_packs::install_template_pack,
            template_packs::remove_template_pack,
            templates::save_custom_template,
            templates::delete_custom_template,
            deadlines::read_deadlines,
            deadlines::refresh_deadlines,
            project::export_pdf,
            project::export_document,
            project::search_docs,
            project::search_project,
            project::download_project_zip,
            project::duplicate_project,
            project::clear_build_cache,
            project::delete_project,
            commands::reveal_in_dir,
            config::redacted_secret_marker,
            config::get_config,
            config::set_config,
            mcp::mcp_register_tools,
            mcp::mcp_set_active_project,
            mcp::mcp_tool_result,
            mcp::mcp_status,
            mcp::mcp_set_enabled,
            mcp::mcp_restart_server,
            mcp::mcp_connection_info,
            mcp::mcp_regenerate_token,
            chats::load_project_chats,
            chats::save_project_chats,
            git::git_auto_commit,
            git::git_auto_commit_update,
            git::git_log,
            git::git_read_version_labels,
            git::git_set_version_label,
            git::git_restore,
            git::git_set_remote,
            git::git_remove_remote,
            git::git_get_remote,
            git::git_current_branch,
            git::git_ahead_behind,
            git::git_push,
            git::git_pull,
            git::git_status,
            git::git_diff,
            git::git_discard,
            git::git_head_oid,
            git::git_stage,
            git::git_unstage,
            git::git_stage_all,
            git::git_unstage_all,
            git::git_commit,
            git::git_show,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Oleafly");
}
