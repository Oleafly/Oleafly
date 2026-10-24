//! Settings › Research › Compute: where research runs execute (SSH hosts,
//! Slurm clusters, Cua Spaces), their tests and host keys, and the local
//! sandbox (the Windows beta switch, interpreters it found, shared access).
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use oleafly_agent::CancellationToken;
use oleafly_research::runs::remote::settings::{self, ComputeTarget, SshConfigHost, TestSummary};
use oleafly_research::runs::remote::target_test::{self, ComputeTestReport};
use oleafly_research::runs::remote::transport::{known_hosts_file, SshContext, SshEndpoint};
use oleafly_research::runs::remote::{host_keys, rsync, ComputeHost, McpStdioServer};
use oleafly_research::runs::RunError;
use oleafly_sandbox::profile::{
    detect_runtimes, detect_runtimes_cached, DetectInputs, RuntimeInstall,
};
use oleafly_sandbox::{SandboxConfig, SharedGrantView, SharedScope};
use serde::Serialize;
use serde_json::Value;

const MAX_TARGETS: usize = 32;
const TEST_LIMIT: Duration = Duration::from_secs(60);
const CUA_TEST_LIMIT: Duration = Duration::from_secs(120);

/// The app as a host for runs on other computers.
pub(crate) struct AppComputeHost {
    data_root: PathBuf,
}

impl AppComputeHost {
    pub(crate) fn new(data_root: PathBuf) -> Self {
        Self { data_root }
    }

    pub(crate) fn shared() -> Option<Arc<dyn ComputeHost>> {
        crate::paths::oleafly_root()
            .ok()
            .map(|root| Arc::new(Self::new(root)) as Arc<dyn ComputeHost>)
    }
}

#[async_trait::async_trait]
impl ComputeHost for AppComputeHost {
    fn data_root(&self) -> PathBuf {
        self.data_root.clone()
    }

    fn locate_program(&self, name: &str) -> Option<PathBuf> {
        crate::program_locator::locate_native(name).map(|located| located.path)
    }

    async fn mcp_call(
        &self,
        server: &McpStdioServer,
        tool: &str,
        arguments: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        crate::mcp::client::call_stdio_tool(
            &server.program,
            &server.args,
            &server.env,
            tool,
            arguments,
            timeout,
        )
        .await
    }
}

/// Where the sandbox keeps its state, for the Windows launcher and the
/// self-test (called before anything else starts).
pub fn sandbox_config() -> Option<SandboxConfig> {
    let root = crate::paths::oleafly_root().ok()?;
    Some(SandboxConfig {
        state_dir: root.join("sandbox"),
        launcher: None,
    })
}

fn caller_allowed(webview_label: &str, window_label: &str) -> bool {
    webview_label == "main" && window_label == "main"
}

fn require_main<R: tauri::Runtime>(webview: &tauri::Webview<R>) -> Result<(), String> {
    if caller_allowed(webview.label(), webview.window().label()) {
        Ok(())
    } else {
        Err("Compute settings are unavailable from this window.".into())
    }
}

fn platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        _ => "other",
    }
}

fn data_root() -> Result<PathBuf, String> {
    crate::paths::oleafly_root()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeView {
    pub platform: &'static str,
    pub targets: Vec<ComputeTarget>,
    pub tested: BTreeMap<String, TestSummary>,
    pub ssh_available: bool,
    pub rsync_available: bool,
    pub cua_available: bool,
}

fn view(root: &std::path::Path) -> ComputeView {
    let saved = settings::load(root);
    let host = AppComputeHost::new(root.to_path_buf());
    let locate = |name: &str| host.locate_program(name);
    ComputeView {
        platform: platform(),
        targets: saved.targets,
        tested: saved.tested,
        ssh_available: SshContext::new(root, &locate).is_ok(),
        rsync_available: rsync::local_rsync(&locate).is_some(),
        cua_available: locate("cua").is_some(),
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn research_compute_settings<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
) -> Result<ComputeView, String> {
    require_main(&webview)?;
    let root = data_root()?;
    blocking(move || Ok(view(&root))).await
}

fn save_target(root: &std::path::Path, mut target: ComputeTarget) -> Result<ComputeView, String> {
    if target.id().is_empty() {
        target.set_id(settings::new_target_id());
    }
    settings::validate_target(&target)?;
    settings::update(root, |saved| {
        let id = target.id().to_string();
        // An edited target needs a new test.
        saved.tested.remove(&id);
        match saved
            .targets
            .iter()
            .position(|existing| existing.id() == id)
        {
            Some(index) => saved.targets[index] = target.clone(),
            None if saved.targets.len() >= MAX_TARGETS => {
                return Err(RunError::Config(format!(
                    "You can add up to {MAX_TARGETS} compute targets."
                )));
            }
            None => saved.targets.push(target.clone()),
        }
        Ok(())
    })?;
    Ok(view(root))
}

#[tauri::command]
pub async fn research_compute_target_save<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    target: ComputeTarget,
) -> Result<ComputeView, String> {
    require_main(&webview)?;
    let root = data_root()?;
    blocking(move || save_target(&root, target)).await
}

fn remove_target(root: &std::path::Path, target_id: &str) -> Result<ComputeView, String> {
    settings::update(root, |saved| {
        saved.targets.retain(|target| target.id() != target_id);
        saved.tested.remove(target_id);
        Ok(())
    })?;
    Ok(view(root))
}

#[tauri::command]
pub async fn research_compute_target_remove<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    target_id: String,
) -> Result<ComputeView, String> {
    require_main(&webview)?;
    let root = data_root()?;
    blocking(move || remove_target(&root, &target_id)).await
}

