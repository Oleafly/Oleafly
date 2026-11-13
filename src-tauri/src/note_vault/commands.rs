use super::*;

pub(super) fn inside_library(path: &Path) -> Result<bool, String> {
    Ok(crate::paths::app_data_roots()?
        .iter()
        .any(|root| path.starts_with(root)))
}

pub(super) fn refuse_library_files(file: &Path) -> Result<(), String> {
    if inside_library(file)? {
        return Err(AppError::new("notes.import_files_in_library").into());
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum FolderUse {
    Import,
    ExportParent,
}

pub(super) fn chosen_folder(picked: &Path, purpose: FolderUse) -> Result<PathBuf, String> {
    let folder = picked
        .canonicalize()
        .map_err(|error| String::from(AppError::new("notes.folder_unopenable").detail(error)))?;
    if !folder.is_dir() {
        return Err(AppError::new("notes.folder_not_folder").into());
    }
    let refused = match purpose {
        FolderUse::Import => crate::paths::overlaps_app_data(&folder)?,
        FolderUse::ExportParent => inside_library(&folder)?,
    };
    if refused {
        return Err(AppError::new("notes.folder_in_library").into());
    }
    Ok(folder)
}

pub(super) fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

pub(super) fn pending() -> &'static Mutex<Vec<(String, PathBuf)>> {
    static PENDING: OnceLock<Mutex<Vec<(String, PathBuf)>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

pub(super) fn valid_run_id(run_id: &str) -> bool {
    !run_id.is_empty()
        && run_id.len() <= MAX_RUN_ID_CHARS
        && run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

pub(super) fn take_pending(run_id: &str) -> Option<PathBuf> {
    let mut pending = pending().lock().unwrap_or_else(PoisonError::into_inner);
    let at = pending.iter().position(|(id, _)| id == run_id)?;
    Some(pending.remove(at).1)
}

pub(super) fn hold_pending(run_id: &str, root: PathBuf) {
    let mut pending = pending().lock().unwrap_or_else(PoisonError::into_inner);
    pending.retain(|(id, _)| id != run_id);
    pending.push((run_id.to_string(), root));
    let excess = pending.len().saturating_sub(MAX_PENDING);
    pending.drain(..excess);
}

pub(super) fn start_run(run_id: &str) -> Result<Arc<AtomicBool>, String> {
    let mut running = running().lock().unwrap_or_else(PoisonError::into_inner);
    if running.contains_key(run_id) {
        return Err(AppError::new("notes.import_running").into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    running.insert(run_id.to_string(), Arc::clone(&cancel));
    Ok(cancel)
}

pub(super) fn finish_run(run_id: &str) {
    running()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(run_id);
}

pub(super) fn dialog_title(title: Option<String>) -> Option<String> {
    title
        .map(|title| truncate_chars(title.trim(), MAX_TITLE_CHARS))
        .filter(|title| !title.is_empty())
}

pub(super) async fn pick(
    webview: &tauri::Webview,
    title: Option<String>,
    filters: Vec<crate::path_grants::DialogFilter>,
    kind: crate::path_grants::PickKind,
) -> Result<Option<Vec<PathBuf>>, String> {
    let spec = crate::path_grants::DialogSpec::new(title, filters, None, None);
    crate::path_grants::native_pick(webview, spec, kind)
        .await
        .map_err(|_| String::from(AppError::new("notes.picker_closed")))
}

pub(super) async fn pick_folder(
    webview: &tauri::Webview,
    title: Option<String>,
) -> Result<Option<PathBuf>, String> {
    let Some(picked) = pick(
        webview,
        title,
        Vec::new(),
        crate::path_grants::PickKind::Folder,
    )
    .await?
    else {
        return Ok(None);
    };
    picked
        .into_iter()
        .next()
        .map(Some)
        .ok_or_else(|| AppError::new("notes.folder_not_local").into())
}

pub(super) async fn pick_markdown_files(
    webview: &tauri::Webview,
    title: Option<String>,
) -> Result<Option<Vec<PathBuf>>, String> {
    let markdown = crate::path_grants::DialogFilter {
        name: "Markdown".into(),
        extensions: vec!["md".into()],
    };
    let picked = pick(
        webview,
        title,
        vec![markdown],
        crate::path_grants::PickKind::Files,
    )
    .await?;
    match picked {
        Some(files) if files.is_empty() => Err(AppError::new("notes.files_not_local").into()),
        picked => Ok(picked),
    }
}

pub(super) struct RunGuard(String);

impl Drop for RunGuard {
    fn drop(&mut self) {
        finish_run(&self.0);
    }
}

#[derive(Default)]
pub(super) struct Throttle {
    pub(super) phase: Option<ImportPhase>,
    pub(super) sent: Option<Instant>,
}

impl Throttle {
    pub(super) fn admits(&mut self, progress: &ImportProgress, now: Instant) -> bool {
        let due = self.phase != Some(progress.phase)
            || progress.done >= progress.total
            || self
                .sent
                .is_none_or(|sent| now.duration_since(sent) >= PROGRESS_EVERY);
        if due {
            self.phase = Some(progress.phase);
            self.sent = Some(now);
        }
        due
    }
}

pub(super) fn channel_progress(
    channel: tauri::ipc::Channel<ImportProgress>,
) -> impl FnMut(ImportProgress) + Send + 'static {
    let mut throttle = Throttle::default();
    move |progress| {
        if throttle.admits(&progress, Instant::now()) {
            let _ = channel.send(progress);
        }
    }
}

pub(super) fn roll_back(created: Vec<String>) {
    for (project_id, error) in crate::project::discard_unopened_projects(created) {
        let _ = crate::project::append_app_log(format!(
            "Could not remove note {project_id:?} after a stopped import: {error}"
        ));
    }
}

pub(super) fn settle(report: ImportReport, folder: Option<&Path>) -> Result<ImportOutcome, String> {
    if let Some(notes) = report.confirm {
        return Ok(ImportOutcome::Large { notes });
    }
    if report.summary.cancelled || report.error.is_some() {
        roll_back(report.created);
        return match report.error {
            Some(error) => Err(error),
            None => Ok(ImportOutcome::Done(ImportSummary {
                cancelled: true,
                ..ImportSummary::default()
            })),
        };
    }
    if let Some(root) = folder.filter(|_| report.summary.notes > 0) {
        if let Err(error) = record_import(root, report.summary.notes) {
            let _ = crate::project::append_app_log(format!(
                "Could not remember the imported folder: {error}"
            ));
        }
    }
    Ok(ImportOutcome::Done(report.summary))
}

pub(super) async fn run_import(
    run_id: &str,
    folder: Option<PathBuf>,
    work: impl FnOnce(&AtomicBool, &CreatedNotes) -> Result<ImportReport, String> + Send + 'static,
) -> Result<ImportOutcome, String> {
    let cancel = start_run(run_id)?;
    let _run = RunGuard(run_id.to_string());
    let journal_run = run_id.to_string();
    let journal_root = folder.clone();
    let journal = off_thread(move || match journal_root {
        Some(root) => CreatedNotes::recorded(&journal_run, &root),
        None => Ok(CreatedNotes::default()),
    })
    .await?;
    let task_journal = journal.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || work(&cancel, &task_journal)).await;
    let failed = |error: String| ImportReport {
        created: journal.take(),
        error: Some(error),
        ..ImportReport::default()
    };
    let report = match outcome {
        Ok(Ok(report)) => report,
        Ok(Err(error)) => failed(error),
        Err(error) => failed(AppError::new("notes.import_stopped").detail(error).into()),
    };
    off_thread(move || {
        let settled = settle(report, folder.as_deref());
        journal.close();
        settled
    })
    .await
}

pub(super) async fn import_picked_files(
    webview: &tauri::Webview,
    request: NotesImportRequest,
    on_progress: tauri::ipc::Channel<ImportProgress>,
) -> Result<ImportOutcome, String> {
    let Some(files) = pick_markdown_files(webview, request.title).await? else {
        return Ok(ImportOutcome::Dismissed);
    };
    let options = ImportOptions {
        folder_tags: request.folder_tags,
        confirm_above: None,
    };
    let mut progress = channel_progress(on_progress);
    run_import(&request.run_id, None, move |cancel, journal| {
        import_files_with(&files, options, cancel, &mut progress, &disk_room, journal)
    })
    .await
}

pub(super) async fn off_thread<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| String::from(AppError::new("notes.import_stopped").detail(error)))?
}
