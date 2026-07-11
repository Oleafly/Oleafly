mod assets;
mod citation;
mod commands;
mod config;
mod git;
mod github;
mod latex_engine;
mod menu;
mod ollama;
mod paths;
mod project;
mod state;
mod synctex;
mod templates;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    paths::run_migrations();
    // One-time hardening: strip any token baked into a project's `origin` remote
    // by earlier builds (auth now flows through the env credential helper).
    git::scrub_remote_credentials();

    let mut builder = tauri::Builder::default()
        .menu(menu::build)
        .on_menu_event(|app, event| menu::on_event(app, event.id().as_ref()))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init());

    // The updater and process plugins are desktop-only.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::library_root,
            commands::app_version,
            commands::compile_project,
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
            project::list_files,
            project::read_file,
            project::write_file,
            project::create_file,
            project::delete_file,
            project::rename_file,
            project::copy_file,
            project::save_file_base64,
            project::read_file_base64,
            project::append_app_log,
            project::read_app_log,
            project::has_pandoc,
            project::download_pandoc,
            latex_engine::latex_engine_info,
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
            project::set_main_doc,
            project::set_project_color,
            project::rename_project,
            project::open_devtools,
            project::get_project,
            project::list_projects,
            project::create_project,
            project::create_image_project,
            templates::list_templates,
            templates::template_preview,
            project::create_project_from_template,
            assets::list_font_components,
            assets::install_font_component,
            assets::remove_font_component,
            assets::download_all_fonts,
            assets::template_prerequisites,
            assets::ensure_template_assets,
            project::export_pdf,
            project::export_document,
            project::search_docs,
            project::search_project,
            project::download_project_zip,
            project::duplicate_project,
            project::clear_build_cache,
            project::delete_project,
            commands::reveal_in_dir,
            config::get_config,
            config::set_config,
            git::git_auto_commit,
            git::git_log,
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
        .expect("error while running OpenLeaf");
}