#[tauri::command]
pub async fn research_compute_ssh_hosts<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
) -> Result<Vec<SshConfigHost>, String> {
    require_main(&webview)?;
    blocking(|| {
        Ok(oleafly_sandbox::home_dir()
            .map(|home| settings::ssh_config_hosts(&home.join(".ssh")))
            .unwrap_or_default())
    })
    .await
}

fn find_target(root: &std::path::Path, target_id: &str) -> Result<ComputeTarget, String> {
    settings::find(&settings::load(root), target_id)
        .cloned()
        .ok_or_else(|| "This compute target no longer exists.".to_string())
}

async fn run_test(root: PathBuf, target: ComputeTarget) -> ComputeTestReport {
    let host = AppComputeHost::new(root);
    let limit = match target {
        ComputeTarget::CuaSpace { .. } => CUA_TEST_LIMIT,
        _ => TEST_LIMIT,
    };
    let cancel = CancellationToken::new();
    match tokio::time::timeout(limit, target_test::test_target(&host, &target, &cancel)).await {
        Ok(report) => report,
        Err(_) => {
            cancel.cancel();
            ComputeTestReport {
                target_id: target.id().to_string(),
                checks: Vec::new(),
                host_key: None,
                resolved: None,
                finished_at: oleafly_research::model::now_ms(),
                error: Some("The test took too long. Check the host name and your network.".into()),
            }
        }
    }
}

#[tauri::command]
pub async fn research_compute_target_test<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    target_id: String,
) -> Result<ComputeTestReport, String> {
    require_main(&webview)?;
    let root = data_root()?;
    let target = find_target(&root, &target_id)?;
    Ok(run_test(root, target).await)
}

fn endpoint_of(target: &ComputeTarget) -> Result<SshEndpoint, String> {
    match target {
        ComputeTarget::Ssh {
            host, user, port, ..
        }
        | ComputeTarget::Slurm {
            host, user, port, ..
        } => Ok(SshEndpoint {
            host: host.clone(),
            user: user.clone(),
            port: *port,
        }),
        ComputeTarget::CuaSpace { .. } => Err("Cua Spaces have no host key to trust.".into()),
    }
}

#[tauri::command]
pub async fn research_compute_trust_host_key<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    target_id: String,
    fingerprints: Vec<String>,
) -> Result<ComputeTestReport, String> {
    require_main(&webview)?;
    if fingerprints.is_empty() || fingerprints.len() > 16 {
        return Err("Confirm the host's key fingerprints first.".into());
    }
    let root = data_root()?;
    let target = find_target(&root, &target_id)?;
    let endpoint = endpoint_of(&target)?;
    let host = AppComputeHost::new(root.clone());
    let ctx = SshContext::new(&root, &|name| host.locate_program(name))?;
    let cancel = CancellationToken::new();
    tokio::time::timeout(
        TEST_LIMIT,
        host_keys::trust(&ctx, &endpoint, &fingerprints, &cancel),
    )
    .await
    .map_err(|_| "Checking the host key took too long.".to_string())??;
    Ok(run_test(root, target).await)
}

#[tauri::command]
pub async fn research_compute_forget_host_key<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    target_id: String,
) -> Result<ComputeView, String> {
    require_main(&webview)?;
    let root = data_root()?;
    blocking(move || {
        let target = find_target(&root, &target_id)?;
        let endpoint = endpoint_of(&target)?;
        let removed = host_keys::forget(&known_hosts_file(&root), &endpoint.host, endpoint.port)
            .map_err(String::from)?;
        // Saying it worked when nothing was removed would leave a replaced
        // key trusted without the user knowing.
        if removed == 0 {
            return Err(format!(
                "No trusted key for {} was found, so nothing was removed.",
                endpoint.host
            ));
        }
        settings::update(&root, |saved| {
            saved.tested.remove(&target_id);
            Ok(())
        })
        .map_err(String::from)?;
        Ok(view(&root))
    })
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    pub platform: &'static str,
    pub available: bool,
    pub reason: Option<String>,
    /// The Windows beta switch; `None` on other systems.
    pub windows_enabled: Option<bool>,
    pub runtimes: Vec<RuntimeInstall>,
    pub grants: Vec<SharedGrantView>,
}

