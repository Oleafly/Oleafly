use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

use oleafly_collab::{load_binding, CollabError};
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::outputs::{OutputKind, ProjectOutput};
use oleafly_collab_protocol::projects::{project_role_allows, ProjectAction};
use serde::Serialize;
use serde_json::json;

use super::commands::{authed, AppHost, CollabCommandError, CollabHost};
use super::state::CollabState;

const UPLOAD_GAP: Duration = Duration::from_secs(60);
const QUIET_AFTER_REFUSAL: Duration = Duration::from_secs(15 * 60);
const MEBIBYTE: u64 = 1024 * 1024;
const SYNCTEX_SUFFIX: &str = ".synctex.gz";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabOutputInfo {
    pub kind: OutputKind,
    pub size: u64,
    pub compiled_by: String,
    pub compiled_at: i64,
    pub main_file: String,
}

impl From<ProjectOutput> for CollabOutputInfo {
    fn from(output: ProjectOutput) -> CollabOutputInfo {
        CollabOutputInfo {
            kind: output.kind,
            size: output.size,
            compiled_by: output.compiled_by.to_string(),
            compiled_at: output.compiled_at,
            main_file: output.main_file,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CompiledOutput {
    pub project_id: String,
    pub engine: String,
    pub main_file: String,
    pub output_id: String,
    pub synctex: Option<PathBuf>,
}

#[derive(Default)]
struct Lane {
    running: bool,
    next: Option<CompiledOutput>,
    last_started: Option<Instant>,
    quiet_until: Option<Instant>,
}

impl Lane {
    fn offer(&mut self, compiled: CompiledOutput) -> bool {
        self.next = Some(compiled);
        !std::mem::replace(&mut self.running, true)
    }

    fn wait(&self, now: Instant) -> Duration {
        let gap = self.last_started.map(|at| at + UPLOAD_GAP);
        [gap, self.quiet_until]
            .into_iter()
            .flatten()
            .max()
            .map_or(Duration::ZERO, |until| until.saturating_duration_since(now))
    }

    fn take(&mut self, now: Instant) -> Option<CompiledOutput> {
        let next = self.next.take();
        if next.is_some() {
            self.last_started = Some(now);
        } else {
            self.running = false;
        }
        next
    }

    fn refused(&mut self, now: Instant) {
        self.quiet_until = Some(now + QUIET_AFTER_REFUSAL);
    }
}

static LANES: LazyLock<Mutex<HashMap<String, Lane>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn with_lane<T>(project_id: &str, work: impl FnOnce(&mut Lane) -> T) -> T {
    let mut lanes = LANES.lock().unwrap_or_else(PoisonError::into_inner);
    work(lanes.entry(project_id.to_owned()).or_default())
}

fn may_upload(project_id: &str) -> bool {
    super::live::read_live(project_id, |live| {
        project_role_allows(live.role(), ProjectAction::Edit)
    })
    .unwrap_or(false)
}

pub(crate) fn upload_after_compile(app: &tauri::AppHandle, compiled: CompiledOutput) {
    let project_id = compiled.project_id.clone();
    if with_lane(&project_id, |lane| lane.offer(compiled)) {
        tauri::async_runtime::spawn(run_lane(app.clone(), project_id));
    }
}

async fn run_lane(app: tauri::AppHandle, project_id: String) {
    loop {
        let wait = with_lane(&project_id, |lane| lane.wait(Instant::now()));
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        let Some(compiled) = with_lane(&project_id, |lane| lane.take(Instant::now())) else {
            return;
        };
        if let Err(error) = upload(&app, &compiled).await {
            if pauses(&error) {
                with_lane(&project_id, |lane| lane.refused(Instant::now()));
            }
            note_failure(&compiled, &error);
        }
    }
}

fn pauses(error: &CollabError) -> bool {
    matches!(
        error,
        CollabError::Api {
            status: 404 | 413 | 429,
            ..
        }
    )
}

fn note_failure(compiled: &CompiledOutput, error: &CollabError) {
    let reason = match error {
        CollabError::Api { status, code, .. } => format!("{status} {code}"),
        CollabError::Network(_) => "unreachable".to_owned(),
        _ => "failed".to_owned(),
    };
    crate::logsafe::warning(
        "compiled output not shared",
        json!({ "reason": reason }),
        json!({ "project_id": compiled.project_id, "error": error.to_string() }),
    );
}

struct OutputFiles {
    pdf: Vec<u8>,
    synctex: Option<Vec<u8>>,
}

fn gzipped_synctex(path: &Path) -> bool {
    path.file_name()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|name| name.ends_with(SYNCTEX_SUFFIX))
}

fn read_files_blocking(compiled: &CompiledOutput) -> Result<Option<OutputFiles>, CollabError> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&compiled.project_id)
        .map_err(CollabError::Io)?;
    let Some(pdf_path) = crate::document_engine::existing_compiled_pdf_path(
        &compiled.project_id,
        &compiled.engine,
        &compiled.main_file,
    )
    .map_err(CollabError::Io)?
    else {
        return Ok(None);
    };
    let pdf = match std::fs::read(&pdf_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(CollabError::Io(error.to_string())),
    };
    if crate::document_engine::fingerprint_compile_output(&pdf) != compiled.output_id {
        return Ok(None);
    }
    let synctex = compiled
        .synctex
        .as_deref()
        .filter(|path| gzipped_synctex(path))
        .and_then(|path| std::fs::read(path).ok());
    Ok(Some(OutputFiles { pdf, synctex }))
}

