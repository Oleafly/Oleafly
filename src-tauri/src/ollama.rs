//! Local Ollama detection.
//!
//! Queries a local Ollama instance's `GET {host}/api/tags` to list the models
//! the user has actually pulled. Done on the Rust side (not the webview) because
//! Ollama's CORS policy blocks browser requests from the Tauri origin unless
//! the user configures `OLLAMA_ORIGINS`.
//!
//! The Tools converters also need to know which models read images. Ollama
//! 0.6 and later list `capabilities` in `/api/tags`; older versions only answer
//! `POST /api/show` per model, so those lookups run in parallel, are cached by
//! host and digest, and are bounded so a slow server cannot stall the listing.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

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

const TAGS_TIMEOUT: Duration = Duration::from_secs(5);
const SHOW_TIMEOUT: Duration = Duration::from_secs(3);
const SHOW_DEADLINE: Duration = Duration::from_secs(6);
const SHOW_CONCURRENCY: usize = 4;
const MAX_SHOW_LOOKUPS: usize = 64;
const MAX_SHOW_CACHE: usize = 256;

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
    #[serde(default)]
    digest: String,
    /// Present from Ollama 0.6 on; older versions leave it out.
    #[serde(default)]
    capabilities: Option<Vec<String>>,
    /// Set for an Ollama Cloud model (signed in, Ollama 0.12 on): Ollama
    /// forwards its requests to this host instead of running it here.
    #[serde(default)]
    remote_host: Option<String>,
    #[serde(default)]
    remote_model: Option<String>,
}

impl TagModel {
    /// Whether Ollama sends this model's requests to another computer, such
    /// as ollama.com. A version that leaves out `remote_host` still names its
    /// cloud models with a `cloud` or `-cloud` tag.
    fn is_remote(&self) -> bool {
        let set = |field: &Option<String>| {
            field
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        };
        if set(&self.remote_host) || set(&self.remote_model) {
            return true;
        }
        let name = self.name.trim().to_ascii_lowercase();
        let (base, tag) = name.rsplit_once(':').unwrap_or((name.as_str(), ""));
        tag == "cloud" || tag.ends_with("-cloud") || base.ends_with("-cloud")
    }
}

#[derive(Deserialize)]
struct ShowResponse {
    #[serde(default)]
    capabilities: Option<Vec<String>>,
    /// The thinking values the model accepts, from newer Ollama versions.
    #[serde(default)]
    thinking: Option<ThinkingValues>,
    #[serde(default)]
    template: Option<String>,
}

#[derive(Deserialize)]
struct ThinkingValues {
    #[serde(default)]
    values: Vec<serde_json::Value>,
}

impl ShowResponse {
    /// Whether the model stops thinking when asked to. Newer Ollama lists
    /// `false` among its thinking values. Older versions only show the prompt
    /// template, and a template that never reads the requested `.Think` value
    /// sends the same prompt either way: a think-only model such as Qwen3
    /// Thinking 2507 then thinks anyway, into its answer.
    fn stops_thinking(&self) -> bool {
        let thinks = self
            .capabilities
            .as_ref()
            .is_some_and(|capabilities| capabilities.iter().any(|c| c == "thinking"));
        if !thinks {
            return false;
        }
        match &self.thinking {
            Some(thinking) => thinking.values.contains(&serde_json::Value::Bool(false)),
            None => self.template.as_deref().is_some_and(reads_think_value),
        }
    }
}

/// `.Think` itself, not `.Thinking`, `.ThinkLevel` or `.IsThinkSet`.
fn reads_think_value(template: &str) -> bool {
    template.match_indices(".Think").any(|(at, found)| {
        !template[at + found.len()..]
            .starts_with(|next: char| next.is_ascii_alphanumeric() || next == '_')
    })
}

/// A pulled model and what it can do (`"vision"`, `"tools"`, ...). `None`
/// means Ollama did not say. `remote` marks an Ollama Cloud model, which
/// runs on another computer even though the local Ollama lists it.
/// `stops_thinking` marks a thinking model that Ollama can tell not to think.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModelInfo {
    pub name: String,
    pub capabilities: Option<Vec<String>>,
    pub remote: bool,
    pub stops_thinking: bool,
}

