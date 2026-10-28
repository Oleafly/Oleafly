use std::future::Future;

use oleafly_collab::{load_binding, CollabPaths};
use tauri::async_runtime::Mutex;

use super::ProjectMeta;
use crate::app_error::AppError;

pub(crate) const DECLINED: &str = "project.shell_escape_declined";

fn shared_project_of(project_id: &str) -> Option<String> {
    let paths = CollabPaths::new(crate::paths::collab_root().ok()?);
    let binding = load_binding(&paths, project_id).ok().flatten()?;
    Some(format!(
        "{}/{}",
        binding.server_id, binding.shared_project_id
    ))
}

pub(crate) fn confirmed_here(project_id: &str) -> bool {
    match (
        shared_project_of(project_id),
        super::shell_escape_shared_project(project_id),
    ) {
        (Some(shared), Ok(Some(confirmed))) => shared == confirmed,
        _ => false,
    }
}

fn to_confirm(project_id: &str, allow: bool) -> Result<Option<String>, String> {
    if !allow || !crate::collab::registry::is_shared(project_id) {
        return Ok(None);
    }
    crate::trust::require_trusted(project_id, crate::trust::Capability::ShellEscape)?;
    if !super::engine_runs_project_code(&super::read_meta(project_id)?.engine) {
        return Err(super::SHELL_ESCAPE_NEEDS_LATEXMK.into());
    }
    shared_project_of(project_id)
        .map(Some)
        .ok_or_else(|| "failed to read this project's sharing details".to_owned())
}

pub(crate) async fn change(
    project_id: &str,
    allow: bool,
    confirm: impl Future<Output = bool>,
    compile_lock: &Mutex<()>,
) -> Result<ProjectMeta, String> {
    let shared = to_confirm(project_id, allow)?;
    if shared.is_some() && !confirm.await {
        return Err(AppError::new(DECLINED).into());
    }
    let _guard = compile_lock.lock().await;
    super::set_project_shell_escape_unlocked(project_id, allow, shared.as_deref())
}

fn dialog_keys(engine: &str) -> (&'static str, &'static str, &'static str) {
    if super::engine_runs_notebook_code(engine) {
        (
            "dialog.sharedCodeExecution.title",
            "dialog.sharedCodeExecution.message",
            "dialog.sharedCodeExecution.confirm",
        )
    } else {
        (
            "dialog.sharedShellEscape.title",
            "dialog.sharedShellEscape.message",
            "dialog.sharedShellEscape.confirm",
        )
    }
}

