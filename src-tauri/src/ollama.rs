//! Local Ollama detection.
//!
//! Queries a local Ollama instance's `GET {host}/api/tags` to list the models
//! the user has actually pulled. Done on the Rust side (not the webview) because
//! Ollama's CORS policy blocks browser requests from the Tauri origin unless

use serde::Deserialize;

use crate::proc::NoConsole;

#[cfg(target_os = "windows")]
const OLLAMA_BINARY: &str = "ollama.exe";
#[cfg(not(target_os = "windows"))]
const OLLAMA_BINARY: &str = "ollama";

#[cfg(target_os = "macos")]
const EXTRA_BIN_DIRS: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
#[cfg(target_os = "linux")]
const EXTRA_BIN_DIRS: [&str; 4] = ["/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"];
#[cfg(target_os = "windows")]
const EXTRA_BIN_DIRS: [&str; 0] = [];

fn installed_ollama() -> Option<std::path::PathBuf> {
    if let Some(paths) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&paths) {
            let candidate = directory.join(OLLAMA_BINARY);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    EXTRA_BIN_DIRS
        .iter()
        .map(|directory| std::path::Path::new(directory).join(OLLAMA_BINARY))
        .find(|candidate| candidate.is_file())
}

/// Whether an `ollama` executable exists on this machine, so the UI can offer
/// to start it instead of only telling the user it is not running.
#[tauri::command]
pub async fn ollama_installed() -> bool {
    installed_ollama().is_some()
}

/// Start a local Ollama server. Succeeds once the process is spawned; the
/// caller re-checks reachability, since the server needs a moment to bind.
#[tauri::command]
pub async fn ollama_start() -> Result<(), String> {
    let binary =
        installed_ollama().ok_or_else(|| "Ollama is not installed on this machine.".to_string())?;
    let mut command = std::process::Command::new(binary);
    command.arg("serve");
    command.no_console();
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not start Ollama: {error}"))
}

#[derive(Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<TagModel>,
}

#[derive(Deserialize)]
struct TagModel {
    name: String,
}

/// Normalize a user-entered host into a base URL for the Ollama REST API,
/// dropping trailing slashes and a trailing `/v1` (the OpenAI-compat shim path).
fn base_url(host: &str) -> String {
    let h = host.trim().trim_end_matches('/');
    let h = h.strip_suffix("/v1").unwrap_or(h).trim_end_matches('/');
    if h.is_empty() {
        // Use the IPv4 loopback literal, not "localhost": Ollama binds 127.0.0.1
        // (IPv4) by default, but on Windows "localhost" often resolves to ::1
        // (IPv6) first, and the request then fails as "not reachable".
        "http://127.0.0.1:11434".to_string()
    } else {
        h.to_string()
    }
}

/// List the models installed in a local Ollama instance. Returns a sorted list
/// of model tags (e.g. `llama3.2:latest`), or an error string if Ollama isn't
/// reachable (not running / not installed).
#[tauri::command]
pub async fn ollama_list_models(host: String) -> Result<Vec<String>, String> {
    let base = base_url(&host);
    let url = format!("{base}/api/tags");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("could not build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|_| format!("Ollama not reachable at {base}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned {} for /api/tags", resp.status()));
    }

    let body: TagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("unexpected /api/tags response: {e}"))?;

    let mut names: Vec<String> = body.models.into_iter().map(|m| m.name).collect();
    names.sort();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::base_url;

    #[test]
    fn normalizes_hosts() {
        assert_eq!(base_url(""), "http://127.0.0.1:11434");
        assert_eq!(base_url("  "), "http://127.0.0.1:11434");
        assert_eq!(base_url("http://localhost:11434"), "http://localhost:11434");
        assert_eq!(
            base_url("http://localhost:11434/"),
            "http://localhost:11434"
        );
        assert_eq!(
            base_url("http://localhost:11434/v1"),
            "http://localhost:11434"
        );
        assert_eq!(
            base_url("http://localhost:11434/v1/"),
            "http://localhost:11434"
        );
        assert_eq!(
            base_url("http://192.168.1.9:11434"),
            "http://192.168.1.9:11434"
        );
    }
}