/// What `/api/show` said about a model.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Described {
    capabilities: Option<Vec<String>>,
    stops_thinking: bool,
}

/// `/api/show` answers by `"{base}|{digest or name}"`. A model Ollama cannot
/// describe (it answered, with no capabilities or a 4xx) is cached with none
/// so it is not asked again on every listing. A lookup that did not get an
/// answer (a timeout, a connection error, a 5xx while Ollama loads a model)
/// and one the deadline cut short are not cached: the next listing asks again.
type ShowCache = HashMap<String, Described>;

static SHOW_CACHE: LazyLock<Mutex<ShowCache>> = LazyLock::new(Default::default);

fn cache_key(base: &str, tag: &TagModel) -> String {
    let identity = if tag.digest.trim().is_empty() {
        tag.name.as_str()
    } else {
        tag.digest.as_str()
    };
    format!("{base}|{identity}")
}

fn cached_description(key: &str) -> Option<Described> {
    SHOW_CACHE
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(key)
        .cloned()
}

fn remember_description(key: String, described: Described) {
    let mut cache = SHOW_CACHE.lock().unwrap_or_else(PoisonError::into_inner);
    if cache.len() >= MAX_SHOW_CACHE {
        cache.clear();
    }
    cache.insert(key, described);
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

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(TAGS_TIMEOUT)
        .build()
        .map_err(|e| format!("could not build HTTP client: {e}"))
}

async fn fetch_tags(client: &reqwest::Client, base: &str) -> Result<Vec<TagModel>, String> {
    let url = format!("{base}/api/tags");
    let resp = client
        .get(&url)
        .timeout(TAGS_TIMEOUT)
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
    Ok(body.models)
}

enum Show {
    /// Ollama answered: what it said the model can do, with no capabilities
    /// when it said nothing (an older Ollama, or a model it does not know).
    Answer(Described),
    Unanswered,
}

async fn show_model(client: &reqwest::Client, base: &str, name: &str) -> Show {
    let Ok(response) = client
        .post(format!("{base}/api/show"))
        .timeout(SHOW_TIMEOUT)
        .json(&serde_json::json!({ "model": name }))
        .send()
        .await
    else {
        return Show::Unanswered;
    };
    let status = response.status();
    if status.is_client_error() {
        return Show::Answer(Described::default());
    }
    if !status.is_success() {
        return Show::Unanswered;
    }
    match response.json::<ShowResponse>().await {
        Ok(body) => Show::Answer(Described {
            stops_thinking: body.stops_thinking(),
            capabilities: body.capabilities,
        }),
        Err(_) => Show::Unanswered,
    }
}

async fn list_model_details_at(
    base: &str,
    show_deadline: Duration,
) -> Result<Vec<OllamaModelInfo>, String> {
    let client = http_client()?;
    let tags = fetch_tags(&client, base).await?;
    let deadline = tokio::time::Instant::now() + show_deadline;
    let mut models: Vec<OllamaModelInfo> = Vec::with_capacity(tags.len());
    let mut lookups: Vec<(usize, String, String)> = Vec::new();
    for tag in tags {
        let index = models.len();
        let remote = tag.is_remote();
        // Only `/api/show` says whether a thinking model can stop thinking.
        let thinks = tag
            .capabilities
            .as_ref()
            .is_some_and(|capabilities| capabilities.iter().any(|c| c == "thinking"));
        if tag.capabilities.is_some() && !thinks {
            models.push(OllamaModelInfo {
                name: tag.name,
                capabilities: tag.capabilities,
                remote,
                stops_thinking: false,
            });
            continue;
        }
        let key = cache_key(base, &tag);
        if let Some(described) = cached_description(&key) {
            models.push(OllamaModelInfo {
                name: tag.name,
                capabilities: described.capabilities.or(tag.capabilities),
                remote,
                stops_thinking: described.stops_thinking,
            });
            continue;
        }
        if lookups.len() < MAX_SHOW_LOOKUPS {
            lookups.push((index, key, tag.name.clone()));
        }
        models.push(OllamaModelInfo {
            name: tag.name,
            capabilities: tag.capabilities,
            remote,
            stops_thinking: false,
        });
    }

    if !lookups.is_empty() {
        let client = &client;
        let mut answers =
            futures_util::stream::iter(lookups.into_iter().map(|(index, key, name)| async move {
                let shown = show_model(client, base, &name).await;
                (index, key, shown)
            }))
            .buffer_unordered(SHOW_CONCURRENCY);
        while let Ok(Some((index, key, shown))) =
            tokio::time::timeout_at(deadline, answers.next()).await
        {
            if let Show::Answer(described) = shown {
                remember_description(key, described.clone());
                let model = &mut models[index];
                if described.capabilities.is_some() {
                    model.capabilities = described.capabilities;
                }
                model.stops_thinking = described.stops_thinking;
            }
        }
    }

    models.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(models)
}