pub(crate) async fn ask(app: tauri::AppHandle, project_id: String) -> bool {
    let engine = super::read_meta(&project_id)
        .map(|meta| meta.engine)
        .unwrap_or_default();
    let (title, message, confirm) = dialog_keys(&engine);
    crate::trust::native_confirm(&app, title, crate::i18n::t(message), confirm)
        .await
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collab::testing::{share, TempLibrary};
    use std::sync::atomic::{AtomicBool, Ordering};

    const MAIN: &str = "main.tex";

    fn latexmk_project(library: &TempLibrary, project_id: &str) {
        library.project(project_id, &[(MAIN, "x\n")]);
        crate::project::write_meta(
            project_id,
            &ProjectMeta {
                name: project_id.to_owned(),
                main_doc: MAIN.into(),
                engine: "latexmk".into(),
                ..ProjectMeta::default()
            },
        )
        .unwrap();
    }

    fn effective(project_id: &str) -> bool {
        let compile = crate::project::read_compile_meta(project_id, MAIN)
            .unwrap()
            .allow_shell_escape;
        let meta = crate::project::read_meta(project_id).unwrap();
        let engine = crate::project::project_state_engine(project_id, &meta)
            .unwrap()
            .allow_shell_escape;
        assert_eq!(compile, engine);
        compile
    }

    fn turn(project_id: &str, allow: bool, answer: bool) -> (Result<ProjectMeta, String>, bool) {
        let asked = AtomicBool::new(false);
        let result = tauri::async_runtime::block_on(change(
            project_id,
            allow,
            async {
                asked.store(true, Ordering::SeqCst);
                answer
            },
            &Mutex::new(()),
        ));
        (result, asked.load(Ordering::SeqCst))
    }

    fn unshare(project_id: &str) {
        let paths = oleafly_collab::CollabPaths::new(crate::paths::collab_root().unwrap());
        oleafly_collab::remove_binding(&paths, project_id).unwrap();
        crate::collab::registry::invalidate(project_id);
    }

    fn files_of(project_id: &str) -> (Vec<u8>, Option<Vec<u8>>) {
        let manifest = crate::paths::project_dir(project_id)
            .unwrap()
            .join("project.json");
        let record = crate::project::shell_escape_trust_path(project_id).unwrap();
        (std::fs::read(manifest).unwrap(), std::fs::read(record).ok())
    }

    #[test]
    fn shell_escape_turned_on_before_sharing_stops_working_until_this_computer_confirms() {
        let library = TempLibrary::new();
        latexmk_project(&library, "before-sharing");
        let (result, asked) = turn("before-sharing", true, false);
        assert!(result.unwrap().allow_shell_escape);
        assert!(!asked);
        assert!(effective("before-sharing"));

        let _shared = share("before-sharing");
        assert!(crate::project::shell_escape_trusted("before-sharing").unwrap());
        assert!(!effective("before-sharing"));

        let (result, asked) = turn("before-sharing", true, true);
        assert!(asked);
        assert!(result.unwrap().allow_shell_escape);
        assert!(effective("before-sharing"));
    }

    #[test]
    fn declining_the_warning_keeps_external_commands_off_and_writes_nothing() {
        let library = TempLibrary::new();
        latexmk_project(&library, "declined");
        let _shared = share("declined");
        let before = files_of("declined");

        let (result, asked) = turn("declined", true, false);
        assert!(asked);
        let refused = result.err().unwrap();
        assert!(
            refused.contains(&format!("\"code\":\"{DECLINED}\"")),
            "{refused}"
        );
        assert_eq!(files_of("declined"), before);
        assert!(!effective("declined"));

        crate::project::write_shell_escape_trust("declined").unwrap();
        let before = files_of("declined");
        let (result, asked) = turn("declined", true, false);
        assert!(asked);
        assert!(result.is_err());
        assert_eq!(files_of("declined"), before);
        assert!(!effective("declined"));
    }

    #[test]
    fn turning_external_commands_off_never_asks() {
        let library = TempLibrary::new();
        latexmk_project(&library, "turn-off");
        let _shared = share("turn-off");
        assert!(turn("turn-off", true, true).0.is_ok());
        assert!(effective("turn-off"));

        let (result, asked) = turn("turn-off", false, false);
        assert!(!asked);
        assert!(!result.unwrap().allow_shell_escape);
        assert!(!effective("turn-off"));
        assert!(!crate::project::shell_escape_trusted("turn-off").unwrap());
    }

    #[test]
    fn a_project_that_is_not_shared_turns_on_without_asking() {
        let library = TempLibrary::new();
        latexmk_project(&library, "private");
        let (result, asked) = turn("private", true, false);
        assert!(!asked);
        assert!(result.unwrap().allow_shell_escape);
        assert!(effective("private"));
    }

    #[test]
    fn an_untrusted_shared_project_keeps_external_commands_off_even_when_confirmed() {
        let library = TempLibrary::new();
        latexmk_project(&library, "untrusted-shared");
        let _shared = share("untrusted-shared");
        assert!(turn("untrusted-shared", true, true).0.is_ok());
        assert!(effective("untrusted-shared"));

        let _restricted = crate::trust::testing::restrict("untrusted-shared");
        assert!(!effective("untrusted-shared"));
        let (result, asked) = turn("untrusted-shared", true, true);
        assert!(!asked);
        let refused = result.err().unwrap();
        assert!(
            refused.contains("\"code\":\"trust.shell_escape\""),
            "{refused}"
        );
    }

    #[test]
    fn changing_the_engine_away_from_latexmk_clears_the_confirmation() {
        let library = TempLibrary::new();
        latexmk_project(&library, "engine-here");
        let _shared = share("engine-here");
        assert!(turn("engine-here", true, true).0.is_ok());
        assert!(effective("engine-here"));
        crate::project::set_project_engine_unlocked("engine-here", "xetex", None).unwrap();
        crate::project::set_project_engine_unlocked("engine-here", "latexmk", None).unwrap();
        assert!(!crate::project::shell_escape_trusted("engine-here").unwrap());
        assert!(!effective("engine-here"));

        latexmk_project(&library, "engine-remote");
        let _shared = share("engine-remote");
        assert!(turn("engine-remote", true, true).0.is_ok());
        assert!(effective("engine-remote"));
        crate::project::follow_shared_settings("engine-remote", |meta| {
            meta.engine = "xetex".into();
            Ok(((), true))
        })
        .unwrap();
        crate::project::follow_shared_settings("engine-remote", |meta| {
            meta.engine = "latexmk".into();
            Ok(((), true))
        })
        .unwrap();
        assert!(!crate::project::shell_escape_trusted("engine-remote").unwrap());
        assert!(!effective("engine-remote"));
    }

    #[test]
    fn a_confirmation_counts_only_for_the_shared_project_it_was_given_in() {
        let library = TempLibrary::new();
        latexmk_project(&library, "reshared");
        let first = share("reshared");
        assert!(turn("reshared", true, true).0.is_ok());
        assert!(effective("reshared"));

        unshare("reshared");
        drop(first);
        assert!(effective("reshared"));

        let _again = share("reshared");
        assert!(!effective("reshared"));
    }

    #[test]
    fn notebook_engines_ask_with_the_code_dialog() {
        assert_eq!(dialog_keys("quarto").0, "dialog.sharedCodeExecution.title");
        assert_eq!(
            dialog_keys("calepin").1,
            "dialog.sharedCodeExecution.message"
        );
        assert_eq!(dialog_keys("latexmk").0, "dialog.sharedShellEscape.title");
    }

    #[test]
    fn a_quarto_project_allows_code_only_on_this_computer_and_forgets_it_on_an_engine_switch() {
        let library = TempLibrary::new();
        library.project("notebook", &[("main.qmd", "# Notes\n")]);
        crate::project::write_meta(
            "notebook",
            &ProjectMeta {
                name: "notebook".to_owned(),
                main_doc: "main.qmd".into(),
                engine: "quarto".into(),
                ..ProjectMeta::default()
            },
        )
        .unwrap();
        let (result, asked) = turn("notebook", true, false);
        assert!(!asked);
        assert!(result.unwrap().allow_shell_escape);
        assert!(
            crate::project::read_meta("notebook")
                .unwrap()
                .allow_shell_escape
        );
        let manifest = std::fs::read_to_string(
            crate::paths::project_dir("notebook")
                .unwrap()
                .join("project.json"),
        )
        .unwrap();
        assert!(!manifest.contains("allow_shell_escape"), "{manifest}");

        crate::project::follow_shared_settings("notebook", |meta| {
            meta.engine = "markdown".into();
            meta.main_doc = "main.qmd".into();
            Ok(((), true))
        })
        .ok();
        assert!(!crate::project::shell_escape_trusted("notebook").unwrap());
    }
}