async fn read_files(compiled: CompiledOutput) -> Result<Option<OutputFiles>, CollabError> {
    tauri::async_runtime::spawn_blocking(move || read_files_blocking(&compiled))
        .await
        .map_err(|error| CollabError::Io(error.to_string()))?
}

fn fits(bytes: &[u8], limit_mb: Option<u64>) -> bool {
    limit_mb.is_none_or(|mb| bytes.len() as u64 <= mb.saturating_mul(MEBIBYTE))
}

fn too_large(limit_mb: u64) -> CollabError {
    CollabError::Api {
        status: 413,
        code: "too_large".to_owned(),
        message: format!("the compiled PDF is larger than the server's {limit_mb} MB file limit"),
    }
}

async fn send(
    state: &CollabState,
    host: &dyn CollabHost,
    server: ServerId,
    project: SharedProjectId,
    kind: OutputKind,
    main_file: &str,
    bytes: &[u8],
) -> Result<ProjectOutput, CollabError> {
    authed(state, host, server, |client, access| {
        let (main_file, bytes) = (main_file.to_owned(), bytes.to_vec());
        Box::pin(async move {
            client
                .put_output(access, project, kind, &main_file, bytes)
                .await
        })
    })
    .await
}

async fn upload(app: &tauri::AppHandle, compiled: &CompiledOutput) -> Result<(), CollabError> {
    use tauri::Manager;
    if !may_upload(&compiled.project_id) {
        return Ok(());
    }
    let Some(state) = app.try_state::<CollabState>() else {
        return Ok(());
    };
    let state = state.inner();
    let Some(binding) = load_binding(state.paths()?, &compiled.project_id)? else {
        return Ok(());
    };
    let Some(files) = read_files(compiled.clone()).await? else {
        return Ok(());
    };
    let limit_mb = state
        .verified_manifest(binding.server_id)
        .map(|manifest| manifest.limits.max_file_mb);
    if !fits(&files.pdf, limit_mb) {
        return Err(too_large(limit_mb.unwrap_or_default()));
    }
    let host = AppHost::new(app.clone());
    let (server, project) = (binding.server_id, binding.shared_project_id);
    let main_file = compiled.main_file.as_str();
    send(
        state,
        &host,
        server,
        project,
        OutputKind::Pdf,
        main_file,
        &files.pdf,
    )
    .await?;
    if let Some(synctex) = files
        .synctex
        .as_deref()
        .filter(|&bytes| fits(bytes, limit_mb))
    {
        send(
            state,
            &host,
            server,
            project,
            OutputKind::Synctex,
            main_file,
            synctex,
        )
        .await?;
    }
    Ok(())
}

fn not_shared() -> CollabError {
    CollabError::Api {
        status: 404,
        code: "not_found".to_owned(),
        message: "this project is not shared".to_owned(),
    }
}