#[tauri::command]
pub async fn ollama_list_models(host: String) -> Result<Vec<String>, String> {
    let base = base_url(&host);
    let client = http_client()?;
    let mut names: Vec<String> = fetch_tags(&client, &base)
        .await?
        .into_iter()
        .map(|model| model.name)
        .collect();
    names.sort();
    Ok(names)
}

/// The installed models with what each can do, sorted by name. Older Ollama
/// versions are asked per model through `/api/show`, within six seconds in all.
#[tauri::command]
pub async fn ollama_list_model_details(host: String) -> Result<Vec<OllamaModelInfo>, String> {
    list_model_details_at(&base_url(&host), SHOW_DEADLINE).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

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

    type Respond = Arc<dyn Fn(&str, &str, &str) -> Option<(u16, String)> + Send + Sync>;

    struct Fixture {
        base: String,
        requests: Arc<Mutex<Vec<(String, String)>>>,
    }

    impl Fixture {
        fn count(&self, path: &str) -> usize {
            self.requests
                .lock()
                .unwrap()
                .iter()
                .filter(|(line, _)| line.ends_with(path))
                .count()
        }

        fn bodies(&self, path: &str) -> Vec<String> {
            self.requests
                .lock()
                .unwrap()
                .iter()
                .filter(|(line, _)| line.ends_with(path))
                .map(|(_, body)| body.clone())
                .collect()
        }
    }

    async fn read_request(stream: &mut tokio::net::TcpStream) -> Option<(String, String, String)> {
        let mut raw = Vec::new();
        let mut buffer = [0_u8; 4096];
        let head_end = loop {
            if let Some(at) = raw.windows(4).position(|window| window == b"\r\n\r\n") {
                break at;
            }
            let read = stream.read(&mut buffer).await.ok()?;
            if read == 0 {
                return None;
            }
            raw.extend_from_slice(&buffer[..read]);
        };
        let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
        let mut lines = head.split("\r\n");
        let mut first = lines.next()?.split_whitespace();
        let method = first.next()?.to_string();
        let path = first.next()?.to_string();
        let length: usize = lines
            .filter_map(|line| line.split_once(':'))
            .find(|(name, _)| name.trim().eq_ignore_ascii_case("content-length"))
            .and_then(|(_, value)| value.trim().parse().ok())
            .unwrap_or(0);
        let mut body = raw[head_end + 4..].to_vec();
        while body.len() < length {
            let read = stream.read(&mut buffer).await.ok()?;
            if read == 0 {
                break;
            }
            body.extend_from_slice(&buffer[..read]);
        }
        Some((method, path, String::from_utf8_lossy(&body).to_string()))
    }

    async fn serve(
        respond: impl Fn(&str, &str, &str) -> Option<(u16, String)> + Send + Sync + 'static,
    ) -> Fixture {
        let respond: Respond = Arc::new(respond);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests: Arc<Mutex<Vec<(String, String)>>> = Arc::default();
        let recorded = Arc::clone(&requests);
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                let respond = Arc::clone(&respond);
                let recorded = Arc::clone(&recorded);
                tokio::spawn(async move {
                    let Some((method, path, body)) = read_request(&mut stream).await else {
                        return;
                    };
                    recorded
                        .lock()
                        .unwrap()
                        .push((format!("{method} {path}"), body.clone()));
                    match respond(&method, &path, &body) {
                        Some((status, reply)) => {
                            let head = format!(
                                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                reply.len()
                            );
                            let _ = stream.write_all(head.as_bytes()).await;
                            let _ = stream.write_all(reply.as_bytes()).await;
                        }
                        None => tokio::time::sleep(Duration::from_secs(30)).await,
                    }
                });
            }
        });
        Fixture { base, requests }
    }

    fn requested_model(body: &str) -> String {
        serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|value| value["model"].as_str().map(str::to_owned))
            .unwrap_or_default()
    }

    #[tokio::test]
    async fn tags_with_capabilities_need_no_show_requests() {
        let fixture = serve(|method, path, _| match (method, path) {
            ("GET", "/api/tags") => Some((
                200,
                r#"{"models":[
                    {"name":"llama3.2","digest":"d2","capabilities":["completion","tools"]},
                    {"name":"glm-ocr:latest","digest":"d1","capabilities":["completion","vision"]}
                ]}"#
                .to_string(),
            )),
            _ => Some((404, String::new())),
        })
        .await;
        let models = list_model_details_at(&fixture.base, Duration::from_millis(500))
            .await
            .unwrap();
        assert_eq!(
            models,
            vec![
                OllamaModelInfo {
                    name: "glm-ocr:latest".into(),
                    capabilities: Some(vec!["completion".into(), "vision".into()]),
                    remote: false,
                    stops_thinking: false,
                },
                OllamaModelInfo {
                    name: "llama3.2".into(),
                    capabilities: Some(vec!["completion".into(), "tools".into()]),
                    remote: false,
                    stops_thinking: false,
                },
            ]
        );
        assert_eq!(fixture.count("/api/show"), 0);
    }

    #[tokio::test]
    async fn only_thinking_models_ollama_can_switch_off_stop_thinking() {
        let fixture = serve(|method, path, body| match (method, path) {
            ("GET", "/api/tags") => Some((
                200,
                r#"{"models":[
                    {"name":"qwen3:0.6b","digest":"h1"},
                    {"name":"qwen3:4b","digest":"t1"},
                    {"name":"r1:new","digest":"n1","capabilities":["completion","thinking"]},
                    {"name":"magistral:new","digest":"n2","capabilities":["completion","thinking"]},
                    {"name":"llama3.2:latest","digest":"l1","capabilities":["completion","tools"]}
                ]}"#
                .to_string(),
            )),
            ("POST", "/api/show") => Some((
                200,
                match requested_model(body).as_str() {
                    "qwen3:0.6b" => {
                        r#"{"capabilities":["completion","tools","thinking"],
                        "template":"{{ if and $.IsThinkSet (not $.Think) }} /no_think{{ end }}"}"#
                    }
                    "qwen3:4b" => {
                        r#"{"capabilities":["completion","tools","thinking"],
                        "template":"{{ if $.IsThinkSet }}{{ .Thinking }}{{ end }}"}"#
                    }
                    "r1:new" => {
                        r#"{"capabilities":["completion","thinking"],
                        "thinking":{"values":[false,true],"default":true}}"#
                    }
                    _ => {
                        r#"{"capabilities":["completion","thinking"],
                        "thinking":{"values":[true],"default":true},"template":"{{ $.Think }}"}"#
                    }
                }
                .to_string(),
            )),
            _ => Some((404, String::new())),
        })
        .await;
        let models = list_model_details_at(&fixture.base, Duration::from_secs(2))
            .await
            .unwrap();
        let stops: Vec<(&str, bool)> = models
            .iter()
            .map(|model| (model.name.as_str(), model.stops_thinking))
            .collect();
        assert_eq!(
            stops,
            [
                ("llama3.2:latest", false),
                ("magistral:new", false),
                ("qwen3:0.6b", true),
                ("qwen3:4b", false),
                ("r1:new", true),
            ]
        );
        assert_eq!(fixture.count("/api/show"), 4);
    }

    #[test]
    fn only_the_think_value_itself_counts_as_read() {
        assert!(reads_think_value("{{ if $.Think }}"));
        assert!(reads_think_value("{{- if not .Think -}}"));
        assert!(!reads_think_value(
            "{{ if $.IsThinkSet }}{{ .Thinking }}{{ $.ThinkLevel }}{{ end }}"
        ));
    }

    #[tokio::test]
    async fn cloud_models_are_marked_remote() {
        let fixture = serve(|method, path, _| match (method, path) {
            ("GET", "/api/tags") => Some((
                200,
                r#"{"models":[
                    {"name":"qwen3-vl:235b-cloud","digest":"c1","capabilities":["completion","vision"],
                     "remote_model":"qwen3-vl:235b","remote_host":"https://ollama.com:443"},
                    {"name":"gpt-oss:120b-cloud","digest":"c2","capabilities":["completion"]},
                    {"name":"minimax-m2:cloud","digest":"c3","capabilities":["completion"]},
                    {"name":"proxied","digest":"c4","capabilities":["completion"],"remote_host":"http://10.0.0.2:11434"},
                    {"name":"qwen2.5vl:7b","digest":"l1","capabilities":["completion","vision"],"remote_host":""},
                    {"name":"wordcloud:latest","digest":"l2","capabilities":["completion"]}
                ]}"#
                .to_string(),
            )),
            _ => Some((404, String::new())),
        })
        .await;
        let models = list_model_details_at(&fixture.base, Duration::from_millis(500))
            .await
            .unwrap();
        let remote: Vec<(&str, bool)> = models
            .iter()
            .map(|model| (model.name.as_str(), model.remote))
            .collect();
        assert_eq!(
            remote,
            [
                ("gpt-oss:120b-cloud", true),
                ("minimax-m2:cloud", true),
                ("proxied", true),
                ("qwen2.5vl:7b", false),
                ("qwen3-vl:235b-cloud", true),
                ("wordcloud:latest", false),
            ]
        );
    }

    #[tokio::test]
    async fn older_ollama_falls_back_to_show_and_unknown_stays_unknown() {
        let fixture = serve(|method, path, body| match (method, path) {
            ("GET", "/api/tags") => Some((
                200,
                r#"{"models":[{"name":"deepseek-ocr","digest":"a1"},{"name":"llava","digest":"b2"}]}"#
                    .to_string(),
            )),
            ("POST", "/api/show") if requested_model(body) == "deepseek-ocr" => Some((
                200,
                r#"{"capabilities":["completion","vision"]}"#.to_string(),
            )),
            _ => Some((404, String::new())),
        })
        .await;
        let models = list_model_details_at(&fixture.base, Duration::from_secs(2))
            .await
            .unwrap();
        assert_eq!(models[0].name, "deepseek-ocr");
        assert_eq!(
            models[0].capabilities.as_deref(),
            Some(&["completion".to_string(), "vision".to_string()][..])
        );
        assert_eq!(models[1].name, "llava");
        assert_eq!(models[1].capabilities, None);
        let mut asked: Vec<String> = fixture
            .bodies("/api/show")
            .iter()
            .map(|body| requested_model(body))
            .collect();
        asked.sort();
        assert_eq!(asked, ["deepseek-ocr", "llava"]);
    }

    #[tokio::test]
    async fn a_lookup_that_got_no_answer_is_not_cached_but_a_404_is() {
        let loading = Arc::new(AtomicBool::new(true));
        let still_loading = Arc::clone(&loading);
        let fixture = serve(move |method, path, body| match (method, path) {
            ("GET", "/api/tags") => Some((
                200,
                r#"{"models":[{"name":"my-ocr-finetune","digest":"ft-1"},{"name":"gone","digest":"gone-1"}]}"#
                    .to_string(),
            )),
            // Ollama is busy loading a model: the fine-tune cannot be shown.
            ("POST", "/api/show") if requested_model(body) == "my-ocr-finetune" => {
                if still_loading.load(Ordering::SeqCst) {
                    Some((503, String::new()))
                } else {
                    Some((
                        200,
                        r#"{"capabilities":["completion","vision"]}"#.to_string(),
                    ))
                }
            }
            _ => Some((404, String::new())),
        })
        .await;
        let first = list_model_details_at(&fixture.base, Duration::from_secs(2))
            .await
            .unwrap();
        let capabilities = |models: &[OllamaModelInfo], name: &str| {
            models
                .iter()
                .find(|model| model.name == name)
                .and_then(|model| model.capabilities.clone())
        };
        assert_eq!(capabilities(&first, "my-ocr-finetune"), None);

        loading.store(false, Ordering::SeqCst);
        let second = list_model_details_at(&fixture.base, Duration::from_secs(2))
            .await
            .unwrap();
        assert_eq!(
            capabilities(&second, "my-ocr-finetune"),
            Some(vec!["completion".to_string(), "vision".to_string()])
        );
        assert_eq!(capabilities(&second, "gone"), None);
        let asked: Vec<String> = fixture
            .bodies("/api/show")
            .iter()
            .map(|body| requested_model(body))
            .collect();
        assert_eq!(asked.iter().filter(|name| *name == "gone").count(), 1);
        assert_eq!(
            asked
                .iter()
                .filter(|name| *name == "my-ocr-finetune")
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn show_results_are_cached_by_host_and_digest() {
        let fixture = serve(|method, path, _| match (method, path) {
            ("GET", "/api/tags") => Some((
                200,
                r#"{"models":[{"name":"llava:7b","digest":"same-a"},{"name":"phi","digest":"same-b"}]}"#
                    .to_string(),
            )),
            ("POST", "/api/show") => Some((200, r#"{"capabilities":["completion"]}"#.to_string())),
            _ => Some((404, String::new())),
        })
        .await;
        for _ in 0..2 {
            let models = list_model_details_at(&fixture.base, Duration::from_secs(2))
                .await
                .unwrap();
            assert_eq!(models.len(), 2);
            assert!(models.iter().all(
                |model| model.capabilities.as_deref() == Some(&["completion".to_string()][..])
            ));
        }
        assert_eq!(fixture.count("/api/show"), 2);
        assert_eq!(fixture.count("/api/tags"), 2);
    }

    #[tokio::test]
    async fn a_slow_show_endpoint_cannot_stall_the_listing() {
        let slow = Arc::new(AtomicBool::new(true));
        let answer_slowly = Arc::clone(&slow);
        let fixture = serve(move |method, path, _| match (method, path) {
            ("GET", "/api/tags") => Some((
                200,
                r#"{"models":[{"name":"qwen2.5vl:7b","digest":"slow-1"}]}"#.to_string(),
            )),
            ("POST", "/api/show") if answer_slowly.load(Ordering::SeqCst) => None,
            ("POST", "/api/show") => Some((
                200,
                r#"{"capabilities":["completion","vision"]}"#.to_string(),
            )),
            _ => Some((404, String::new())),
        })
        .await;
        let started = std::time::Instant::now();
        let models = list_model_details_at(&fixture.base, Duration::from_millis(200))
            .await
            .unwrap();
        assert!(started.elapsed() < Duration::from_secs(10));
        assert_eq!(models[0].capabilities, None);

        slow.store(false, Ordering::SeqCst);
        let models = list_model_details_at(&fixture.base, Duration::from_secs(2))
            .await
            .unwrap();
        assert_eq!(
            models[0].capabilities.as_deref(),
            Some(&["completion".to_string(), "vision".to_string()][..])
        );
        assert_eq!(fixture.count("/api/show"), 2);
    }

    #[tokio::test]
    async fn the_name_listing_keeps_its_errors_and_sorting() {
        let fixture = serve(|method, path, _| match (method, path) {
            ("GET", "/api/tags") => Some((
                200,
                r#"{"models":[{"name":"zeta"},{"name":"alpha","capabilities":["vision"]}]}"#
                    .to_string(),
            )),
            _ => Some((404, String::new())),
        })
        .await;
        assert_eq!(
            ollama_list_models(fixture.base.clone()).await.unwrap(),
            ["alpha", "zeta"]
        );
        assert_eq!(fixture.count("/api/show"), 0);

        let missing = serve(|_, _, _| Some((500, String::new()))).await;
        let error = ollama_list_models(missing.base.clone()).await.unwrap_err();
        assert!(error.contains("for /api/tags"), "{error}");
    }
}