fn sandbox_status(root: &std::path::Path, refresh: bool) -> SandboxStatus {
    let (available, reason) = match oleafly_sandbox::availability() {
        oleafly_sandbox::Availability::Available => (true, None),
        oleafly_sandbox::Availability::Unavailable(reason) => (false, Some(reason)),
    };
    let search_dirs = crate::program_locator::search_dirs();
    let home = oleafly_sandbox::home_dir();
    let env = |name: &str| std::env::var_os(name);
    let inputs = DetectInputs {
        search_dirs: &search_dirs,
        project_root: None,
        home: home.as_deref(),
        env: &env,
    };
    SandboxStatus {
        platform: platform(),
        available,
        reason,
        windows_enabled: cfg!(windows).then(|| settings::windows_sandbox_enabled(root)),
        runtimes: if refresh {
            detect_runtimes(&inputs)
        } else {
            detect_runtimes_cached(&inputs)
        },
        grants: oleafly_sandbox::shared_grants(),
    }
}

#[tauri::command]
pub async fn research_sandbox_status<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    refresh: bool,
) -> Result<SandboxStatus, String> {
    require_main(&webview)?;
    let root = data_root()?;
    blocking(move || Ok(sandbox_status(&root, refresh))).await
}

#[tauri::command]
pub async fn research_sandbox_set_windows<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    enabled: bool,
) -> Result<SandboxStatus, String> {
    require_main(&webview)?;
    if !cfg!(windows) {
        return Err("The sandbox switch only applies on Windows.".into());
    }
    let root = data_root()?;
    blocking(move || {
        settings::update(&root, |saved| {
            saved.windows_sandbox = Some(enabled);
            Ok(())
        })
        .map_err(String::from)?;
        Ok(sandbox_status(&root, false))
    })
    .await
}

#[tauri::command]
pub async fn research_sandbox_remove_access<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
) -> Result<SandboxStatus, String> {
    require_main(&webview)?;
    let root = data_root()?;
    blocking(move || {
        oleafly_sandbox::remove_shared_access(SharedScope::All)
            .map_err(|error| error.to_string())?;
        Ok(sandbox_status(&root, false))
    })
    .await
}

#[tauri::command]
pub async fn research_sandbox_check<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
) -> Result<oleafly_sandbox::selftest::SelfTestReport, String> {
    require_main(&webview)?;
    blocking(|| {
        let python =
            crate::program_locator::locate_native(if cfg!(windows) { "python" } else { "python3" })
                .map(|located| located.path);
        Ok(oleafly_sandbox::selftest::run_selftest(
            &oleafly_sandbox::selftest::SelfTestOptions {
                network: false,
                python,
                json: false,
            },
        ))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ssh(id: &str, host: &str) -> ComputeTarget {
        ComputeTarget::Ssh {
            id: id.into(),
            label: "Lab".into(),
            host: host.into(),
            user: None,
            port: None,
            remote_root: None,
            prelude: String::new(),
        }
    }

    #[test]
    fn caller_must_be_the_main_window() {
        assert!(!caller_allowed("browser-pane", "main"));
        assert!(!caller_allowed("main", "settings"));
        assert!(caller_allowed("main", "main"));
    }

    #[test]
    fn save_assigns_ids_and_validates() {
        let root = tempfile::tempdir().unwrap();
        let saved = save_target(root.path(), ssh("", "cluster.example.edu")).unwrap();
        assert!(saved.targets[0].id().starts_with("t-"));
        let before = std::fs::read_to_string(settings::compute_file(root.path())).unwrap();
        let error = save_target(root.path(), ssh("", "-oProxyCommand=x")).unwrap_err();
        assert!(error.contains("host name"), "{error}");
        assert_eq!(
            std::fs::read_to_string(settings::compute_file(root.path())).unwrap(),
            before
        );
    }

    #[test]
    fn remove_keeps_other_targets() {
        let root = tempfile::tempdir().unwrap();
        save_target(root.path(), ssh("t-a", "a.example.edu")).unwrap();
        save_target(root.path(), ssh("t-b", "b.example.edu")).unwrap();
        let left = remove_target(root.path(), "t-a").unwrap();
        assert_eq!(left.targets.len(), 1);
        assert_eq!(left.targets[0].id(), "t-b");
    }

    #[test]
    fn sandbox_status_reports_the_platform() {
        let root = tempfile::tempdir().unwrap();
        let status = sandbox_status(root.path(), false);
        let expected = match std::env::consts::OS {
            "windows" | "macos" | "linux" => std::env::consts::OS,
            _ => "other",
        };
        assert_eq!(status.platform, expected);
        if !cfg!(windows) {
            assert_eq!(status.windows_enabled, None);
        }
    }
}