pub async fn output_info(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
) -> Result<Vec<CollabOutputInfo>, CollabError> {
    let binding = load_binding(state.paths()?, project_id)?.ok_or_else(not_shared)?;
    let shared = binding.shared_project_id;
    let listed = authed(state, host, binding.server_id, |client, access| {
        Box::pin(client.outputs(access, shared))
    })
    .await;
    match listed {
        Ok(outputs) => Ok(outputs
            .into_iter()
            .filter(|output| output.kind != OutputKind::Unknown)
            .map(CollabOutputInfo::from)
            .collect()),
        Err(CollabError::Api { status: 404, .. }) => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub async fn collab_output_info(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<Vec<CollabOutputInfo>, CollabCommandError> {
    let host = AppHost::new(app);
    output_info(state.inner(), &host, &project_id)
        .await
        .map_err(CollabCommandError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compiled(output_id: &str) -> CompiledOutput {
        CompiledOutput {
            project_id: "local-1".to_owned(),
            engine: "tectonic".to_owned(),
            main_file: "main.tex".to_owned(),
            output_id: output_id.to_owned(),
            synctex: None,
        }
    }

    fn taken(lane: &mut Lane, at: Instant) -> Option<String> {
        lane.take(at).map(|compiled| compiled.output_id)
    }

    #[test]
    fn one_upload_runs_at_a_time_and_only_the_latest_compile_waits_for_it() {
        let mut lane = Lane::default();
        let now = Instant::now();
        assert!(lane.offer(compiled("first")));
        assert_eq!(lane.wait(now), Duration::ZERO);
        assert_eq!(taken(&mut lane, now).as_deref(), Some("first"));
        assert!(!lane.offer(compiled("second")));
        assert!(!lane.offer(compiled("third")));
        assert_eq!(lane.wait(now), UPLOAD_GAP);
        assert_eq!(lane.wait(now + UPLOAD_GAP), Duration::ZERO);
        assert_eq!(taken(&mut lane, now + UPLOAD_GAP).as_deref(), Some("third"));
        assert_eq!(taken(&mut lane, now + UPLOAD_GAP), None);
        assert!(lane.offer(compiled("fourth")));
    }

    #[test]
    fn a_refused_upload_keeps_the_project_quiet_for_a_while() {
        let mut lane = Lane::default();
        let now = Instant::now();
        lane.offer(compiled("first"));
        lane.take(now);
        lane.refused(now);
        assert_eq!(lane.wait(now), QUIET_AFTER_REFUSAL);
        assert_eq!(lane.wait(now + QUIET_AFTER_REFUSAL), Duration::ZERO);
    }

    #[test]
    fn limits_and_missing_routes_pause_uploads_and_other_failures_do_not() {
        let api = |status: u16, code: &str| CollabError::Api {
            status,
            code: code.to_owned(),
            message: String::new(),
        };
        assert!(pauses(&api(429, "too_many_uploads")));
        assert!(pauses(&api(413, "account_storage_full")));
        assert!(pauses(&api(404, "not_found")));
        assert!(!pauses(&api(400, "bad_request")));
        assert!(!pauses(&api(503, "server_busy")));
        assert!(!pauses(&CollabError::Network("down".to_owned())));
    }

    #[test]
    fn a_file_fits_when_the_server_limit_is_unknown_or_large_enough() {
        assert!(fits(&[0; 10], None));
        assert!(fits(&vec![0; MEBIBYTE as usize], Some(1)));
        assert!(!fits(&vec![0; MEBIBYTE as usize + 1], Some(1)));
    }

    #[test]
    fn only_compressed_synctex_goes_up() {
        assert!(gzipped_synctex(Path::new(
            "/p/.oleafly/build/main.synctex.gz"
        )));
        assert!(!gzipped_synctex(Path::new(
            "/p/.oleafly/build/main.synctex"
        )));
        assert!(!gzipped_synctex(Path::new("/p/.oleafly/build/main.pdf")));
    }

    #[test]
    fn output_info_reaches_the_app_in_camel_case() {
        let info = CollabOutputInfo::from(ProjectOutput {
            kind: OutputKind::Synctex,
            size: 12,
            compiled_by: "01920000-0000-7000-8000-000000000002".parse().unwrap(),
            compiled_at: 1_760_000_000_000,
            main_file: "main.tex".to_owned(),
        });
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            json!({
                "kind": "synctex",
                "size": 12,
                "compiledBy": "01920000-0000-7000-8000-000000000002",
                "compiledAt": 1_760_000_000_000_i64,
                "mainFile": "main.tex",
            })
        );
    }
}
